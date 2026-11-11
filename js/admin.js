// admin.js — 데이터 초기화, 학생 계정 관리·재생성·마이그레이션
import { state } from './state.js?v=20261111c';
import {
  addDoc, collection, db, deleteDoc, doc, getDoc, getDocs,
  increment, query, serverTimestamp, setDoc, updateDoc, updatePassword,
  where
} from './firebase.js?v=20261111c';
import { closeModal, openModal, showToast } from './core.js?v=20261111c';
import { makePw, nameToEmail } from './level.js?v=20261111c';
import { getPwHint, helperCreateStudent, helperSignInStudent, helperSignOut, removePwHint, savePwHint } from './accounts.js?v=20261111c';
import { reloadStudents } from './realtime.js?v=20261111c';
import { renderDashboard } from './dashboard.js?v=20261111c';
import { renderStudentList } from './students.js?v=20261111c';

// ===== 데이터 초기화 =====
// 전체 프레임 인벤토리 초기화
window.resetAllFrames = async function() {
  const confirmText = document.getElementById('resetFrameConfirmInput').value.trim();
  if (confirmText !== '프레임초기화') return showToast('확인 텍스트를 정확히 입력해주세요');
  try {
    // frameInventory 전체 삭제
    const invSnap = await getDocs(collection(db, 'frameInventory'));
    await Promise.all(invSnap.docs.map(d => deleteDoc(d.ref)));
    // frameDeleted 전체 삭제
    const delSnap = await getDocs(collection(db, 'frameDeleted'));
    await Promise.all(delSnap.docs.map(d => deleteDoc(d.ref)));
    // 모든 학생 equippedFrameId 초기화
    const sSnap = await getDocs(collection(db, 'students'));
    await Promise.all(sSnap.docs.map(d => updateDoc(d.ref, { equippedFrameId: null })));
    closeModal('resetFrameModal');
    showToast('전체 프레임 인벤토리가 초기화됐어요 🖼️');
    await reloadStudents();
    renderStudentList();
  } catch(e) { showToast('오류: ' + e.message); }
};

window.openResetModal = function() {
  document.getElementById('resetConfirmInput').value = '';
  openModal('resetModal');
};

window.openDungeonRewardReclaim = async function() {
  showToast('내역 불러오는 중...');
  // 모든 던전 보상 내역 조회 (개인/단체/문제 던전) — 한 번만 조회
  const allSnap = await getDocs(query(
    collection(db, 'history'),
    where('source', 'in', ['dungeon','quizDungeon'])
  ));
  const records = allSnap.docs
    .map(d => ({ id: d.id, ref: d.ref, ...d.data() }))
    .sort((a,b) => (b.createdAt?.seconds||0) - (a.createdAt?.seconds||0))
    .slice(0, 100); // 최근 100건

  window._reclaimRecords = records;

  let modal = document.getElementById('dungeonReclaimModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'dungeonReclaimModal';
    modal.className = 'modal-overlay hidden';
    document.body.appendChild(modal);
  }

  const rows = records.map((r, i) => {
    const s = state.students.find(st => st.id === r.studentId);
    const name = s ? `${s.number||''}번 ${s.name}` : '알 수 없는 계정';
    const abHtml = r.abilities && Object.keys(r.abilities).length
      ? Object.entries(r.abilities).map(([k,v])=>`${k}+${v}`).join(' ')
      : '';
    const date = r.createdAt?.toDate?.()?.toLocaleString('ko-KR',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}) || '';
    return `
      <div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--border);">
        <input type="checkbox" id="reclaim_${i}" data-idx="${i}" style="width:16px;height:16px;cursor:pointer;flex-shrink:0;" />
        <div style="flex:1;min-width:0;">
          <div style="font-size:13px;font-weight:600;">${name}</div>
          <div style="font-size:11px;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${r.reason}</div>
          ${abHtml ? `<div style="font-size:11px;color:#7c3aed;">${abHtml}</div>` : ''}
        </div>
        <div style="text-align:right;flex-shrink:0;">
          <div style="font-size:13px;font-weight:700;color:#16a34a;">+${r.delta}🪙</div>
          <div style="font-size:10px;color:var(--text-muted);">${date}</div>
        </div>
      </div>`;
  }).join('');

  modal.innerHTML = `<div class="modal" style="max-width:540px;max-height:88vh;overflow:hidden;padding:0;display:flex;flex-direction:column;">
    <div style="padding:20px 20px 0;font-size:17px;font-weight:700;flex-shrink:0;">⚔️ 던전 보상 회수</div>
    <div style="padding:6px 20px 10px;font-size:12px;color:var(--text-muted);flex-shrink:0;">회수할 내역에 체크하면 포인트와 능력치가 함께 회수됩니다. (최근 100건)</div>
    <div style="overflow-y:auto;flex:1;padding:0 20px;">${rows || '<div style="padding:20px;text-align:center;color:var(--text-muted);">던전 보상 내역이 없어요</div>'}</div>
    <div style="padding:14px 20px;display:flex;gap:8px;flex-shrink:0;border-top:1px solid var(--border);">
      <button class="btn btn-secondary btn-full" onclick="closeModal('dungeonReclaimModal')">취소</button>
      <button class="btn btn-danger btn-full" onclick="executeDungeonReclaim()">선택 내역 회수</button>
    </div>
  </div>`;
  modal.classList.remove('hidden');
  modal.style.opacity = '0';
  requestAnimationFrame(() => { modal.style.transition = 'opacity 0.35s ease'; modal.style.opacity = '1'; });
};

