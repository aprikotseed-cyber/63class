// messages.js — 쪽지 (교사/학생)
import { state } from './state.js?v=20261111b';
import {
  addDoc, collection, db, deleteDoc, doc, getDocs, orderBy, query, serverTimestamp, updateDoc,
  where
} from './firebase.js?v=20261111b';
import { closeModal, getCfgTeacher, openModal, showToast } from './core.js?v=20261111b';
import { formatTime } from './level.js?v=20261111b';
import { updateMsgBadge } from './realtime.js?v=20261111b';
import { isSingleEmoji } from './titles.js?v=20261111b';

// ===== 쪽지 (교사/학생 완전 분리) =====
export function renderMessages() {
  if (!state.currentUser) return;
  document.getElementById('msgSubtitle').textContent =
    state.currentUser.role === 'teacher' ? '학생들과 주고받은 쪽지' : '선생님과 주고받은 쪽지';
  if (state.currentUser.role === 'teacher') {
    renderTeacherMessages();
  } else {
    renderStudentMessages();
  }
}

// ===== 교사 쪽지함 =====
function renderTeacherMessages() {
  // 교사는 새 쪽지 쓰기 버튼 항상 표시
  const newMsgBtn = document.getElementById('newMsgBtn');
  if (newMsgBtn) newMsgBtn.style.display = '';
  // 목록 렌더
  const byStudent = {};
  state.messages.forEach(m => {
    if (!byStudent[m.studentId] ||
        (m.createdAt?.seconds||0) > (byStudent[m.studentId].createdAt?.seconds||0)) {
      byStudent[m.studentId] = m;
    }
  });
  const threads = Object.values(byStudent)
    .sort((a,b) => (b.createdAt?.seconds||0) - (a.createdAt?.seconds||0));
  const listEl = document.getElementById('messageList');
  listEl.innerHTML = threads.map(m => {
    const unread = state.messages.filter(x =>
      x.studentId === m.studentId && !x.readByTeacher && x.senderRole === 'student').length;
    const active = state.selectedMessageId === m.studentId;
    // 학생 프로필 이모지 가져오기
    const sInfo = state.students.find(s => s.id === m.studentId);
    const sEmoji = sInfo?.avatarEmoji || '';
    return `<div class="message-item ${active?'active':''} ${unread?'unread':''}"
      onclick="teacherSelectThread('${m.studentId}','${m.studentName}')">
      <div class="message-item-top">
        <span class="message-item-name" style="display:flex;align-items:center;gap:6px;">
          ${sEmoji ? `<span style="font-size:14px;">${sEmoji}</span>` : ''}${m.studentName}
        </span>
        ${unread ? `<span class="sidebar-notif">${unread}</span>`
                 : `<span class="message-item-time">${formatTime(m.createdAt)}</span>`}
      </div>
      <div class="message-item-preview">${m.content}</div>
    </div>`;
  }).join('') || '<div class="empty-state" style="padding:30px"><p>아직 쪽지가 없어요</p></div>';

  // 열려있는 스레드 갱신 (msgThread만 교체 — textarea 건드리지 않음)
  if (state.selectedMessageId) {
    const msgThread = document.getElementById('msgThread');
    if (msgThread) {
      teacherRefreshThread(state.selectedMessageId);
    }
  }
}

