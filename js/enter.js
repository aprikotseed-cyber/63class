// enter.js — 로그인 후 앱 진입, 대기 중 알림 확인, 로그아웃
import { state } from './state.js?v=20261111a';
import {
  auth, collection, db, deleteDoc, doc, getDocs, onSnapshot, query, signOut, updateDoc, where
} from './firebase.js?v=20261111a';
import { getCfgTeacher, getMyStudentData } from './core.js?v=20261111a';
import { resetAutoLogoutTimer } from './auth.js?v=20261111a';
import { loadSiteSettings } from './site-config.js?v=20261111a';
import {
  listenExchanges, listenMessages, listenRewards, listenStudents, pushNotif
} from './realtime.js?v=20261111a';
import { renderStudentPendingExchanges } from './exchanges.js?v=20261111a';
import { loadAttendPoint } from './attendance.js?v=20261111a';
import { checkMissedRoles } from './roles.js?v=20261111a';
import { escapeHtml } from './board.js?v=20261111a';
import { updateQuizDungeonBadge } from './quiz-dungeon.js?v=20261111a';
import { initStudentAvatar } from './avatar.js?v=20261111a';

// ===== 앱 진입 =====
export async function enterApp() {
  if (window._appEntered) return; // 로그인 직후 studentLogin과 onAuthStateChanged가 둘 다 호출하면 알림이 2번 뜨는 문제 방지
  window._appEntered = true;
  document.getElementById('loginPage').classList.add('hidden');
  document.getElementById('appPage').classList.remove('hidden');
  document.getElementById('navName').textContent = state.currentUser.name;
  resetAutoLogoutTimer(); // 자동 로그아웃 타이머 시작
  const navAvatar = document.getElementById('navAvatar');
  navAvatar.textContent = state.currentUser.name[0];
  navAvatar.style.background = 'var(--primary-light)';
  navAvatar.style.color = 'var(--primary)';
  navAvatar.style.fontSize = '13px';

  await loadSiteSettings();
  await loadAttendPoint(); // 출석 포인트 로드
  if (state.currentUser?.role === 'teacher') {
    // 학생 뷰 버튼 표시
    const svBtn = document.getElementById('studentViewBtn');
    if (svBtn) svBtn.style.display = '';
    checkMissedRoles(); // 미수행 자동 처리
    // 수행 요청 뱃지 실시간 업데이트
    onSnapshot(
      query(collection(db, 'roleLogs'), where('status', '==', 'pending')),
      snap => {
        const roleBadge = document.getElementById('roleBadge');
        if (!roleBadge) return;
        const cnt = snap.docs.length;
        roleBadge.textContent = cnt;
        roleBadge.classList.toggle('hidden', cnt === 0);
      }
    );
  }
  listenMessages();
  // 학생: 새 카드/칭호 실시간 감지
  if (state.currentUser?.role === 'student') {
    let _firstFire = true;
    const cardQ = query(
      collection(db, 'givenCards'),
      where('studentId', '==', state.currentUser.uid)
    );
    onSnapshot(cardQ, async snap => {
      // 첫 fire는 기존 데이터 로드이므로 캐시만 업데이트하고 팝업 안 띄움
      window._myGivenCards = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      if (_firstFire) { _firstFire = false; return; }
      // 이후 추가된 카드만 팝업
      snap.docChanges().forEach(async change => {
        if (change.type !== 'added') return;
        const c = change.doc.data();
        const _tc = await getCfgTeacher();
        const teacherEmoji = _tc.charUrl || _tc.avatarEmoji || '👩‍🏫';
        if ((c.cardType||c.type) === 'praise') {
          pushNotif('💓 칭찬 카드를 받았어요!', teacherEmoji,
            `선생님께서 <strong>'${c.cardTitle}'</strong> 칭찬 카드를 부여해 주셨어요!<br>` +
            `<span style="color:var(--primary);font-weight:700;">+${c.cardPoint}🪙</span>` +
            `${c.memo ? `<br><span style="font-size:12px;color:var(--text-secondary);">메모: ${c.memo}</span>` : ''}`
          );
        } else {
          pushNotif('⚠️ 벌점 카드를 받았어요', teacherEmoji,
            `선생님께서 <strong>'${c.cardTitle}'</strong> 벌점 카드를 부여하셨어요.<br>` +
            `<span style="color:#e11d48;font-weight:700;">-${c.cardPoint}🪙</span>` +
            `${c.memo ? `<br><span style="font-size:12px;color:var(--text-secondary);">메모: ${c.memo}</span>` : ''}`
          );
        }
        window._myHistory = null; // 내역 캐시 무효화
      });
    });
  }

  if (state.currentUser.role === 'teacher') {
    document.getElementById('teacherMenu').classList.remove('hidden');
    document.getElementById('studentMenu').classList.add('hidden');
    document.getElementById('floatingLogBtn').style.display = 'flex';
    document.getElementById('floatingLogBtn').style.alignItems = 'center';
    document.getElementById('floatingLogBtn').style.justifyContent = 'center';
    document.getElementById('floatingCheckBtn').style.display = 'flex';
    document.getElementById('floatingCheckBtn').style.alignItems = 'center';
    document.getElementById('floatingCheckBtn').style.justifyContent = 'center';
    try {
      const _tc3824 = await getCfgTeacher();
      if (_tc3824.avatarEmoji) {
        navAvatar.textContent = _tc3824.avatarEmoji;
        navAvatar.style.background = 'transparent';
        navAvatar.style.color = '';
        navAvatar.style.fontSize = '22px';
      }
    } catch(e) {}
    // 교사 전용 리스너
    listenExchanges();
    listenRewards();
    // students onSnapshot 첫 fire 후 홈으로 이동
    await new Promise(resolve => {
      const unsub = onSnapshot(collection(db, 'students'), snap => {
        state.students = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        unsub(); // 첫 fire 후 이 임시 리스너 해제
        resolve();
      });
    });
    listenStudents(); // 이제 정식 리스너 시작
    navigate('teacherHome');
    setTimeout(() => checkPendingTeacherBoardNotifs(), 800);
  } else {
    document.getElementById('studentMenu').classList.remove('hidden');
    document.getElementById('teacherMenu').classList.add('hidden');
    try {
      const _ms = getMyStudentData();
      const sDoc = { exists: () => Object.keys(_ms).length > 0, data: () => _ms };
      if (sDoc.exists() && sDoc.data().avatarEmoji) {
        navAvatar.textContent = sDoc.data().avatarEmoji;
        navAvatar.style.background = 'transparent';
        navAvatar.style.color = '';
        navAvatar.style.fontSize = '20px';
      }
    } catch(e) {}
    // 아바타 초기화 + students 전체 1회 로드 후 홈 이동
    await initStudentAvatar().catch(e => console.error('아바타 초기화 오류:', e));
    // 랭킹용 전체 students 1회 로드
    if (!state.students.length) {
      const sSnap = await getDocs(collection(db, 'students'));
      state.students = sSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    }
    listenStudents(); // 내 문서만 실시간 구독
    // 새로고침으로 인한 진행중 잠금 해제
    try { await deleteDoc(doc(db, 'config', `quizProgress_${state.currentUser.uid}`)); } catch(e) {}
    // 학생 자신의 교환 신청 실시간 구독
    onSnapshot(
      query(collection(db, 'exchanges'), where('studentId', '==', state.currentUser.uid)),
      snap => {
        // 학생 본인 exchanges만 로컬에 반영
        const myExchanges = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        // 기존 exchanges에서 내 것 제거 후 최신으로 교체
        state.exchanges = [...state.exchanges.filter(e => e.studentId !== state.currentUser.uid), ...myExchanges];
        renderStudentPendingExchanges();
      }
    );
    navigate('studentHome');
    setTimeout(() => checkPendingNotifs(), 800);
    setTimeout(() => updateQuizDungeonBadge(), 1000);
  }
}

