// roles.js — 1인1역 시스템
import { state } from './state.js?v=20261111d';
import {
  addDoc, collection, db, deleteDoc, doc, getDoc, getDocs, increment, limit, onSnapshot, orderBy,
  query, serverTimestamp, setDoc, updateDoc, where
} from './firebase.js?v=20261111d';
import { closeModal, openModal, showToast } from './core.js?v=20261111d';
import { formatTime } from './level.js?v=20261111d';
import { reloadStudents } from './realtime.js?v=20261111d';
import { renderDashboard } from './dashboard.js?v=20261111d';
import { getTodayStr } from './attendance.js?v=20261111d';
import { buildStudentAuctionHtml } from './role-auction.js?v=20261111d';
import { getCurrentWeekKey } from './books.js?v=20261111d';

// ===== 1인1역 시스템 =====
export const DAY_NAMES = ['','월','화','수','목','금','토','일'];
export let roles = [];
let _pendingRoleSubmit = null; // { roleId, roleName, roleEmoji }
let _editingRoleId = null;

// Firestore 로드
export async function loadRoles() {
  if (window._cachedRoles) { roles = window._cachedRoles; return; }
  const snap = await getDocs(collection(db, 'roles'));
  roles = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  window._cachedRoles = roles;
}

async function loadRoleConfig() {
  if (window._roleConfig) return window._roleConfig;
  const snap = await getDoc(doc(db, 'config', 'roles'));
  window._roleConfig = snap.exists() ? snap.data() : {
    rewardPoint: 50, penaltyPoint: 30, penaltyThreshold: 70,
    penaltyAbilities: { 성실성: 1, 인성: 0, 사회성: 0, 지력: 0, 집중력: 0 }
  };
  // 비활성화 버튼 상태 반영 (교사 메뉴)
  const isActive = window._roleConfig.active !== false;
  const toggleBtn = document.getElementById('roleActiveToggleBtn');
  if (toggleBtn) {
    toggleBtn.textContent = isActive ? '⏸️ 비활성화' : '▶️ 활성화';
    toggleBtn.style.background = isActive ? '' : '#fef9c3';
    toggleBtn.style.color = isActive ? '' : '#a16207';
    toggleBtn.style.borderColor = isActive ? '' : '#fcd34d';
  }
  return window._roleConfig;
}

// 미수행 자동 차감 (앱 진입 시 실행)
// ===== 주간 날짜 범위 계산 (월~금) =====
function getThisWeekRange() {
  const now = new Date();
  const dow = now.getDay();
  const diffToMon = dow === 0 ? -6 : 1 - dow;
  const mon = new Date(now); mon.setDate(now.getDate() + diffToMon); mon.setHours(0,0,0,0);
  // 로컬 날짜 문자열 (toISOString은 UTC 기준이라 한국에서 날짜 밀림 버그)
  const toLocalStr = d => {
    const y = d.getFullYear();
    const m = String(d.getMonth()+1).padStart(2,'0');
    const dd = String(d.getDate()).padStart(2,'0');
    return `${y}-${m}-${dd}`;
  };
  const dates = [];
  for (let i=0;i<5;i++) {
    const d = new Date(mon); d.setDate(mon.getDate()+i);
    dates.push(toLocalStr(d));
  }
  const fri = new Date(mon); fri.setDate(mon.getDate()+4);
  return { mon, fri, dates, monStr: toLocalStr(mon), friStr: toLocalStr(fri) };
}

// ===== 특정 주차(ISO 주차 키, 예: 2026-W38) 기준 월~금 날짜 범위 계산 =====
// input[type=week]의 값 형식(YYYY-Www)과 동일하며, 지난 주 보상 지급 등에 사용
function getWeekRangeFromKey(wk) {
  const [yr, wn] = wk.split('-W').map(Number);
  const jan4 = new Date(yr, 0, 4);
  const jDow = jan4.getDay() || 7;
  const week1Mon = new Date(jan4);
  week1Mon.setDate(jan4.getDate() - jDow + 1);
  const mon = new Date(week1Mon);
  mon.setDate(week1Mon.getDate() + (wn - 1) * 7);
  mon.setHours(0,0,0,0);
  const toLocalStr = d => {
    const y = d.getFullYear();
    const m = String(d.getMonth()+1).padStart(2,'0');
    const dd = String(d.getDate()).padStart(2,'0');
    return `${y}-${m}-${dd}`;
  };
  const dates = [];
  for (let i=0;i<5;i++) {
    const d = new Date(mon); d.setDate(mon.getDate()+i);
    dates.push(toLocalStr(d));
  }
  const fri = new Date(mon); fri.setDate(mon.getDate()+4);
  return { mon, fri, dates, monStr: toLocalStr(mon), friStr: toLocalStr(fri) };
}

// 수행률 계산: 학생 1명 기준, 역할별 세부 내역 포함 (역할별 완수 보너스 계산용)
// returns { rate: 0~1, done: number, total: number, perRole: [{roleId, roleName, emoji, done, total, rate, bonusPoint}] }
function calcStudentRoleBreakdown(studentId, weekDates, approvedLogSet, roleList) {
  let total = 0, done = 0;
  const perRole = [];
  for (const r of roleList) {
    if (!(r.students||[]).includes(studentId)) continue;
    let rTotal = 0, rDone = 0;
    for (const dateStr of weekDates) {
      // UTC 오프셋 문제 방지: 로컬 기준으로 파싱
      const [y,m,d] = dateStr.split('-').map(Number);
      const dow = new Date(y, m-1, d).getDay(); // 로컬 기준
      if ((r.days||[]).includes(dow)) {
        rTotal++;
        if (approvedLogSet.has(`${studentId}_${r.id}_${dateStr}`)) rDone++;
      }
    }
    if (rTotal > 0) {
      total += rTotal; done += rDone;
      perRole.push({ roleId: r.id, roleName: r.name, emoji: r.emoji, done: rDone, total: rTotal, rate: rDone/rTotal, bonusPoint: r.bonusPoint||0 });
    }
  }
  return { rate: total === 0 ? 0 : done / total, done, total, perRole };
}

// 수행률 계산: 학생 1명 기준
// returns { rate: 0~1, done: number, total: number }
function calcStudentRoleRate(studentId, weekDates, approvedLogSet, roleList) {
  let total = 0, done = 0;
  for (const r of roleList) {
    if (!(r.students||[]).includes(studentId)) continue;
    for (const dateStr of weekDates) {
      // UTC 오프셋 문제 방지: 로컬 기준으로 파싱
      const [y,m,d] = dateStr.split('-').map(Number);
      const dow = new Date(y, m-1, d).getDay(); // 로컬 기준
      if ((r.days||[]).includes(dow)) {
        total++;
        if (approvedLogSet.has(`${studentId}_${r.id}_${dateStr}`)) done++;
      }
    }
  }
  return { rate: total === 0 ? 0 : done / total, done, total };
}

// 10골드 단위 절삭
function floorTo10(n) { return Math.floor(n / 10) * 10; }

