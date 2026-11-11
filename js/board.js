// board.js — 자유게시판
import { state } from './state.js?v=20261111a';
import {
  addDoc, arrayUnion, collection, db, deleteDoc, doc, getDoc, getDocFromServer, getDocs, increment,
  limit, orderBy, query, serverTimestamp, setDoc, updateDoc, where
} from './firebase.js?v=20261111a';
import { closeModal, getCfgTeacher, getMyStudentData, openModal, showToast } from './core.js?v=20261111a';
import { formatTime } from './level.js?v=20261111a';

// ===== 자유게시판 (실명, 글쓰기+댓글) =====
const BOARD_PAGE_SIZE = 10;   // 한 페이지에 보여줄 글 수
const BOARD_MAX_FETCH = 500;  // 안전 상한 (학급 게시판 규모에선 충분)
const BOARD_COOLDOWN_MS = 60000; // 글/댓글 작성 후 재작성 대기 시간(도배 방지)
let _boardAllPosts = [];
let _boardCurrentPage = 1;
let _boardEditingPostId = null; // null이면 새 글, 값 있으면 수정 중
let _boardCurrentPostId = null; // 상세 모달에 열려있는 글
let _cfgBoard = null;

export function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  }[c]));
}

async function getCfgBoard() {
  if (!_cfgBoard) {
    const d = await getDoc(doc(db, 'config', 'board'));
    _cfgBoard = d.exists() ? d.data() : { active: true, bannedWords: [] };
  }
  return _cfgBoard;
}

function containsBannedWord(text, bannedWords) {
  if (!bannedWords || !bannedWords.length) return false;
  const lower = String(text || '').toLowerCase();
  return bannedWords.some(w => w && lower.includes(String(w).toLowerCase()));
}

// 도배 방지: 학생만 60초 쿨다운 적용 (교사는 제외)
async function checkBoardCooldown() {
  if (state.currentUser.role === 'teacher') return { ok: true };
  try {
    const snap = await getDocFromServer(doc(db, 'students', state.currentUser.uid));
    const last = snap.exists() ? snap.data().lastBoardActionAt : null;
    const lastMs = last?.seconds ? last.seconds * 1000 : 0;
    const elapsed = Date.now() - lastMs;
    if (lastMs && elapsed < BOARD_COOLDOWN_MS) {
      return { ok: false, remain: Math.ceil((BOARD_COOLDOWN_MS - elapsed) / 1000) };
    }
    return { ok: true };
  } catch(e) {
    return { ok: true }; // 확인 실패 시 과도한 차단 방지
  }
}
async function markBoardAction() {
  if (state.currentUser.role === 'teacher') return;
  try { await updateDoc(doc(db, 'students', state.currentUser.uid), { lastBoardActionAt: serverTimestamp() }); } catch(e) {}
}

// ─── 게시판 "목록 열람" 시각 (배지의 '새 글' 조건용, 조회수용 readBy와는 별개) ───
async function getMyBoardListSeenAt() {
  if (state.currentUser.role === 'teacher') {
    const tc = await getCfgTeacher();
    return tc.lastBoardListSeenAt || 0;
  }
  return getMyStudentData().lastBoardListSeenAt || 0;
}
async function markBoardListSeen() {
  const now = Date.now();
  try {
    if (state.currentUser.role === 'teacher') {
      await setDoc(doc(db, 'config', 'teacher'), { lastBoardListSeenAt: now }, { merge: true });
      if (state._cfgTeacher) state._cfgTeacher.lastBoardListSeenAt = now;
    } else {
      await updateDoc(doc(db, 'students', state.currentUser.uid), { lastBoardListSeenAt: now });
      const me = getMyStudentData();
      if (me) me.lastBoardListSeenAt = now;
    }
  } catch(e) { /* 무시: 배지는 부가 기능 */ }
}