// 학생 로그인 시 미확인 알림 체크
async function checkPendingNotifs() {
  try {
    const uid = state.currentUser.uid;
    const name = state.currentUser.name;
    // Firestore에서 마지막 확인 시간 로드 (브라우저 재시작해도 유지)
    let lastCheckTime = 0;
    try {
      const _me = state.students.find(s => s.id === uid);
      if (_me?.lastNotifCheck) lastCheckTime = _me.lastNotifCheck;
    } catch(e) {}

    // 교사 프로필 캐릭터 로드 (charUrl 우선, 없으면 avatarEmoji fallback)
    let teacherEmoji = '👩‍🏫';
    try {
      const _tc = await getCfgTeacher();
      teacherEmoji = _tc.charUrl || _tc.avatarEmoji || '👩‍🏫';
    } catch(e) {}

    // givenCards 캐시 사용
    if (!window._myGivenCards) {
      const _cs = await getDocs(query(collection(db, 'givenCards'), where('studentId', '==', uid)));
      window._myGivenCards = _cs.docs.map(d => ({ id: d.id, ...d.data() }));
    }
    const newCards = window._myGivenCards
      .filter(c => (c.givenAt?.seconds || 0) * 1000 > lastCheckTime)
      .sort((a, b) => (a.givenAt?.seconds || 0) - (b.givenAt?.seconds || 0));

    // history 캐시 사용 (revoke만 필터)
    if (!window._myHistory) {
      const _hs = await getDocs(query(collection(db, 'history'), where('studentId', '==', uid)));
      window._myHistory = _hs.docs.map(d => d.data());
    }
    const newRevokes = window._myHistory
      .filter(h => h.source === 'revoke' && (h.createdAt?.seconds || 0) * 1000 > lastCheckTime)
      .sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0));

    // titleInventory 캐시 사용
    const _myTitles = (window._cachedTitleInventory || []).filter(t => t.studentId === uid);
    const newTitles = _myTitles
      .filter(t => (t.givenAt?.seconds || 0) * 1000 > lastCheckTime)
      .sort((a, b) => (a.givenAt?.seconds || 0) - (b.givenAt?.seconds || 0));

    newTitles.forEach(t => {
      pushNotif(
        '🏅 칭호를 받았어요!',
        teacherEmoji,
        `선생님께서 <strong>'${t.titleEmoji||''} ${t.titleName}'</strong> 칭호를 부여해 주셨어요!<br>` +
        `<span style="font-size:12px;color:var(--text-secondary);">내 보관함에서 확인하고 장착해 보세요 😊</span>`
      );
    });

    // 카드 알림은 givenCards onSnapshot이 실시간으로 처리
    // (checkPendingNotifs는 칭호/회수 등만 담당)

    newRevokes.forEach(h => {
      pushNotif(
        '🔄 카드가 회수됐어요',
        teacherEmoji,
        `선생님께서 카드를 회수하셨어요. 포인트가 조정됐어요.<br>` +
        `<span style="font-weight:700;">${h.delta > 0 ? '+' : ''}${h.delta}🪙</span>`
      );
    });

    // bossCleared 알림 처리
    const bossNotifSnap = await getDocs(query(
      collection(db, 'notifications'),
      where('studentId', '==', uid),
      where('type', '==', 'bossCleared'),
      where('read', '==', false)
    ));
    for (const n of bossNotifSnap.docs) {
      const nd = n.data();
      pushNotif(
        '🎉 단체 던전 클리어!',
        teacherEmoji,
        `축하합니다! 우리 반이 함께 협력해서 <strong>${nd.bossName}</strong>을(를) 물리쳤어요!<br><span style="color:var(--primary);font-weight:700;">보상으로 +${nd.reward}🪙를 획득했어요 🎊</span>`
      );
      await updateDoc(doc(db, 'notifications', n.id), { read: true });
    }

    // 역할 경매 낙찰 알림 처리
    const auctionWonSnap = await getDocs(query(
      collection(db, 'notifications'),
      where('studentId', '==', uid),
      where('type', '==', 'roleAuctionWon'),
      where('read', '==', false)
    ));
    for (const n of auctionWonSnap.docs) {
      await updateDoc(doc(db, 'notifications', n.id), { read: true });
    }
    for (const n of auctionWonSnap.docs) {
      const nd = n.data();
      pushNotif(
        '🔨 역할 경매 낙찰!',
        teacherEmoji,
        `축하해요! <strong>'${escapeHtml(nd.roleEmoji||'📋')} ${escapeHtml(nd.roleName||'')}'</strong> 역할을 낙찰받았어요!<br>` +
        `<span style="color:var(--primary);font-weight:700;">${nd.amount||0}🪙</span>가 사용되었고, 이제 이 역할을 맡아요 😊`
      );
    }

    // 1인1역 수행 승인 알림 처리
    const roleNotifSnap = await getDocs(query(
      collection(db, 'notifications'),
      where('studentId', '==', uid),
      where('type', '==', 'roleApproved'),
      where('read', '==', false)
    ));
    // 먼저 read:true로 모두 처리 (rankUp 쿼리와 중복 방지)
    for (const n of roleNotifSnap.docs) {
      await updateDoc(doc(db, 'notifications', n.id), { read: true });
    }
    // 팝업은 그 다음에
    for (const n of roleNotifSnap.docs) {
      const nd = n.data();
      pushNotif(
        '📋 1인1역 수행 승인!',
        teacherEmoji,
        `선생님께서 <strong>'${nd.roleEmoji||'📋'} ${nd.roleName}'</strong> 역할 수행을 승인해 주셨어요!<br>` +
        `<span style="color:var(--text-secondary);font-size:12px;">주간 수행률에 반영됐어요 😊</span>`
      );
    }

    // 자유게시판: 내 글에 댓글 알림 처리
    const boardCommentNotifSnap = await getDocs(query(
      collection(db, 'notifications'),
      where('studentId', '==', uid),
      where('type', '==', 'boardComment'),
      where('read', '==', false)
    ));
    for (const n of boardCommentNotifSnap.docs) {
      await updateDoc(doc(db, 'notifications', n.id), { read: true });
    }
    window._shownNotifIds = window._shownNotifIds || new Set();
    for (const n of boardCommentNotifSnap.docs) {
      if (window._shownNotifIds.has(n.id)) continue;
      window._shownNotifIds.add(n.id);
      const nd = n.data();
      pushNotif(
        '💬 내 글에 댓글이 달렸어요',
        teacherEmoji,
        `<strong>${escapeHtml(nd.commenterName||'')}</strong>님이 '<strong>${escapeHtml(nd.postTitle||'')}</strong>' 글에 댓글을 남겼어요.` +
        (nd.commentSnippet ? `<br><span style="font-size:12px;color:var(--text-secondary);">"${escapeHtml(nd.commentSnippet)}"</span>` : '')
      );
    }

    // rankUp 알림 처리 (roleApproved read 처리 완료 후 조회)
    const notifSnap = await getDocs(query(
      collection(db, 'notifications'),
      where('studentId', '==', uid),
      where('read', '==', false)
    ));
    const rankUpNotifs = notifSnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(n => n.type === 'rankUp' && (n.createdAt?.seconds||0)*1000 > lastCheckTime)
      .sort((a,b) => (a.createdAt?.seconds||0)-(b.createdAt?.seconds||0));

    for (const n of rankUpNotifs) {
      const details = n.rankUpDetails || [];
      const msg = details.map(d =>
        `나의 <strong>${d.icon} ${d.key}</strong>이(가) <strong style="color:#f59e0b;">${d.rank}등급</strong>으로 상승했어요!`
      ).join('<br>') + `<br><span style="color:var(--primary);font-weight:700;">보상으로 +${n.bonus}🪙가 지급됐어요 🎉</span>`;
      pushNotif('⚡ 능력치 등급 상승!', teacherEmoji, msg);
      await updateDoc(doc(db, 'notifications', n.id), { read: true });
    }

    // 현재 시간을 마지막 확인 시간으로 Firestore에 저장 (브라우저 재시작해도 유지)
    await updateDoc(doc(db, 'students', uid), { lastNotifCheck: Date.now() });
  } catch(e) { console.error('알림 확인 오류:', e); }
}