window.executeDungeonReclaim = async function() {
  const records = window._reclaimRecords || [];
  const targets = records.filter((_, i) => document.getElementById(`reclaim_${i}`)?.checked);
  if (!targets.length) return showToast('회수할 내역을 선택하세요');
  if (!confirm(`${targets.length}건의 던전 보상을 회수할까요?\n포인트와 능력치가 모두 회수됩니다.`)) return;
  try {
    await Promise.all(targets.map(async r => {
      const s = state.students.find(st => st.id === r.studentId);
      // 포인트 회수
      const updateData = {
        points: increment(-(r.delta||0)),
        accumulatedPoints: increment(-(r.delta||0)),
      };
      // 능력치 회수
      if (r.abilities) {
        Object.entries(r.abilities).forEach(([k,v]) => {
          if (v > 0) updateData[`abilities.${k}`] = increment(-v);
        });
      }
      await updateDoc(doc(db, 'students', r.studentId), updateData);
      // 회수 history 기록
      const abMsg = r.abilities ? Object.entries(r.abilities).filter(([,v])=>v>0).map(([k,v])=>`${k}-${v}`).join(' ') : '';
      await addDoc(collection(db, 'history'), {
        studentId: r.studentId,
        studentName: s?.name || '',
        delta: -(r.delta||0),
        reason: `던전 중복 보상 회수 (교사)${abMsg?' ['+abMsg+']':''}`,
        type: 'minus', source: 'reclaim',
        createdAt: serverTimestamp()
      });
      // 원본 history 삭제
      await deleteDoc(r.ref);
    }));
    closeModal('dungeonReclaimModal');
    showToast(`✅ ${targets.length}건 보상 회수 완료 (포인트+능력치)`);
  } catch(e) { showToast('오류: ' + e.message); console.error(e); }
};

window.cleanupDuplicateHistory = async function() {
  if (!confirm('중복된 history 내역을 정리할까요?\n같은 학생, 같은 reason, 같은 delta가 10초 이내에 여러 번 기록된 것을 삭제합니다.')) return;
  showToast('중복 내역 분석 중...');
  const snap = await getDocs(collection(db, 'history'));
  const docs = snap.docs.map(d => ({ id: d.id, ref: d.ref, ...d.data() }));

  // 그룹화: studentId + reason + delta + 10초 단위 시간
  const seen = new Map();
  const toDelete = [];
  // 최신순 정렬 (첫 번째 = 원본, 나머지 = 중복)
  docs.sort((a,b) => (a.createdAt?.seconds||0) - (b.createdAt?.seconds||0));

  for (const d of docs) {
    const timeSlot = Math.floor((d.createdAt?.seconds||0) / 10); // 10초 단위
    const key = `${d.studentId}|${d.reason}|${d.delta}|${timeSlot}`;
    if (seen.has(key)) {
      toDelete.push(d.ref);
    } else {
      seen.set(key, true);
    }
  }

  if (toDelete.length === 0) {
    showToast('중복 내역이 없어요 ✅');
    return;
  }

  if (!confirm(`${toDelete.length}개의 중복 내역을 삭제할까요?`)) return;

  // 배치 삭제
  const BATCH_SIZE = 400;
  for (let i = 0; i < toDelete.length; i += BATCH_SIZE) {
    const { writeBatch } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
    const batch = writeBatch(db);
    toDelete.slice(i, i + BATCH_SIZE).forEach(ref => batch.delete(ref));
    await batch.commit();
  }
  showToast(`✅ ${toDelete.length}개 중복 내역 삭제 완료`);
};

