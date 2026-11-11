// role-auction.js — 1인1역 경매
import { state } from './state.js?v=20261111d';
import {
  addDoc, collection, db, doc, getDoc, getDocs, increment, query, serverTimestamp, updateDoc,
  where
} from './firebase.js?v=20261111d';
import { getMyStudentData, openModal, showToast } from './core.js?v=20261111d';
import { DAY_NAMES, loadRoles, renderRoleManagePage, roles } from './roles.js?v=20261111d';
import { escapeHtml } from './board.js?v=20261111d';

// ===== 1인1역 경매 =====
// 규칙: 입찰해도 포인트는 빠지지 않고, 확정(낙찰) 시 낙찰된 역할의 금액만 차감(소멸). 한 학생은 한 역할만 낙찰.
// 컬렉션: roleAuctions(경매 1건) / roleBids(입찰, 문서ID = 경매ID_역할ID_학생ID)
let _auctionPicks = [];
const _fmtN = n => Number(n || 0).toLocaleString();
const _FIRESTORE_URL = 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

// 낙찰 계산: 높은 금액부터 확정. 한 학생은 한 역할만, 역할별 모집 인원(slots)까지만.
// 같은 금액에서 서로 충돌(같은 학생이 여러 역할 / 한 역할의 자리보다 많은 동점자)하면 교사 선택(picks)이 필요.
function computeAuctionSettlement(cfgs, bids, pointsMap, picks) {
  const cfgMap = {}; cfgs.forEach(c => { cfgMap[c.roleId] = c; });
  const excluded = [];
  const valid = [];
  bids.forEach(b => {
    const c = cfgMap[b.roleId];
    const pts = pointsMap[b.studentId];
    if (!c) { excluded.push({ ...b, reason: '경매 대상이 아닌 역할' }); return; }
    if (!(b.amount > 0) || b.amount < (c.minBid || 0)) { excluded.push({ ...b, reason: '최저 입찰가 미만' }); return; }
    if (pts === undefined) { excluded.push({ ...b, reason: '학생 정보 없음' }); return; }
    if (b.amount > pts) { excluded.push({ ...b, reason: `보유 포인트 부족 (현재 ${pts})` }); return; }
    valid.push(b);
  });
  const assigned = new Set();
  const filled = {}; cfgs.forEach(c => { filled[c.roleId] = 0; });
  const assignments = [];
  const free = id => (cfgMap[id].slots || 1) - filled[id];
  const give = b => { assigned.add(b.studentId); filled[b.roleId]++; assignments.push(b); };
  let pickIdx = 0, guard = 0;
  while (guard++ < 10000) {
    const remaining = valid.filter(b => !assigned.has(b.studentId) && free(b.roleId) > 0);
    if (!remaining.length) break;
    const M = Math.max(...remaining.map(b => b.amount));
    const C = remaining.filter(b => b.amount === M);
    const sc = {}, rc = {};
    C.forEach(b => { sc[b.studentId] = (sc[b.studentId] || 0) + 1; rc[b.roleId] = (rc[b.roleId] || 0) + 1; });
    const conflict = C.filter(b => sc[b.studentId] > 1 || rc[b.roleId] > free(b.roleId));
    const clear = C.filter(b => !conflict.includes(b));
    if (!conflict.length) { clear.forEach(give); continue; }
    if (clear.length) { clear.forEach(give); continue; }
    const pk = picks[pickIdx];
    const chosen = pk && conflict.find(b => b.id === pk);
    if (chosen) { give(chosen); pickIdx++; continue; }
    return { assignments, excluded, pending: conflict, pendingAmount: M, filled };
  }
  return { assignments, excluded, pending: null, pendingAmount: null, filled };
}

async function getActiveRoleAuction(statuses = ['open', 'closed']) {
  const snap = await getDocs(query(collection(db, 'roleAuctions'), where('status', 'in', statuses)));
  const list = snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
  return list[0] || null;
}
async function getAuctionBids(auctionId) {
  const snap = await getDocs(query(collection(db, 'roleBids'), where('auctionId', '==', auctionId)));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}
function _auctionStudentLabel(sid, fallbackName, fallbackNo) {
  const s = state.students.find(x => x.id === sid);
  const no = s?.number ?? fallbackNo ?? '';
  return `${no ? no + '번 ' : ''}${escapeHtml(s?.name || fallbackName || '(알 수 없음)')}`;
}
function _fmtDeadline(ms) {
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// ───────── 교사 ─────────
window.openRoleAuctionModal = async function() {
  if (state.currentUser?.role !== 'teacher') return;
  _auctionPicks = [];
  openModal('roleAuctionModal');
  await renderRoleAuctionAdmin();
};

let _aucAdmin = null; // { a, bids } — 동점 선택/되돌리기는 이 캐시로 다시 그려서 읽기 0건
function _paintAuctionAdmin(el, a, bids) {
  if (a.status === 'open') return renderRoleAuctionOpen(el, a, bids);
  return renderRoleAuctionClosed(el, a, bids);
}
window.renderRoleAuctionAdmin = renderRoleAuctionAdmin; // 새로고침 버튼에서 호출
async function renderRoleAuctionAdmin(useCache) {
  const el = document.getElementById('roleAuctionContent');
  if (!el) return;
  if (useCache === true && _aucAdmin) return _paintAuctionAdmin(el, _aucAdmin.a, _aucAdmin.bids);
  el.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text-muted);">불러오는 중...</div>';
  try {
    const a = await getActiveRoleAuction();
    if (!a) {
      _aucAdmin = null;
      await loadRoles(); // 역할 목록은 '새 경매 만들기' 화면에서만 필요(캐시 있으면 읽기 0건)
      return await renderRoleAuctionCreate(el);
    }
    const bids = await getAuctionBids(a.id);
    _aucAdmin = { a, bids };
    return _paintAuctionAdmin(el, a, bids);
  } catch (e) {
    el.innerHTML = `<div style="color:#ef4444;padding:16px;">오류: ${escapeHtml(_bidErrMsg(e))} <button class="btn btn-secondary btn-sm" onclick="renderRoleAuctionAdmin()">다시 시도</button></div>`;
  }
}