// ─── 게시판 활성화/비활성화 + 필터링 단어 (교사 관리) ───
window.openBoardManageModal = async function() {
  const cfg = await getCfgBoard();
  document.getElementById('boardBannedWordsInput').value = (cfg.bannedWords || []).join('\n');
  refreshBoardManageBtnState(cfg);
  openModal('boardManageModal');
};

function refreshBoardManageBtnState(cfg) {
  const isActive = cfg.active !== false;
  const btn = document.getElementById('boardActiveToggleBtn');
  if (btn) {
    btn.textContent = isActive ? '⏸️ 비활성화' : '▶️ 활성화';
    btn.style.background = isActive ? '' : '#fef9c3';
    btn.style.color = isActive ? '' : '#a16207';
    btn.style.borderColor = isActive ? '' : '#fcd34d';
  }
}

window.toggleBoardActive = async function() {
  const cfg = await getCfgBoard();
  const newActive = !(cfg.active !== false);
  await setDoc(doc(db, 'config', 'board'), { active: newActive }, { merge: true });
  _cfgBoard = null;
  const fresh = await getCfgBoard();
  refreshBoardManageBtnState(fresh);
  showToast(newActive ? '게시판이 활성화됐어요 ▶️' : '게시판이 비활성화됐어요 ⏸️');
  await updateBoardWriteAvailability();
};

window.saveBoardBannedWords = async function() {
  const raw = document.getElementById('boardBannedWordsInput').value;
  const words = raw.split('\n').map(w => w.trim()).filter(Boolean);
  try {
    await setDoc(doc(db, 'config', 'board'), { bannedWords: words }, { merge: true });
    _cfgBoard = null;
    await getCfgBoard();
    showToast('필터링 단어가 저장됐어요 ✅');
    closeModal('boardManageModal');
  } catch(e) { showToast('오류: ' + e.message); }
};

async function updateBoardWriteAvailability() {
  const cfg = await getCfgBoard();
  const isActive = cfg.active !== false;
  const isTeacher = state.currentUser.role === 'teacher';
  const writeBtn = document.getElementById('boardWriteBtn');
  const manageBtn = document.getElementById('boardManageBtn');
  const lockedNotice = document.getElementById('boardLockedNotice');
  if (manageBtn) manageBtn.classList.toggle('hidden', !isTeacher);
  if (writeBtn) writeBtn.classList.toggle('hidden', !isActive && !isTeacher);
  if (lockedNotice) lockedNotice.classList.toggle('hidden', isActive);
}

// ─── 안 읽은 글 배지(빨간 점) ───
// 조건 A: 게시판 목록조차 한 번도 열람하지 않은 "완전히 새로운 글"이 있을 때 (목록만 들어가도 해제)
// 조건 B: 내가 쓴 글에 내가 아직 확인하지 않은 댓글이 달렸을 때 (그 글을 열어봐야 해제)
export async function updateBoardBadge(preFetchedPosts) {
  if (!state.currentUser) return;
  const badgeId = state.currentUser.role === 'teacher' ? 'teacherBoardBadge' : 'studentBoardBadge';
  const badge = document.getElementById(badgeId);
  if (!badge) return;
  try {
    let posts = preFetchedPosts;
    if (!posts) {
      const snap = await getDocs(query(collection(db, 'boardPosts'), orderBy('createdAt', 'desc'), limit(BOARD_MAX_FETCH)));
      posts = snap.docs.map(d => d.data());
    }
    const lastListSeen = await getMyBoardListSeenAt();
    const hasNewPost = posts.some(p => {
      const createdMs = p.createdAt?.seconds ? p.createdAt.seconds * 1000 : 0;
      return createdMs > lastListSeen;
    });
    const hasUnseenComment = posts.some(p =>
      p.authorId === state.currentUser.uid && (p.commentCount || 0) > (p.authorSeenCommentCount || 0)
    );
    badge.style.display = (hasNewPost || hasUnseenComment) ? 'block' : 'none';
  } catch(e) { /* 무시: 배지는 부가 기능 */ }
}