window.resetAllData = async function() {
  const confirmText = document.getElementById('resetConfirmInput').value.trim();
  if (confirmText !== '초기화') return showToast('확인 텍스트를 정확히 입력해주세요');
  closeModal('resetModal');
  showToast('초기화 중... 잠시 기다려주세요 ⏳');
  try {
    const cols = ['history','givenCards','exchanges','attendance','titleInventory','messages','notifications'];
    for (const col of cols) {
      const snap = await getDocs(collection(db, col));
      await Promise.all(snap.docs.map(d => deleteDoc(doc(db, col, d.id))));
    }
    const sSnap = await getDocs(collection(db, 'students'));
    await Promise.all(sSnap.docs.map(d =>
      updateDoc(doc(db, 'students', d.id), {
        points: 0, accumulatedPoints: 0,
        equippedTitleId: null, lastNotifCheck: 0,
        abilities: {}, dungeonSoloDate: null, dungeonRaidDate: null
      })
    ));
    showToast('초기화 완료! 🔄 새로고침할게요');
    setTimeout(() => location.reload(), 1500);
  } catch(e) { showToast('오류: ' + e.message); console.error(e); }
};

// 학생별로 저장된 비밀번호로 실제 로그인이 되는지 점검 (Console에서 실수로 계정을 지웠는지 찾기용)
window.checkStudentAccounts = async function() {
  if (!confirm('모든 학생의 로그인 계정을 점검할게요. 학생 수만큼 로그인 시도를 하느라 잠시 걸려요. 진행할까요?')) return;
  const ok = [], bad = [], unknown = [];
  try {
    for (let i = 0; i < state.students.length; i++) {
      const st = state.students[i];
      showToast(`점검 중... (${i+1}/${state.students.length}) ${st.name}`);
      const hint = await getPwHint(st.id);
      if (!hint) { unknown.push(st.name); continue; }
      // 보조 창구로 로그인 시도 (선생님 로그인은 그대로)
      const r = await helperSignInStudent(st.name, [hint]);
      if (r.user) ok.push(st.name); else bad.push(`${st.name} (${(r.code || '').replace('auth/','')})`);
    }
  } finally {
    await helperSignOut();
  }
  alert(`[로그인 점검 결과]\n\n정상 ${ok.length}명\n\n문제 있음 ${bad.length}명:\n${bad.join('\n') || '없음'}\n\n비밀번호 기록 없어 확인 불가 ${unknown.length}명:\n${unknown.join(', ') || '없음'}\n\n※ 문제 있음 = 계정이 지워졌거나, 학생이 비밀번호를 직접 바꿔 기록과 달라진 경우예요.\n해당 학생의 "🔒 비번변경"에서 새 비밀번호를 넣고 [비밀번호 변경]을 눌러보세요. 실패하면 나타나는 "계정 재생성"을 누르면, 계정이 지워진 학생은 Console 작업 없이 바로 복원되고 포인트·기록도 그대로 이어져요.`);
};

// 학생 추가
window.openAddStudentModal = function() {
  document.getElementById('newStudentName').value = '';
  document.getElementById('newStudentPw').value = '';
  openModal('addStudentModal');
};

