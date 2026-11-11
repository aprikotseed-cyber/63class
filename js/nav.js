// nav.js — 페이지 이동(네비게이션)
import { state } from './state.js?v=20261111a';
import { db, deleteDoc, doc, getDoc, serverTimestamp, updateDoc } from './firebase.js?v=20261111a';
import { getCfgTeacher } from './core.js?v=20261111a';
import { renderShopPage } from './shop.js?v=20261111a';
import { renderDashboard } from './dashboard.js?v=20261111a';
import { renderStudentList } from './students.js?v=20261111a';
import { renderCardsPage } from './cards.js?v=20261111a';
import { renderExchanges } from './exchanges.js?v=20261111a';
import { renderMessages } from './messages.js?v=20261111a';
import { renderStudentHome, renderTeacherHome } from './home.js?v=20261111a';
import { renderMyRolesPage, renderRoleManagePage } from './roles.js?v=20261111a';
import { renderBoardPage } from './board.js?v=20261111a';
import { renderDecorShop, renderMyInventory } from './inventory.js?v=20261111a';
import { renderDungeonManage } from './dungeon-admin.js?v=20261111a';
import { renderQuizDungeonSection } from './quiz-dungeon.js?v=20261111a';
import { renderBooksPage } from './books.js?v=20261111a';
import { renderDecorManage, renderTitlesPage } from './titles.js?v=20261111a';
import { renderStudentSettings } from './profile.js?v=20261111a';
import { renderMyPoints } from './points.js?v=20261111a';

// ===== 네비게이션 (사이트 설정 연동) =====
window.navigate = async function(page) {
  if (window.innerWidth <= 768) closeSidebar();

  // 학생 메뉴 이동 시 최종 활동 시간 기록 (5분 debounce)
  if (state.currentUser?.role === 'student') {
    const now = Date.now();
    if (!window._lastActiveUpdate || now - window._lastActiveUpdate > 5 * 60 * 1000) {
      window._lastActiveUpdate = now;
      updateDoc(doc(db, 'students', state.currentUser.uid), { lastActiveAt: serverTimestamp() }).catch(()=>{});
    }
  }

  // 문제 던전 진행 중 다른 메뉴로 이탈 시 자동 참여 기록
  if (page !== 'dungeonSolo' && state.quizBattleState && !state.quizBattleState.done && state.quizBattleState._answered) {
    try {
      const { getDocFromServer: gds } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
      const freshBoss = await gds(doc(db, 'config', 'quizDungeonBoss'));
      if (freshBoss.exists() && freshBoss.data()?.active) {
        const bossNow = freshBoss.data();
        if (!(bossNow.participants||[]).includes(state.currentUser.uid)) {
          await updateDoc(doc(db, 'config', 'quizDungeonBoss'), {
            participants: [...(bossNow.participants||[]), state.currentUser.uid]
          });
          state.quizDungeonBoss = undefined;
        }
      }
    } catch(e) {}
    try { await deleteDoc(doc(db, 'config', `quizProgress_${state.currentUser.uid}`)); } catch(e2) {}
    state.quizBattleState = null;
  }

  // 현재 보이는 섹션 페이드 아웃
  const current = document.querySelector('section[id^="page-"]:not(.hidden)');
  const currentPage = current?.id?.replace('page-', '');
  // 같은 페이지 재클릭 시 재렌더 방지
  if (currentPage === page) return;
  if (current) {
    current.style.transition = 'opacity 0.15s ease';
    current.style.opacity = '0';
    await new Promise(r => setTimeout(r, 150));
  }
  document.querySelectorAll('section[id^="page-"]').forEach(s => {
    s.classList.add('hidden');
    s.style.opacity = '';
    s.style.transition = '';
  });
  const el = document.getElementById('page-' + page);
  if (el) {
    el.classList.remove('hidden');
    el.style.opacity = '0';
    el.style.transition = 'opacity 0.18s ease';
    requestAnimationFrame(() => { el.style.opacity = '1'; });
  }
  document.querySelectorAll('.sidebar-item').forEach(i => {
    i.classList.toggle('active', i.dataset.page === page);
  });

  // ── 페이지별 렌더 (리스너가 데이터를 항상 최신으로 유지하므로 별도 reload 불필요)
  if (page === 'teacherHome') renderTeacherHome();
  else if (page === 'dashboard') renderDashboard();
  else if (page === 'students') renderStudentList();
  else if (page === 'exchanges') renderExchanges();
  else if (page === 'messages') renderMessages();
  else if (page === 'myPoints') renderMyPoints();
  else if (page === 'shop') renderShopPage();
  else if (page === 'cards') renderCardsPage();
  else if (page === 'studentHome') renderStudentHome();
  else if (page === 'studentSettings') renderStudentSettings();
  else if (page === 'decorShop') renderDecorShop();
  else if (page === 'dungeonManage') renderDungeonManage();
  else if (page === 'roleManage') renderRoleManagePage();
  else if (page === 'myRoles') renderMyRolesPage();
  else if (page === 'studentLogs') renderStudentLogsPage();
  else if (page === 'board') renderBoardPage();
  else if (page === 'books') renderBooksPage();
  else if (page === 'dungeonSolo') { renderDungeonLobby(); renderQuizDungeonSection(); }
  else if (page === 'myInventory') renderMyInventory();
  else if (page === 'decorManage') renderDecorManage();
  else if (page === 'titles') renderTitlesPage();
  else if (page === 'settings') {
    const title = document.getElementById('navTitle').textContent;
    const logo  = document.getElementById('navLogo').textContent;
    const inp   = document.getElementById('siteNameInput');
    const lp    = document.getElementById('logoPreview');
    if (inp) inp.value = title;
    if (lp)  lp.textContent = logo;
    try {
      const cfgDoc = await getDoc(doc(db, 'config', 'site'));
      if (cfgDoc.exists() && cfgDoc.data().startDate) {
        const sd = document.getElementById('classStartDate');
        if (sd) sd.value = cfgDoc.data().startDate;
      }
    } catch(e) {}
    // 교사 캐릭터 URL 불러오기
    try {
      const _tc2 = await getCfgTeacher();
      const urlInput = document.getElementById('teacherCharUrl');
      if (urlInput) urlInput.value = _tc2.charUrl || '';
      if (_tc2.charUrl) previewTeacherChar();
    } catch(e) {}
  }
};