// ─── 목록 (10개씩 페이지네이션) ───
export async function renderBoardPage() {
  const listEl = document.getElementById('boardListEl');
  if (listEl) listEl.innerHTML = '<div style="text-align:center;padding:24px;color:var(--text-muted);">불러오는 중...</div>';
  await updateBoardWriteAvailability();
  try {
    const snap = await getDocs(query(collection(db, 'boardPosts'), orderBy('createdAt', 'desc'), limit(BOARD_MAX_FETCH)));
    const rawPosts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    // 글 번호는 고정(공지) 여부와 무관하게 작성 순서 기준으로 매김 (오래된 글이 1번)
    const total = rawPosts.length;
    rawPosts.forEach((p, idx) => { p._postNo = total - idx; });
    // 공지(고정) 글을 맨 위로: 정렬은 안정적이라 그룹별 최신순은 그대로 유지됨
    _boardAllPosts = rawPosts.slice().sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
  } catch(e) {
    if (listEl) listEl.innerHTML = `<div style="color:#ef4444;padding:16px;">오류: ${e.message}</div>`;
    return;
  }
  renderBoardListPage(1);
  await markBoardListSeen(); // 목록을 열람했으므로 '새 글' 조건은 해제
  updateBoardBadge(_boardAllPosts);
}

// 게시판 목록 전용 날짜 표기: 오늘 쓴 글은 'HH:MM', 자정이 지난 글은 'MM-DD'
function formatBoardDate(ts) {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  const now = new Date();
  const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  if (sameDay) {
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  }
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${mo}-${da}`;
}

function renderBoardListPage(page) {
  const listEl = document.getElementById('boardListEl');
  const total = _boardAllPosts.length;
  if (!total) {
    if (listEl) listEl.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted);">아직 글이 없어요. 첫 글을 남겨보세요! ✍️</div>';
    renderBoardPagination(1, 1);
    return;
  }
  const totalPages = Math.max(1, Math.ceil(total / BOARD_PAGE_SIZE));
  page = Math.min(Math.max(1, page), totalPages);
  _boardCurrentPage = page;
  const startIdx = (page - 1) * BOARD_PAGE_SIZE;
  const pagePosts = _boardAllPosts.slice(startIdx, startIdx + BOARD_PAGE_SIZE);

  if (listEl) {
    const rows = pagePosts.map((p, i) => {
      const postNo = p._postNo;
      const roleTag = p.authorRole === 'teacher'
        ? `<span style="font-size:9px;font-weight:700;color:#fff;background:var(--primary);padding:1px 5px;border-radius:4px;margin-left:3px;">쌤</span>`
        : '';
      const editedTag = p.updatedAt ? `<span style="font-size:11px;color:var(--text-muted);margin-left:4px;">(수정됨)</span>` : '';
      const pinnedTag = p.pinned
        ? `<span style="font-size:10px;font-weight:700;color:#fff;background:#f59e0b;padding:1px 6px;border-radius:4px;margin-right:5px;">📌 공지</span>`
        : '';
      const viewCount = (p.readBy || []).length;
      return `<tr onclick="openBoardDetailModal('${p.id}')" style="cursor:pointer;border-bottom:1px solid var(--border);${p.pinned ? 'background:rgba(245,158,11,0.08);' : ''}">
        <td style="padding:10px 6px;text-align:center;color:var(--text-muted);font-size:12px;">${postNo}</td>
        <td style="padding:10px 6px;text-align:left;overflow:hidden;">
          <span style="font-size:14px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${pinnedTag}${escapeHtml(p.title)}</span>
          <span style="font-size:12px;color:var(--primary);font-weight:700;">[${p.commentCount||0}]</span>
          ${editedTag}
        </td>
        <td style="padding:10px 6px;text-align:center;color:var(--text-muted);font-size:12px;white-space:nowrap;">${formatBoardDate(p.createdAt)}</td>
        <td style="padding:10px 6px;text-align:center;color:var(--text-muted);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(p.authorName)}${roleTag}</td>
        <td style="padding:10px 6px;text-align:center;color:var(--text-muted);font-size:12px;">${viewCount}</td>
      </tr>`;
    }).join('');

    listEl.innerHTML = `<div style="overflow-x:auto;">
      <table style="width:100%;border-collapse:collapse;table-layout:fixed;min-width:480px;">
        <colgroup>
          <col style="width:10%;"><col style="width:48%;"><col style="width:16%;"><col style="width:16%;"><col style="width:10%;">
        </colgroup>
        <thead>
          <tr style="background:var(--bg);">
            <th style="padding:8px 6px;text-align:center;border-bottom:2px solid var(--border);font-size:12px;color:var(--text-secondary);">번호</th>
            <th style="padding:8px 6px;text-align:left;border-bottom:2px solid var(--border);font-size:12px;color:var(--text-secondary);">제목</th>
            <th style="padding:8px 6px;text-align:center;border-bottom:2px solid var(--border);font-size:12px;color:var(--text-secondary);">날짜</th>
            <th style="padding:8px 6px;text-align:center;border-bottom:2px solid var(--border);font-size:12px;color:var(--text-secondary);">글쓴이</th>
            <th style="padding:8px 6px;text-align:center;border-bottom:2px solid var(--border);font-size:12px;color:var(--text-secondary);">조회</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  }
  renderBoardPagination(page, totalPages);
}