async function renderRoleAuctionCreate(el) {
  let lastHtml = '';
  try {
    const snap = await getDocs(query(collection(db, 'roleAuctions'), where('status', '==', 'settled')));
    const last = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.settledAt?.seconds || 0) - (a.settledAt?.seconds || 0))[0];
    if (last?.results) {
      lastHtml = `<div style="margin-top:18px;padding:12px 14px;background:var(--bg);border-radius:10px;border:1px solid var(--border);">
        <div style="font-size:13px;font-weight:700;margin-bottom:8px;">📜 최근 경매 결과</div>
        ${last.results.map(r => `<div style="font-size:12px;padding:2px 0;">${escapeHtml(r.roleEmoji || '📋')} ${escapeHtml(r.roleName)} → <strong>${escapeHtml(r.studentName)}</strong> (${_fmtN(r.amount)}🪙)</div>`).join('') || '<div style="font-size:12px;color:var(--text-muted);">낙찰자 없음</div>'}
      </div>`;
    }
  } catch (e) { /* 최근 결과는 보조 정보 */ }
  if (!roles.length) {
    el.innerHTML = '<div class="empty-state"><div class="empty-icon">📋</div><h3>등록된 역할이 없어요</h3><p>먼저 역할을 추가해주세요</p></div>';
    return;
  }
  el.innerHTML = `
    <div style="font-size:13px;color:var(--text-secondary);line-height:1.7;margin-bottom:12px;">
      경매에 올릴 역할을 고르고 모집 인원·최저 입찰가를 정하세요. 학생들은 <strong>1인1역 메뉴</strong>에서 입찰해요.<br>
      입찰만으로는 포인트가 빠지지 않고, 확정 시 <strong>낙찰된 역할 금액만</strong> 차감돼요.
    </div>
    <div style="display:flex;flex-direction:column;gap:8px;">
      ${roles.map(r => `<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:var(--bg);border:1px solid var(--border);border-radius:10px;flex-wrap:wrap;">
        <label style="display:flex;align-items:center;gap:8px;flex:1;min-width:150px;cursor:pointer;margin:0;">
          <input type="checkbox" id="aucRoleChk-${r.id}" checked style="width:auto;" />
          <span style="font-size:14px;font-weight:700;">${escapeHtml(r.emoji || '📋')} ${escapeHtml(r.name)}</span>
        </label>
        <label style="font-size:12px;display:flex;align-items:center;gap:4px;margin:0;">모집
          <input type="number" id="aucSlots-${r.id}" value="1" min="1" max="30" style="width:56px;padding:4px 6px;font-size:13px;" />명</label>
        <label style="font-size:12px;display:flex;align-items:center;gap:4px;margin:0;">최저가
          <input type="number" id="aucMin-${r.id}" value="10" min="0" style="width:80px;padding:4px 6px;font-size:13px;" />🪙</label>
      </div>`).join('')}
    </div>
    <div class="form-group" style="margin-top:14px;">
      <label>입찰 마감 시각 (선택)</label>
      <input type="datetime-local" id="aucEnds" />
      <div style="font-size:11px;color:var(--text-muted);margin-top:4px;">시각이 지나면 학생이 더 입찰할 수 없어요. 비워두면 교사가 마감할 때까지 계속돼요.</div>
    </div>
    <label style="display:flex;align-items:flex-start;gap:8px;padding:10px 12px;background:#fef9c3;border-radius:8px;cursor:pointer;margin:0;font-size:12px;color:#a16207;line-height:1.6;">
      <input type="checkbox" id="aucClear" checked style="width:auto;margin-top:3px;" />
      <span><strong>확정할 때 선택한 역할의 기존 담당자를 모두 비우고 낙찰자로 교체</strong>해요. (체크 해제 시 기존 담당자는 유지되고 낙찰자가 추가돼요)</span>
    </label>
    <button class="btn btn-primary btn-full" style="margin-top:14px;" onclick="createRoleAuction()">🔨 경매 시작</button>
    ${lastHtml}`;
}

