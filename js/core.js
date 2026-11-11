// core.js — 전역 상태·상수, 설정 캐시, 공통 유틸(토스트·모달)
import { state } from './state.js?v=20261111c';
import { collection, db, doc, getDoc, getDocs, query, where } from './firebase.js?v=20261111c';

// ===== 전역 상태 =====
// (여러 파일이 함께 쓰는 상태는 state.js 에 있어요)

// ===== 전역 상수 =====
export const RANK_NAMES   = ['D','C','B','A','S','SS','SSS','LEGEND','신화'];
// 능력치 값 → 랭크 인덱스 (0~8). 500 이상은 신화(8), 그 외엔 20단위로 D~LEGEND(0~7)
export function getRankIdx(val) {
  if (val >= 500) return 8;
  return Math.min(7, Math.floor(val / 20));
}
export const GRADE_LABELS = { absolute:'🔱 절대신', special:'✨ 특별', legend:'🌟 전설', epic:'🔥 영웅', rare:'💙 희귀', normal:'⬜ 일반' };
export const GRADE_ORDER  = { normal:0, rare:1, epic:2, legend:3, special:4, absolute:5 };
// ===== Config 캐시 (세션 중 1회만 읽음) =====
let _cfgSite    = null;
// 현재 로그인 학생 데이터 캐시에서 가져오기
export function getMyStudentData() {
  return state.students.find(s => s.id === state.currentUser?.uid) || {};
}
export async function loadTitleInventoryCache(forceReload = false) {
  if (forceReload || !window._cachedTitleInventory) {
    const snap = await getDocs(collection(db, 'titleInventory'));
    window._cachedTitleInventory = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  }
  return window._cachedTitleInventory;
}
export async function loadTitleDeletedCache() {
  if (!window._cachedTitleDeleted) {
    const snap = await getDocs(collection(db, 'titleDeleted'));
    window._cachedTitleDeleted = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  }
  return window._cachedTitleDeleted;
}
export async function getCfgSite()    { if (!_cfgSite)    { const d = await getDoc(doc(db,'config','site'));    _cfgSite    = d.exists()?d.data():{}; } return _cfgSite; }
export async function getCfgTeacher() { if (!state._cfgTeacher) { const d = await getDoc(doc(db,'config','teacher')); state._cfgTeacher = d.exists()?d.data():{}; } return state._cfgTeacher; }

// 내 교환 신청 목록. 학생은 로그인 때부터 실시간으로 받고 있으므로 그것을 그대로 쓰고(읽기 0),
// 아직 안 받았거나(교사의 학생 뷰 등) 다른 사람이면 서버에서 읽어요.
export async function getMyExchanges() {
  const uid = state.currentUser?.uid;
  if (uid && window._myExchangesReadyUid === uid) return state.exchanges.filter(e => e.studentId === uid);
  const snap = await getDocs(query(collection(db, 'exchanges'), where('studentId', '==', uid)));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ===== 유틸 =====
export function showToast(msg, ms = 2500) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(window._toastTimer);
  window._toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}
export function openModal(id) {
  const el = document.getElementById(id);
  el.classList.remove('hidden');
}
window.openModal = openModal;
export function closeModal(id) {
  const el = document.getElementById(id);
  el.style.opacity = '0';
  setTimeout(() => {
    el.style.opacity = '';
    el.classList.add('hidden');
  }, 350);
}
window.closeModal = closeModal;