window.addStudent = async function() {
  const name = document.getElementById('newStudentName').value.trim();
  const pw = document.getElementById('newStudentPw').value.trim();
  if (!name || !pw) return showToast('이름과 비밀번호를 입력하세요');
  if (state.students.find(s => s.name === name)) return showToast('이미 같은 이름의 학생이 있어요');
  const email = nameToEmail(name);
  try {
    // 보조 창구로 계정 생성 (선생님 로그인은 그대로 유지)
    const user = await helperCreateStudent(name, pw);
    await setDoc(doc(db, 'students', user.uid), {
      name, points: 0, accumulatedPoints: 0, createdAt: serverTimestamp()
    });
    await savePwHint(user.uid, pw);
    await helperSignOut();
    closeModal('addStudentModal');
    showToast(`${name} 학생이 추가됐어요! ✅`);
  } catch(e) {
    if (e.code === 'auth/email-already-in-use') {
      // Auth 계정이 이미 존재 → 같은 비밀번호로 로그인되면 그 계정에 학생 정보를 다시 만듦
      const r = await helperSignInStudent(name, [pw]);
      await helperSignOut();
      if (!r.user) {
        showToast(`Auth 계정이 남아있어요. Firebase 콘솔에서 '${email}' 계정을 삭제 후 다시 시도하세요.`);
        return;
      }
      await setDoc(doc(db, 'students', r.user.uid), {
        name, points: 0, accumulatedPoints: 0, createdAt: serverTimestamp()
      });
      await savePwHint(r.user.uid, pw);
      closeModal('addStudentModal');
      showToast(`${name} 학생을 덮어써서 추가했어요! ✅`);
    } else {
      console.error(e);
      showToast('오류: ' + e.message);
      return;
    }
  }
  await reloadStudents();
  renderStudentList();
  renderDashboard();
};

window.deleteStudent = async function(id, name) {
  if (!confirm(`${name} 학생을 삭제할까요? 포인트 내역도 모두 삭제됩니다.`)) return;
  try {
    // 관련 컬렉션 일괄 삭제
    const relatedCollections = [
      'history', 'givenCards', 'exchanges', 'attendance',
      'titleInventory', 'titleDeleted', 'frameInventory', 'frameDeleted',
      'messages', 'notifications'
    ];
    await Promise.all(relatedCollections.map(async col => {
      const snap = await getDocs(query(collection(db, col), where('studentId', '==', id)));
      await Promise.all(snap.docs.map(d => deleteDoc(d.ref)));
    }));
    // 쪽지는 senderId도 확인
    const msgSnap2 = await getDocs(query(collection(db, 'messages'), where('senderId', '==', id)));
    await Promise.all(msgSnap2.docs.map(d => deleteDoc(d.ref)));
    // 학생 문서 삭제
    await deleteDoc(doc(db, 'students', id));
    showToast(`${name} 학생이 삭제됐어요`);
    await reloadStudents();
    renderStudentList();
    renderDashboard();
  } catch(e) { showToast('오류: ' + e.message); }
};

// 개별 학생 던전 기록 초기화
window.resetStudentDungeon = async function(id, name) {
  if (!confirm(`${name} 학생의 오늘 개인 던전 참여 기록을 초기화할까요?\n(단체 던전은 영향 없음)`)) return;
  try {
    await updateDoc(doc(db, 'students', id), { dungeonSoloDate: null });
    showToast(`${name} 학생 개인 던전 기록 초기화 완료 ✅`);
  } catch(e) { showToast('오류: ' + e.message); }
};

// 비밀번호 변경
window.openChangePw = function(id, name) {
  state.changePwTargetId = id;
  document.getElementById('changePwSubtitle').textContent = `${name} 학생`;
  document.getElementById('changePwInput').value = '';
  // 이메일 디코딩해서 표시 (한국어 URL 인코딩 → 원문)
  const email = nameToEmail(name);
  document.getElementById('changePwEmail').textContent = email;
  document.getElementById('changePwEmail2').textContent = email;
  // 매번 열 때마다 간편 변경부터 다시 시도하도록 폴백 섹션/안내 문구 초기화
  document.getElementById('changePwFallback').classList.add('hidden');
  const statusEl = document.getElementById('changePwStatus');
  statusEl.style.background = '#eff6ff';
  statusEl.style.color = '#1d4ed8';
  statusEl.textContent = '💡 먼저 간편 변경을 시도해요. 학생이 비밀번호를 직접 바꾼 적이 있어서 저장된 정보와 다르면 실패할 수 있는데, 그럴 땐 아래에 계정 재생성 방법이 자동으로 나타나요.';
  const primaryBtn = document.getElementById('changePwPrimaryBtn');
  primaryBtn.disabled = false;
  primaryBtn.textContent = '비밀번호 변경';
  openModal('changePwModal');
};