window.createRoleAuction = async function() {
  if (state.currentUser?.role !== 'teacher') return;
  const picked = [];
  for (const r of roles) {
    if (!document.getElementById(`aucRoleChk-${r.id}`)?.checked) continue;
    const slots = parseInt(document.getElementById(`aucSlots-${r.id}`).value, 10);
    const minBid = parseInt(document.getElementById(`aucMin-${r.id}`).value, 10);
    if (!(slots >= 1)) return showToast(`'${r.name}' 모집 인원은 1명 이상이어야 해요`);
    if (!(minBid >= 0)) return showToast(`'${r.name}' 최저가를 확인해주세요`);
    picked.push({ roleId: r.id, name: r.name, emoji: r.emoji || '📋', days: r.days || [], slots, minBid });
  }
  if (!picked.length) return showToast('경매에 올릴 역할을 1개 이상 선택하세요');
  let endsAt = null;
  const endsVal = document.getElementById('aucEnds')?.value;
  if (endsVal) {
    endsAt = new Date(endsVal).getTime();
    if (!(endsAt > Date.now())) return showToast('마감 시각은 지금보다 뒤여야 해요');
  }
  try {
    if (await getActiveRoleAuction()) return showToast('이미 진행 중인 경매가 있어요');
    await addDoc(collection(db, 'roleAuctions'), {
      status: 'open', roles: picked, endsAt, bidView: {},
      clearExisting: !!document.getElementById('aucClear')?.checked,
      createdAt: serverTimestamp()
    });
    showToast('경매를 시작했어요 🔨 학생들이 1인1역 메뉴에서 입찰할 수 있어요');
    await renderRoleAuctionAdmin();
  } catch (e) { showToast('오류: ' + e.message); }
};

function _auctionBidRowsHtml(a, bids) {
  return a.roles.map(c => {
    const list = bids.filter(b => b.roleId === c.roleId).sort((x, y) => y.amount - x.amount);
    const rows = list.map((b, i) => {
      const s = state.students.find(x => x.id === b.studentId);
      const low = s && b.amount > (s.points || 0);
      return `<div style="display:flex;justify-content:space-between;font-size:12px;padding:3px 0;${low ? 'color:#ef4444;' : ''}">
        <span>${i + 1}. ${_auctionStudentLabel(b.studentId, b.studentName, b.studentNumber)}${low ? ' ⚠️ 포인트 부족' : ''}</span>
        <strong>${_fmtN(b.amount)}🪙</strong></div>`;
    }).join('') || '<div style="font-size:12px;color:var(--text-muted);">아직 입찰이 없어요</div>';
    return `<div style="padding:10px 12px;background:var(--bg);border:1px solid var(--border);border-radius:10px;">
      <div style="font-size:13px;font-weight:700;margin-bottom:6px;">${escapeHtml(c.emoji)} ${escapeHtml(c.name)}
        <span style="font-size:11px;font-weight:600;color:var(--text-muted);margin-left:6px;">모집 ${c.slots}명 · 최저 ${_fmtN(c.minBid)}🪙 · 입찰 ${list.length}건</span></div>
      ${rows}</div>`;
  }).join('');
}

