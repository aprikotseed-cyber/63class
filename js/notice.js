// notice.js — 공지사항
import { state } from './state.js?v=20261111a';
import { db, doc, getDoc } from './firebase.js?v=20261111a';
import { getCfgTeacher, openModal } from './core.js?v=20261111a';
import { pushNotif } from './realtime.js?v=20261111a';

// ===== 공지사항 =====
export async function loadNotice(isTeacher) {
  // 세션 캐시 (공지 내용은 자주 안 바뀜, 공지 저장 시 캐시 무효화)
  if (!isTeacher && window._noticeLoaded) return;
  if (isTeacher && window._noticeLoadedTeacher) return;
  try {
    const nDoc = await getDoc(doc(db, 'config', 'notice'));
    if (!isTeacher) window._noticeLoaded = true;
    if (isTeacher) window._noticeLoadedTeacher = true;
    if (!nDoc.exists() || !nDoc.data().content) {
      if (isTeacher) {
        document.getElementById('teacherNoticeContent').innerHTML = '<span class="notice-empty">공지사항을 작성해 보세요</span>';
      } else {
        document.getElementById('studentNoticeBox').style.display = 'none';
      }
      return;
    }
    const data = nDoc.data();
    const avatar = data.teacherAvatar || '👩‍🏫';
    const content = data.content;

    // 교사 charUrl 조회 - 캐시 사용
    let charUrl = '';
    try {
      const _tc = await getCfgTeacher();
      charUrl = _tc.charUrl || '';
    } catch(e) {}
    const avatarHtml = charUrl
      ? `<img src="${charUrl}" style="width:80px;height:100px;object-fit:contain;image-rendering:pixelated;" onerror="this.style.display='none';this.parentNode.textContent='👩\u200d🏫'" />`
      : avatar;

    if (isTeacher) {
      const el = document.getElementById('teacherNoticeAvatar');
      if (el) el.innerHTML = avatarHtml;
      document.getElementById('teacherNoticeContent').textContent = content;
    } else {
      const el = document.getElementById('studentNoticeAvatar');
      if (el) el.innerHTML = avatarHtml;
      document.getElementById('studentNoticeContent').textContent = content;
      document.getElementById('studentNoticeBox').style.display = 'flex';

      // 새 공지 팝업 (로그인 후 1회만)
      const lastSeen = localStorage.getItem(`notice_seen_${state.currentUser.uid}`);
      const noticeId = data.updatedAt?.seconds || '';
      if (String(lastSeen) !== String(noticeId)) {
        localStorage.setItem(`notice_seen_${state.currentUser.uid}`, noticeId);
        pushNotif('📢 선생님 공지사항', charUrl || avatar, content);
      }
    }
  } catch(e) { console.error('공지 로드 오류:', e); }
}

window.openNoticeModal = function() {
  const current = document.getElementById('teacherNoticeContent').textContent;
  document.getElementById('noticeInput').value =
    current.includes('공지사항을 작성해 보세요') ? '' : current;
  openModal('noticeModal');
};
