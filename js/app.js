// app.js — 시작점: 모든 기능을 불러오고 자동 로그인 처리
import { state } from './state.js?v=20261111a';
import { auth, db, doc, getDoc, onAuthStateChanged, signOut } from './firebase.js?v=20261111a';
import { enterApp } from './enter.js?v=20261111a';
import { applyLoginBg, applySiteLogoImg } from './site-config.js?v=20261111a';
import { hideLoading } from './ui.js?v=20261111a';
import './core.js?v=20261111a';
import './level.js?v=20261111a';
import './auth.js?v=20261111a';
import './emoji-picker.js?v=20261111a';
import './shop.js?v=20261111a';
import './nav.js?v=20261111a';
import './realtime.js?v=20261111a';
import './dashboard.js?v=20261111a';
import './students.js?v=20261111a';
import './admin.js?v=20261111a';
import './cards.js?v=20261111a';
import './exchanges.js?v=20261111a';
import './messages.js?v=20261111a';
import './home.js?v=20261111a';
import './attendance.js?v=20261111a';
import './roles.js?v=20261111a';
import './board.js?v=20261111a';
import './role-auction.js?v=20261111a';
import './dungeon.js?v=20261111a';
import './frames.js?v=20261111a';
import './inventory.js?v=20261111a';
import './dungeon-admin.js?v=20261111a';
import './quiz-dungeon.js?v=20261111a';
import './logs.js?v=20261111a';
import './books.js?v=20261111a';
import './titles.js?v=20261111a';
import './avatar.js?v=20261111a';
import './avatar-shop.js?v=20261111a';
import './notice.js?v=20261111a';
import './student-detail.js?v=20261111a';
import './profile.js?v=20261111a';
import './points.js?v=20261111a';
import './checklist.js?v=20261111a';
import './pets.js?v=20261111a';
import './student-view.js?v=20261111a';
import './crowdfunding.js?v=20261111a';
import './backup.js?v=20261111a';

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