function renderRoleAuctionOpen(el, a, bids) {
  const ends = a.endsAt ? `마감 ${_fmtDeadline(a.endsAt)}${Date.now() > a.endsAt ? ' (마감 시각 지남)' : ''}` : '마감 시각 없음 (교사가 마감)';
  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;gap:8px;flex-wrap:wrap;">
      <div style="font-size:13px;font-weight:700;color:#16a34a;">🟢 입찰 진행 중 <span style="font-weight:500;color:var(--text-muted);margin-left:6px;">${ends}</span></div>
      <button class="btn btn-secondary btn-sm" onclick="renderRoleAuctionAdmin()">🔄 새로고침</button>
    </div>
    <div style="display:flex;flex-direction:column;gap:8px;">${_auctionBidRowsHtml(a, bids)}</div>
    <div style="display:flex;gap:8px;margin-top:14px;">
      <button class="btn btn-secondary" style="flex:1;" onclick="cancelRoleAuction('${a.id}')">경매 취소</button>
      <button class="btn btn-primary" style="flex:2;" onclick="closeRoleAuctionBidding('${a.id}')">입찰 마감 → 낙찰 계산</button>
    </div>`;
}

window.cancelRoleAuction = async function(auctionId) {
  if (state.currentUser?.role !== 'teacher') return;
  if (!confirm('경매를 취소할까요?\n입찰 내용은 사라지고 포인트·역할은 아무것도 바뀌지 않아요.')) return;
  try {
    await updateDoc(doc(db, 'roleAuctions', auctionId), { status: 'cancelled', cancelledAt: serverTimestamp() });
    showToast('경매를 취소했어요');
    await renderRoleAuctionAdmin();
  } catch (e) { showToast('오류: ' + e.message); }
};

window.closeRoleAuctionBidding = async function(auctionId) {
  if (state.currentUser?.role !== 'teacher') return;
  if (!confirm('입찰을 마감하고 낙찰 결과를 계산할까요?\n마감하면 학생들은 더 이상 입찰할 수 없어요.')) return;
  try {
    await updateDoc(doc(db, 'roleAuctions', auctionId), { status: 'closed', closedAt: serverTimestamp() });
    _auctionPicks = [];
    await renderRoleAuctionAdmin();
  } catch (e) { showToast('오류: ' + e.message); }
};

window.reopenRoleAuctionBidding = async function(auctionId) {
  if (state.currentUser?.role !== 'teacher') return;
  try {
    await updateDoc(doc(db, 'roleAuctions', auctionId), { status: 'open' });
    _auctionPicks = [];
    await renderRoleAuctionAdmin();
  } catch (e) { showToast('오류: ' + e.message); }
};

function _auctionSettlement(a, bids) {
  const pointsMap = {};
  state.students.forEach(s => { pointsMap[s.id] = s.points || 0; });
  const cleanBids = bids.map(b => ({ id: b.id, roleId: b.roleId, studentId: b.studentId, amount: Number(b.amount) || 0 }));
  return computeAuctionSettlement(a.roles, cleanBids, pointsMap, _auctionPicks);
}

function renderRoleAuctionClosed(el, a, bids) {
  const st = _auctionSettlement(a, bids);
  const bidMap = {}; bids.forEach(b => { bidMap[b.id] = b; });
  const winnersByRole = {};
  st.assignments.forEach(w => { (winnersByRole[w.roleId] = winnersByRole[w.roleId] || []).push(w); });
  const roleHtml = a.roles.map(c => {
    const ws = winnersByRole[c.roleId] || [];
    const body = ws.length
      ? ws.map(w => `<div style="font-size:13px;padding:2px 0;">🏆 <strong>${_auctionStudentLabel(w.studentId, bidMap[w.id]?.studentName, bidMap[w.id]?.studentNumber)}</strong> · ${_fmtN(w.amount)}🪙</div>`).join('')
      : `<div style="font-size:12px;color:var(--text-muted);">낙찰자 없음${st.pending ? ' (동점 선택 후 확정돼요)' : ''}</div>`;
    return `<div style="padding:10px 12px;background:var(--bg);border:1px solid var(--border);border-radius:10px;">
      <div style="font-size:13px;font-weight:700;margin-bottom:4px;">${escapeHtml(c.emoji)} ${escapeHtml(c.name)} <span style="font-size:11px;font-weight:600;color:var(--text-muted);margin-left:6px;">모집 ${c.slots}명 · 낙찰 ${ws.length}명</span></div>${body}</div>`;
  }).join('');

  let tieHtml = '';
  if (st.pending) {
    tieHtml = `<div style="padding:12px 14px;background:#fff7ed;border:1.5px solid #fb923c;border-radius:10px;margin-bottom:12px;">
      <div style="font-size:14px;font-weight:800;color:#c2410c;margin-bottom:4px;">⚖️ 동점 발생 · ${_fmtN(st.pendingAmount)}🪙</div>
      <div style="font-size:12px;color:#9a3412;line-height:1.6;margin-bottom:8px;">가위바위보 등으로 정한 뒤, <strong>낙찰시킬 입찰 1건</strong>을 선택하세요. (한 번에 한 건씩 정해요)</div>
      <div style="display:flex;flex-direction:column;gap:6px;">
        ${st.pending.map(b => {
          const raw = bidMap[b.id]; const c = a.roles.find(r => r.roleId === b.roleId);
          return `<button class="btn btn-secondary" style="text-align:left;" onclick="pickAuctionTie('${b.id}')">
            ${_auctionStudentLabel(b.studentId, raw?.studentName, raw?.studentNumber)} → ${escapeHtml(c?.emoji || '')} ${escapeHtml(c?.name || '')} (${_fmtN(b.amount)}🪙)</button>`;
        }).join('')}
      </div>
    </div>`;
  }
  const excl = st.excluded.length ? `<div style="padding:10px 12px;border:1px dashed #ef4444;border-radius:10px;margin-top:10px;">
    <div style="font-size:12px;font-weight:700;color:#b91c1c;margin-bottom:4px;">제외된 입찰 (낙찰 계산에서 빠져요)</div>
    ${st.excluded.map(b => {
      const raw = bidMap[b.id]; const c = a.roles.find(r => r.roleId === b.roleId);
      return `<div style="font-size:12px;color:#b91c1c;">${_auctionStudentLabel(b.studentId, raw?.studentName, raw?.studentNumber)} · ${escapeHtml(c?.name || '')} ${_fmtN(b.amount)}🪙 — ${escapeHtml(b.reason)}</div>`;
    }).join('')}</div>` : '';
  const undo = _auctionPicks.length ? `<button class="btn btn-secondary btn-sm" onclick="undoAuctionTiePick()">↶ 마지막 동점 선택 취소</button>` : '';

  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;gap:8px;flex-wrap:wrap;">
      <div style="font-size:13px;font-weight:700;color:#c2410c;">🟠 입찰 마감됨 · 낙찰 확인 중</div>
      <div style="display:flex;gap:6px;">${undo}<button class="btn btn-secondary btn-sm" onclick="renderRoleAuctionAdmin()">🔄 새로고침</button></div>
    </div>
    ${tieHtml}
    <div style="display:flex;flex-direction:column;gap:8px;">${roleHtml}</div>
    ${excl}
    <div style="font-size:11px;color:var(--text-muted);margin-top:10px;line-height:1.6;">
      높은 금액부터 낙찰돼요. 한 학생은 한 역할만 낙찰되고, 낙찰된 학생의 다른 입찰은 취소돼요. 확정하면 낙찰된 역할 금액만 차감돼요.
      ${a.clearExisting ? '<br>⚠️ 확정 시 경매 대상 역할의 <strong>기존 담당자는 비워지고</strong> 낙찰자로 교체돼요.' : '<br>기존 담당자는 유지되고 낙찰자가 추가돼요.'}
    </div>
    <div style="display:flex;gap:8px;margin-top:14px;">
      <button class="btn btn-secondary" style="flex:1;" onclick="reopenRoleAuctionBidding('${a.id}')">↩️ 입찰 다시 열기</button>
      <button class="btn btn-primary" style="flex:2;" ${st.pending ? 'disabled' : ''} onclick="confirmRoleAuction('${a.id}')">✅ 낙찰 확정</button>
    </div>`;
}