function renderBoardPagination(page, totalPages) {
  const pagEl = document.getElementById('boardPaginationEl');
  if (!pagEl) return;
  if (totalPages <= 1) { pagEl.innerHTML = ''; return; }
  const groupSize = 5;
  const groupStart = Math.floor((page - 1) / groupSize) * groupSize + 1;
  const groupEnd = Math.min(groupStart + groupSize - 1, totalPages);
  let html = '';
  if (groupStart > 1) {
    html += `<button onclick="goToBoardPage(${groupStart - 1})" style="font-size:12px;padding:6px 10px;border-radius:6px;border:1px solid var(--border);background:transparent;cursor:pointer;font-family:inherit;">이전 페이지</button>`;
  }
  for (let p = groupStart; p <= groupEnd; p++) {
    const isActive = p === page;
    html += `<button onclick="goToBoardPage(${p})" style="font-size:12px;padding:6px 12px;border-radius:6px;border:1px solid ${isActive ? 'var(--primary)' : 'var(--border)'};background:${isActive ? 'var(--primary)' : 'transparent'};color:${isActive ? '#fff' : 'inherit'};cursor:pointer;font-family:inherit;font-weight:${isActive ? '700' : '400'};">${p}</button>`;
  }
  if (groupEnd < totalPages) {
    html += `<button onclick="goToBoardPage(${groupEnd + 1})" style="font-size:12px;padding:6px 10px;border-radius:6px;border:1px solid var(--border);background:transparent;cursor:pointer;font-family:inherit;">다음 페이지</button>`;
  }
  pagEl.innerHTML = html;
}

window.goToBoardPage = function(page) {
  renderBoardListPage(page);
};

// ─── 글쓰기 / 수정 ───
window.openBoardWriteModal = function(postId) {
  _boardEditingPostId = postId || null;
  const titleEl = document.getElementById('boardWriteModalTitle');
  const titleInput = document.getElementById('boardWriteTitle');
  const contentInput = document.getElementById('boardWriteContent');
  const authorInfo = document.getElementById('boardWriteAuthorInfo');
  if (postId) {
    const post = window._boardCurrentPostData?.id === postId
      ? window._boardCurrentPostData
      : _boardAllPosts.find(p => p.id === postId);
    titleEl.textContent = '✏️ 글 수정';
    titleInput.value = post?.title || '';
    contentInput.value = post?.content || '';
  } else {
    titleEl.textContent = '✏️ 글쓰기';
    titleInput.value = '';
    contentInput.value = '';
  }
  authorInfo.textContent = `작성자: ${state.currentUser.name}${state.currentUser.role === 'teacher' ? ' (선생님)' : ''} · 실명으로 게시돼요`;
  openModal('boardWriteModal');
};