// 교사 로그인 시 미확인 알림 체크 (자유게시판 댓글 알림 전용 — 교사는 카드/칭호 알림 대상이 아님)
async function checkPendingTeacherBoardNotifs() {
  try {
    const snap = await getDocs(query(
      collection(db, 'notifications'),
      where('studentId', '==', 'teacher'),
      where('type', '==', 'boardComment'),
      where('read', '==', false)
    ));
    for (const n of snap.docs) {
      await updateDoc(doc(db, 'notifications', n.id), { read: true });
    }
    window._shownNotifIds = window._shownNotifIds || new Set();
    for (const n of snap.docs) {
      if (window._shownNotifIds.has(n.id)) continue;
      window._shownNotifIds.add(n.id);
      const nd = n.data();
      pushNotif(
        '💬 내 글에 댓글이 달렸어요',
        '👩‍🏫',
        `<strong>${escapeHtml(nd.commenterName||'')}</strong>님이 '<strong>${escapeHtml(nd.postTitle||'')}</strong>' 글에 댓글을 남겼어요.` +
        (nd.commentSnippet ? `<br><span style="font-size:12px;color:var(--text-secondary);">"${escapeHtml(nd.commentSnippet)}"</span>` : '')
      );
    }
  } catch(e) { console.error('교사 알림 확인 오류:', e); }
}