window.pickAuctionTie = async function(bidId) {
  _auctionPicks.push(bidId);
  await renderRoleAuctionAdmin(true);
};
window.undoAuctionTiePick = async function() {
  _auctionPicks.pop();
  await renderRoleAuctionAdmin(true);
};

window.confirmRoleAuction = async function(auctionId) {
  if (state.currentUser?.role !== 'teacher') return;
  if (window._auctionConfirming) return;
  try {
    const a = await getActiveRoleAuction(['closed']);
    if (!a || a.id !== auctionId) return showToast('마감 상태의 경매가 아니에요. 새로고침 후 다시 확인하세요');
    const bids = await getAuctionBids(a.id);
    const st = _auctionSettlement(a, bids);
    if (st.pending) return showToast('동점 선택을 먼저 마쳐주세요');
    const bidMap = {}; bids.forEach(b => { bidMap[b.id] = b; });
    const winners = st.assignments.map(w => {
      const c = a.roles.find(r => r.roleId === w.roleId);
      const s = state.students.find(x => x.id === w.studentId);
      return { roleId: w.roleId, roleName: c.name, roleEmoji: c.emoji, studentId: w.studentId,
               studentName: s?.name || bidMap[w.id]?.studentName || '', amount: w.amount };
    });
    const summary = winners.length
      ? winners.map(w => `• ${w.roleName}: ${w.studentName} (${_fmtN(w.amount)}🪙)`).join('\n')
      : '낙찰자가 없어요';
    if (!confirm(`아래 내용으로 확정할까요?\n\n${summary}\n\n낙찰된 포인트는 소멸되고, 확정 후에는 되돌릴 수 없어요.${a.clearExisting ? '\n경매 대상 역할의 기존 담당자는 비워져요.' : ''}`)) return;

    window._auctionConfirming = true;
    const { runTransaction } = await import(_FIRESTORE_URL);
    await runTransaction(db, async tx => {
      const aRef = doc(db, 'roleAuctions', a.id);
      const aSnap = await tx.get(aRef);
      if (!aSnap.exists() || aSnap.data().status !== 'closed') throw new Error('경매 상태가 바뀌었어요. 새로고침 후 다시 시도하세요');
      // 읽기 먼저(트랜잭션 규칙)
      const sSnaps = {};
      for (const w of winners) sSnaps[w.studentId] = await tx.get(doc(db, 'students', w.studentId));
      const rSnaps = {};
      for (const c of a.roles) rSnaps[c.roleId] = await tx.get(doc(db, 'roles', c.roleId));
      for (const w of winners) {
        const ss = sSnaps[w.studentId];
        if (!ss.exists()) throw new Error(`${w.studentName} 학생 정보를 찾을 수 없어요`);
        if ((ss.data().points || 0) < w.amount) throw new Error(`${w.studentName} 학생의 포인트가 부족해요 (현재 ${ss.data().points || 0}🪙). 새로고침 후 다시 계산해주세요`);
      }
      for (const w of winners) {
        if (!rSnaps[w.roleId].exists()) throw new Error(`'${w.roleName}' 역할이 삭제되어 확정할 수 없어요`);
      }
      // 쓰기
      for (const w of winners) {
        tx.update(doc(db, 'students', w.studentId), { points: increment(-w.amount) });
        tx.set(doc(collection(db, 'history')), {
          studentId: w.studentId, studentName: w.studentName, delta: -w.amount,
          reason: `🔨 역할 경매 낙찰: ${w.roleEmoji} ${w.roleName} (-${w.amount}🪙)`,
          type: 'minus', source: 'roleAuction', createdAt: serverTimestamp()
        });
        tx.set(doc(collection(db, 'notifications')), {
          studentId: w.studentId, type: 'roleAuctionWon', roleName: w.roleName, roleEmoji: w.roleEmoji,
          amount: w.amount, createdAt: serverTimestamp(), read: false
        });
      }
      for (const c of a.roles) {
        const cur = rSnaps[c.roleId].data().students || [];
        const win = winners.filter(w => w.roleId === c.roleId).map(w => w.studentId);
        const next = a.clearExisting ? win : [...new Set([...cur, ...win])];
        tx.update(doc(db, 'roles', c.roleId), { students: next });
      }
      tx.update(aRef, { status: 'settled', settledAt: serverTimestamp(), results: winners });
    });
    window._cachedRoles = null;
    _auctionPicks = [];
    showToast(`낙찰 확정 완료 🔨 ${winners.length}명에게 역할이 배정됐어요`);
    await renderRoleAuctionAdmin();
    if (typeof renderRoleManagePage === 'function' && !document.getElementById('page-roleManage')?.classList.contains('hidden')) renderRoleManagePage();
  } catch (e) {
    showToast('오류: ' + e.message);
    await renderRoleAuctionAdmin();
  } finally { window._auctionConfirming = false; }
};