window.submitBoardWrite = async function() {
  const title = document.getElementById('boardWriteTitle').value.trim();
  const content = document.getElementById('boardWriteContent').value.trim();
  if (!title) return showToast('제목을 입력해주세요');
  if (!content) return showToast('내용을 입력해주세요');
  const isNewPost = !_boardEditingPostId;
  try {
    const cfg = await getCfgBoard();
    if (containsBannedWord(title, cfg.bannedWords) || containsBannedWord(content, cfg.bannedWords)) {
      return showToast('사용할 수 없는 단어가 포함되어 있습니다. 내용을 수정해 주세요.');
    }
    if (isNewPost) {
      // 새 글일 때만 잠금 상태와 도배 방지 쿨다운을 확인 (수정은 예외)
      if (state.currentUser.role !== 'teacher' && cfg.active === false) {
        return showToast('지금은 게시판이 잠겨있어요 🔒');
      }
      const cooldown = await checkBoardCooldown();
      if (!cooldown.ok) {
        return showToast(`도배 방지를 위해 ${cooldown.remain}초 후에 다시 글을 쓸 수 있어요`);
      }
    }

    if (_boardEditingPostId) {
      await updateDoc(doc(db, 'boardPosts', _boardEditingPostId), {
        title, content, updatedAt: serverTimestamp()
      });
      showToast('글이 수정됐어요');
      closeModal('boardWriteModal');
      // 상세 모달이 열려있으면 갱신
      if (_boardCurrentPostId === _boardEditingPostId) openBoardDetailModal(_boardEditingPostId);
    } else {
      await addDoc(collection(db, 'boardPosts'), {
        authorId: state.currentUser.uid,
        authorName: state.currentUser.name,
        authorRole: state.currentUser.role,
        title, content,
        commentCount: 0,
        authorSeenCommentCount: 0, // 작성자가 마지막으로 확인한 댓글 수 (댓글 배지용)
        readBy: [state.currentUser.uid], // 작성자 본인은 자기 글을 안읽음으로 보지 않음
        createdAt: serverTimestamp(),
        updatedAt: null
      });
      await markBoardAction();
      showToast('글이 게시됐어요 🎉');
      closeModal('boardWriteModal');
    }
    _boardEditingPostId = null;
    await renderBoardPage();
  } catch(e) { showToast('오류: ' + e.message); }
};

window.deleteBoardPost = async function(postId) {
  const post = _boardAllPosts.find(p => p.id === postId) || window._boardCurrentPostData;
  if (!post) return;
  const isOwner = post.authorId === state.currentUser.uid;
  const isTeacher = state.currentUser.role === 'teacher';
  if (!isOwner && !isTeacher) return showToast('삭제 권한이 없어요');
  if (!confirm('이 글을 삭제할까요? 댓글도 모두 함께 삭제돼요.')) return;
  try {
    // 댓글 함께 삭제
    const commentSnap = await getDocs(query(collection(db, 'boardComments'), where('postId', '==', postId)));
    await Promise.all(commentSnap.docs.map(d => deleteDoc(d.ref)));
    await deleteDoc(doc(db, 'boardPosts', postId));
    showToast('글이 삭제됐어요');
    closeModal('boardDetailModal');
    await renderBoardPage();
  } catch(e) { showToast('오류: ' + e.message); }
};