// ===== 역할 보상 미리보기 모달 =====
// weekKeyOverride: input[type=week] 값(예: 2026-W38). 없으면 이번 주 기준
window.openRoleRewardModal = async function(weekKeyOverride) {
  openModal('roleRewardModal');
  const listEl = document.getElementById('roleRewardList');
  const subtitleEl = document.getElementById('roleRewardSubtitle');
  const wkInput = document.getElementById('roleRewardWeekInput');
  listEl.innerHTML = '<div style="text-align:center;padding:24px;color:var(--text-muted);">계산 중...</div>';
  try {
    const cfg = await loadRoleConfig();
    await loadRoles();
    const weekKey = weekKeyOverride || getCurrentWeekKey();
    window._roleRewardWeekKey = weekKey;
    if (wkInput) wkInput.value = weekKey;
    const { dates, monStr, friStr } = getWeekRangeFromKey(weekKey);
    const isCurrentWeek = weekKey === getCurrentWeekKey();
    subtitleEl.textContent = `${monStr} ~ ${friStr}${isCurrentWeek ? ' (이번 주)' : ' (지난 주)'} · 100% 보상 ${cfg.rewardPoint||500}🪙 · ${cfg.penaltyThreshold??70}% 미만 벌점 최대 ${cfg.penaltyPoint||200}🪙`;
    // 가장 최근 일괄지급 시각 표시 (중복 지급 방지용)
    const lastGrantEl = document.getElementById('roleRewardLastGrantInfo');
    if (lastGrantEl) {
      lastGrantEl.textContent = '최근 지급 내역 확인 중...';
      try {
        const lastSnap = await getDocs(query(collection(db,'roleRewardBatches'), orderBy('grantedAt','desc'), limit(1)));
        if (lastSnap.empty) {
          lastGrantEl.textContent = '⏱️ 최근 지급 내역이 없어요';
        } else {
          const last = lastSnap.docs[0].data();
          const revertedTag = last.reverted ? ' (회수됨)' : '';
          lastGrantEl.textContent = `⏱️ 최근 일괄지급: ${last.monStr}~${last.friStr} · ${formatTime(last.grantedAt)} · ${last.grantedCount}명${revertedTag}`;
        }
      } catch(e) { lastGrantEl.textContent = ''; }
    }
    // 해당 주 승인된 수행 로그
    // (읽기 절약) 학기 전체가 아니라 해당 주 날짜 범위만 조회하고, 상태는 여기서 거름
    const logSnap = await getDocs(query(collection(db,'roleLogs'), where('date','>=',dates[0]), where('date','<=',dates[dates.length-1])));
    const approvedLogSet = new Set();
    logSnap.docs.forEach(d => {
      const data = d.data();
      if (['approved','done','absent','holiday'].includes(data.status) && dates.includes(data.date)) approvedLogSet.add(`${data.studentId}_${data.roleId}_${data.date}`);
    });
    // 이 주차에 이미 지급된 학생 확인 (중복 지급 방지, 클라이언트 필터로 인덱스 불필요)
    // (읽기 절약) 해당 주차 지급 기록만 조회 (같다(==) 조건만 2개라 별도 색인 필요 없음)
    const historySnap = await getDocs(query(collection(db,'history'), where('source','==','roleWeeklyReward'), where('weekKey','==',weekKey)));
    const alreadyGivenSet = new Set();
    historySnap.docs.forEach(d => {
      const data = d.data();
      if (data.weekKey === weekKey) alreadyGivenSet.add(data.studentId);
    });
    // 배정된 학생들만
    const assignedStudentIds = new Set();
    roles.forEach(r => (r.students||[]).forEach(sid => assignedStudentIds.add(sid)));
    const assignedStudents = state.students.filter(s => !s.hidden && assignedStudentIds.has(s.id))
      .sort((a,b)=>(a.number||0)-(b.number||0));
    if (!assignedStudents.length) {
      listEl.innerHTML = '<div style="text-align:center;padding:24px;color:var(--text-muted);">배정된 학생이 없어요</div>';
      return;
    }
    // 각 학생 수행률 계산 (+ 역할별 100% 완수 보너스)
    window._roleRewardData = [];
    listEl.innerHTML = assignedStudents.map(s => {
      const { rate, done, total, perRole } = calcStudentRoleBreakdown(s.id, dates, approvedLogSet, roles);
      const pct = Math.round(rate * 100);
      const isReward = rate >= (cfg.penaltyThreshold??70)/100;
      let basePoint = 0;
      if (isReward) {
        basePoint = floorTo10((cfg.rewardPoint||500) * rate);
      } else {
        basePoint = -floorTo10((cfg.penaltyPoint||200) * (1 - rate));
      }
      // 역할별 완수 보너스: 해당 역할을 그 주에 100% 수행했고, 보너스 포인트가 설정돼 있으면 전체 보상/벌점과 별개로 추가 지급
      const bonusRoles = perRole.filter(pr => pr.rate >= 1 && pr.bonusPoint > 0);
      const bonusTotal = bonusRoles.reduce((sum, b) => sum + b.bonusPoint, 0);
      const point = basePoint + bonusTotal;
      const alreadyGiven = alreadyGivenSet.has(s.id);
      window._roleRewardData.push({
        studentId: s.id, studentName: s.name, rate, pct, point, isReward, done, total, weekKey, skip: alreadyGiven,
        bonusTotal, bonusRoleNames: bonusRoles.map(b => b.roleName)
      });
      const color = isReward ? '#15803d' : '#b91c1c';
      const bg = isReward ? '#dcfce7' : '#fee2e2';
      const sign = point >= 0 ? '+' : '';
      const barColor = pct >= 70 ? '#10b981' : '#ef4444';
      const bonusLine = bonusRoles.length
        ? `<div style="font-size:10px;color:#a16207;margin-top:2px;">🎁 ${bonusRoles.map(b=>b.roleName).join(', ')} 완수 보너스 +${bonusTotal}</div>`
        : '';
      return `<div style="display:flex;align-items:center;gap:12px;padding:10px 12px;background:var(--bg);border-radius:10px;border:1px solid var(--border);${alreadyGiven?'opacity:0.5;':''}">
        <div style="font-size:13px;font-weight:700;min-width:80px;">${s.number||''}번 ${s.name}</div>
        <div style="flex:1;">
          <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text-muted);margin-bottom:3px;">
            <span>${done}/${total}회</span><span>${pct}%</span>
          </div>
          <div style="height:6px;background:var(--border);border-radius:3px;overflow:hidden;">
            <div style="height:100%;width:${pct}%;background:${barColor};border-radius:3px;"></div>
          </div>
          ${bonusLine}
        </div>
        <div style="background:${bg};color:${color};font-size:13px;font-weight:800;padding:4px 10px;border-radius:8px;min-width:70px;text-align:center;">
          ${alreadyGiven ? '지급완료' : `${sign}${point}🪙`}
        </div>
      </div>`;
    }).join('');
  } catch(e) {
    listEl.innerHTML = `<div style="color:#ef4444;padding:16px;">오류: ${e.message}</div>`;
  }
};

window.confirmRoleReward = async function() {
  if (!window._roleRewardData?.length) return;
  const cfg = await loadRoleConfig();
  const penaltyAb = cfg.penaltyAbilities || {};
  const weekKey = window._roleRewardWeekKey || getCurrentWeekKey();
  const { monStr, friStr } = getWeekRangeFromKey(weekKey);
  try {
    let grantedCount = 0;
    const batchEntries = [];
    for (const d of window._roleRewardData) {
      if (d.skip || d.point === 0) continue;
      grantedCount++;
      const update = {
        points: increment(d.point),
        // 벌점(음수)일 때는 누적포인트 차감 안 함, 보상(양수)일 때만 증가
        ...(d.point > 0 ? { accumulatedPoints: increment(d.point) } : {})
      };
      // 벌점일 때만 능력치 차감
      if (!d.isReward) {
        for (const [k, v] of Object.entries(penaltyAb)) {
          if (v > 0) update[`abilities.${k}`] = increment(-v);
        }
      }
      await updateDoc(doc(db,'students',d.studentId), update);
      const bonusSuffix = d.bonusTotal > 0 ? ` (${d.bonusRoleNames.join(', ')} 완수 보너스 +${d.bonusTotal} 포함)` : '';
      const historyRef = await addDoc(collection(db,'history'), {
        studentId: d.studentId, studentName: d.studentName,
        delta: d.point,
        reason: `1인1역 주간 수행률 ${d.pct}% ${d.isReward ? '보상' : '벌점'}${bonusSuffix}`,
        type: d.point >= 0 ? 'plus' : 'minus',
        source: 'roleWeeklyReward',
        weekKey: weekKey,
        createdAt: serverTimestamp()
      });
      batchEntries.push({
        studentId: d.studentId, studentName: d.studentName,
        point: d.point, isReward: d.isReward, pct: d.pct,
        bonusTotal: d.bonusTotal||0, bonusRoleNames: d.bonusRoleNames||[],
        historyId: historyRef.id
      });
    }
    // 일괄지급 1건으로 기록 (지급 내역 조회 + 회수용)
    if (grantedCount > 0) {
      const totalPlus = batchEntries.filter(e=>e.point>0).reduce((s,e)=>s+e.point,0);
      const totalMinus = batchEntries.filter(e=>e.point<0).reduce((s,e)=>s+e.point,0);
      await addDoc(collection(db,'roleRewardBatches'), {
        weekKey, monStr, friStr,
        grantedCount, totalPlus, totalMinus,
        entries: batchEntries,
        penaltyAbilities: penaltyAb,
        reverted: false, revertedAt: null,
        grantedAt: serverTimestamp()
      });
    }
    closeModal('roleRewardModal');
    showToast(grantedCount ? `1인1역 보상 지급 완료! 🎉` : '이미 모두 지급된 주차예요');
    window._roleRewardData = null;
    window._roleRewardWeekKey = null;
    await reloadStudents();
    renderDashboard();
  } catch(e) { showToast('오류: ' + e.message); }
};