// ───────── 학생 ─────────
// 읽기 최소화 설계
//  - 입찰 현황은 경매 문서의 bidView(요약)에 같이 저장 → 새로고침 = 문서 1건 읽기
//  - 입찰/취소 직후엔 화면을 메모리 캐시로 다시 그려서 추가 읽기 0건
//  - 정산(교사 확정)은 roleBids 원본으로만 계산하므로 요약이 틀려도 결과엔 영향 없음
let _aucStu = null; // { uid, a, bids }
function _withTimeout(p, ms, onTimeout) {
  let t;
  return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => { try { onTimeout && onTimeout(); } catch (_) {} rej(new Error('TIMEOUT')); }, ms); })])
    .finally(() => clearTimeout(t));
}
function _bidsFromView(a) {
  const out = [], v = a.bidView || {};
  for (const roleId of Object.keys(v)) for (const sid of Object.keys(v[roleId] || {})) {
    const x = v[roleId][sid];
    if (x && typeof x.a === 'number') out.push({ roleId, studentId: sid, amount: x.a, studentName: x.n || '', studentNumber: x.no || 0 });
  }
  return out;
}
async function _bidsOf(a) { return a.bidView !== undefined ? _bidsFromView(a) : await getAuctionBids(a.id); } // 구형 경매만 전체 읽기
async function _loadStudentAuction() { // 읽기 1건(경매 문서)
  const a = await getActiveRoleAuction(['open']);
  if (!a) { _aucStu = null; return null; }
  _aucStu = { uid: state.currentUser.uid, a, bids: await _bidsOf(a) };
  return _aucStu;
}
async function _reloadStudentAuction() { // 읽기 1건(경매 문서 직접 조회)
  if (!_aucStu || _aucStu.uid !== state.currentUser.uid) return _loadStudentAuction();
  const snap = await getDoc(doc(db, 'roleAuctions', _aucStu.a.id));
  if (!snap.exists() || snap.data().status !== 'open') { _aucStu = null; return { closed: true }; }
  const a = { id: snap.id, ...snap.data() };
  _aucStu = { uid: state.currentUser.uid, a, bids: await _bidsOf(a) };
  return _aucStu;
}
function _renderStudentAuctionHtml(st) {
  if (!st) return '';
  if (st.closed) return `<div style="background:#fff7ed;border:1.5px solid #fdba74;border-radius:var(--radius-lg);padding:16px 20px;margin-bottom:20px;font-size:14px;font-weight:700;color:#c2410c;">🔨 입찰이 마감됐어요. 선생님의 낙찰 확정을 기다려요!</div>`;
  const a = st.a, bids = st.bids;
  const uid = state.currentUser.uid;
  const me = state.students.find(s => s.id === uid) || (typeof getMyStudentData === 'function' ? getMyStudentData() : {}) || {};
  const myPts = me.points || 0;
  const ended = !!(a.endsAt && Date.now() > a.endsAt);
  const roleCards = a.roles.map(c => {
    const list = bids.filter(b => b.roleId === c.roleId).sort((x, y) => y.amount - x.amount);
    const top = list[0];
    const topNames = top ? list.filter(b => b.amount === top.amount).map(b => escapeHtml(state.students.find(s => s.id === b.studentId)?.name || b.studentName || '')).join(', ') : '';
    const mine = list.find(b => b.studentId === uid);
    let badge = '';
    if (mine) {
      const rank = list.filter(b => b.amount > mine.amount).length;
      const tie = list.filter(b => b.amount === mine.amount).length > 1;
      badge = rank >= c.slots ? '<span style="color:#ef4444;">📉 지금은 밀려요</span>'
        : tie ? '<span style="color:#d97706;">⚖️ 동점 (가위바위보 가능)</span>'
        : '<span style="color:#16a34a;">🥇 낙찰권이에요</span>';
    }
    const dayChips = [1, 2, 3, 4, 5].map(d => `<span class="role-day-chip ${(c.days || []).includes(d) ? 'active' : ''}" style="font-size:10px;width:20px;height:20px;">${DAY_NAMES[d]}</span>`).join('');
    const disabled = ended ? 'disabled' : '';
    return `<div style="padding:12px;background:var(--surface);border:1px solid var(--border);border-radius:12px;">
      <div style="font-size:14px;font-weight:700;margin-bottom:6px;">${escapeHtml(c.emoji)} ${escapeHtml(c.name)}</div>
      <div style="display:flex;gap:3px;margin-bottom:8px;">${dayChips}</div>
      <div style="font-size:12px;color:var(--text-secondary);line-height:1.7;">
        모집 ${c.slots}명 · 최저 ${_fmtN(c.minBid)}🪙 · 입찰 ${list.length}건<br>
        현재 최고가: ${top ? `<strong>${_fmtN(top.amount)}🪙</strong> (${topNames})` : '<span style="color:var(--text-muted);">아직 없음</span>'}
        ${mine ? `<br>내 입찰: <strong>${_fmtN(mine.amount)}🪙</strong> ${badge}` : ''}
      </div>
      <div style="display:flex;gap:6px;margin-top:8px;">
        <input type="number" id="bidInput-${c.roleId}" min="${Math.max(1, c.minBid)}" placeholder="입찰 금액" value="${mine ? mine.amount : ''}" ${disabled} style="flex:1;min-width:0;padding:6px 8px;font-size:13px;" />
        <button class="btn btn-primary btn-sm" id="bidBtn-${c.roleId}" ${disabled} onclick="placeRoleBid('${a.id}','${c.roleId}')">${mine ? '수정' : '입찰'}</button>
        ${mine ? `<button class="btn btn-secondary btn-sm" ${disabled} onclick="cancelRoleBid('${a.id}','${c.roleId}')">취소</button>` : ''}
      </div>
    </div>`;
  }).join('');
  return `<div style="background:linear-gradient(135deg,#fff7ed,#ffedd5);border:1.5px solid #fdba74;border-radius:var(--radius-lg);padding:18px 20px;margin-bottom:20px;">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px;">
      <div style="font-size:17px;font-weight:800;color:#c2410c;">🔨 1인1역 경매 진행 중!</div>
      <button class="btn btn-secondary btn-sm" onclick="refreshStudentAuctionBox()">🔄 새로고침</button>
    </div>
    <div style="font-size:12px;color:#9a3412;line-height:1.7;margin-bottom:12px;">
      ${a.endsAt ? `마감 ${_fmtDeadline(a.endsAt)}${ended ? ' · <strong>입찰이 마감됐어요. 선생님의 낙찰 확정을 기다려요</strong>' : ''}` : '선생님이 마감할 때까지 입찰할 수 있어요'}<br>
      • 입찰해도 포인트는 바로 빠지지 않아요. 여러 역할에 입찰해도 돼요. (각 입찰은 내 포인트 <strong>${_fmtN(myPts)}🪙</strong> 이하로)<br>
      • 낙찰되면 <strong>그 역할 금액만 차감</strong>되고, 다른 입찰은 모두 취소돼요. 한 사람이 한 역할만 맡아요.<br>
      • 같은 금액이면 가위바위보로 정해요. 확정 때 포인트가 모자라면 그 입찰은 무효예요.<br>
      • 다른 친구들의 최신 입찰은 🔄 새로고침을 눌러야 보여요.
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:12px;">${roleCards}</div>
  </div>`;
}
export async function buildStudentAuctionHtml() {
  const st = await _loadStudentAuction();
  window._aucLastRefresh = Date.now();
  return _renderStudentAuctionHtml(st);
}
// 경매 박스만 다시 그린다(입력 중이던 다른 칸의 값은 유지)
function _paintStudentAuctionBox(st, exceptRoleId) {
  const box = document.getElementById('roleAuctionStudentBox');
  if (!box) return;
  const typed = {};
  box.querySelectorAll('input[id^="bidInput-"]').forEach(i => { typed[i.id] = i.value; });
  box.innerHTML = _renderStudentAuctionHtml(st);
  Object.keys(typed).forEach(id => {
    if (exceptRoleId && id === `bidInput-${exceptRoleId}`) return;
    const el = document.getElementById(id);
    if (el && !el.disabled && typed[id] !== '') el.value = typed[id];
  });
}