// ─── 공지(고정) 등록/해제 (교사 전용) ───
window.toggleBoardPostPinned = async function(postId) {
  const post = window._boardCurrentPostData?.id === postId
    ? window._boardCurrentPostData
    : _boardAllPosts.find(p => p.id === postId);
  if (!post) return;
  const newPinned = !post.pinned;
  try {
    await updateDoc(doc(db, 'boardPosts', postId), { pinned: newPinned });
    showToast(newPinned ? '공지로 등록됐어요 📌' : '공지가 해제됐어요');
    await renderBoardPage();
    if (_boardCurrentPostId === postId) await openBoardDetailModal(postId);
  } catch(e) { showToast('오류: ' + e.message); }
};

// ─── 글 상세 + 댓글 ───
window.openBoardDetailModal = async function(postId) {
  _boardCurrentPostId = postId;
  openModal('boardDetailModal');
  document.getElementById('boardDetailTitle').textContent = '불러오는 중...';
  document.getElementById('boardDetailMeta').textContent = '';
  document.getElementById('boardDetailContent').textContent = '';
  document.getElementById('boardDetailPostActions').innerHTML = '';
  document.getElementById('boardCommentList').innerHTML = '';
  try {
    const postDoc = await getDoc(doc(db, 'boardPosts', postId));
    if (!postDoc.exists()) {
      document.getElementById('boardDetailTitle').textContent = '삭제된 글이에요';
      return;
    }
    let post = { id: postDoc.id, ...postDoc.data() };

    // 조회수: 처음 열람하는 사용자만 readBy에 추가
    let needsCacheRefresh = false;
    if (!(post.readBy || []).includes(state.currentUser.uid)) {
      try {
        await updateDoc(doc(db, 'boardPosts', postId), { readBy: arrayUnion(state.currentUser.uid) });
        post.readBy = [...(post.readBy || []), state.currentUser.uid];
      } catch(e) {}
      needsCacheRefresh = true;
    }
    // 내 글이고, 아직 확인하지 않은 댓글이 있다면 확인 처리 (댓글 배지 해제는 글을 직접 열어야만 해제됨)
    if (post.authorId === state.currentUser.uid && (post.commentCount || 0) > (post.authorSeenCommentCount || 0)) {
      try {
        await updateDoc(doc(db, 'boardPosts', postId), { authorSeenCommentCount: post.commentCount || 0 });
        post.authorSeenCommentCount = post.commentCount || 0;
      } catch(e) {}
      needsCacheRefresh = true;
    }
    if (needsCacheRefresh) {
      // 목록 캐시에도 반영해서 배지/조회수가 바로 갱신되게
      const cacheIdx = _boardAllPosts.findIndex(p => p.id === postId);
      if (cacheIdx >= 0) _boardAllPosts[cacheIdx] = { ..._boardAllPosts[cacheIdx], readBy: post.readBy, authorSeenCommentCount: post.authorSeenCommentCount };
      updateBoardBadge(_boardAllPosts);
      // 상세 모달 뒤에 있는 목록도 즉시 갱신 (모달을 닫기 전에도 조회수가 반영되게)
      renderBoardListPage(_boardCurrentPage);
    }
    window._boardCurrentPostData = post;

    const isOwner = post.authorId === state.currentUser.uid;
    const isTeacher = state.currentUser.role === 'teacher';
    const roleTag = post.authorRole === 'teacher'
      ? `<span style="font-size:10px;font-weight:700;color:#fff;background:var(--primary);padding:1px 6px;border-radius:5px;margin-left:4px;">선생님</span>`
      : '';
    const pinnedTitleTag = post.pinned
      ? `<span style="font-size:11px;font-weight:700;color:#fff;background:#f59e0b;padding:2px 7px;border-radius:5px;margin-right:6px;vertical-align:middle;">📌 공지</span>`
      : '';

    document.getElementById('boardDetailTitle').innerHTML = pinnedTitleTag + escapeHtml(post.title);
    document.getElementById('boardDetailMeta').innerHTML =
      `${escapeHtml(post.authorName)}${roleTag} · ${formatTime(post.createdAt)}${post.updatedAt ? ' · 수정됨' : ''} · 조회 ${(post.readBy||[]).length}`;
    document.getElementById('boardDetailContent').textContent = post.content;

    const actionsEl = document.getElementById('boardDetailPostActions');
    let actionsHtml = '';
    if (isOwner) {
      actionsHtml += `<button onclick="openBoardWriteModal('${post.id}')" style="font-size:11px;padding:4px 10px;border-radius:6px;border:1px solid var(--border);background:transparent;cursor:pointer;font-family:inherit;white-space:nowrap;">수정</button>`;
    }
    if (isTeacher) {
      const pinLabel = post.pinned ? '📌 공지 해제' : '📌 공지';
      actionsHtml += `<button onclick="toggleBoardPostPinned('${post.id}')" style="font-size:11px;padding:4px 10px;border-radius:6px;border:1px solid ${post.pinned ? '#f59e0b' : 'var(--border)'};background:${post.pinned ? '#fef3c7' : 'transparent'};color:${post.pinned ? '#b45309' : 'inherit'};cursor:pointer;font-family:inherit;white-space:nowrap;">${pinLabel}</button>`;
    }
    if (isOwner || isTeacher) {
      actionsHtml += `<button onclick="deleteBoardPost('${post.id}')" style="font-size:11px;padding:4px 10px;border-radius:6px;border:1px solid #ef4444;background:transparent;color:#ef4444;cursor:pointer;font-family:inherit;white-space:nowrap;">삭제</button>`;
    }
    actionsEl.innerHTML = actionsHtml;

    await renderBoardComments(postId);
  } catch(e) {
    document.getElementById('boardDetailTitle').textContent = '오류가 발생했어요';
    console.error(e);
  }
};