// 통합 비밀번호 재설정: 먼저 간편 변경(계정 유지)을 시도하고, 실패하면 계정 재생성 폴백 UI를 노출
window.resetStudentPassword = async function() {
  const newPw = document.getElementById('changePwInput').value.trim();
  if (!newPw) return showToast('새 비밀번호를 입력하세요');
  if (newPw.length < 4) return showToast('비밀번호는 4자 이상 입력하세요');

  const student = state.students.find(s => s.id === state.changePwTargetId);
  if (!student) return showToast('학생 정보를 찾을 수 없어요');

  const statusEl = document.getElementById('changePwStatus');
  const primaryBtn = document.getElementById('changePwPrimaryBtn');
  primaryBtn.disabled = true;
  primaryBtn.textContent = '변경 중...';

  const finalPw = makePw(newPw);
  const oldPwHint = await getPwHint(student.id);

  const showFallback = (msg) => {
    statusEl.style.background = '#fef2f2';
    statusEl.style.color = '#b91c1c';
    statusEl.textContent = msg;
    document.getElementById('changePwFallback').classList.remove('hidden');
    primaryBtn.disabled = false;
    primaryBtn.textContent = '비밀번호 변경';
  };

  try {
    // 저장된 비밀번호로 보조 창구에서 학생 계정에 잠깐 로그인 (선생님 로그인은 그대로)
    const r = await helperSignInStudent(student.name, [oldPwHint]);

    if (!r.user) {
      showFallback('⚠️ 저장된 비밀번호 정보로 로그인이 안 돼요. 학생이 비밀번호를 직접 바꿔서 기록과 달라진 것 같아요. 아래 "계정 재생성" 방법을 사용해주세요.');
      return;
    }

    // 비밀번호 변경 + 기록 저장
    await updatePassword(r.user, finalPw);
    await savePwHint(student.id, newPw);
    await helperSignOut();

    closeModal('changePwModal');
    showToast(`${student.name} 학생 비밀번호가 '${newPw}'(으)로 변경됐어요 ✅`);
  } catch(e) {
    await helperSignOut();
    showFallback(`⚠️ 간편 변경에 실패했어요 (${e.message}). 아래 "계정 재생성" 방법을 사용해주세요.`);
  }
};

// studentId 기준 컬렉션 / authorId 기준 컬렉션 목록 (이관·복구 공통)
const MIGRATE_ID_COLS = [
  'givenCards','history','exchanges','messages','notifications','roleLogs','studentLogs','studentLogsDeleted','attendance',
  'titleDeleted','frameDeleted','bookCardLog','checkTableCardLog','checkTableRows','crowdfundingLogs','profileMsgLog',
  'titleInventory','frameInventory','avatarInventory','petInventory'
];

// oldUid → newUid 로 모든 연결 기록을 옮기고, 컬렉션별 결과를 돌려줌
async function _migrateAllRecords(oldUid, newUid) {
  const result = { moved: {}, failed: [] };
  for (const col of MIGRATE_ID_COLS) {
    try {
      const snap = await getDocs(query(collection(db, col), where('studentId','==', oldUid)));
      for (const d of snap.docs) await updateDoc(doc(db, col, d.id), { studentId: newUid });
      if (snap.size) result.moved[col] = snap.size;
    } catch(e) { console.error('이관 실패', col, e); result.failed.push(col); }
  }
  for (const col of ['boardPosts','boardComments']) {
    try {
      const snap = await getDocs(query(collection(db, col), where('authorId','==', oldUid)));
      for (const d of snap.docs) await updateDoc(doc(db, col, d.id), { authorId: newUid });
      if (snap.size) result.moved[col] = snap.size;
    } catch(e) { console.error('이관 실패', col, e); result.failed.push(col); }
  }
  try {
    const snap = await getDocs(query(collection(db, 'messages'), where('senderId','==', oldUid)));
    for (const d of snap.docs) await updateDoc(doc(db, 'messages', d.id), { senderId: newUid });
  } catch(e) { result.failed.push('messages(senderId)'); }
  try {
    const snap = await getDocs(collection(db, 'roleRewardBatches'));
    for (const d of snap.docs) {
      const entries = d.data().entries || [];
      if (entries.some(en => en.studentId === oldUid)) {
        await updateDoc(doc(db, 'roleRewardBatches', d.id), { entries: entries.map(en => en.studentId === oldUid ? { ...en, studentId: newUid } : en) });
      }
    }
  } catch(e) { result.failed.push('roleRewardBatches'); }
  try {
    const snap = await getDocs(collection(db, 'bookWeeks'));
    for (const d of snap.docs) {
      const arr = d.data().students || [];
      if (arr.some(s => s.id === oldUid)) await updateDoc(doc(db, 'bookWeeks', d.id), { students: arr.map(s => s.id === oldUid ? { ...s, id: newUid } : s) });
    }
  } catch(e) { result.failed.push('bookWeeks'); }
  try {
    const snap = await getDocs(collection(db, 'roles'));
    for (const d of snap.docs) {
      const arr = d.data().students || [];
      if (arr.includes(oldUid)) await updateDoc(doc(db, 'roles', d.id), { students: arr.map(u => u === oldUid ? newUid : u) });
    }
  } catch(e) { result.failed.push('roles'); }
  // 캐시 무효화
  window._cachedRoles = null; window._myGivenCards = null; window._cachedTitleInventory = null; window._cachedTitleDeleted = null;
  window._threadCache = {};
  return result;
}