window.refreshStudentAuctionBox = async function() {
  const box = document.getElementById('roleAuctionStudentBox');
  if (!box || state.currentUser?.role !== 'student') return;
  if (window._aucRefreshing) return;
  if (Date.now() - (window._aucLastRefresh || 0) < 5000) return showToast('방금 갱신했어요. 5초 뒤에 다시 눌러주세요 🙂');
  window._aucRefreshing = true;
  try {
    const st = await _withTimeout(_reloadStudentAuction(), 10000);
    window._aucLastRefresh = Date.now();
    _paintStudentAuctionBox(st);
    showToast('최신 입찰 현황으로 갱신했어요');
  } catch (e) { showToast(_bidErrMsg(e), 5000); }
  finally { window._aucRefreshing = false; }
};

function _bidErrMsg(e) {
  const m = e?.message || '', code = e?.code || '';
  const known = { NOT_OPEN: '이미 마감됐거나 취소된 경매예요', ENDED: '입찰 시간이 끝났어요', NO_ROLE: '경매 대상 역할이 아니에요',
    MIN: '최저 입찰가보다 낮아요', POINTS: '보유 포인트보다 많이 입찰할 수 없어요', NO_STUDENT: '학생 정보를 찾을 수 없어요' };
  if (known[m]) return known[m];
  if (m === 'TIMEOUT') return '응답이 없어요. 오늘 Firebase 사용량 한도를 넘었거나 인터넷이 불안정할 수 있어요. 잠시 뒤 🔄 새로고침으로 입찰됐는지 확인해 주세요';
  if (code === 'resource-exhausted' || /quota/i.test(m)) return '오늘 Firebase 무료 사용량 한도를 다 썼어요. 한국시간 오후 4~5시 이후에 다시 해 주세요';
  if (code === 'permission-denied') return '권한이 없어서 저장하지 못했어요 (Firebase 보안 규칙)';
  if (code === 'unavailable' || /network|offline/i.test(m)) return '인터넷 연결이 불안정해요. 잠시 뒤 다시 시도해 주세요';
  return '오류: ' + m;
}

function _setBidBtn(roleId, text, disabled) {
  const b = document.getElementById(`bidBtn-${roleId}`);
  if (b) { if (text != null) b.textContent = text; b.disabled = !!disabled; }
}