async function renderBoardComments(postId) {
  const listEl = document.getElementById('boardCommentList');
  const countLabel = document.getElementById('boardCommentCountLabel');
  const snap = await getDocs(query(collection(db, 'boardComments'), where('postId', '==', postId)));
  const comments = snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .sort((a,b) => (a.createdAt?.seconds||0) - (b.createdAt?.seconds||0));
  countLabel.textContent = `💬 댓글 ${comments.length}개`;
  if (!comments.length) {
    listEl.innerHTML = '<div style="font-size:13px;color:var(--text-muted);padding:8px 0;">첫 댓글을 남겨보세요!</div>';
    return;
  }
  const isTeacher = state.currentUser.role === 'teacher';
  listEl.innerHTML = comments.map(c => {
    const isOwner = c.authorId === state.currentUser.uid;
    const roleTag = c.authorRole === 'teacher'
      ? `<span style="font-size:9px;font-weight:700;color:#fff;background:var(--primary);padding:1px 5px;border-radius:4px;margin-left:3px;">선생님</span>`
      : '';
    const delBtn = (isOwner || isTeacher)
      ? `<button onclick="deleteBoardComment('${postId}','${c.id}')" style="font-size:10px;color:#ef4444;background:none;border:none;cursor:pointer;font-family:inherit;padding:0;">삭제</button>`
      : '';
    return `<div style="padding:8px 10px;background:var(--bg);border-radius:8px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px;">
        <span style="font-size:12px;font-weight:700;">${escapeHtml(c.authorName)}${roleTag}</span>
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="font-size:11px;color:var(--text-muted);">${formatTime(c.createdAt)}</span>
          ${delBtn}
        </div>
      </div>
      <div style="font-size:13px;line-height:1.5;white-space:pre-wrap;word-break:break-word;">${escapeHtml(c.content)}</div>
    </div>`;
  }).join('');
}

