// app.js — 시작점: 모든 기능을 불러오고 자동 로그인 처리
import { state } from './state.js?v=20261111c';
import { auth, db, doc, getDoc, onAuthStateChanged, signOut } from './firebase.js?v=20261111c';
import { enterApp } from './enter.js?v=20261111c';
import { applyLoginBg, applySiteLogoImg } from './site-config.js?v=20261111c';
import { hideLoading } from './ui.js?v=20261111c';
import './core.js?v=20261111c';
import './level.js?v=20261111c';
import './auth.js?v=20261111c';
import './emoji-picker.js?v=20261111c';
import './shop.js?v=20261111c';
import './nav.js?v=20261111c';
import './realtime.js?v=20261111c';
import './dashboard.js?v=20261111c';
import './students.js?v=20261111c';
import './admin.js?v=20261111c';
import './cards.js?v=20261111c';
import './exchanges.js?v=20261111c';
import './messages.js?v=20261111c';
import './home.js?v=20261111c';
import './attendance.js?v=20261111c';
import './roles.js?v=20261111c';
import './board.js?v=20261111c';
import './role-auction.js?v=20261111c';
import './dungeon.js?v=20261111c';
import './frames.js?v=20261111c';
import './inventory.js?v=20261111c';
import './dungeon-admin.js?v=20261111c';
import './quiz-dungeon.js?v=20261111c';
import './logs.js?v=20261111c';
import './books.js?v=20261111c';
import './titles.js?v=20261111c';
import './avatar.js?v=20261111c';
import './avatar-shop.js?v=20261111c';
import './notice.js?v=20261111c';
import './student-detail.js?v=20261111c';
import './profile.js?v=20261111c';
import './points.js?v=20261111c';
import './checklist.js?v=20261111c';
import './pets.js?v=20261111c';
import './student-view.js?v=20261111c';
import './crowdfunding.js?v=20261111c';
import './backup.js?v=20261111c';
import './cleanup.js?v=20261111c';

// 페이지 로드 시 로그인 화면에도 사이트 설정 반영
(async function initLoginScreen() {
  try {
    const cfgDoc = await getDoc(doc(db, 'config', 'site'));
    const lt = document.getElementById('loginTitle');
    const ll = document.getElementById('loginLogo');
    if (cfgDoc.exists()) {
      const d = cfgDoc.data();
      if (d.title && lt) { lt.textContent = d.title; document.title = d.title; }
      // 로고 이미지 우선, 없으면 이모지
      if (d.logoImg || d.logo) applySiteLogoImg(d.logoImg||'', d.logo||'🏫');
      if (d.loginBg || d.loginBgTeacher) applyLoginBg(d.loginBg||'', d.loginBgTeacher||'');
    }
    if (lt) lt.style.visibility = 'visible';
    if (ll) ll.style.visibility = 'visible';
  } catch(e) {
    const lt = document.getElementById('loginTitle');
    const ll = document.getElementById('loginLogo');
    if (lt) lt.style.visibility = 'visible';
    if (ll) ll.style.visibility = 'visible';
  }
})();

// ===== 자동 로그인 (새로고침 시 유지) =====
onAuthStateChanged(auth, async (user) => {
  // 이미 앱이 표시 중이면 무시
  if (!document.getElementById('appPage').classList.contains('hidden')) {
    hideLoading();
    return;
  }
  if (!user) {
    // 로그인 안 된 상태 → 로그인 화면 표시
    hideLoading();
    document.getElementById('loginPage').classList.remove('hidden');
    return;
  }

  // Firebase Auth 로그인된 경우 자동 복원
  if (user.email === 'teacher@ourclass.kr') {
    state.currentUser = { role: 'teacher', name: '선생님', uid: 'teacher' };
    await enterApp();
    hideLoading();
  } else {
    try {
      const sDoc = await getDoc(doc(db, 'students', user.uid));
      if (sDoc.exists()) {
        state.currentUser = { role: 'student', name: sDoc.data().name, uid: user.uid };
        await enterApp();
        hideLoading();
      } else {
        await signOut(auth);
        hideLoading();
        document.getElementById('loginPage').classList.remove('hidden');
      }
    } catch(e) {
      await signOut(auth);
      hideLoading();
      document.getElementById('loginPage').classList.remove('hidden');
    }
  }
});