// ===== 1인1역 일괄지급 내역 (지급 건 단위, 회수 가능) =====
window.openRoleRewardHistoryModal = async function() {
  showToast('지급 내역 불러오는 중...');
  const snap = await getDocs(query(collection(db,'roleRewardBatches'), orderBy('grantedAt','desc'), limit(30)));
  const batches = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  window._roleRewardBatches = batches;

  let modal = document.getElementById('roleRewardHistoryModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'roleRewardHistoryModal';
    modal.className = 'modal-overlay hidden';
    document.body.appendChild(modal);
  }

  const rows = batches.map(b => {
    const plusStr = b.totalPlus ? `+${b.totalPlus}🪙` : '';
    const minusStr = b.totalMinus ? `${b.totalMinus}🪙` : '';
    const sumStr = [plusStr, minusStr].filter(Boolean).join(' / ') || '0🪙';
    const statusBadge = b.reverted
      ? `<span style="font-size:11px;font-weight:700;color:#b91c1c;background:#fee2e2;padding:2px 8px;border-radius:6px;">회수됨</span>`
      : `<button onclick="revertRoleRewardBatch('${b.id}')" style="font-size:11px;padding:4px 10px;border-radius:6px;border:1px solid #ef4444;background:transparent;color:#ef4444;cursor:pointer;font-weight:600;font-family:inherit;white-space:nowrap;">회수</button>`;
    return `
      <div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border);${b.reverted?'opacity:0.55;':''}">
        <div style="flex:1;min-width:0;">
          <div style="font-size:13px;font-weight:700;">${b.monStr} ~ ${b.friStr}</div>
          <div style="font-size:11px;color:var(--text-muted);">${formatTime(b.grantedAt)} · ${b.grantedCount}명 · ${sumStr}</div>
        </div>
        ${statusBadge}
      </div>`;
  }).join('');

  modal.innerHTML = `<div class="modal" style="max-width:520px;max-height:80vh;overflow:hidden;padding:0;display:flex;flex-direction:column;">
    <div style="padding:20px 20px 0;font-size:17px;font-weight:700;flex-shrink:0;">📜 1인1역 지급 내역</div>
    <div style="padding:6px 20px 10px;font-size:12px;color:var(--text-muted);flex-shrink:0;">일괄지급 1건씩 표시 · 최근 30건 · 잘못 지급된 건은 회수할 수 있어요</div>
    <div style="overflow-y:auto;flex:1;padding:0 20px;">${rows || '<div style="padding:20px;text-align:center;color:var(--text-muted);">지급 내역이 없어요</div>'}</div>
    <div style="padding:14px 20px;border-top:1px solid var(--border);flex-shrink:0;">
      <button class="btn btn-secondary btn-full" onclick="closeModal('roleRewardHistoryModal')">닫기</button>
    </div>
  </div>`;
  modal.classList.remove('hidden');
  modal.style.opacity = '0';
  requestAnimationFrame(() => { modal.style.transition = 'opacity 0.35s ease'; modal.style.opacity = '1'; });
};

window.revertRoleRewardBatch = async function(batchId) {
  const batch = (window._roleRewardBatches||[]).find(b => b.id === batchId);
  if (!batch) return showToast('내역을 찾을 수 없어요');
  if (batch.reverted) return showToast('이미 회수된 지급이에요');
  if (!confirm(`${batch.monStr}~${batch.friStr} 주차 지급(${batch.grantedCount}명)을 통째로 회수할까요?\n포인트·능력치가 모두 원상복구돼요.`)) return;
  try {
    const penaltyAb = batch.penaltyAbilities || {};
    for (const entry of (batch.entries||[])) {
      const update = {
        points: increment(-entry.point),
        ...(entry.point > 0 ? { accumulatedPoints: increment(-entry.point) } : {})
      };
      // 벌점이었던 건이면 당시 차감했던 능력치를 복구
      if (!entry.isReward) {
        for (const [k, v] of Object.entries(penaltyAb)) {
          if (v > 0) update[`abilities.${k}`] = increment(v);
        }
      }
      await updateDoc(doc(db,'students',entry.studentId), update);
      await addDoc(collection(db,'history'), {
        studentId: entry.studentId, studentName: entry.studentName,
        delta: -entry.point,
        reason: `1인1역 주간 보상 회수 (${batch.monStr}~${batch.friStr})`,
        type: entry.point >= 0 ? 'minus' : 'plus',
        source: 'roleWeeklyRewardRevert',
        weekKey: batch.weekKey,
        createdAt: serverTimestamp()
      });
      // 원본 지급 history 삭제 (중복 표시 방지)
      if (entry.historyId) {
        try { await deleteDoc(doc(db,'history', entry.historyId)); } catch(_) {}
      }
    }
    await updateDoc(doc(db,'roleRewardBatches', batchId), { reverted: true, revertedAt: serverTimestamp() });
    showToast('✅ 지급 회수 완료 (포인트+능력치 원상복구)');
    await reloadStudents();
    renderDashboard();
    openRoleRewardHistoryModal();
  } catch(e) { showToast('오류: ' + e.message); }
};

// ===== 미수행 자동 차감 제거 - 주간 수행률 방식으로 전환 =====
export async function checkMissedRoles() {
  // 주간 수행률 방식으로 변경됨 - 일별 자동 처리 없음
  return;
}

export async function renderRoleManagePage() {
  window._cachedRoles = null;
  await checkMissedRoles();
  const el = document.getElementById('roleManageContent');
  if (!el) return;
  el.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text-muted);">불러오는 중...</div>';
  await loadRoles();
  const todayStr = getTodayStr();
  const todayDow = new Date().getDay();

  // 수행 요청 실시간 리스너 등록 (페이지 진입 시마다 갱신)
  if (window._unsubRoleLogs) window._unsubRoleLogs();
  let _firstPendingSnap = true; // 첫 신호는 바로 아래에서 직접 그리므로 건너뜀 (중복 렌더·중복 읽기 방지)
  window._unsubRoleLogs = onSnapshot(
    query(collection(db,'roleLogs'), where('status','==','pending')),
    () => {
      if (_firstPendingSnap) { _firstPendingSnap = false; return; }
      // 현재 roleManage 페이지가 열려있을 때만 갱신
      const page = document.querySelector('.section-title');
      if (document.getElementById('page-roleManage') && !document.getElementById('page-roleManage').classList.contains('hidden')) {
        _renderRoleManageContent();
      }
    }
  );

  await _renderRoleManageContent();
}