window.placeRoleBid = async function(auctionId, roleId) {
  if (state.currentUser?.role !== 'student') return showToast('학생 계정으로 로그인해야 입찰할 수 있어요');
  const input = document.getElementById(`bidInput-${roleId}`);
  const amount = Math.floor(Number(input?.value));
  if (!(amount >= 1)) return showToast('입찰 금액을 1 이상으로 입력하세요');
  if (window._bidBusy) return showToast('이전 입찰을 처리 중이에요. 잠시만 기다려주세요');
  window._bidBusy = true;
  const prevText = document.getElementById(`bidBtn-${roleId}`)?.textContent || '입찰';
  _setBidBtn(roleId, '입찰 중…', true);
  showToast('입찰하는 중이에요… ⏳', 12000);
  const ctl = { aborted: false };
  try {
    const { runTransaction } = await import(_FIRESTORE_URL);
    const txP = runTransaction(db, async tx => {
      if (ctl.aborted) throw new Error('TIMEOUT'); // 시간 초과 뒤 재시도로 몰래 저장되는 일 방지
      const aSnap = await tx.get(doc(db, 'roleAuctions', auctionId));
      if (!aSnap.exists() || aSnap.data().status !== 'open') throw new Error('NOT_OPEN');
      const a = aSnap.data();
      if (a.endsAt && Date.now() > a.endsAt) throw new Error('ENDED');
      const c = (a.roles || []).find(r => r.roleId === roleId);
      if (!c) throw new Error('NO_ROLE');
      if (amount < (c.minBid || 0)) throw new Error('MIN');
      const sSnap = await tx.get(doc(db, 'students', state.currentUser.uid));
      if (!sSnap.exists()) throw new Error('NO_STUDENT');
      if (amount > (sSnap.data().points || 0)) throw new Error('POINTS');
      const no = sSnap.data().number || 0;
      tx.set(doc(db, 'roleBids', `${auctionId}_${roleId}_${state.currentUser.uid}`), {
        auctionId, roleId, studentId: state.currentUser.uid, studentName: state.currentUser.name,
        studentNumber: no, amount, updatedAt: serverTimestamp()
      });
      return { no };
    });
    txP.catch(() => {});
    const { no } = await _withTimeout(txP, 12000, () => { ctl.aborted = true; });
    // 화면: 메모리 캐시로 갱신(읽기 0건)
    if (_aucStu && _aucStu.a.id === auctionId) {
      _aucStu.bids = _aucStu.bids.filter(b => !(b.roleId === roleId && b.studentId === state.currentUser.uid));
      _aucStu.bids.push({ roleId, studentId: state.currentUser.uid, amount, studentName: state.currentUser.name, studentNumber: no });
      _paintStudentAuctionBox(_aucStu, roleId);
      // 다른 친구 화면용 요약(쓰기 1건, 실패해도 입찰 자체는 저장됨)
      if (_aucStu.a.bidView !== undefined) {
        updateDoc(doc(db, 'roleAuctions', auctionId), { [`bidView.${roleId}.${state.currentUser.uid}`]: { a: amount, n: state.currentUser.name, no } })
          .catch(err => { console.warn('bidView 갱신 실패', err); showToast('입찰은 저장됐지만 친구들 화면 반영이 늦을 수 있어요', 4000); });
      }
    }
    showToast('입찰했어요 🔨');
  } catch (e) {
    _setBidBtn(roleId, prevText, false);
    showToast(_bidErrMsg(e), 6000); // 실패 시 입력값은 그대로 두고 추가 읽기도 하지 않는다
  } finally { window._bidBusy = false; }
};

window.cancelRoleBid = async function(auctionId, roleId) {
  if (state.currentUser?.role !== 'student') return showToast('학생 계정으로 로그인해야 해요');
  if (window._bidBusy) return showToast('이전 입찰을 처리 중이에요. 잠시만 기다려주세요');
  window._bidBusy = true;
  showToast('입찰을 취소하는 중이에요… ⏳', 12000);
  const ctl = { aborted: false };
  try {
    const { runTransaction, deleteField } = await import(_FIRESTORE_URL);
    const txP = runTransaction(db, async tx => {
      if (ctl.aborted) throw new Error('TIMEOUT');
      const aSnap = await tx.get(doc(db, 'roleAuctions', auctionId));
      if (!aSnap.exists() || aSnap.data().status !== 'open') throw new Error('NOT_OPEN');
      tx.delete(doc(db, 'roleBids', `${auctionId}_${roleId}_${state.currentUser.uid}`));
    });
    txP.catch(() => {});
    await _withTimeout(txP, 12000, () => { ctl.aborted = true; });
    if (_aucStu && _aucStu.a.id === auctionId) {
      _aucStu.bids = _aucStu.bids.filter(b => !(b.roleId === roleId && b.studentId === state.currentUser.uid));
      _paintStudentAuctionBox(_aucStu, roleId);
      if (_aucStu.a.bidView !== undefined) {
        updateDoc(doc(db, 'roleAuctions', auctionId), { [`bidView.${roleId}.${state.currentUser.uid}`]: deleteField() })
          .catch(err => console.warn('bidView 갱신 실패', err));
      }
    }
    showToast('입찰을 취소했어요');
  } catch (e) { showToast(_bidErrMsg(e), 6000); }
  finally { window._bidBusy = false; }
};
