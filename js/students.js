// students.js — 학생 목록·포인트/능력치 수정·일괄 추가
import { state } from './state.js?v=20261111c';
import {
  addDoc, auth, collection, createUserWithEmailAndPassword, db, doc, getDocFromServer, increment,
  serverTimestamp, setDoc, updateDoc
} from './firebase.js?v=20261111c';
import { RANK_NAMES, closeModal, getRankIdx, openModal, showToast } from './core.js?v=20261111c';
import { formatLoginTime } from './level.js?v=20261111c';
import { helperCreateStudent, helperSignOut, savePwHint } from './accounts.js?v=20261111c';
import { reloadStudents } from './realtime.js?v=20261111c';
import { renderDashboard } from './dashboard.js?v=20261111c';

// ===== 학생 목록 =====
export function renderStudentList() {
  const sorted = [...state.students].sort((a,b) => (a.number||999)-(b.number||999));
  const tbody = document.getElementById('studentListBody');
  tbody.innerHTML = sorted.map((s) => `
    <tr style="${s.hidden?'opacity:0.45;':''}">
      <td>
        <input type="number" min="1" max="99" value="${s.number||''}" placeholder="-"
          style="width:56px;padding:4px 8px;font-size:13px;text-align:center;"
          onchange="updateStudentNumber('${s.id}', this.value)" />
      </td>
      <td><strong>${s.name}</strong>${s.hidden?'<span style="font-size:10px;color:#94a3b8;margin-left:4px;">[숨김]</span>':''}${state.students.filter(x=>x.name===s.name).length>1?`<div style="font-size:10px;color:#dc2626;margin-top:2px;">⚠️ 중복 · ID …${s.id.slice(-6)}${s.createdAt?.seconds?' · 생성 '+new Date(s.createdAt.seconds*1000).toLocaleString('ko-KR',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}):''}</div>`:''}</td>
      <td>
        <span class="badge badge-primary" style="cursor:pointer;" title="클릭하여 수정"
          onclick="openEditPointModal('${s.id}','${s.name}',${s.accumulatedPoints||s.points||0},'accum')">
          🪙 ${(s.accumulatedPoints||s.points||0).toLocaleString()}
        </span>
      </td>
      <td>
        <span class="badge" style="background:#fff7ed;color:#c2410c;border:1px solid #fed7aa;cursor:pointer;" title="클릭하여 수정"
          onclick="openEditPointModal('${s.id}','${s.name}',${s.points||0},'gold')">
          🪙 ${(s.points||0).toLocaleString()}
        </span>
      </td>
      <td style="font-size:12px;color:var(--text-secondary);">
        ${s.lastActiveAt
          ? `<span title="마지막 메뉴 이동 시각">${formatLoginTime(s.lastActiveAt)}</span>`
          : s.lastLoginAt
          ? `<span style="color:var(--text-muted);" title="로그인 시각">${formatLoginTime(s.lastLoginAt)}</span>`
          : '-'}
      </td>
      <td><button class="btn btn-secondary btn-sm" onclick="openEditAbilityModal('${s.id}','${s.name}')" style="white-space:nowrap;">⚡ 수정</button></td>
      <td>
        <button class="btn btn-secondary btn-sm" onclick="openChangePw('${s.id}','${s.name}')">🔒 비번변경</button>
      </td>
      <td>
        <button class="btn btn-sm" onclick="toggleStudentHidden('${s.id}',${!!s.hidden})"
          style="background:${s.hidden?'#f0fdf4':'#f8fafc'};border:1px solid ${s.hidden?'#86efac':'#e2e8f0'};color:${s.hidden?'#16a34a':'#64748b'};font-size:11px;padding:3px 8px;border-radius:6px;cursor:pointer;white-space:nowrap;">
          ${s.hidden?'👁️ 표시':'🙈 숨김'}
        </button>
      </td>
      <td><button class="btn btn-danger btn-sm" onclick="deleteStudent('${s.id}','${s.name}')">삭제</button></td>
    </tr>
  `).join('') || '<tr><td colspan="8" style="text-align:center;color:var(--text-muted);padding:30px">학생이 없어요. 학생을 추가해 주세요!</td></tr>';
}

window.toggleStudentHidden = async function(id, isHidden) {
  await updateDoc(doc(db, 'students', id), { hidden: !isHidden });
  showToast(!isHidden ? '🙈 숨김 처리됐어요' : '👁️ 표시로 변경됐어요');
};

let editPointTarget = { id: '', type: '' };