// 실제 렌더 로직 분리 (onSnapshot 콜백에서도 호출 가능)
async function _renderRoleManageContent() {
  const el = document.getElementById('roleManageContent');
  if (!el) return;
  await loadRoles();
  const todayStr = getTodayStr();
  const todayDow = new Date().getDay();

  // ─ 수행 요청 섹션 ─
  const reqSnap = await getDocs(query(collection(db,'roleLogs'), where('status','==','pending')));
  const reqItems = reqSnap.docs.map(d=>({id:d.id,...d.data()}))
    .sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
  const roleBadge = document.getElementById('roleBadge');
  if (roleBadge) { roleBadge.textContent=reqItems.length; roleBadge.classList.toggle('hidden',reqItems.length===0); }

  const reqHtml = reqItems.length
    ? reqItems.map(item => {
        const d = item.createdAt?.toDate();
        const dateStr = d ? `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}` : '';
        return `<div class="role-request-item" data-log-id="${item.id}">
          <span style="font-size:22px;">${item.roleEmoji||'📋'}</span>
          <div style="flex:1;min-width:0;">
            <div style="font-size:13px;font-weight:700;">${item.studentName} · ${item.roleName}</div>
            <div style="font-size:11px;color:#6d28d9;margin-top:2px;">${item.date} · ${dateStr}</div>
          </div>
          <div style="display:flex;gap:6px;">
            <button onclick="approveRoleLog('${item.id}')" class="btn btn-primary" style="font-size:12px;padding:5px 12px;">승인</button>
            <button onclick="rejectRoleLog('${item.id}')" class="btn btn-secondary" style="font-size:12px;padding:5px 12px;">반려</button>
          </div>
        </div>`;
      }).join('')
    : '<div style="font-size:13px;color:#6d28d9;text-align:center;padding:12px;">대기 중인 수행 요청이 없어요 ✅</div>';

  // ─ 오늘 현황 섹션 ─
  const todayRoles = roles.filter(r=>(r.days||[]).includes(todayDow));
  const logSnap = todayRoles.length ? await getDocs(query(collection(db,'roleLogs'), where('date','==',todayStr))) : {docs:[]};
  const logMap = {};
  logSnap.docs.forEach(d=>{ const data=d.data(); logMap[`${data.studentId}_${data.roleId}`]=data.status; });

  const STATUS_LABEL = {
    approved: '✅완료', done: '✅수행', absent: '🏥결석', holiday: '🎌공휴일', none: '— 미수행'
  };
  const STATUS_CLASS = {
    approved:'approved', done:'approved', absent:'approved', holiday:'approved', none:'none'
  };

  const todayHtml = todayRoles.length
    ? `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px;">
        ${todayRoles.map(r=>{
          const rows = (r.students||[]).map(sid=>{
            const s=state.students.find(x=>x.id===sid); if(!s) return '';
            const status=logMap[`${sid}_${r.id}`]||'none';
            const label = STATUS_LABEL[status]||'— 미수행';
            const cls = STATUS_CLASS[status]||'none';
            const isClickable = (status==='none'||status==='approved'||status==='done'||status==='absent'||status==='holiday');
            const tagStyle = isClickable ? 'cursor:pointer;' : '';
            return `<div style="display:flex;align-items:center;justify-content:space-between;font-size:12px;padding:4px 0;">
              <span>${s.number||''}번 ${s.name}</span>
              <span class="role-tag ${cls}" style="font-size:11px;${tagStyle}"
                onclick="openRoleStatusModal('${sid}','${s.name}','${r.id}','${r.name}','${todayStr}','${status}')">${label}</span>
            </div>`;
          }).join('');
          return `<div class="role-card" style="padding:12px 14px;">
            <div style="font-size:13px;font-weight:700;margin-bottom:8px;">${r.emoji||'📋'} ${r.name}</div>
            ${rows||'<span style="font-size:11px;color:var(--text-muted);">배정 없음</span>'}
          </div>`;
        }).join('')}
      </div>`
    : '<div style="padding:16px;color:var(--text-muted);font-size:13px;text-align:center;">오늘 수행할 역할이 없어요</div>';

  // ─ 학생별 수행 현황 ─
  const { dates: weekDates, monStr, friStr } = getThisWeekRange();
  const weekRangeStr = `${monStr} ~ ${friStr}`;

  // 이번 주 roleLogs만 조회 (읽기 절약: 학기 전체 → 이번 주)
  const weekLogSnap = await getDocs(query(collection(db, 'roleLogs'), where('date','>=',monStr), where('date','<=',friStr)));
  // 이번 주 날짜에 해당하는 로그만 필터
  const weekLogs = weekLogSnap.docs.map(d => d.data())
    .filter(l => weekDates.includes(l.date));

  // studentId_roleId_date → status
  const weekLogMap = {};
  weekLogs.forEach(l => { weekLogMap[`${l.studentId}_${l.roleId}_${l.date}`] = l.status; });

  // 배정된 학생만 (숨김 제외), 번호순 정렬
  const assignedIds = new Set();
  roles.forEach(r => (r.students||[]).forEach(sid => assignedIds.add(sid)));
  const assignedStudents = state.students.filter(s => !s.hidden && assignedIds.has(s.id))
    .sort((a,b) => (a.number||0) - (b.number||0));

  const DONE_SET = new Set(['approved','done','absent','holiday']);

  const studentStatusHtml = assignedStudents.length ? `
    <div style="background:var(--surface);border-radius:var(--radius-lg);border:1px solid var(--border);overflow:hidden;">
      ${assignedStudents.map((s, idx) => {
        // 이 학생의 역할들
        const myRoles = roles.filter(r => (r.students||[]).includes(s.id));
        // 수행률 계산
        let total = 0, done = 0;
        const approvedLogSet = new Set();
        weekLogs.filter(l => DONE_SET.has(l.status) && l.studentId === s.id)
          .forEach(l => approvedLogSet.add(`${l.studentId}_${l.roleId}_${l.date}`));
        for (const r of myRoles) {
          for (const dateStr of weekDates) {
            const [y,m,d] = dateStr.split('-').map(Number);
            const dow = new Date(y,m-1,d).getDay();
            if ((r.days||[]).includes(dow)) {
              total++;
              if (approvedLogSet.has(`${s.id}_${r.id}_${dateStr}`)) done++;
            }
          }
        }
        const pct = total === 0 ? 0 : Math.round(done/total*100);
        const barColor = pct >= 70 ? '#10b981' : '#ef4444';

        // 요일별 원 생성 (월~금)
        const dayCircles = weekDates.map(dateStr => {
          const [y,m,d] = dateStr.split('-').map(Number);
          const dow = new Date(y,m-1,d).getDay();
          const dayLabel = DAY_NAMES[dow];
          const hasRole = myRoles.some(r => (r.days||[]).includes(dow));
          const isDone = myRoles.some(r => DONE_SET.has(weekLogMap[`${s.id}_${r.id}_${dateStr}`]));
          const isPending = !isDone && myRoles.some(r => weekLogMap[`${s.id}_${r.id}_${dateStr}`] === 'pending');
          const todayIdx = weekDates.indexOf(todayStr||weekDates[4]);
          const dateIdx = weekDates.indexOf(dateStr);
          // 오늘 포함 이전 날짜 클릭 가능 (todayStr이 weekDates에 없으면 전체 허용)
          const isPast = todayIdx < 0 ? true : dateIdx <= todayIdx;
          const isMissed = hasRole && !isDone && !isPending && isPast;

          let bg = 'var(--border)', color = 'var(--primary)', border = 'none';
          if (hasRole) { bg = 'var(--primary)'; color = '#fff'; }
          if (isDone) border = '2.5px solid #38bdf8';
          else if (isMissed) border = '2.5px solid #f97316';

          // 클릭 가능: 배정된 요일이고 오늘 이전(지난 날짜)인 경우
          const isClickable = hasRole && isPast;
          const curStatus = myRoles.map(r => weekLogMap[`${s.id}_${r.id}_${dateStr}`]).find(st => st) || 'none';
          // 클릭 시 역할 정보 (첫 번째 해당 역할 기준)
          const clickRole = myRoles.find(r => (r.days||[]).includes(dow));
          const clickStyle = isClickable ? 'cursor:pointer;' : '';
          const clickAttr = isClickable && clickRole
            ? `onclick="openRoleStatusModal('${s.id}','${s.name}','${clickRole.id}','${clickRole.name}','${dateStr}','${curStatus}')"`
            : '';

          return `<div ${clickAttr} style="width:26px;height:26px;border-radius:50%;background:${bg};color:${color};font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;border:${border};box-sizing:border-box;flex-shrink:0;${clickStyle}transition:opacity 0.15s;${isClickable?'':''}${isClickable?'opacity:1;':'opacity:0.9;'}"
            ${isClickable?'onmouseenter="this.style.opacity=\'0.7\'" onmouseleave="this.style.opacity=\'1\'"':''}>${dayLabel}</div>`;
        }).join('');

        return `<div style="display:flex;align-items:center;gap:12px;padding:10px 16px;">
          <div style="min-width:72px;font-size:13px;font-weight:700;">${s.number||''}번 ${s.name}</div>
          <div style="display:flex;gap:6px;align-items:center;">${dayCircles}</div>
          <div style="flex:1;margin:0 8px;">
            <div style="height:6px;background:var(--border);border-radius:3px;overflow:hidden;">
              <div style="height:100%;width:${pct}%;background:${barColor};border-radius:3px;"></div>
            </div>
          </div>
          <div style="min-width:36px;text-align:right;font-size:13px;font-weight:800;color:${barColor};">${pct}%</div>
        </div>`;
      }).join('')}
    </div>
    <div style="display:flex;gap:16px;margin-top:10px;font-size:11px;color:var(--text-muted);padding:0 4px;">
      <span><span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:var(--primary);vertical-align:middle;margin-right:3px;"></span>배정 요일</span>
      <span><span style="display:inline-block;width:12px;height:12px;border-radius:50%;border:2px solid #38bdf8;vertical-align:middle;margin-right:3px;"></span>수행 완료</span>
      <span><span style="display:inline-block;width:12px;height:12px;border-radius:50%;border:2px solid #f97316;vertical-align:middle;margin-right:3px;"></span>미수행</span>
    </div>` : '<div style="padding:16px;color:var(--text-muted);font-size:13px;text-align:center;">배정된 학생이 없어요</div>';

  // ─ 역할 목록 섹션 ─
  const roleListHtml = roles.length
    ? `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px;">
        ${roles.map(r=>{
          const dayChips=[1,2,3,4,5].map(d=>`<span class="role-day-chip ${(r.days||[]).includes(d)?'active':''}">${DAY_NAMES[d]}</span>`).join('');
          const studentChips=(r.students||[]).map(sid=>{
            const s=state.students.find(x=>x.id===sid);
            return s?`<span class="role-student-chip">${s.number||''}번 ${s.name}</span>`:'';
          }).join('');
          const bonusTag = r.bonusPoint > 0
            ? `<span style="font-size:11px;font-weight:700;color:#a16207;background:#fef9c3;padding:1px 7px;border-radius:6px;margin-left:6px;vertical-align:middle;">+${r.bonusPoint}🪙</span>`
            : '';
          return `<div class="role-card">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;">
              <div style="font-size:15px;font-weight:700;">${r.emoji||'📋'} ${r.name}${bonusTag}</div>
              <div style="display:flex;gap:8px;">
                <span onclick="openEditRoleModal('${r.id}')" style="font-size:12px;color:var(--primary);cursor:pointer;font-weight:600;">수정</span>
                <span onclick="deleteRole('${r.id}','${r.name}')" style="font-size:12px;color:#ef4444;cursor:pointer;font-weight:600;">삭제</span>
              </div>
            </div>
            <div style="display:flex;justify-content:space-between;margin-bottom:8px;">${dayChips}</div>
            <div style="display:flex;flex-wrap:wrap;gap:4px;">${studentChips||'<span style="font-size:12px;color:var(--text-muted);">배정된 학생 없음</span>'}</div>
          </div>`;
        }).join('')}
      </div>`
    : '<div style="padding:16px;color:var(--text-muted);font-size:13px;text-align:center;">등록된 역할이 없어요</div>';

  el.innerHTML = `
    <div style="background:linear-gradient(135deg,#ede9fe,#ddd6fe,#c4b5fd);border-radius:var(--radius-lg);padding:20px 24px;margin-bottom:24px;border:1px solid rgba(139,92,246,0.2);">
      <div style="font-size:15px;font-weight:700;color:#5b21b6;margin-bottom:12px;display:flex;align-items:center;gap:8px;">
        ✅ 수행 요청
        ${reqItems.length>0?`<span style="background:#ef4444;color:#fff;border-radius:20px;padding:1px 8px;font-size:12px;">${reqItems.length}</span>`:''}
      </div>
      <div style="display:flex;flex-direction:column;gap:8px;">${reqHtml}</div>
    </div>
    <div style="margin-bottom:24px;">
      <div style="font-size:15px;font-weight:700;margin-bottom:12px;">📅 오늘의 현황 <span style="font-size:12px;font-weight:400;color:var(--text-muted);">· 태그 클릭으로 상태 변경</span></div>
      ${todayHtml}
    </div>
    <div style="margin-bottom:24px;">
      <div style="font-size:15px;font-weight:700;margin-bottom:12px;">📋 역할 목록</div>
      ${roleListHtml}
    </div>
    <div>
      <div style="font-size:15px;font-weight:700;margin-bottom:12px;">📊 학생별 수행 현황
        <span style="font-size:12px;font-weight:400;color:var(--text-muted);">· ${weekRangeStr} · 새 주마다 리셋</span>
      </div>
      ${studentStatusHtml}
    </div>`;
}

