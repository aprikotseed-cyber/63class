// closure.js — 홈페이지 임시 폐쇄 (선생님이 문을 열고 닫기)
//
// · 상태는 config/closure 문서 하나에 둬요: { closed, message, updatedAt }
// · 로그인한 사람은 이 문서 하나만 실시간으로 지켜봐요 (읽기 1건 + 바뀔 때마다 1건)
// · 닫혀 있으면 학생 화면 전체를 뿌옇게 가리고 아무것도 누를 수 없게 해요.
//   선생님(학생 뷰로 보고 있을 때 포함)은 가리지 않고, 맨 위에 "학생 화면 닫힘" 표시만 보여요.
import { state } from './state.js?v=20261120a';
import { auth, db, doc, getDoc, onSnapshot, serverTimestamp, setDoc } from './firebase.js?v=20261120a';
import { showToast } from './core.js?v=20261120a';

export const DEFAULT_CLOSED_MESSAGE = '즐거운 학교 생활을 위해 운영하는 홈페이지가 오히려 학습 태도를 망치는 부작용을 발생시키고 있어 임시폐쇄합니다.';
const closureRef = () => doc(db, 'config', 'closure');
const OVERLAY_ID = 'closedOverlay';
let _unsub = null;
let _current = { closed: false, message: '' };
let _gate = false;     // 문이 닫혀 있어 로그인만 하고 앱에는 못 들어온 상태
let _wasClosed = null; // 직전 상태 (닫힘 → 열림 바뀔 때 새로고침하려고)
let _inerted = [];

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isTeacherAccount = () => auth.currentUser?.email === 'teacher@ourclass.kr';

// 로그인 뒤 호출: 문 상태를 실시간으로 지켜봄
export function watchClosure() {
  stopWatchingClosure();
  _unsub = onSnapshot(closureRef(), (snap) => {
    // 서버가 확인한 상태만 믿어요 (몰래 고치려는 쓰기가 잠깐 화면에 먼저 반영되는 경우 무시)
    if (snap.metadata.hasPendingWrites) return;
    _current = snap.exists() ? { closed: !!snap.data().closed, message: snap.data().message || '' } : { closed: false, message: '' };
    // 학생: 닫혀 있다가 열리면 새로고침해서 평소 화면으로 (닫힌 동안 서버가 막아 끊긴 연결도 새로 이어져요)
    if (_wasClosed === true && !_current.closed && !isTeacherAccount() && state.currentUser) {
      location.reload();
      return;
    }
    _wasClosed = _current.closed;
    applyClosure();
  }, (e) => console.warn('홈페이지 문 상태 확인 실패', e));
}

// 지금 문이 닫혀 있는지 (config 는 로그인 전에도 읽을 수 있어요)
export async function isSiteClosed() {
  try {
    const snap = await getDoc(closureRef());
    return snap.exists() && !!snap.data().closed;
  } catch (e) { return false; }
}

// 문이 닫혀 있을 때 학생이 로그인하면: 앱에 들어가지 않고 가림 화면만 보여줘요.
// (닫힌 동안은 서버가 학생의 데이터 읽기를 막아서 앱을 열 수 없어요) 문이 열리면 자동 새로고침.
export function showClosedGate(uid, name) {
  _gate = true;
  state.currentUser = { role: 'student', name: name || '', uid };
  _wasClosed = true;
  watchClosure();
}

// 로그아웃할 때 호출
export function stopWatchingClosure() {
  if (_unsub) { _unsub(); _unsub = null; }
  _current = { closed: false, message: '' };
  _gate = false;
  _wasClosed = null;
  hideClosedOverlay();
  const badge = document.getElementById('closureBadge');
  if (badge) badge.classList.add('hidden');
}

function applyClosure() {
  const teacher = isTeacherAccount();
  const badge = document.getElementById('closureBadge');
  if (badge) badge.classList.toggle('hidden', !(teacher && _current.closed));
  if (_current.closed && !teacher && state.currentUser) showClosedOverlay(_current.message || DEFAULT_CLOSED_MESSAGE);
  else hideClosedOverlay();
  if (teacher) paintClosureSettings();
}