window.openEditPointModal = function(id, name, currentVal, type) {
  editPointTarget = { id, type };
  const isAccum = type === 'accum';
  document.getElementById('editPointModalTitle').textContent = isAccum ? '🪙 누적 포인트 수정' : '💰 골드 수정';
  document.getElementById('editPointModalSubtitle').textContent = `${name} 학생`;
  document.getElementById('editPointLabel').textContent = isAccum ? '누적 포인트' : '골드';
  document.getElementById('editPointInput').value = currentVal;
  openModal('editPointModal');
  setTimeout(() => document.getElementById('editPointInput').select(), 100);
};

window.saveEditPoint = async function() {
  const val = parseInt(document.getElementById('editPointInput').value);
  if (isNaN(val) || val < 0) return showToast('올바른 숫자를 입력하세요');
  const { id, type } = editPointTarget;
  try {
    if (type === 'accum') {
      await updateDoc(doc(db, 'students', id), { accumulatedPoints: val });
    } else {
      // 골드(points)만 수정 - accumulatedPoints가 없는 학생은 0으로 초기화해서 분리
      const sData = state.students.find(s => s.id === id);
      const updateData = { points: val };
      if (sData?.accumulatedPoints === undefined) updateData.accumulatedPoints = 0;
      await updateDoc(doc(db, 'students', id), updateData);
    }
    // students 캐시 즉시 갱신 (onSnapshot 도착 전에 렌더 대응)
    const idx = state.students.findIndex(s => s.id === id);
    if (idx >= 0) {
      if (type === 'accum') state.students[idx] = { ...state.students[idx], accumulatedPoints: val };
      else                   state.students[idx] = { ...state.students[idx], points: val };
    }
    closeModal('editPointModal');
    showToast('수정됐어요 ✅');
    renderStudentList();
    renderDashboard();
  } catch(e) { showToast('오류: ' + e.message); }
};

let editAbilityTarget = { id: '', name: '' };
const ABILITY_KEYS = ['성실성','인성','사회성','지력','집중력'];

window.openEditAbilityModal = function(id, name) {
  editAbilityTarget = { id, name };
  document.getElementById('editAbilitySubtitle').textContent = `${name} 학생`;
  const s = state.students.find(s => s.id === id);
  const ab = s?.abilities || {};
  ABILITY_KEYS.forEach(k => {
    const el = document.getElementById(`editAb_${k}`);
    if (el) el.value = ab[k] || 0;
  });
  openModal('editAbilityModal');
};

window.saveEditAbility = async function() {
  const { id, name } = editAbilityTarget;
  const newVals = {};
  for (const k of ABILITY_KEYS) {
    const val = parseInt(document.getElementById(`editAb_${k}`)?.value);
    if (isNaN(val)) return showToast(`${k} 값을 올바르게 입력하세요`);
    newVals[k] = val;
  }
  try {
    // 서버에서 최신 데이터 읽기 (stale 캐시 방지)
    const freshDoc = await getDocFromServer(doc(db, 'students', id));
    const freshData = freshDoc.exists() ? freshDoc.data() : {};
    const prevAbilities = freshData.abilities || {};
    const rankGranted = freshData.abilityRankGranted || {};

    const abilityOnlyUpdate = {};
    const rankGrantedUpdate = {};
    let rankBonus = 0;
    const rankUpDetails = [];

    for (const k of ABILITY_KEYS) {
      abilityOnlyUpdate[`abilities.${k}`] = newVals[k];
      const prev = prevAbilities[k] || 0;
      const next = newVals[k];
      const prevRankIdx = getRankIdx(prev);
      const nextRankIdx = getRankIdx(next);
      const alreadyGranted = rankGranted[k] !== undefined ? rankGranted[k] : prevRankIdx;

      if (nextRankIdx > alreadyGranted) {
        // 새 랭크 진입 → 보상 지급 + abilityRankGranted 갱신
        rankBonus += 500 * (nextRankIdx - Math.max(prevRankIdx, alreadyGranted));
        rankUpDetails.push({ key: k, rank: RANK_NAMES[nextRankIdx] });
        rankGrantedUpdate[`abilityRankGranted.${k}`] = nextRankIdx;
      } else if (nextRankIdx < alreadyGranted) {
        // 능력치가 낮아진 경우 → abilityRankGranted도 현재 랭크로 낮춰서 동기화
        // (이후 카드로 다시 올라갈 때 정상 보상 가능하게)
        rankGrantedUpdate[`abilityRankGranted.${k}`] = nextRankIdx;
      }
      // nextRankIdx === alreadyGranted 이면 변경 없음 (정상)
    }

    // 1단계: 능력치만 업데이트
    await updateDoc(doc(db, 'students', id), abilityOnlyUpdate);

    // 2단계: 랭크업 보상 + abilityRankGranted 동기화
    if (rankBonus > 0 || Object.keys(rankGrantedUpdate).length > 0) {
      const update2 = { ...rankGrantedUpdate };
      if (rankBonus > 0) {
        update2.points = increment(rankBonus);
        update2.accumulatedPoints = increment(rankBonus);
      }
      await updateDoc(doc(db, 'students', id), update2);
    }

    // 랭크업 보상 history 기록
    for (const detail of rankUpDetails) {
      await addDoc(collection(db, 'history'), {
        studentId: id, studentName: name,
        delta: 500,
        reason: `능력치 등급 상승 보상 (${detail.key} → ${detail.rank}) [교사 직접 수정]`,
        type: 'plus', source: 'abilityEdit',
        createdAt: serverTimestamp()
      });
    }

    // 로컬 캐시 즉시 갱신
    const idx = state.students.findIndex(s => s.id === id);
    if (idx >= 0) state.students[idx] = { ...state.students[idx], abilities: { ...newVals } };

    closeModal('editAbilityModal');
    if (rankBonus > 0) {
      const rankMsg = rankUpDetails.map(d => `${d.key} → ${d.rank}`).join(', ');
      showToast(`${name} 학생 능력치 수정 완료! 🎉 랭크업 보상 +${rankBonus}🪙 (${rankMsg})`);
    } else {
      showToast(`${name} 학생 능력치 수정 완료 ✅`);
    }
    renderStudentList();
  } catch(e) { showToast('오류: ' + e.message); }
};

