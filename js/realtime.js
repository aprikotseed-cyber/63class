// realtime.js — 교사 데이터 로드, 알림 큐, Firestore 실시간 리스너
import { state } from './state.js?v=20261111d';
import {
  collection, db, doc, getDocs, limit, onSnapshot, orderBy, query, updateDoc, where
} from './firebase.js?v=20261111d';
import { closeModal, openModal, showToast } from './core.js?v=20261111d';
import { renderShopPage } from './shop.js?v=20261111d';
import { renderDashboard } from './dashboard.js?v=20261111d';
import { renderStudentList } from './students.js?v=20261111d';
import { renderExchanges, renderStudentPendingExchanges } from './exchanges.js?v=20261111d';
import { renderMessages } from './messages.js?v=20261111d';
import { renderStudentHome, renderTeacherHome } from './home.js?v=20261111d';
import { renderInventoryDecor } from './frames.js?v=20261111d';
import {
  inventoryRewardCategory, renderDecorShop, renderInventoryAvatar, renderInventoryTitles
} from './inventory.js?v=20261111d';
import { renderStudentSettings } from './profile.js?v=20261111d';
import { renderMyPoints } from './points.js?v=20261111d';
import { renderInventoryPet } from './pets.js?v=20261111d';

// ===== 데이터 로드 =====
// reloadStudents / reloadRewards / reloadExchanges는
// onSnapshot 리스너가 자동 갱신하므로 더 이상 getDocs를 호출하지 않음.
// 기존 호출 코드와의 호환성을 위해 빈 함수로 유지.
export async function reloadStudents() {}
export async function reloadRewards() {
  if (!window._cachedRewards) {
    const snap = await getDocs(collection(db, 'rewards'));
    window._cachedRewards = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  }
  state.rewards = window._cachedRewards;
  window._cachedRewards = null; // 캐시 무효화
}
// ===== 알림 큐 시스템 =====
const notifQueue = [];
let notifShowing = false;

export function pushNotif(title, avatar, contentHtml) {
  notifQueue.push({ title, avatar, contentHtml });
  if (!notifShowing) showNextNotif();
}

function showNextNotif() {
  if (notifQueue.length === 0) { notifShowing = false; return; }
  notifShowing = true;
  const n = notifQueue.shift();
  document.getElementById('noticePopupTitle').textContent = n.title;
  // avatar가 http URL이면 이미지로, 아니면 이모지 텍스트로
  const avatarEl = document.getElementById('noticePopupAvatar');
  if (n.avatar && (n.avatar.startsWith('http') || n.avatar.startsWith('data:'))) {
    avatarEl.innerHTML = `<img src="${n.avatar}" style="width:80px;height:100px;object-fit:contain;image-rendering:pixelated;" onerror="this.parentNode.textContent='👩‍🏫'" />`;
  } else {
    avatarEl.textContent = n.avatar || '👩‍🏫';
  }
  document.getElementById('noticePopupContent').innerHTML = n.contentHtml;
  openModal('noticePopupModal');
}

window.confirmNoticePopup = function() {
  closeModal('noticePopupModal');
  notifShowing = false;
  // 다음 알림이 있으면 약간의 딜레이 후 표시
  if (notifQueue.length > 0) setTimeout(() => showNextNotif(), 400);
};

const TEACHER_MESSAGES_LISTEN_LIMIT = 400; // 읽기 비용 상한: 반 전체 쪽지를 매번 처음부터 전부 읽지 않도록 최근 N건만 실시간 구독
                                            // (오래된 개별 대화 전체 내역은 teacherSelectThread에서 그때그때 1회 조회)