// ===== 역할 상태 변경 (교사 임의 조작) =====
let _roleStatusPending = null;
let _roleStatusSelected = null;

window.openRoleStatusModal = function(studentId, studentName, roleId, roleName, dateStr, currentStatus) {
  _roleStatusPending = { studentId, studentName, roleId, roleName, dateStr };
  _roleStatusSelected = currentStatus;
  document.getElementById('roleStatusTitle').textContent = `${roleName} · ${studentName}`;
  document.getElementById('roleStatusSubtitle').textContent = `${dateStr} 수행 상태를 변경합니다`;
  // 현재 선택 강조
  ['none','done','absent','holiday'].forEach(s => {
    const btn = document.getElementById(`rss-${s}`);
    if (btn) btn.className = s === currentStatus ? 'btn btn-primary' : 'btn btn-secondary';
    if (btn) btn.style.cssText = 'padding:14px;font-size:14px;font-weight:700;border-radius:10px;';
  });
  openModal('roleStatusModal');
};

window.selectRoleStatus = function(status) {
  _roleStatusSelected = status;
  ['none','done','absent','holiday'].forEach(s => {
    const btn = document.getElementById(`rss-${s}`);
    if (btn) btn.className = s === status ? 'btn btn-primary' : 'btn btn-secondary';
  });
};

window.confirmRoleStatus = async function() {
  if (!_roleStatusPending || !_roleStatusSelected) return;
  const { studentId, studentName, roleId, roleName, dateStr } = _roleStatusPending;
  const status = _roleStatusSelected;
  try {
    // 기존 log 찾기
    const existing = await getDocs(query(collection(db,'roleLogs'),
      where('studentId','==',studentId), where('roleId','==',roleId), where('date','==',dateStr)
    ));
    const role = roles.find(r=>r.id===roleId);
    if (!existing.empty) {
      await updateDoc(doc(db,'roleLogs',existing.docs[0].id), { status, updatedAt: serverTimestamp() });
    } else {
      await addDoc(collection(db,'roleLogs'), {
        studentId, studentName, roleId, roleName,
        roleEmoji: role?.emoji||'📋',
        date: dateStr, status,
        createdAt: serverTimestamp()
      });
    }
    closeModal('roleStatusModal');
    showToast(`${studentName} · ${roleName} 상태 변경 완료`);
    _renderRoleManageContent();
    renderTodayRolesBox();
  } catch(e) { showToast('오류: ' + e.message); }
};

// calcStudentRoleRate에서 done/absent/holiday도 수행으로 인정

// ─── 역할 추가/수정 모달 ───
window.openAddRoleModal = function() {
  _editingRoleId = null;
  document.getElementById('addRoleModalTitle').textContent = '📋 역할 추가';
  document.getElementById('roleNameInput').value = '';
  document.getElementById('roleEmojiInput').value = '';
  document.getElementById('roleBonusPointInput').value = 0;
  document.querySelectorAll('input[name="roleDay"]').forEach(cb => cb.checked = false);
  // 학생 체크박스
  const box = document.getElementById('roleStudentCheckboxes');
  let selectedRoleStudents = new Set();
  box.innerHTML = [...state.students].sort((a,b)=>(a.number||0)-(b.number||0))
    .map(s=>`<div class="give-student-card" id="rsc-${s.id}" onclick="toggleRoleStudent('${s.id}')" style="cursor:pointer;text-align:center;padding:10px 6px;">
      <div style="font-size:11px;font-weight:700;color:var(--text-secondary);">${s.number||''}번</div>
      <div style="font-size:13px;font-weight:700;margin-top:2px;">${s.name}${s.hidden?'<span style="font-size:9px;color:var(--text-muted);"> (숨김)</span>':''}</div>
    </div>`).join('');
  window._selectedRoleStudents = new Set();
  openModal('addRoleModal');
};

window.toggleRoleStudent = function(sid) {
  if (!window._selectedRoleStudents) window._selectedRoleStudents = new Set();
  if (window._selectedRoleStudents.has(sid)) window._selectedRoleStudents.delete(sid);
  else window._selectedRoleStudents.add(sid);
  const el = document.getElementById(`rsc-${sid}`);
  if (el) el.classList.toggle('selected', window._selectedRoleStudents.has(sid));
};

window.selectAllRoleStudents = function(all) {
  window._selectedRoleStudents = all ? new Set(state.students.map(s=>s.id)) : new Set();
  state.students.forEach(s => {
    const el = document.getElementById(`rsc-${s.id}`);
    if (el) el.classList.toggle('selected', all);
  });
};

