// ui.js — 화면 공통 (탭 페이드, 사이드바, 로딩)
import { db, doc, getDoc, setDoc } from './firebase.js?v=20261111d';

// ===== 탭 패널 페이드 헬퍼 =====
export function fadePanel(el) {
  if (!el) return;
  el.classList.remove('tab-panel-fade');
  void el.offsetWidth; // reflow
  el.classList.add('tab-panel-fade');
}

// ===== 모바일 사이드바 =====
window.toggleSidebar = function() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebarOverlay');
  if (sidebar.classList.contains('mobile-open')) {
    closeSidebar();
  } else {
    sidebar.classList.add('mobile-open');
    overlay.classList.add('active');
    document.body.style.overflow = 'hidden';
    // 모바일 열릴 때 텍스트 opacity 강제 복원
    sidebar.querySelectorAll('.menu-text, .sidebar-label, .sidebar-banner').forEach(el => {
      el.style.opacity = '1';
      el.style.transition = 'none';
    });
  }
};

window.closeSidebar = function() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebarOverlay');
  sidebar.classList.remove('mobile-open');
  overlay.classList.remove('active');
  document.body.style.overflow = '';
};

async function initConfig() {
  const cfgDoc = await getDoc(doc(db, 'config', 'teacher'));
  // 비밀번호는 저장하지 않아요 (Firebase 로그인이 확인). 아이디만 기본값을 둬요.
  if (!cfgDoc.exists()) {
    await setDoc(doc(db, 'config', 'teacher'), { teacherId: 'teacher' });
  } else if (!cfgDoc.data().teacherId) {
    await setDoc(doc(db, 'config', 'teacher'), { teacherId: 'teacher' }, { merge: true });
  }
}
initConfig();

// ===== 로딩 화면 제거 함수 =====
export function hideLoading() {
  const lp = document.getElementById('loadingPage');
  if (!lp) return;
  lp.classList.add('fade-out');
  setTimeout(() => lp.remove(), 350);
}