window.submitBoardComment = async function() {
  const input = document.getElementById('boardCommentInput');
  const content = input.value.trim();
  if (!content) return showToast('댓글 내용을 입력해주세요');
  if (!_boardCurrentPostId) return;
  try {
    const cfg = await getCfgBoard();
    if (containsBannedWord(content, cfg.bannedWords)) {
      return showToast('사용할 수 없는 단어가 포함되어 있습니다. 내용을 수정해 주세요.');
    }
    if (state.currentUser.role !== 'teacher' && cfg.active === false) {
      return showToast('지금은 게시판이 잠겨있어요 🔒');
    }
    const cooldown = await checkBoardCooldown();
    if (!cooldown.ok) {
      return showToast(`도배 방지를 위해 ${cooldown.remain}초 후에 다시 댓글을 달 수 있어요`);
    }
    await addDoc(collection(db, 'boardComments'), {
      postId: _boardCurrentPostId,
      authorId: state.currentUser.uid,
      authorName: state.currentUser.name,
      authorRole: state.currentUser.role,
      content,
      createdAt: serverTimestamp()
    });
    await updateDoc(doc(db, 'boardPosts', _boardCurrentPostId), { commentCount: increment(1) });
    await markBoardAction();

    // 글쓴이에게 댓글 알림 (본인 글에 본인이 단 댓글은 제외)
    let targetPost = window._boardCurrentPostData?.id === _boardCurrentPostId
      ? window._boardCurrentPostData
      : (await getDoc(doc(db, 'boardPosts', _boardCurrentPostId))).data();
    try {
      if (targetPost && targetPost.authorId && targetPost.authorId !== state.currentUser.uid) {
        await addDoc(collection(db, 'notifications'), {
          studentId: targetPost.authorId, type: 'boardComment',
          postId: _boardCurrentPostId,
          postTitle: targetPost.title || '',
          commenterName: state.currentUser.name,
          commentSnippet: content.length > 60 ? content.slice(0, 60) + '...' : content,
          createdAt: serverTimestamp(), read: false
        });
      }
    } catch(e) { console.warn('댓글 알림 생성 오류:', e.message); }

    // 내 글에 내가 직접 댓글을 단 경우, 스스로 단 댓글은 '안읽음'으로 남지 않게 확인 처리
    const newCommentCount = (targetPost?.commentCount || 0) + 1;
    let newAuthorSeenCount = targetPost?.authorSeenCommentCount || 0;
    if (targetPost && targetPost.authorId === state.currentUser.uid) {
      newAuthorSeenCount = newCommentCount;
      try { await updateDoc(doc(db, 'boardPosts', _boardCurrentPostId), { authorSeenCommentCount: newAuthorSeenCount }); } catch(e) {}
      if (window._boardCurrentPostData) window._boardCurrentPostData.authorSeenCommentCount = newAuthorSeenCount;
    }

    input.value = '';
    await renderBoardComments(_boardCurrentPostId);
    // 목록 캐시의 댓글 수/확인 여부도 갱신 (뒤에 있는 목록도 즉시 반영)
    const cacheIdx = _boardAllPosts.findIndex(p => p.id === _boardCurrentPostId);
    if (cacheIdx >= 0) _boardAllPosts[cacheIdx] = { ..._boardAllPosts[cacheIdx], commentCount: newCommentCount, authorSeenCommentCount: newAuthorSeenCount };
    renderBoardListPage(_boardCurrentPage);
    updateBoardBadge(_boardAllPosts);
  } catch(e) { showToast('오류: ' + e.message); }
};

window.deleteBoardComment = async function(postId, commentId) {
  if (!confirm('이 댓글을 삭제할까요?')) return;
  try {
    await deleteDoc(doc(db, 'boardComments', commentId));
    await updateDoc(doc(db, 'boardPosts', postId), { commentCount: increment(-1) });
    await renderBoardComments(postId);
    const cacheIdx = _boardAllPosts.findIndex(p => p.id === postId);
    if (cacheIdx >= 0) _boardAllPosts[cacheIdx] = { ..._boardAllPosts[cacheIdx], commentCount: Math.max(0, (_boardAllPosts[cacheIdx].commentCount||0) - 1) };
    renderBoardListPage(_boardCurrentPage);
  } catch(e) { showToast('오류: ' + e.message); }
};