// ===== 학생 계정 재생성 + 데이터 마이그레이션 =====
window.doMigrateStudent = async function() {
  const newPw = document.getElementById('changePwInput').value.trim();
  if (!newPw) return showToast('새 비밀번호를 먼저 입력하세요');
  const student = state.students.find(s => s.id === state.changePwTargetId);
  if (!student) return showToast('학생 정보를 찾을 수 없어요');
  if (state.students.filter(s => s.name === student.name).length > 1) {
    return alert(`${student.name} 학생 계정이 앱 안에 2개 이상 있어서 재생성을 막았어요.\n\n먼저 이 창의 "🩹 빠진 기록 복구"를 눌러 하나로 합친 뒤, 다시 재생성해주세요.`);
  }
  if (!confirm(`${student.name} 학생의 계정을 재생성하고 비밀번호를 '${newPw}'로 설정할게요.\n\nFirebase Console에서 Auth 계정을 먼저 삭제하셨나요?`)) return;

  const oldUid = student.id;
  let newUid = null;
  try {
    showToast('1/3 계정 추가 중...');
    // 보조 창구로 계정 생성 (선생님 로그인은 그대로)
    const user = await helperCreateStudent(student.name, newPw);
    newUid = user.uid;
    await helperSignOut();

    showToast('2/3 데이터 이관 중...');
    const oldSnap = await getDoc(doc(db, 'students', oldUid));
    const oldData = oldSnap.exists() ? oldSnap.data() : {};
    delete oldData.pwHint; // 비밀번호 기록은 학생 문서가 아니라 보관함에
    await setDoc(doc(db, 'students', newUid), { ...oldData, createdAt: serverTimestamp() });
    await savePwHint(newUid, newPw);

    const result = await _migrateAllRecords(oldUid, newUid);

    if (result.failed.length) {
      // 일부 실패 시 기존 문서는 남겨둠 (데이터 유실 방지)
      showToast(`일부 기록 이관 실패: ${result.failed.join(', ')}. 기존 학생 정보는 남겨뒀어요. 새로고침 후 학생 목록에서 확인하세요.`);
      await reloadStudents(); renderStudentList();
      return;
    }
    showToast('3/3 기존 계정 정리 중...');
    await deleteDoc(doc(db, 'students', oldUid));
    await removePwHint(oldUid);
    const summary = Object.entries(result.moved).map(([c,n]) => `${c} ${n}`).join(', ') || '이관할 기록 없음';
    closeModal('changePwModal');
    showToast(`${student.name} 재생성 완료! 비밀번호: ${newPw} ✅ (${summary})`);
    await reloadStudents();
    renderStudentList();
    renderDashboard();
  } catch(e) {
    await helperSignOut();
    if (e.code === 'auth/email-already-in-use') {
      showToast('아직 Firebase Console에서 이 계정이 삭제되지 않았어요. Console에서 Authentication > Users 목록에 이 이메일이 남아있는지 확인하고 삭제한 뒤 다시 시도하세요.');
    } else {
      showToast('오류: ' + e.message);
    }
  }
};

