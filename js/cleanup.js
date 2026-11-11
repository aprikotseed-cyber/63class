// cleanup.js — 데이터 정리 도구 (교사 전용): 검사 → 결과 확인 → 백업 → 실행
import { state } from './state.js?v=20261111c';
import { collection, db, deleteField, doc, getDoc, getDocs, query, serverTimestamp, where, writeBatch } from './firebase.js?v=20261111c';
import { closeModal, openModal, showToast } from './core.js?v=20261111c';
import { SECRETS } from './accounts.js?v=20261111c';
import { ORPHAN_COLLECTIONS, chunk, countByCol, oldReadNotifications, planOrphans } from './cleanup-plan.js?v=20261111c';

const MODAL_ID = 'cleanupModal';
let _plan = null; // 검사 결과

function ensureModal() {
  if (document.getElementById(MODAL_ID)) return;
  const el = document.createElement('div');
  el.className = 'modal-overlay hidden';
  el.id = MODAL_ID;
  el.innerHTML = `
    <div class="modal" style="max-width:560px;">
      <div class="modal-title">🧹 데이터 정리</div>
      <div class="modal-subtitle">먼저 검사만 해요. 무엇이 바뀌는지 확인한 뒤 실행할지 고를 수 있어요.</div>
      <div id="cleanupBody" style="margin:16px 0;font-size:14px;line-height:1.6;"></div>
      <div class="modal-actions" id="cleanupActions"></div>
    </div>`;
  document.body.appendChild(el);
}

function setActions(html) { document.getElementById('cleanupActions').innerHTML = html; }
function setBody(html) { document.getElementById('cleanupBody').innerHTML = html; }

window.openCleanupModal = function() {
  if (state.currentUser?.role !== 'teacher') return showToast('선생님만 쓸 수 있어요');
  ensureModal();
  _plan = null;
  setBody(`
    <div style="background:var(--bg);border-radius:10px;padding:12px 14px;">
      <div style="font-weight:700;margin-bottom:6px;">검사하는 것</div>
      <div>🔐 <b>비밀번호 기록 보호</b>: 학생 비밀번호 기록과 선생님 비밀번호가 다른 사람이 읽을 수 있는 곳에 있는지</div>
      <div>🔔 <b>오래된 알림</b>: 학생이 이미 읽었고 30일이 지난 알림</div>
      <label style="display:flex;gap:8px;align-items:flex-start;margin-top:6px;cursor:pointer;">
        <input type="checkbox" id="cleanupDeep" style="margin-top:5px;width:auto;flex:0 0 auto;">
        <span>🔗 <b>주인 잃은 기록</b>: 계정 재생성 뒤 끊긴 기록(다시 연결)과 삭제된 학생의 남은 기록(삭제)<br>
        <span style="font-size:12px;color:var(--text-muted);">기록 전체를 한 번 읽어서 읽기 사용량이 백업할 때만큼 한 번 늘어요</span></span>
      </label>
    </div>
    <div style="font-size:12px;color:var(--text-muted);margin-top:10px;">누가기록·게시판·체크표는 대상이 아니에요.</div>`);
  setActions(`<button class="btn btn-secondary" onclick="closeModal('${MODAL_ID}')">닫기</button>
    <button class="btn btn-primary" id="cleanupScanBtn" onclick="runCleanupScan()">🔍 검사하기</button>`);
  openModal(MODAL_ID);
};