// openEditRoleModal용 임시 변수 초기화 placeholder
window.openEditRoleModal = function(roleId) {
  _editingRoleId = roleId;
  const r = roles.find(x=>x.id===roleId);
  if (!r) return;
  document.getElementById('addRoleModalTitle').textContent = '📋 역할 수정';
  document.getElementById('roleNameInput').value = r.name||'';
  document.getElementById('roleEmojiInput').value = r.emoji||'';
  document.getElementById('roleBonusPointInput').value = r.bonusPoint||0;
  document.querySelectorAll('input[name="roleDay"]').forEach(cb => {
    cb.checked = (r.days||[]).includes(parseInt(cb.value));
  });
  const box = document.getElementById('roleStudentCheckboxes');
  window._selectedRoleStudents = new Set(r.students||[]);
  box.innerHTML = [...state.students].sort((a,b)=>(a.number||0)-(b.number||0))
    .map(s=>`<div class="give-student-card ${(r.students||[]).includes(s.id)?'selected':''}" id="rsc-${s.id}" onclick="toggleRoleStudent('${s.id}')" style="cursor:pointer;text-align:center;padding:10px 6px;">
      <div style="font-size:11px;font-weight:700;color:var(--text-secondary);">${s.number||''}번</div>
      <div style="font-size:13px;font-weight:700;margin-top:2px;">${s.name}${s.hidden?'<span style="font-size:9px;color:var(--text-muted);"> (숨김)</span>':''}</div>
    </div>`).join('');
  openModal('addRoleModal');
};

window.saveRole = async function() {
  const name = document.getElementById('roleNameInput').value.trim();
  const emoji = document.getElementById('roleEmojiInput').value.trim() || '📋';
  const bonusPoint = parseInt(document.getElementById('roleBonusPointInput').value) || 0;
  const days = [...document.querySelectorAll('input[name="roleDay"]:checked')].map(cb=>parseInt(cb.value));
  const studentIds = [...(window._selectedRoleStudents||new Set())];
  if (!name) return showToast('역할 이름을 입력해 주세요');
  if (!days.length) return showToast('수행 요일을 선택해 주세요');
  const data = { name, emoji, bonusPoint, days, students: studentIds, updatedAt: serverTimestamp() };
  try {
    if (_editingRoleId) {
      await updateDoc(doc(db, 'roles', _editingRoleId), data);
      showToast('역할이 수정됐어요 ✅');
    } else {
      data.createdAt = serverTimestamp();
      await addDoc(collection(db, 'roles'), data);
      showToast('역할이 추가됐어요 📋');
    }
    window._cachedRoles = null;
    closeModal('addRoleModal');
    renderRoleManagePage();
  } catch(e) { showToast('오류: ' + e.message); }
};

window.deleteRole = async function(id, name) {
  if (!confirm(`'${name}' 역할을 삭제할까요?`)) return;
  await deleteDoc(doc(db, 'roles', id));
  window._cachedRoles = null;
  showToast('삭제됐어요');
  renderRoleManagePage();
};

// ─── 포인트 설정 ───
window.openRoleSettingModal = async function() {
  const cfg = await loadRoleConfig();
  document.getElementById('roleRewardPointInput').value = cfg.rewardPoint||500;
  document.getElementById('rolePenaltyPointInput').value = cfg.penaltyPoint||200;
  document.getElementById('rolePenaltyThresholdInput').value = cfg.penaltyThreshold??70;
  const thr = cfg.penaltyThreshold??70;
  document.getElementById('roleSettingThresholdPreview1').textContent = thr;
  document.getElementById('roleSettingThresholdPreview2').textContent = thr;
  const ab = cfg.penaltyAbilities||{};
  ['성실성','인성','사회성','지력','집중력'].forEach(k => {
    const el = document.getElementById(`rolePenalty_${k}`);
    if (el) el.value = ab[k]||0;
  });
  openModal('roleSettingModal');
};

window.saveRoleSetting = async function() {
  const rewardPoint = parseInt(document.getElementById('roleRewardPointInput').value)||500;
  const penaltyPoint = parseInt(document.getElementById('rolePenaltyPointInput').value)||0;
  const penaltyThresholdRaw = document.getElementById('rolePenaltyThresholdInput').value;
const penaltyThreshold = penaltyThresholdRaw===''?70:Math.max(0,Math.min(100,parseInt(penaltyThresholdRaw)||0));
  const penaltyAbilities = {};
  ['성실성','인성','사회성','지력','집중력'].forEach(k => {
    penaltyAbilities[k] = parseInt(document.getElementById(`rolePenalty_${k}`)?.value)||0;
  });
  await setDoc(doc(db,'config','roles'), { rewardPoint, penaltyPoint, penaltyThreshold, penaltyAbilities }, { merge: true });
  window._roleConfig = { rewardPoint, penaltyPoint, penaltyThreshold, penaltyAbilities };
  closeModal('roleSettingModal');
  showToast('설정이 저장됐어요 ✅');
};

// ─── 수행 요청 승인/반려 ───
// 요청 아이템 부드럽게 제거 후 콜백 실행
function removeRoleRequestItem(logId, callback) {
  const el = document.querySelector(`.role-request-item[data-log-id="${logId}"]`);
  if (el) {
    el.classList.add('removing');
    setTimeout(callback, 360); // 트랜지션 완료 후 실행
  } else {
    callback();
  }
}

window.approveRoleLog = async function(logId) {
  const logRef = doc(db, 'roleLogs', logId);
  const fresh = await getDoc(logRef);
  if (!fresh.exists()) return showToast('이미 처리됐어요');
  const item = fresh.data();
  await updateDoc(logRef, { status: 'approved', approvedAt: serverTimestamp() });
  await addDoc(collection(db,'notifications'), {
    studentId: item.studentId,
    type: 'roleApproved',
    roleName: item.roleName,
    roleEmoji: item.roleEmoji||'📋',
    createdAt: serverTimestamp(),
    read: false
  });
  showToast(`${item.studentName} 수행 승인 ✅`);
  removeRoleRequestItem(logId, () => {
    _renderRoleManageContent();
    renderTodayRolesBox();
  });
};

window.rejectRoleLog = async function(logId) {
  if (!confirm('이 수행 요청을 반려할까요?')) return;
  await updateDoc(doc(db,'roleLogs',logId), { status: 'rejected', rejectedAt: serverTimestamp() });
  showToast('반려됐어요');
  removeRoleRequestItem(logId, () => {
    _renderRoleManageContent();
  });
};