// 이미 재생성했는데 카드·구매이력 등이 안 따라온 학생용: 옛 UID로 남은 기록을 이름 기준으로 찾아 현재 계정으로 연결
window.repairStudentRecords = async function() {
  const student = state.students.find(s => s.id === state.changePwTargetId);
  if (!student) return showToast('학생 정보를 찾을 수 없어요');
  // 같은 이름의 중복 계정이 앱 안에 남아 있으면 → 로그인 가능한 계정만 남기고 나머지의 기록을 합친 뒤 삭제
  const group = state.students.filter(s => s.name === student.name);
  if (group.length > 1) {
    try {
      showToast('로그인 가능한 계정 확인 중...');
      // 1) 실제로 로그인되는(Firebase Auth에 살아있는) 계정 찾기: 저장된 비밀번호 후보로 로그인 시도 → 그 uid가 남길 계정
      const hints = [];
      for (const g of group) hints.push(await getPwHint(g.id));
      const r = await helperSignInStudent(student.name, hints);
      const liveUid = r.user?.uid || null;
      const liveHint = r.user ? hints.find(h => h && (r.pw === h || r.pw === makePw(h))) : '';
      await helperSignOut();
      let target = group.find(g => g.id === liveUid);
      let how = '실제 로그인 확인';
      if (!target) {
        // 2) 확인 실패 시: 가장 최근에 만들어진 계정을 새 계정으로 간주
        target = [...group].sort((x, y) => (y.createdAt?.seconds || 0) - (x.createdAt?.seconds || 0))[0];
        how = '가장 최근 생성 기준(로그인 확인은 실패)';
      }
      const dupes = group.filter(g => g.id !== target.id);
      const fmt = (x, tag) => `${tag} 포인트 ${x.points||0} / 누적 ${x.accumulatedPoints||0}`;
      if (!confirm(`${student.name} 학생 계정이 ${group.length}개 있어요.\n\n${fmt(target, '[남길 계정]')}\n${dupes.map(d => fmt(d, '[삭제할 계정]')).join('\n')}\n\n(판단 방법: ${how})\n\n삭제할 계정의 모든 기록(카드, 구매이력, 포인트, 능력치 등)을 남길 계정으로 합치고 삭제할게요.\n진행할까요?`)) return;
      showToast('계정 합치는 중...');
      for (const dup of dupes) {
        const tgtSnap = await getDoc(doc(db, 'students', target.id));
        const srcSnap = await getDoc(doc(db, 'students', dup.id));
        const srcData = srcSnap.exists() ? srcSnap.data() : {};
        const tgtData = tgtSnap.exists() ? tgtSnap.data() : {};
        // 옛 데이터 값 기준으로 덮어쓰되 생성일은 남길 계정 것을 유지 (비밀번호 기록은 보관함에 따로)
        const merged = { ...srcData, createdAt: tgtData.createdAt || srcData.createdAt || serverTimestamp() };
        delete merged.pwHint;
        await setDoc(doc(db, 'students', target.id), merged);
        if (liveHint && target.id === liveUid) await savePwHint(target.id, liveHint);
        const result = await _migrateAllRecords(dup.id, target.id);
        if (result.failed.length) {
          showToast(`일부 기록 이관 실패: ${result.failed.join(', ')}. 삭제할 계정은 남겨뒀어요.`);
          return;
        }
        await deleteDoc(doc(db, 'students', dup.id));
        await removePwHint(dup.id);
        const sum = Object.entries(result.moved).map(([c,n]) => `${c} ${n}`).join(', ') || '이관할 기록 없음';
        showToast(`합치기 완료 ✅ (${sum})`);
      }
      await reloadStudents(); renderStudentList(); renderDashboard();
      closeModal('changePwModal');
    } catch(e) { showToast('오류: ' + e.message); }
    return;
  }
  if (!confirm(`${student.name} 학생의 계정에서 빠진 기록(카드, 구매이력 등)을 찾아 연결할까요?`)) return;
  try {
    showToast('기록 찾는 중...');
    const liveIds = new Set(state.students.map(s => s.id));
    const NAME_COLS = ['givenCards','history','exchanges','crowdfundingLogs','profileMsgLog'];
    const counts = {};
    for (const col of NAME_COLS) {
      const snap = await getDocs(query(collection(db, col), where('studentName','==', student.name)));
      let n = 0;
      for (const d of snap.docs) {
        const sid = d.data().studentId;
        if (sid && sid !== student.id && !liveIds.has(sid)) {
          await updateDoc(doc(db, col, d.id), { studentId: student.id });
          n++;
        }
      }
      if (n) counts[col] = n;
    }
    window._myGivenCards = null;
    const summary = Object.entries(counts).map(([c,n]) => `${c} ${n}건`).join(', ');
    showToast(summary ? `복구 완료 ✅ ${summary}` : '연결할 빠진 기록이 없어요');
  } catch(e) { showToast('오류: ' + e.message); }
};