window.runCleanupScan = async function() {
  const deep = document.getElementById('cleanupDeep')?.checked;
  const btn = document.getElementById('cleanupScanBtn');
  if (btn) { btn.disabled = true; btn.textContent = '검사 중...'; }
  try {
    const plan = { security: { students: [], teacherPw: false }, notifications: [], relink: [], remove: [] };
    // 🔐 학생 문서에 남은 비밀번호 기록, config 에 남은 선생님 비밀번호
    plan.security.students = state.students.filter((s) => 'pwHint' in s).map((s) => ({ id: s.id, name: s.name, pwHint: s.pwHint }));
    const tc = await getDoc(doc(db, 'config', 'teacher'));
    plan.security.teacherPw = tc.exists() && 'password' in tc.data();
    // 🔔 읽은 알림 중 30일 지난 것 (읽은 알림만 조회: 같다(==) 조건이라 색인 불필요)
    const nSnap = await getDocs(query(collection(db, 'notifications'), where('read', '==', true)));
    plan.notifications = oldReadNotifications(nSnap.docs.map((d) => ({ id: d.id, data: d.data() })));
    // 🔗 주인 잃은 기록
    if (deep) {
      const docsByCol = {};
      for (const [i, col] of ORPHAN_COLLECTIONS.entries()) {
        if (btn) btn.textContent = `검사 중... (${i + 1}/${ORPHAN_COLLECTIONS.length})`;
        const snap = await getDocs(collection(db, col));
        docsByCol[col] = snap.docs.map((d) => ({ id: d.id, data: d.data() }));
      }
      Object.assign(plan, planOrphans(docsByCol, state.students));
    }
    plan.deep = !!deep;
    _plan = plan;
    renderPlan();
  } catch (e) {
    showToast('검사 중 오류: ' + e.message);
    if (btn) { btn.disabled = false; btn.textContent = '🔍 검사하기'; }
  }
};

function fmtCounts(items) {
  const c = countByCol(items);
  return Object.entries(c).map(([k, n]) => `${k} ${n}건`).join(', ');
}

function renderPlan() {
  const p = _plan;
  const secN = p.security.students.length + (p.security.teacherPw ? 1 : 0);
  const row = (key, on, title, desc) => `
    <label style="display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border:1px solid var(--border);border-radius:10px;margin-bottom:8px;${on ? 'cursor:pointer;' : 'opacity:.55;'}">
      <input type="checkbox" class="cleanup-item" data-key="${key}" ${on ? 'checked' : 'disabled'} style="margin-top:5px;width:auto;flex:0 0 auto;">
      <span><b>${title}</b><br><span style="font-size:12.5px;color:var(--text-secondary);">${desc}</span></span>
    </label>`;
  const names = p.security.students.slice(0, 8).map((s) => s.name).join(', ') + (p.security.students.length > 8 ? ` 외 ${p.security.students.length - 8}명` : '');
  const relinkNames = [...new Set(p.relink.map((r) => r.name))].join(', ');
  setBody(`
    ${row('security', secN > 0, `🔐 비밀번호 기록 보호 (${secN}건)`,
      secN ? `학생 ${p.security.students.length}명의 비밀번호 기록을 선생님만 볼 수 있는 보관함으로 옮기고 학생 문서에서는 지워요${names ? ` (${names})` : ''}.${p.security.teacherPw ? ' config 에 저장된 선생님 비밀번호도 지워요 (로그인은 Firebase가 확인해요).' : ''}` : '이미 정리돼 있어요.')}
    ${row('notifications', p.notifications.length > 0, `🔔 오래된 알림 삭제 (${p.notifications.length}건)`,
      p.notifications.length ? '학생이 이미 읽었고 30일이 지난 알림을 지워요.' : '지울 알림이 없어요.')}
    ${p.deep ? row('relink', p.relink.length > 0, `🔗 끊긴 기록 다시 연결 (${p.relink.length}건)`,
      p.relink.length ? `계정 재생성 뒤 따라오지 못한 기록을 같은 이름 학생에게 연결해요 (${relinkNames}). ${fmtCounts(p.relink)}` : '끊긴 기록이 없어요.') : ''}
    ${p.deep ? row('remove', p.remove.length > 0, `🗑️ 삭제된 학생의 남은 기록 삭제 (${p.remove.length}건)`,
      p.remove.length ? `지금 학생 목록에 없는 학생의 기록이에요. ${fmtCounts(p.remove)}` : '남은 기록이 없어요.') : ''}
    <div style="background:#fef9c3;color:#854d0e;border-radius:10px;padding:10px 12px;font-size:13px;margin-top:6px;">
      실행 전에 <b>💾 백업</b>을 받아 두세요. 삭제한 기록은 백업 파일로만 되찾을 수 있어요.
    </div>`);
  setActions(`<button class="btn btn-secondary" onclick="closeModal('${MODAL_ID}')">닫기</button>
    <button class="btn btn-secondary" onclick="downloadFullBackup(this)">💾 백업 받기</button>
    <button class="btn btn-primary" id="cleanupRunBtn" onclick="runCleanup()">🧹 선택한 것 정리</button>`);
}