// ─── 학생: 내 역할 페이지 ───
export async function renderMyRolesPage() {
  const el = document.getElementById('myRolesContent');
  if (!el) return;
  el.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text-muted);">불러오는 중...</div>';
  await loadRoles();
  window._roleConfig = null; // 항상 최신 설정값 반영
  const cfg = await loadRoleConfig();

  // 비활성화 상태 체크
  if (cfg.active === false) {
    el.innerHTML = `<div style="text-align:center;padding:60px 20px;">
      <div style="font-size:48px;margin-bottom:16px;">⏸️</div>
      <div style="font-size:17px;font-weight:700;color:var(--text-primary);margin-bottom:8px;">1인1역이 잠시 비활성화 중이에요</div>
      <div style="font-size:14px;color:var(--text-muted);">방학 기간 동안 수행 완료 및 보상 기능이 일시 중단됩니다.<br>선생님이 활성화하면 다시 이용할 수 있어요.</div>
    </div>`;
    return;
  }
  const myRoles = roles.filter(r => (r.students||[]).includes(state.currentUser.uid));
  const todayStr = getTodayStr();
  const todayDow = new Date().getDay();
  const { dates, monStr, friStr } = getThisWeekRange();

  // 이번 주 수행 로그
  // (읽기 절약) 내 학기 전체 기록 대신 이번 주 기록만 조회 후 내 것만 거름
  const logSnap = await getDocs(query(collection(db,'roleLogs'), where('date','>=',monStr), where('date','<=',friStr)));
  const logs = logSnap.docs.map(d=>({id:d.id,...d.data()})).filter(l=>l.studentId===state.currentUser.uid)
    .sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
  const todayLogMap = {};
  logs.filter(l=>l.date===todayStr).forEach(l=>{ todayLogMap[l.roleId]=l; });
  // 주간 승인 로그
  const approvedLogSet = new Set();
  logs.filter(l=>['approved','done','absent','holiday'].includes(l.status)&&dates.includes(l.date))
    .forEach(l=>approvedLogSet.add(`${l.studentId}_${l.roleId}_${l.date}`));

  // 수행률 계산
  const { rate, done, total } = calcStudentRoleRate(state.currentUser.uid, dates, approvedLogSet, roles);
  const pct = Math.round(rate * 100);
  const isReward = rate >= (cfg.penaltyThreshold??70)/100;
  const previewPoint = total > 0
    ? (isReward ? floorTo10((cfg.rewardPoint||500)*rate) : -floorTo10((cfg.penaltyPoint||200)*(1-rate)))
    : 0;
  const barColor = pct >= 70 ? '#10b981' : '#ef4444';
  const rateColor = pct >= 70 ? '#15803d' : '#b91c1c';

  // ─ 수행률 카드 ─
  const rateCardHtml = `<div style="background:var(--surface);border-radius:var(--radius-lg);border:1px solid var(--border);padding:24px;box-shadow:var(--shadow-sm);height:100%;box-sizing:border-box;">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
      <div>
        <div style="font-size:13px;font-weight:600;color:var(--text-muted);margin-bottom:2px;">이번 주 수행률</div>
        <div style="font-size:11px;color:var(--text-muted);">${monStr} ~ ${friStr}</div>
      </div>
      <div style="text-align:right;">
        <div style="font-size:42px;font-weight:900;color:${rateColor};line-height:1;">${pct}%</div>
        <div style="font-size:12px;color:var(--text-muted);margin-top:2px;">${done}회 / ${total}회</div>
      </div>
    </div>
    <div style="height:10px;background:var(--border);border-radius:5px;overflow:hidden;margin-bottom:12px;">
      <div style="height:100%;width:${pct}%;background:${barColor};border-radius:5px;transition:width 0.6s ease;"></div>
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center;">
      <div style="font-size:12px;color:var(--text-muted);">
        ${total === 0 ? '이번 주 수행할 역할이 없어요' : pct >= (cfg.penaltyThreshold??70) ? '✅ 보상 대상이에요!' : `⚠️ ${cfg.penaltyThreshold??70}% 이상 달성하면 보상을 받아요`}
      </div>
      ${total > 0 ? `<div style="font-size:13px;font-weight:700;color:${rateColor};">
        예상 ${previewPoint >= 0 ? '+' : ''}${previewPoint}🪙
      </div>` : ''}
    </div>
  </div>`;

  // ─ 1인1역 안내 박스 (최상단, 가로로 길게) ─
  const penaltyAb = cfg.penaltyAbilities||{};
  const penaltyAbStr = Object.entries(penaltyAb).filter(([,v])=>v>0).map(([k,v])=>`${k} -${v}`).join(', ');
  const guideHtml = `<div style="
    background:linear-gradient(135deg,#ede9fe,#ddd6fe,#c4b5fd);
    border-radius:var(--radius-lg); padding:20px 24px;
    border:1px solid rgba(139,92,246,0.2); margin-bottom:20px;
  ">
    <div style="font-size:17px;font-weight:800;color:#5b21b6;margin-bottom:14px;">📋 1인1역 안내</div>
    <div class="m-stack" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
      <div style="background:rgba(255,255,255,0.6);border-radius:10px;padding:12px;">
        <div style="font-size:14px;font-weight:700;color:#6d28d9;margin-bottom:6px;">🎁 수행률 보상</div>
        <div style="font-size:13px;color:#4c1d95;line-height:1.7;">
          • 매주 <strong>수행률 ${cfg.penaltyThreshold??70}% 이상</strong>이면 보상 포인트를 받아요!<br>
          • 수행률이 높을수록 더 많은 포인트를 받아요.<br>
          • (100% = 최대 ${cfg.rewardPoint||500}🪙)<br>
          • 선생님이 주간 보상 버튼을 누르면 자동 지급돼요.
        </div>
      </div>
      <div style="background:rgba(255,255,255,0.6);border-radius:10px;padding:12px;">
        <div style="font-size:14px;font-weight:700;color:#6d28d9;margin-bottom:6px;">❌ ${cfg.penaltyThreshold??70}% 미만 패널티</div>
        <div style="font-size:13px;color:#4c1d95;line-height:1.7;">
          • 수행률이 <strong>${cfg.penaltyThreshold??70}% 미만</strong>이면 최대 <strong>${cfg.penaltyPoint||200}🪙</strong> 포인트가 차감돼요.${penaltyAbStr?`<br>• 능력치도 차감: ${penaltyAbStr}`:''}<br>
          • 열심히 역할을 수행해서 꼭 ${cfg.penaltyThreshold??70}%를 넘겨요! 💪
        </div>
      </div>
    </div>
  </div>`;

  // ─ 내 역할 현황 + 이번 주 수행률 ─
  const myRoleCardHtml = myRoles.length
    ? `<div class="card" style="padding:14px;height:100%;box-sizing:border-box;">
        <div style="font-size:13px;font-weight:700;margin-bottom:10px;">✨ 내 역할</div>
        ${myRoles.map(r => {
          const isToday = (r.days||[]).includes(todayDow);
          const todayLog = todayLogMap[r.id];
          const dayChips = [1,2,3,4,5].map(d=>`<span class="role-day-chip ${(r.days||[]).includes(d)?'active':''} ${d===todayDow?'today':''}" style="font-size:11px;width:22px;height:22px;">${DAY_NAMES[d]}</span>`).join('');
          let actionHtml = '';
          if (isToday) {
            if (!todayLog) actionHtml = `<button onclick="openRoleSubmitModal('${r.id}','${r.name.replace(/'/g,"\\'")}','${r.emoji||'📋'}')" class="btn btn-primary" style="width:50%;margin-top:8px;font-size:12px;padding:6px;">✅ 수행 완료 요청</button>`;
            else if (todayLog.status==='pending') actionHtml = `<div style="margin-top:8px;text-align:center;"><span class="role-tag pending" style="font-size:11px;">⏳ 승인 대기 중</span></div>`;
            else if (['approved','done'].includes(todayLog.status)) actionHtml = `<div style="margin-top:8px;text-align:center;"><span class="role-tag approved" style="font-size:11px;">✅ 오늘 완료!</span></div>`;
            else if (todayLog.status==='absent') actionHtml = `<div style="margin-top:8px;text-align:center;"><span class="role-tag approved" style="font-size:11px;">🏥 결석 처리</span></div>`;
            else if (todayLog.status==='holiday') actionHtml = `<div style="margin-top:8px;text-align:center;"><span class="role-tag approved" style="font-size:11px;">🎌 공휴일</span></div>`;
          }
          const recentLogs = logs.filter(l=>l.roleId===r.id).slice(0,3);
          const logHtml = recentLogs.length ? `<div style="margin-top:8px;padding-top:6px;border-top:1px solid var(--border);">
            ${recentLogs.map(l=>{
              const tag = l.status==='approved'||l.status==='done'?'<span class="role-tag approved" style="font-size:10px;">✅완료</span>'
                :l.status==='pending'?'<span class="role-tag pending" style="font-size:10px;">⏳대기</span>'
                :l.status==='absent'?'<span class="role-tag approved" style="font-size:10px;">🏥결석</span>'
                :l.status==='holiday'?'<span class="role-tag approved" style="font-size:10px;">🎌공휴일</span>'
                :l.status==='missed'?'<span class="role-tag missed" style="font-size:10px;">❌미수행</span>'
                :'<span class="role-tag none" style="font-size:10px;">반려</span>';
              return `<div style="display:flex;justify-content:space-between;font-size:11px;padding:2px 0;"><span style="color:var(--text-muted);">${l.date}</span>${tag}</div>`;
            }).join('')}
          </div>` : '';
          return `<div class="role-card" style="padding:10px;margin-bottom:8px;">
            <div style="font-size:13px;font-weight:700;margin-bottom:5px;">${r.emoji||'📋'} ${r.name}</div>
            <div style="display:flex;gap:3px;">${dayChips}</div>
            ${actionHtml}${logHtml}
          </div>`;
        }).join('')}
      </div>`
    : `<div class="card" style="padding:14px;text-align:center;height:100%;box-sizing:border-box;">
        <div style="font-size:24px;margin-bottom:6px;">📋</div>
        <div style="font-size:13px;color:var(--text-muted);">배정된 역할 없음</div>
      </div>`;

  const topHtml = `<div class="m-stack" style="display:grid;grid-template-columns:1fr 3fr;gap:14px;margin-bottom:20px;align-items:stretch;">
    <div style="display:flex;flex-direction:column;">
      ${myRoleCardHtml}
    </div>
    <div style="display:flex;flex-direction:column;">
      ${rateCardHtml}
    </div>
  </div>`;

  // ─ 하단: 우리 반 전체 역할 목록 ─
  const allRoleHtml = roles.length
    ? `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px;">
        ${roles.map(r=>{
          const dayChips=[1,2,3,4,5].map(d=>`<span class="role-day-chip ${(r.days||[]).includes(d)?'active':''}">${DAY_NAMES[d]}</span>`).join('');
          const studentChips=(r.students||[]).map(sid=>{
            const s=state.students.find(x=>x.id===sid&&!x.hidden);
            return s?`<span class="role-student-chip">${s.number||''} ${s.name}</span>`:'';
          }).filter(Boolean).join('');
          const bonusTag = r.bonusPoint > 0
            ? `<span style="font-size:11px;font-weight:700;color:#a16207;background:#fef9c3;padding:1px 7px;border-radius:6px;margin-left:6px;vertical-align:middle;">+${r.bonusPoint}🪙</span>`
            : '';
          return `<div class="role-card">
            <div style="font-size:15px;font-weight:700;margin-bottom:8px;">${r.emoji||'📋'} ${r.name}${bonusTag}</div>
            <div style="display:flex;justify-content:space-between;margin-bottom:8px;">${dayChips}</div>
            <div style="display:flex;flex-wrap:wrap;gap:4px;">${studentChips||'<span style="font-size:12px;color:var(--text-muted);">배정된 학생 없음</span>'}</div>
          </div>`;
        }).join('')}
      </div>`
    : '<div style="padding:16px;color:var(--text-muted);font-size:13px;">등록된 역할이 없어요</div>';

  let auctionHtml = '';
  try { auctionHtml = await buildStudentAuctionHtml(); } catch (e) { console.warn('경매 정보 로드 오류', e); }
  el.innerHTML = `<div id="roleAuctionStudentBox">${auctionHtml}</div>` + guideHtml + topHtml + `
    <div>
      <div style="font-size:15px;font-weight:700;margin-bottom:12px;">📋 우리 반 1인1역 전체 목록</div>
      ${allRoleHtml}
    </div>`;
}

// ─── 학생: 수행 요청 모달 ───
window.openRoleSubmitModal = function(roleId, roleName, roleEmoji) {
  _pendingRoleSubmit = { roleId, roleName, roleEmoji };
  document.getElementById('roleSubmitTitle').textContent = `${roleEmoji} ${roleName}`;
  document.getElementById('roleSubmitSubtitle').textContent = `오늘(${getTodayStr()}) 수행 완료를 요청합니다`;
  openModal('roleSubmitModal');
};

window.confirmRoleSubmit = async function() {
  if (!_pendingRoleSubmit) return;
  const { roleId, roleName, roleEmoji } = _pendingRoleSubmit;
  const todayStr = getTodayStr();
  // 중복 요청 방지
  const existing = await getDocs(query(collection(db,'roleLogs'),
    where('studentId','==',state.currentUser.uid),
    where('roleId','==',roleId),
    where('date','==',todayStr)
  ));
  if (!existing.empty) { closeModal('roleSubmitModal'); showToast('오늘은 이미 요청했어요'); return; }
  await addDoc(collection(db,'roleLogs'), {
    studentId: state.currentUser.uid, studentName: state.currentUser.name,
    roleId, roleName, roleEmoji,
    date: todayStr, status: 'pending',
    createdAt: serverTimestamp()
  });
  closeModal('roleSubmitModal');
  showToast('수행 요청을 보냈어요! 선생님 승인을 기다려요 ⏳');
  _pendingRoleSubmit = null;
  renderMyRolesPage();
  renderTodayRolesBox();
};

// ─── 학생 홈 오늘의 1인1역 박스 ───
export async function renderTodayRolesBox() {
  const isTeacher = state.currentUser?.role === 'teacher';
  const boxId = isTeacher ? 'teacherTodayRoleBox' : 'studentTodayRoleBox';
  const box = document.getElementById(boxId);
  if (!box) return;
  await loadRoles();
  const todayDow = new Date().getDay();
  const todayStr = getTodayStr();
  const todayRoles = roles.filter(r => (r.days||[]).includes(todayDow));
  if (!todayRoles.length) { box.style.display = 'none'; return; }
  const logSnap = await getDocs(query(collection(db,'roleLogs'), where('date','==',todayStr)));
  const logMap = {};
  logSnap.docs.forEach(d=>{ const data=d.data(); logMap[`${data.studentId}_${data.roleId}`]=data.status; });

  const STATUS_LABEL = {
    approved:'✅완료', done:'✅수행', absent:'🏥결석', holiday:'🎌공휴일', none:'— 미수행', pending:'⏳대기'
  };
  const STATUS_CLASS = {
    approved:'approved', done:'approved', absent:'approved', holiday:'approved', none:'none', pending:'pending'
  };

  box.style.display = 'block';
  box.innerHTML = `<div class="home-role-box" style="box-sizing:border-box;">
    <div style="font-size:15px;font-weight:700;color:var(--text-primary);margin-bottom:12px;">📋 오늘의 1인1역</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px;">
      ${todayRoles.map(r => {
        const rows = (r.students||[]).map(sid => {
          const s = state.students.find(x=>x.id===sid);
          if (!s) return '';
          const status = logMap[`${sid}_${r.id}`]||'none';
          const label = STATUS_LABEL[status]||'— 미수행';
          const cls = STATUS_CLASS[status]||'none';
          const isMyRole = sid === state.currentUser?.uid;
          return `<div style="display:flex;align-items:center;justify-content:space-between;font-size:12px;padding:4px 0;${isMyRole?'font-weight:700;color:var(--primary);':''}">
            <span>${s.name}</span>
            <span class="role-tag ${cls}" style="font-size:11px;">${label}</span>
          </div>`;
        }).join('');
        const isMyRoleBox = (r.students||[]).includes(state.currentUser?.uid);
        return `<div class="role-card${isMyRoleBox?' my-role-box':''}" style="padding:12px 14px;">
          <div style="font-size:13px;font-weight:700;margin-bottom:8px;">${r.emoji||'📋'} ${r.name}</div>
          ${rows||'<span style="font-size:11px;color:var(--text-muted);">배정 없음</span>'}
        </div>`;
      }).join('')}
    </div>
  </div>`;
}

// ===== 1인1역 활성화/비활성화 토글 =====
window.toggleRoleActive = async function() {
  const cfg = await loadRoleConfig();
  const isActive = cfg.active !== false;
  const newActive = !isActive;
  await setDoc(doc(db, 'config', 'roles'), { active: newActive }, { merge: true });
  window._roleConfig = null; // 캐시 무효화
  await loadRoleConfig(); // 버튼 상태 즉시 갱신
  showToast(newActive ? '1인1역이 활성화됐어요 ▶️' : '1인1역이 비활성화됐어요 ⏸️');
};
window.openAttendanceModal = async function() {
  const today = getTodayStr();
  const [year, month, day] = today.split('-');
  document.getElementById('attendanceDate').textContent = `${year}년 ${month}월 ${day}일 출석 현황`;

  const sortedStudents = [...state.students].sort((a,b) => (a.number||999)-(b.number||999));
  const tbody = document.getElementById('attendanceBody');
  tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:20px;">불러오는 중...</td></tr>';

  openModal('attendanceModal');

  // 오늘 출석 + 누적 횟수를 세션 캐시로
  if (!window._attendCache) window._attendCache = {};
  if (!window._attendCache.counts) {
    const allAttendSnap = await getDocs(collection(db, 'attendance'));
    window._attendCache.counts = {};
    allAttendSnap.docs.forEach(d => {
      const sid = d.data().studentId;
      if (sid) window._attendCache.counts[sid] = (window._attendCache.counts[sid] || 0) + 1;
    });
  }
  const attendCountMap = window._attendCache.counts;

  // 오늘 출석은 where 쿼리 1건으로
  const todayAttendSnap = await getDocs(query(collection(db, 'attendance'), where('date', '==', today)));
  const todayAttendMap = {};
  todayAttendSnap.docs.forEach(d => { todayAttendMap[d.data().studentId] = d.data(); });

  const rows = sortedStudents.map(s => ({ s, data: todayAttendMap[s.id] || null }));

  tbody.innerHTML = rows.map(({ s, data }) => `
    <tr>
      <td style="color:var(--text-muted)">${s.number || '-'}</td>
      <td><strong>${s.name}</strong></td>
      <td style="font-weight:700;color:var(--primary);">${attendCountMap[s.id] || 0}회</td>
      <td><span class="attend-badge ${data ? 'attend-o' : 'attend-x'}">${data ? '✅ 출석' : '❌ 미출석'}</span></td>
      <td style="color:var(--text-secondary);text-align:left;">${data ? data.message : '-'}</td>
    </tr>
  `).join('') || '<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:20px;">학생 정보가 없어요</td></tr>';
};