window.logout = async function() {
  window._appEntered = false;
  window._shownNotifIds = new Set();
  if (state.unsubMessages)  state.unsubMessages();
  if (state.unsubStudents)  state.unsubStudents();
  if (state.unsubExchanges) state.unsubExchanges();
  if (state.unsubRewards)   state.unsubRewards();
  if (typeof unsubPointNotif !== 'undefined' && unsubPointNotif) unsubPointNotif();
  state.unsubMessages = null; state.unsubStudents = null; state.unsubExchanges = null; state.unsubRewards = null;
  await signOut(auth);
  state.currentUser = null;
  state.selectedMessageId = null;
  state.students = []; state.rewards = []; state.exchanges = []; state.messages = [];

  // 모든 페이지 숨기기 (재로그인 시 이전 화면 안 보이게)
  document.querySelectorAll('section[id^="page-"]').forEach(s => s.classList.add('hidden'));

  // 메뉴 초기화
  document.getElementById('teacherMenu').classList.add('hidden');
  document.getElementById('studentMenu').classList.add('hidden');
  document.getElementById('floatingLogBtn').style.display = 'none';
  document.getElementById('floatingCheckBtn').style.display = 'none';

  // 사이드바 active 초기화
  document.querySelectorAll('.sidebar-item').forEach(i => i.classList.remove('active'));

  // messageDetail 초기화
  const detail = document.getElementById('messageDetail');
  if (detail) detail.innerHTML = '<div class="empty-state"><div class="empty-icon">💌</div><h3>쪽지를 선택하세요</h3><p>왼쪽 목록에서 쪽지를 클릭하면<br>내용을 확인할 수 있어요</p></div>';

  document.getElementById('appPage').classList.add('hidden');
  document.getElementById('loginPage').classList.remove('hidden');
  document.getElementById('teacherPw').value = '';
  document.getElementById('teacherName').value = '';
  document.getElementById('studentName').value = '';
  document.getElementById('studentPw').value = '';
};