function showClosedOverlay(message) {
  let el = document.getElementById(OVERLAY_ID);
  if (!el) {
    el = document.createElement('div');
    el.id = OVERLAY_ID;
    el.setAttribute('role', 'alertdialog');
    el.setAttribute('aria-modal', 'true');
    document.body.appendChild(el);
  }
  el.innerHTML = `
    <div class="closed-card">
      <div class="closed-icon">🔒</div>
      <div class="closed-title">홈페이지 임시 폐쇄</div>
      <div class="closed-message">${esc(message).replace(/\n/g, '<br>')}</div>
      <button class="btn btn-secondary btn-sm" onclick="logout()">로그아웃</button>
    </div>`;
  // 가려진 화면은 마우스·키보드(Tab)로도 누를 수 없게
  if (!_inerted.length) {
    _inerted = [...document.body.children].filter((c) => c !== el && !c.inert && c.tagName !== 'SCRIPT');
    _inerted.forEach((c) => { c.inert = true; });
  }
  document.querySelectorAll('.modal-overlay:not(.hidden)').forEach((m) => m.classList.add('hidden'));
}

function hideClosedOverlay() {
  document.getElementById(OVERLAY_ID)?.remove();
  _inerted.forEach((c) => { c.inert = false; });
  _inerted = [];
}

// ───────── 선생님: 설정 화면 ─────────
function paintClosureSettings() {
  const status = document.getElementById('closureStatus');
  const btn = document.getElementById('closureToggleBtn');
  const msg = document.getElementById('closureMessage');
  if (!status || !btn) return;
  if (msg && document.activeElement !== msg && !msg.dataset.dirty) msg.value = _current.message || DEFAULT_CLOSED_MESSAGE;
  status.innerHTML = _current.closed
    ? '<span style="color:#dc2626;font-weight:800;">🔒 지금 닫혀 있어요</span> · 학생은 로그인해도 안내 문구만 보여요'
    : '<span style="color:#16a34a;font-weight:800;">🟢 지금 열려 있어요</span> · 학생이 평소처럼 쓸 수 있어요';
  btn.textContent = _current.closed ? '🔓 문 열기' : '🔒 문 닫기';
  btn.className = _current.closed ? 'btn btn-primary' : 'btn btn-danger';
}
export function renderClosureSettings() { paintClosureSettings(); }

async function saveClosure(closed) {
  const msgEl = document.getElementById('closureMessage');
  const message = (msgEl?.value || '').trim() || DEFAULT_CLOSED_MESSAGE;
  await setDoc(closureRef(), { closed, message, updatedAt: serverTimestamp() }, { merge: true });
  if (msgEl) delete msgEl.dataset.dirty;
}

window.toggleSiteClosure = async function() {
  if (!isTeacherAccount()) return showToast('선생님만 바꿀 수 있어요');
  const next = !_current.closed;
  const ask = next
    ? '홈페이지 문을 닫을까요?\n\n지금 접속해 있는 학생 화면도 바로 가려지고, 아무 메뉴도 누를 수 없게 돼요.\n(학생 데이터는 그대로 남아요)'
    : '홈페이지 문을 다시 열까요?\n\n학생들이 평소처럼 쓸 수 있게 돼요.';
  if (!confirm(ask)) return;
  try {
    await saveClosure(next);
    showToast(next ? '🔒 홈페이지 문을 닫았어요' : '🔓 홈페이지 문을 열었어요');
  } catch (e) { showToast('오류: ' + e.message); }
};

window.saveClosureMessage = async function() {
  if (!isTeacherAccount()) return showToast('선생님만 바꿀 수 있어요');
  try {
    await saveClosure(_current.closed);
    showToast('안내 문구를 저장했어요' + (_current.closed ? ' (학생 화면에 바로 반영돼요)' : ''));
  } catch (e) { showToast('오류: ' + e.message); }
};

window.resetClosureMessage = function() {
  const msgEl = document.getElementById('closureMessage');
  if (msgEl) { msgEl.value = DEFAULT_CLOSED_MESSAGE; msgEl.dataset.dirty = '1'; }
};