window.teacherSelectThread = async function(studentId, studentName) {
  state.selectedMessageId = studentId;
  // 읽음 처리
  const unread = state.messages.filter(m =>
    m.studentId === studentId && !m.readByTeacher && m.senderRole === 'student');
  for (const m of unread) await updateDoc(doc(db, 'messages', m.id), { readByTeacher: true });
  // 이 학생과의 전체 대화 내역을 1회 조회해서 캐시
  // (실시간 구독은 읽기 비용 때문에 최근 것만 하고 있어서, 오래된 대화까지 보려면 스레드를 열 때 따로 가져와야 함)
  if (!window._threadCache) window._threadCache = {};
  if (!window._threadCache[studentId]) {
    try {
      const tSnap = await getDocs(query(collection(db, 'messages'), where('studentId', '==', studentId), orderBy('createdAt')));
      window._threadCache[studentId] = tSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch(e) { window._threadCache[studentId] = []; }
  }
  // 대화창 전체 그리기
  teacherDrawThread(studentId, studentName);
  // 목록 재렌더
  renderTeacherMessages();
};

function teacherDrawThread(studentId, studentName) {
  const s = state.students.find(x => x.id === studentId);
  const avatar = s?.avatarEmoji || studentName[0];
  const avatarStyle = s?.avatarEmoji ? 'font-size:20px;background:var(--bg);' : '';
  const detail = document.getElementById('messageDetail');
  detail.innerHTML = `
    <div class="message-detail-header">
      <div class="nav-avatar" style="${avatarStyle}">${avatar}</div>
      <div>
        <div style="font-weight:700">${studentName}</div>
        <div style="font-size:12px;color:var(--text-secondary)">학생</div>
      </div>
    </div>
    <div class="message-thread" id="msgThread"></div>
    <div class="message-compose">
      <textarea id="replyContent" placeholder="${studentName}에게 답장..." rows="2"
        onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();replyMessage('${studentId}','${studentName}');}"></textarea>
      <button class="btn btn-primary"
        onclick="replyMessage('${studentId}','${studentName}')">보내기</button>
    </div>`;
  teacherRefreshThread(studentId);
}

function teacherRefreshThread(studentId) {
  const msgThread = document.getElementById('msgThread');
  if (!msgThread) return;
  // 1회 조회해둔 전체 대화 캐시 + 실시간(최근) 목록을 합쳐서 오래된 대화도 안 잘리게 함
  const cached = window._threadCache?.[studentId] || [];
  const live = state.messages.filter(m => m.studentId === studentId);
  const mergedMap = {};
  cached.forEach(m => { mergedMap[m.id] = m; });
  live.forEach(m => { mergedMap[m.id] = m; }); // 읽음 표시 등 최신 상태는 실시간 목록이 더 정확하므로 덮어씀
  const thread = Object.values(mergedMap)
    .sort((a,b) => {
      const aT = a.createdAt?.seconds || 0;
      const bT = b.createdAt?.seconds || 0;
      if (aT === bT) return 0;
      if (aT === 0) return 1;  // 아직 서버시간 없는 것(방금 보낸 것)은 맨 뒤
      if (bT === 0) return -1;
      return aT - bT;
    });
  const wasBottom = msgThread.scrollHeight - msgThread.scrollTop - msgThread.clientHeight < 80;
  msgThread.innerHTML = thread.map(m => {
    const isMine = m.senderRole === 'teacher';
    const isEmoji = isSingleEmoji(m.content);
    return `<div class="msg-bubble ${isMine?'mine':'theirs'}">
      ${!isMine ? `<div class="msg-sender">${m.studentName}</div>` : ''}
      ${isEmoji
        ? `<div style="font-size:52px;line-height:1.2;text-align:${isMine?'right':'left'};padding:4px 0;">${m.content}</div>`
        : `<div class="msg-content">${m.content.replace(/\n/g, '<br>')}</div>`}
      <div class="msg-time" style="display:flex;align-items:center;gap:6px;justify-content:${isMine?'flex-end':'flex-start'};">
        <span>${formatTime(m.createdAt)}</span>
        ${isMine ? `<span class="read-status ${m.readByStudent?'read':'unread'}">${m.readByStudent?' ✓읽음':' 읽지않음'}</span>
        <button onclick="deleteMessage('${m.id}')" title="쪽지 삭제"
          style="background:none;border:none;cursor:pointer;font-size:12px;color:#94a3b8;padding:0 2px;line-height:1;opacity:0.6;"
          onmouseover="this.style.opacity='1';this.style.color='#ef4444'"
          onmouseout="this.style.opacity='0.6';this.style.color='#94a3b8'">🗑️</button>` : ''}
      </div>
    </div>`;
  }).join('') || '<div class="empty-state" style="padding:40px"><p>아직 대화가 없어요</p></div>';
  if (wasBottom || thread.length <= 1) msgThread.scrollTop = msgThread.scrollHeight;
}

window.deleteMessage = async function(id) {
  if (!confirm('이 쪽지를 삭제할까요?\n학생 화면에서도 사라집니다.')) return;
  try {
    await deleteDoc(doc(db, 'messages', id));
    // 대화 전체 내역 캐시에도 반영 (지운 쪽지가 다시 뜨지 않게)
    if (window._threadCache) {
      Object.keys(window._threadCache).forEach(sid => {
        window._threadCache[sid] = window._threadCache[sid].filter(m => m.id !== id);
      });
    }
    if (state.selectedMessageId) teacherRefreshThread(state.selectedMessageId);
    showToast('쪽지가 삭제됐어요');
  } catch(e) { showToast('오류: ' + e.message); }
};

window.replyMessage = async function(studentId, studentName) {
  const ta = document.getElementById('replyContent');
  if (!ta) return;
  const content = ta.value.trim();
  if (!content) return;
  ta.value = '';
  try {
    await addDoc(collection(db, 'messages'), {
      studentId, studentName,
      senderRole: 'teacher', content,
      readByTeacher: true, readByStudent: false,
      createdAt: serverTimestamp()
    });
  } catch(e) { showToast('오류: ' + e.message); ta.value = content; }
};

// ===== 학생 쪽지함 =====
async function renderStudentMessages() {
  const unreadCnt = state.messages.filter(m => !m.readByStudent && m.senderRole === 'teacher').length;
  const sorted = [...state.messages].sort((a,b) => (b.createdAt?.seconds||0) - (a.createdAt?.seconds||0));
  const lastMsg = sorted[0] || null;
  const listEl = document.getElementById('messageList');
  // 교사 프로필 이모지: Firestore에서 가져오기
  let teacherEmoji = '👩‍🏫';
  try {
    const _tc5701 = await getCfgTeacher();
    if (_tc5701.avatarEmoji) teacherEmoji = _tc5701.avatarEmoji;
  } catch(e) {}

  listEl.innerHTML = `<div class="message-item ${state.selectedMessageId==='teacher'?'active':''} ${unreadCnt?'unread':''}"
    onclick="studentSelectThread()">
    <div class="message-item-top">
      <span class="message-item-name" style="display:flex;align-items:center;gap:6px;">
        <span style="font-size:14px;">${teacherEmoji}</span> 선생님과의 대화
      </span>
      ${unreadCnt ? `<span class="sidebar-notif">${unreadCnt}</span>` : ''}
    </div>
    <div class="message-item-preview">${lastMsg ? lastMsg.content : '쪽지를 보내보세요!'}</div>
  </div>`;

  // 대화 이력이 없을 때만 "새 쪽지 쓰기" 버튼 표시
  const newMsgBtn = document.getElementById('newMsgBtn');
  if (newMsgBtn) {
    newMsgBtn.style.display = state.messages.length === 0 ? '' : 'none';
  }

  // 대화창이 이미 열려있고 msgThread가 존재하면 내용만 갱신 (전체 재렌더 X)
  if (state.selectedMessageId === 'teacher' && document.getElementById('msgThread')) {
    studentRefreshThread();
  }
}

window.studentSelectThread = async function() {
  state.selectedMessageId = 'teacher';
  // 읽음 처리
  const unread = state.messages.filter(m => !m.readByStudent && m.senderRole === 'teacher');
  for (const m of unread) await updateDoc(doc(db, 'messages', m.id), { readByStudent: true });
  // 대화창 전체 그리기
  studentDrawThread();
  updateMsgBadge();
  // 목록 재렌더
  renderStudentMessages();
};

async function studentDrawThread() {
  // 교사 프로필 이모지 실시간 로드
  let tEmoji = '👩‍🏫';
  try {
    const _tc5744 = await getCfgTeacher();
    if (_tc5744.avatarEmoji) tEmoji = _tc5744.avatarEmoji;
  } catch(e) {}
  const detail = document.getElementById('messageDetail');
  detail.innerHTML = `
    <div class="message-detail-header">
      <div class="nav-avatar" style="font-size:20px;background:var(--bg);">${tEmoji}</div>
      <div><div style="font-weight:700">선생님</div></div>
    </div>
    <div class="message-thread" id="msgThread"></div>
    <div class="message-compose">
      <textarea id="replyContent" placeholder="선생님께 쪽지 쓰기..." rows="2"
        onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendStudentMessage();}"></textarea>
      <button class="btn btn-primary" onclick="sendStudentMessage()">보내기</button>
    </div>`;
  studentRefreshThread();
}

function studentRefreshThread() {
  const msgThread = document.getElementById('msgThread');
  if (!msgThread) return;
  const thread = [...state.messages].sort((a,b) => {
    const aT = a.createdAt?.seconds || 0;
    const bT = b.createdAt?.seconds || 0;
    if (aT === bT) return 0;
    if (aT === 0) return 1;
    if (bT === 0) return -1;
    return aT - bT;
  });
  const wasBottom = msgThread.scrollHeight - msgThread.scrollTop - msgThread.clientHeight < 80;
  msgThread.innerHTML = thread.map(m => {
    const isMine = m.senderRole === 'student';
    const isEmoji3 = isSingleEmoji(m.content);
    return `<div class="msg-bubble ${isMine?'mine':'theirs'}">
      ${!isMine ? `<div class="msg-sender">선생님</div>` : ''}
      ${isEmoji3
        ? `<div style="font-size:52px;line-height:1.2;text-align:${isMine?'right':'left'};padding:4px 0;">${m.content}</div>`
        : `<div class="msg-content">${m.content.replace(/\n/g, '<br>')}</div>`}
      <div class="msg-time">${formatTime(m.createdAt)}${isMine
        ? `<span class="read-status ${m.readByTeacher?'read':'unread'}">${m.readByTeacher?' ✓읽음':' 읽지않음'}</span>`
        : ''}</div>
    </div>`;
  }).join('') || '<div class="empty-state" style="padding:40px"><p>선생님께 첫 쪽지를 보내보세요! 💌</p></div>';
  if (wasBottom || thread.length <= 1) msgThread.scrollTop = msgThread.scrollHeight;
}

window.sendStudentMessage = async function() {
  const ta = document.getElementById('replyContent');
  if (!ta) return;
  const content = ta.value.trim();
  if (!content) return;
  ta.value = '';
  try {
    await addDoc(collection(db, 'messages'), {
      studentId: state.currentUser.uid, studentName: state.currentUser.name,
      senderRole: 'student', content,
      readByTeacher: false, readByStudent: true,
      createdAt: serverTimestamp()
    });
  } catch(e) { showToast('오류: ' + e.message); ta.value = content; }
};

// ===== 새 쪽지 모달 =====
window.openNewMessageModal = function() {
  const isTeacher = state.currentUser.role === 'teacher';
  document.getElementById('newMsgSubtitle').textContent =
    isTeacher ? '학생에게 먼저 쪽지를 보내세요' : '선생님께 쪽지를 보내세요';
  const group = document.getElementById('newMsgReceiverGroup');
  const select = document.getElementById('newMsgReceiver');
  if (isTeacher) {
    group.classList.remove('hidden');
    const sorted = [...state.students].sort((a,b) => (a.number||999) - (b.number||999));
    select.innerHTML = sorted.map(s =>
      `<option value="${s.id}" data-name="${s.name}">${s.name}</option>`).join('');
  } else {
    group.classList.add('hidden');
  }
  document.getElementById('newMsgContent').value = '';
  openModal('newMsgModal');
};

window.sendMessage = async function() {
  const content = document.getElementById('newMsgContent').value.trim();
  if (!content) return showToast('내용을 입력하세요');
  try {
    if (state.currentUser.role === 'teacher') {
      const select = document.getElementById('newMsgReceiver');
      const opt = select.options[select.selectedIndex];
      await addDoc(collection(db, 'messages'), {
        studentId: select.value, studentName: opt.dataset.name,
        senderRole: 'teacher', content,
        readByTeacher: true, readByStudent: false,
        createdAt: serverTimestamp()
      });
    } else {
      await addDoc(collection(db, 'messages'), {
        studentId: state.currentUser.uid, studentName: state.currentUser.name,
        senderRole: 'student', content,
        readByTeacher: false, readByStudent: true,
        createdAt: serverTimestamp()
      });
    }
    closeModal('newMsgModal');
    showToast('쪽지를 보냈어요 💌');
  } catch(e) { showToast('오류: ' + e.message); }
};