export function listenMessages() {
  if (state.unsubMessages) state.unsubMessages();

  const myRole = state.currentUser.role;
  const myUid = state.currentUser.uid;

  const q = myRole === 'teacher'
    ? query(collection(db, 'messages'), orderBy('createdAt', 'desc'), limit(TEACHER_MESSAGES_LISTEN_LIMIT))
    : query(collection(db, 'messages'), where('studentId', '==', myUid), orderBy('createdAt', 'desc'));

  state.unsubMessages = onSnapshot(q, async snap => {
    state.messages = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    updateMsgBadge();
    const msgPage = document.getElementById('page-messages');
    if (msgPage && !msgPage.classList.contains('hidden')) {
      // 교사: 현재 열려있는 스레드의 새 메시지 자동 읽음 처리
      if (myRole === 'teacher' && state.selectedMessageId) {
        const unread = state.messages.filter(m =>
          m.studentId === state.selectedMessageId && !m.readByTeacher && m.senderRole === 'student');
        for (const m of unread) {
          updateDoc(doc(db, 'messages', m.id), { readByTeacher: true });
        }
      }
      // 학생: 채팅창 열려있으면 새 교사 메시지 자동 읽음 처리
      if (myRole === 'student' && state.selectedMessageId === 'teacher') {
        const unread = state.messages.filter(m => !m.readByStudent && m.senderRole === 'teacher');
        for (const m of unread) {
          updateDoc(doc(db, 'messages', m.id), { readByStudent: true });
        }
      }
      renderMessages();
    }
  }, err => {
    console.error('쪽지 리스너 오류:', err.code);
  });
}

// ===== 실시간 리스너: students =====
export function listenStudents() {
  if (state.unsubStudents) state.unsubStudents();

  if (state.currentUser?.role === 'student') {
    // 학생: 자기 문서만 구독 (읽기 1건, 변경 시 1건)
    state.unsubStudents = onSnapshot(doc(db, 'students', state.currentUser.uid), docSnap => {
      if (!docSnap.exists()) return;
      const me = { id: docSnap.id, ...docSnap.data() };
      // students 배열에서 내 정보만 업데이트
      const idx = state.students.findIndex(s => s.id === state.currentUser.uid);
      if (idx >= 0) state.students[idx] = me;
      else state.students.push(me);
      // avatarEquipped 동기화
      state.avatarEquipped     = me.avatarEquipped     || {};
      state.avatarEquippedMeta = me.avatarEquippedMeta || {};
      state.avatarPreviewEquip = { ...state.avatarEquipped };
      // 현재 페이지 갱신
      const active = document.querySelector('section[id^="page-"]:not(.hidden)');
      if (!active) return;
      const page = active.id.replace('page-', '');
      if (page === 'studentHome') {
        clearTimeout(window._studentHomeThrottle);
        window._studentHomeThrottle = setTimeout(() => renderStudentHome(), 1000);
      } else if (page === 'myPoints') {
        clearTimeout(window._myPointsThrottle);
        window._myPointsThrottle = setTimeout(() => renderMyPoints(), 1000);
      } else if (page === 'studentSettings') renderStudentSettings();
      else if (page === 'shop') {
        // 보상 상점 골드 실시간 업데이트
        const el = document.getElementById('shopGoldAmount');
        if (el) el.textContent = (me.points || 0).toLocaleString();
      } else if (page === 'dungeonSolo') {
        const battleEl = document.getElementById('dungeonBattle');
        if (!battleEl || battleEl.style.display === 'none') renderDungeonLobby();
      }
    }, err => console.error('students 리스너 오류:', err.code));
  } else {
    // 교사: 전체 구독 (랭킹/홈 표시용)
    state.unsubStudents = onSnapshot(collection(db, 'students'), snap => {
      state.students = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      // 교사 홈만 재렌더 (다른 페이지는 navigate 시 렌더)
      const active = document.querySelector('section[id^="page-"]:not(.hidden)');
      if (!active) return;
      const page = active.id.replace('page-', '');
      if (page === 'teacherHome') {
        clearTimeout(window._teacherHomeThrottle);
        window._teacherHomeThrottle = setTimeout(() => renderTeacherHome(), 1000);
      } else if (page === 'students') renderStudentList();
    }, err => console.error('students 리스너 오류:', err.code));
  }
}