async function commitInChunks(ops, label, btn) {
  let done = 0;
  for (const part of chunk(ops)) {
    const batch = writeBatch(db);
    for (const op of part) op(batch);
    await batch.commit();
    done += part.length;
    if (btn) btn.textContent = `${label} ${done}/${ops.length}`;
  }
}

window.runCleanup = async function() {
  if (!_plan) return;
  const keys = [...document.querySelectorAll('.cleanup-item:checked')].map((x) => x.dataset.key);
  if (!keys.length) return showToast('정리할 항목을 골라 주세요');
  if (!confirm('선택한 항목을 정리할까요?\n\n백업을 받아 두셨는지 한 번 더 확인해 주세요.')) return;
  const btn = document.getElementById('cleanupRunBtn');
  btn.disabled = true;
  const p = _plan;
  const summary = [];
  try {
    if (keys.includes('security')) {
      const ops = [];
      for (const s of p.security.students) {
        // 보관함에 이미 (더 최근) 기록이 있으면 덮어쓰지 않음
        const existing = await getDoc(doc(db, SECRETS, s.id));
        if (!existing.exists() && s.pwHint) ops.push((b) => b.set(doc(db, SECRETS, s.id), { pwHint: s.pwHint, updatedAt: serverTimestamp() }));
        ops.push((b) => b.update(doc(db, 'students', s.id), { pwHint: deleteField() }));
      }
      if (p.security.teacherPw) ops.push((b) => b.set(doc(db, 'config', 'teacher'), { password: deleteField() }, { merge: true }));
      await commitInChunks(ops, '🔐', btn);
      state._cfgTeacher = null;
      summary.push(`비밀번호 기록 보호 ${p.security.students.length}명${p.security.teacherPw ? ' + 선생님 비밀번호' : ''}`);
    }
    if (keys.includes('notifications')) {
      await commitInChunks(p.notifications.map((id) => (b) => b.delete(doc(db, 'notifications', id))), '🔔', btn);
      summary.push(`알림 ${p.notifications.length}건 삭제`);
    }
    if (keys.includes('relink')) {
      await commitInChunks(p.relink.map((r) => (b) => b.update(doc(db, r.col, r.id), { studentId: r.to })), '🔗', btn);
      window._myGivenCards = null; window._cachedTitleInventory = null;
      summary.push(`끊긴 기록 ${p.relink.length}건 다시 연결`);
    }
    if (keys.includes('remove')) {
      await commitInChunks(p.remove.map((r) => (b) => b.delete(doc(db, r.col, r.id))), '🗑️', btn);
      summary.push(`남은 기록 ${p.remove.length}건 삭제`);
    }
    _plan = null;
    setBody(`<div style="text-align:center;padding:16px 0;"><div style="font-size:40px;">✅</div><div style="font-weight:700;margin-top:8px;">정리 완료</div><div style="margin-top:6px;color:var(--text-secondary);">${summary.join('<br>')}</div></div>`);
    setActions(`<button class="btn btn-primary" onclick="closeModal('${MODAL_ID}')">닫기</button>`);
  } catch (e) {
    showToast('정리 중 오류: ' + e.message + ' (완료된 부분까지는 반영됐어요. 다시 검사해 보세요)');
    btn.disabled = false;
    btn.textContent = '🧹 선택한 것 정리';
  }
};