window.updateStudentNumber = async function(id, val) {
  const num = parseInt(val);
  if (isNaN(num) || num < 1) return;
  try {
    await updateDoc(doc(db, 'students', id), { number: num });
    const idx = state.students.findIndex(s => s.id === id);
    if (idx >= 0) state.students[idx] = { ...state.students[idx], number: num };
    renderStudentList();
  } catch(e) { showToast('오류: ' + e.message); }
};

window.openBulkAddModal = function() {
  document.getElementById('bulkStudentInput').value = '';
  document.getElementById('bulkProgress').classList.add('hidden');
  document.getElementById('bulkAddBtn').disabled = false;
  document.getElementById('bulkCancelBtn').disabled = false;
  openModal('bulkAddModal');
};

window.bulkAddStudents = async function() {
  const raw = document.getElementById('bulkStudentInput').value.trim();
  if (!raw) return showToast('학생 목록을 입력하세요');

  const lines = raw.split('\n').map(l => l.trim()).filter(l => l);
  const parsed = [];
  for (const line of lines) {
    const parts = line.split(',');
    if (parts.length < 2) { showToast(`형식 오류: "${line}" — 이름,비밀번호 형식으로 입력하세요`); return; }
    const name = parts[0].trim();
    const pw = parts[1].trim();
    if (!name || !pw) { showToast(`빈 값이 있어요: "${line}"`); return; }
    if (state.students.find(s => s.name === name)) { showToast(`"${name}"은 이미 존재하는 학생이에요`); return; }
    parsed.push({ name, pw });
  }

  // 진행 표시
  document.getElementById('bulkProgress').classList.remove('hidden');
  document.getElementById('bulkAddBtn').disabled = true;
  document.getElementById('bulkCancelBtn').disabled = true;

  let success = 0;
  let fail = 0;
  for (let i = 0; i < parsed.length; i++) {
    const { name, pw } = parsed[i];
    const pct = Math.round(((i) / parsed.length) * 100);
    document.getElementById('bulkProgressBar').style.width = pct + '%';
    document.getElementById('bulkProgressText').textContent = `추가 중... (${i+1}/${parsed.length}) — ${name}`;
    try {
      // 보조 창구로 계정 생성 (선생님 로그인은 그대로 유지)
      const user = await helperCreateStudent(name, pw);
      await setDoc(doc(db, 'students', user.uid), {
        name, points: 0, accumulatedPoints: 0, createdAt: serverTimestamp()
      });
      await savePwHint(user.uid, pw);
      success++;
    } catch(e) {
      console.error(name, e);
      fail++;
    }
  }

  await helperSignOut();
  document.getElementById('bulkProgressBar').style.width = '100%';
  document.getElementById('bulkProgressText').textContent = `완료! 성공 ${success}명${fail > 0 ? `, 실패 ${fail}명` : ''}`;

  await reloadStudents();
  setTimeout(() => {
    closeModal('bulkAddModal');
    showToast(`${success}명 추가 완료! 🎉`);
    renderStudentList();
    renderDashboard();
  }, 1200);
};