// ===== 실시간 리스너: exchanges (교사 전용) =====
const EXCHANGES_LISTEN_LIMIT = 300; // 읽기 비용 상한: 오래된 처리 내역까지 매번 실시간으로 전부 읽지 않도록 최근 N건만 구독
export function listenExchanges() {
  if (state.unsubExchanges) state.unsubExchanges();
  let _prevExchanges = null;
  state.unsubExchanges = onSnapshot(
    query(collection(db, 'exchanges'), orderBy('createdAt', 'desc'), limit(EXCHANGES_LISTEN_LIMIT)),
    async snap => {
      const newExchanges = snap.docs.map(d => ({ id: d.id, ...d.data() }));

      // 승인/거절 변경 감지 (학생 본인 건만)
      if (_prevExchanges && state.currentUser?.role === 'student') {
        for (const change of snap.docChanges()) {
          if (change.type !== 'modified') continue;
          const d = change.doc.data();
          if (d.studentId !== state.currentUser.uid) return;
          const prev = _prevExchanges.find(e => e.id === change.doc.id);
          if (prev?.status === 'pending' && d.status === 'approved') {
            // 승인됨 → 인벤토리 캐시 전체 무효화
            window._frameInvCache = null;
            window._avatarInvCache = null;
            window._myExchanges = null;
            window._cachedRewards = null; // 재고 캐시도 무효화
            state.petInventory = new Set(); state.petList = []; // 펫 캐시 무효화
            showToast(`✅ '${d.rewardName}' 교환이 승인됐어요! 보관함을 확인하세요 🎉`);
            // 상점 재고 즉시 갱신
            const shopPage = document.getElementById('page-shop');
            if (shopPage && !shopPage.classList.contains('hidden')) {
              await reloadRewards();
              renderShopPage();
            }
            // 꾸미기 상점 갱신
            const decorPage = document.getElementById('page-decorShop');
            if (decorPage && !decorPage.classList.contains('hidden')) {
              renderDecorShop();
            }
            // 보관함 갱신 (열려있으면 즉시, 아니어도 캐시는 무효화됨)
            const invPage = document.getElementById('page-myInventory');
            if (invPage && !invPage.classList.contains('hidden')) {
              const activeTabBtn = invPage.querySelector('.decor-top-tab.active');
              const activeTab = activeTabBtn?.getAttribute('onclick')?.match(/switchInventoryTab\('(\w+)'/)?.[1];
              if (activeTab === 'reward') filterInventoryReward(inventoryRewardCategory);
              else if (activeTab === 'title') renderInventoryTitles();
              else if (activeTab === 'decor') renderInventoryDecor();
              else if (activeTab === 'avatar') renderInventoryAvatar();
              else if (activeTab === 'pet') renderInventoryPet();
              else filterInventoryReward(inventoryRewardCategory);
            }
          }
        }
      }

      state.exchanges = newExchanges;
      _prevExchanges = newExchanges.map(e => ({...e}));

      // 교환 대기 뱃지 업데이트
      const pendingCount = state.exchanges.filter(e => e.status === 'pending').length;
      const badge = document.getElementById('exchangeBadge');
      if (badge) {
        badge.textContent = pendingCount;
        if (pendingCount > 0) badge.classList.remove('hidden');
        else badge.classList.add('hidden');
      }
      // 교환 신청 페이지가 열려있으면 자동 갱신
      const exPage = document.getElementById('page-exchanges');
      if (exPage && !exPage.classList.contains('hidden')) renderExchanges();
      // 대시보드가 열려있으면 자동 갱신
      const dashPage = document.getElementById('page-dashboard');
      if (dashPage && !dashPage.classList.contains('hidden')) renderDashboard();
      // 학생 홈화면 교환 신청 내역 갱신
      if (state.currentUser?.role === 'student') renderStudentPendingExchanges();
    }, err => console.error('exchanges 리스너 오류:', err.code));
}

// ===== 실시간 리스너: rewards (교사 전용) =====
export async function listenRewards() {
  // rewards는 자주 안 바뀌므로 실시간 리스너 대신 세션당 1회 로드
  if (!state.rewards.length) await reloadRewards();
}

export function updateMsgBadge() {
  const unread = state.messages.filter(m => {
    if (state.currentUser.role === 'teacher') return !m.readByTeacher && m.senderRole === 'student';
    return !m.readByStudent && m.senderRole === 'teacher';
  }).length;
  const badge1 = document.getElementById('teacherMsgBadge');
  const badge2 = document.getElementById('studentMsgBadge');
  const notifBadge = document.getElementById('notifBadge');
  const b = state.currentUser.role === 'teacher' ? badge1 : badge2;
  if (b) {
    if (unread > 0) { b.textContent = unread; b.classList.remove('hidden'); }
    else b.classList.add('hidden');
  }
  if (notifBadge) {
    if (unread > 0) notifBadge.classList.remove('hidden');
    else notifBadge.classList.add('hidden');
  }
}
