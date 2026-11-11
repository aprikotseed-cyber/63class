// cards.js — 칭찬/벌점 카드 관리·부여·내역·회수
import { state } from './state.js?v=20261111a';
import {
  addDoc, collection, db, deleteDoc, doc, getDoc, getDocFromServer, getDocs, increment, limit,
  orderBy, query, serverTimestamp, updateDoc, where
} from './firebase.js?v=20261111a';
import { RANK_NAMES, closeModal, getRankIdx, openModal, showToast } from './core.js?v=20261111a';
import { formatTime } from './level.js?v=20261111a';
import { discountHtml } from './shop.js?v=20261111a';
import { reloadRewards, reloadStudents } from './realtime.js?v=20261111a';
import { renderDashboard } from './dashboard.js?v=20261111a';
import { makeAbilityTags } from './titles.js?v=20261111a';
import { buildCharHtml } from './avatar.js?v=20261111a';
import { fadePanel } from './ui.js?v=20261111a';

export let praiseCards = [];
let currentCardTab = 'praise';
let editingCardId = null;
let pendingGiveCard = null;

export async function reloadPraiseCards() {
  if (window._cachedPraiseCards) {
    praiseCards = window._cachedPraiseCards;
    return;
  }
  const snap = await getDocs(collection(db, 'praiseCards'));
  praiseCards = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  window._cachedPraiseCards = praiseCards;
}

async function renderPointCards() {
  await reloadPraiseCards();
  switchCardTab(currentCardTab);
}

window.switchCardTab = function(type) {
  const revokePanel = document.getElementById('cardTabRevoke');
  const cardTwoCol  = document.getElementById('cardTwoCol');
  const listBtn     = document.getElementById('cardListBtn');
  const revokeBtn   = document.getElementById('revokeTabBtn2');
  if (type === 'revoke') {
    if (revokePanel) { revokePanel.style.display = ''; fadePanel(revokePanel); }
    if (cardTwoCol)  cardTwoCol.style.display  = 'none';
    if (listBtn)  listBtn.style.display  = '';
    if (revokeBtn) revokeBtn.style.display = 'none';
    renderRevokeList();
  } else if (type === 'close' || type === 'list') {
    if (revokePanel) revokePanel.style.display = 'none';
    if (cardTwoCol)  cardTwoCol.style.display  = '';
    if (listBtn)  listBtn.style.display  = 'none';
    if (revokeBtn) revokeBtn.style.display = '';
  } else {
    currentCardTab = type;
    filterCards('praise');
    filterCards('penalty');
  }
};

async function loadSubTabs(type) {
  const snap = await getDocs(query(collection(db, 'cardSubTabs'), where('type','==',type)));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0));
}

window.filterCards = function(type) {
  const filtered = praiseCards.filter(c => c.type === type)
    .sort((a, b) => (a.title||'').localeCompare(b.title||'', 'ko'));
  const listId = type === 'praise' ? 'praiseCardList' : 'penaltyCardList';
  const list = document.getElementById(listId);
  if (!list) return;
  list.innerHTML = filtered.length ? filtered.map(c => `
    <div class="praise-card-box type-${c.type}">
      <div class="praise-card-box-icon">${c.emoji || (c.type==='praise'?'💓':'⚠️')}</div>
      <div class="praise-card-box-title">${c.title}</div>
      <div class="praise-card-box-desc">${c.desc || c.category || '설명 없음'}</div>
      <div class="praise-card-box-point ${c.type==='praise'?'plus':'minus'}">
        ${c.type==='praise'?'+':'-'}${c.point}🪙
      </div>
      ${makeAbilityTags(c.abilities, c.type==='penalty')}
      <div class="praise-card-box-btns">
        <button onclick="openGiveCardModal('${c.id}')" style="background:none;border:none;cursor:pointer;font-size:13px;font-weight:600;color:var(--primary);font-family:inherit;padding:4px 0;">부여</button>
        <button onclick="openEditCard('${c.id}')" style="background:none;border:none;cursor:pointer;font-size:13px;font-weight:600;color:var(--text-secondary);font-family:inherit;padding:4px 0;">수정</button>
        <button onclick="deleteCard('${c.id}','${c.title}')" style="background:none;border:none;cursor:pointer;font-size:13px;font-weight:600;color:#ef4444;font-family:inherit;padding:4px 0;">삭제</button>
      </div>
    </div>
  `).join('') : `<div class="empty-state" style="padding:40px;grid-column:1/-1;"><div class="empty-icon">${type==='praise'?'💓':'⚠️'}</div><h3>${type==='praise'?'칭찬 카드':'벌점 카드'}가 없어요</h3><p>카드를 추가해 주세요</p></div>`;
};

window.openAddCardModal = async function() {
  editingCardId = null;
  document.getElementById('addCardModalTitle').textContent = '💓 카드 추가';
  document.getElementById('cardType').value = 'praise';
  document.getElementById('cardEmoji').value = '';
  document.getElementById('cardTitle').value = '';
  document.getElementById('cardDesc').value = '';
  document.getElementById('cardPoint').value = '';
  ['성실성','인성','사회성','지력','집중력'].forEach(k => {
    const el = document.getElementById(`cardAb_${k}`);
    if (el) el.value = '';
  });
  await refreshCardCategorySelect('praise');
  openModal('addCardModal');
};

// 카드 종류 변경 시 분류 select 업데이트
document.addEventListener('change', async e => {
  if (e.target.id === 'cardType') {
    await refreshCardCategorySelect(e.target.value);
  }
});

async function refreshCardCategorySelect(type, selectedCat) {
  const subTabs = await loadSubTabs(type);
  const sel = document.getElementById('cardCategory');
  if (!sel) return;
  sel.innerHTML = '<option value="전체">전체</option>' +
    subTabs.map(t => `<option value="${t.name}">${t.emoji||''} ${t.name}</option>`).join('');
  if (selectedCat) sel.value = selectedCat;
}

window.openEditCard = async function(id) {
  editingCardId = id;
  const c = praiseCards.find(x => x.id === id);
  document.getElementById('addCardModalTitle').textContent = '카드 수정';
  document.getElementById('cardType').value = c.type;
  document.getElementById('cardEmoji').value = c.emoji || '';
  document.getElementById('cardTitle').value = c.title;
  document.getElementById('cardDesc').value = c.desc || '';
  document.getElementById('cardPoint').value = c.point;
  ['성실성','인성','사회성','지력','집중력'].forEach(k => {
    const el = document.getElementById(`cardAb_${k}`);
    if (el) el.value = c.abilities?.[k] || '';
  });
  await refreshCardCategorySelect(c.type, c.category || '전체');
  openModal('addCardModal');
};

window.saveCard = async function() {
  const type = document.getElementById('cardType').value;
  const category = document.getElementById('cardCategory')?.value || '전체';
  const emoji = document.getElementById('cardEmoji').value.trim();
  const title = document.getElementById('cardTitle').value.trim();
  const desc = document.getElementById('cardDesc').value.trim();
  const point = parseInt(document.getElementById('cardPoint').value);
  if (!title) return showToast('카드 제목을 입력하세요');
  if (!point || point < 1) return showToast('포인트를 입력하세요');
  try {
    const abilities = {};
  ['성실성','인성','사회성','지력','집중력'].forEach(k => {
    const v = parseInt(document.getElementById(`cardAb_${k}`)?.value || '0');
    if (v > 0) abilities[k] = v;
  });
  const data = { type, category, emoji, title, desc, point, abilities, createdAt: serverTimestamp() };
    if (editingCardId) {
      await updateDoc(doc(db, 'praiseCards', editingCardId), data);
      // 로컬 캐시 즉시 갱신
      const idx = praiseCards.findIndex(c => c.id === editingCardId);
      if (idx >= 0) praiseCards[idx] = { id: editingCardId, ...data };
      window._cachedPraiseCards = praiseCards;
      showToast('카드가 수정됐어요 ✅');
    } else {
      const newRef = await addDoc(collection(db, 'praiseCards'), data);
      // 로컬 배열에 즉시 추가 (Firestore 재조회 없이 바로 반영)
      const newCard = { id: newRef.id, ...data };
      praiseCards.push(newCard);
      window._cachedPraiseCards = praiseCards;
      showToast('카드가 추가됐어요 💓');
    }
    closeModal('addCardModal');
    renderCardsPage();
  } catch(e) { showToast('오류: ' + e.message); }
};

window.deleteCard = async function(id, title) {
  if (!confirm(`'${title}' 카드를 삭제할까요?`)) return;
  await deleteDoc(doc(db, 'praiseCards', id));
  praiseCards = praiseCards.filter(c => c.id !== id);
  window._cachedPraiseCards = praiseCards;
  showToast('삭제됐어요');
  renderCardsPage();
};

let selectedGiveStudentIds = new Set();

window.openGiveCardModal = function(cardId) {
  const c = praiseCards.find(x => x.id === cardId);
  if (!c) return;
  pendingGiveCard = c;
  selectedGiveStudentIds = new Set();
  document.getElementById('giveCardTitle').textContent = `${c.emoji||''} ${c.title}`;
  document.getElementById('giveCardSubtitle').textContent =
    `${c.type==='praise'?'💓 칭찬':'⚠️ 벌점'} · ${c.type==='praise'?'+':'-'}${c.point}🪙`;
  document.getElementById('giveCardMemo').value = '';
  // 해당 카드 누적 횟수를 위해 givenCards 로드 (카드별 세션 캐시)
  const cacheKey = `_giveCardCache_${c.id}`;
  if (!window[cacheKey]) {
    getDocs(query(collection(db, 'givenCards'), where('cardId', '==', c.id))).then(snap => {
      window[cacheKey] = snap.docs.map(d => d.data());
      window._allGivenCardsCache = window[cacheKey];
      renderGiveStudentGrid();
    });
  } else {
    window._allGivenCardsCache = window[cacheKey];
  }
  renderGiveStudentGrid();
  openModal('giveCardModal');
};

function renderGiveStudentGrid() {
  const sorted = [...state.students].sort((a,b) => (a.number||999)-(b.number||999));
  const grid = document.getElementById('giveCardStudentGrid');
  if (!grid) return;
  const c = pendingGiveCard;
  // 해당 카드 누적 횟수 계산 (givenCards 캐시 활용)
  const countMap = {};
  if (c && window._myGivenCards) {
    window._myGivenCards.forEach(g => {
      if (g.cardId === c.id) countMap[g.studentId] = (countMap[g.studentId]||0) + 1;
    });
  }
  // 교사는 전체 givenCards가 없으므로 exchanges 대신 별도 캐시
  const allCards = window._allGivenCardsCache || [];
  allCards.forEach(g => {
    if (c && g.cardId === c.id) countMap[g.studentId] = (countMap[g.studentId]||0) + 1;
  });

  grid.innerHTML = sorted.map(s => {
    const selected = selectedGiveStudentIds.has(s.id);
    const cnt = countMap[s.id] || 0;
    return `
    <div class="give-student-card ${selected?'selected':''}" onclick="toggleGiveStudent('${s.id}')" id="gsc-${s.id}">
      ${buildCharHtml(s, 'margin-bottom:6px;')}
      <div class="gs-name">${s.number||''}번 ${s.name}</div>
      ${cnt > 0 ? `<div style="font-size:10px;color:var(--text-muted);margin-top:2px;">누적 ${cnt}회</div>` : ''}
    </div>`;
  }).join('');
}

window.toggleGiveStudent = function(studentId) {
  if (selectedGiveStudentIds.has(studentId)) {
    selectedGiveStudentIds.delete(studentId);
  } else {
    selectedGiveStudentIds.add(studentId);
  }
  const el = document.getElementById(`gsc-${studentId}`);
  if (el) {
    const selected = selectedGiveStudentIds.has(studentId);
    el.classList.toggle('selected', selected);
  }
};

window.selectAllGiveStudents = function(selectAll) {
  state.students.forEach(s => {
    if (selectAll) selectedGiveStudentIds.add(s.id);
    else selectedGiveStudentIds.delete(s.id);
  });
  renderGiveStudentGrid();
};

window.giveCard = async function() {
  const c = pendingGiveCard;
  if (!c) return;
  if (selectedGiveStudentIds.size === 0) return showToast('학생을 선택해 주세요');
  // 더블클릭 방지
  const btn = document.querySelector('#giveCardModal .btn-primary');
  if (btn) { btn.disabled = true; btn.textContent = '부여 중...'; }
  const memo = document.getElementById('giveCardMemo').value.trim();
  const delta = c.type === 'praise' ? c.point : -c.point;
  const selectedStudents = state.students.filter(s => selectedGiveStudentIds.has(s.id));
  try {
    for (const s of selectedStudents) {
      const abilityUpdate = {};
      let rankBonus = 0;
      const rankUpDetails = [];
      const ABILITY_ICONS2 = {'성실성':'🌟','인성':'❤️','사회성':'🤝','지력':'📚','집중력':'⚡'};

      // 반드시 서버에서 최신값 읽기
      const freshDoc = await getDocFromServer(doc(db, 'students', s.id));
      const freshData = freshDoc.exists() ? freshDoc.data() : {};
      const prevAbilities = freshData.abilities || {};
      const rankGranted = freshData.abilityRankGranted || {};

      // 카드에 능력치가 있으면 업데이트 계산
      if (c.abilities && Object.keys(c.abilities).length > 0) {
        for (const [k, v] of Object.entries(c.abilities)) {
          const amt = c.type === 'praise' ? v : -v;
          abilityUpdate[`abilities.${k}`] = increment(amt);
        }
      }

      // 칭찬카드인 경우 카드 능력치 포함 여부 무관하게 모든 능력치 랭크업 체크
      if (c.type === 'praise') {
        const ALL_ABILITY_KEYS = ['성실성','인성','사회성','지력','집중력'];
        for (const k of ALL_ABILITY_KEYS) {
          const prev = prevAbilities[k] || 0;
          const cardAmt = (c.abilities && typeof c.abilities[k] === 'number') ? c.abilities[k] : 0;
          const next = prev + cardAmt;
          const prevRankIdx = getRankIdx(prev);
          const nextRankIdx = getRankIdx(next);
          const grantedSoFar = rankGranted[k] !== undefined ? rankGranted[k] : 0;
          // grantedSoFar가 prevRankIdx보다 높으면 이미 보상 받은 것 - 그 위부터 체크
          // grantedSoFar가 prevRankIdx보다 낮으면 동기화 문제 - prevRankIdx 기준으로 체크
          const fromRank = Math.max(prevRankIdx, grantedSoFar);
          if (nextRankIdx > fromRank) {
            const steps = nextRankIdx - fromRank;
            rankBonus += 500 * steps;
            rankUpDetails.push({ key: k, icon: ABILITY_ICONS2[k]||'⚡', rank: RANK_NAMES[nextRankIdx] });
          }
        }
      }

      // 1단계: 능력치 + 카드 포인트만 업데이트 (abilityRankGranted 제외)
      await updateDoc(doc(db, 'students', s.id), {
        points: increment(delta),
        // 칭찬카드(양수)만 누적포인트 증가, 벌점카드는 누적포인트 유지
        ...(delta > 0 ? { accumulatedPoints: increment(delta) } : {}),
        ...abilityUpdate
      });

      // 2단계: 랭크업 보상 + abilityRankGranted 함께 처리
      if (rankBonus > 0) {
        const rankGrantedUpdate = {};
        rankUpDetails.forEach(detail => {
          // 최신 nextRankIdx 재계산
          const prev = prevAbilities[detail.key] || 0;
          const cardAmt = (c.abilities && typeof c.abilities[detail.key] === 'number') ? c.abilities[detail.key] : 0;
          const nextRankIdx = getRankIdx((prev + cardAmt));
          rankGrantedUpdate[`abilityRankGranted.${detail.key}`] = nextRankIdx;
        });
        await updateDoc(doc(db, 'students', s.id), {
          points: increment(rankBonus),
          accumulatedPoints: increment(rankBonus),
          ...rankGrantedUpdate
        });
      }
      // 랭크업 보상: 능력치별 개별 history 기록
      for (const detail of rankUpDetails) {
        await addDoc(collection(db, 'history'), {
          studentId: s.id, studentName: s.name,
          delta: 500,
          reason: `능력치 등급 상승 보상 (${detail.icon}${detail.key} → ${detail.rank})`,
          type: 'plus', source: 'praiseCard',
          createdAt: serverTimestamp()
        });
      }
      if (rankUpDetails.length > 0) {
        // 알림 저장 (학생 로그인 시 팝업)
        await addDoc(collection(db, 'notifications'), {
          studentId: s.id,
          type: 'rankUp',
          rankUpDetails: rankUpDetails,
          bonus: rankBonus,
          createdAt: serverTimestamp(),
          read: false
        });
      }
      await addDoc(collection(db, 'givenCards'), {
        studentId: s.id, studentName: s.name,
        cardId: c.id, cardTitle: c.title, cardEmoji: c.emoji||'',
        cardType: c.type, type: c.type, cardPoint: c.point,
        delta, abilities: c.abilities || {},
        memo, givenAt: serverTimestamp(), createdAt: serverTimestamp()
      });
      await addDoc(collection(db, 'history'), {
        studentId: s.id, studentName: s.name,
        delta, reason: c.title,
        type: c.type === 'praise' ? 'plus' : 'minus',
        source: c.type === 'praise' ? 'praiseCard' : 'penaltyCard',
        cardId: c.id, createdAt: serverTimestamp()
      });
    }
    closeModal('giveCardModal');
    const abMsg = c.abilities && Object.keys(c.abilities).length
      ? ' · ' + Object.entries(c.abilities).map(([k,v]) => `${k}${delta>0?'+':'-'}${v}`).join(', ')
      : '';
    // 버튼 상태 복구 (다음 부여를 위해)
    const btn2 = document.querySelector('#giveCardModal .btn-primary');
    if (btn2) { btn2.disabled = false; btn2.textContent = '부여하기'; }
    window._myGivenCards = null;
    if (pendingGiveCard) window[`_giveCardCache_${pendingGiveCard.id}`] = null;
    window._myHistory = null;
    showToast(`${selectedStudents.length}명에게 '${c.emoji||''} ${c.title}' 부여! ${delta>0?'+':''}${delta}🪙${abMsg}`);
    await reloadStudents();
    renderDashboard();
  } catch(e) {
    showToast('오류: ' + e.message);
    // 오류 시 버튼 복구
    const btn2 = document.querySelector('#giveCardModal .btn-primary');
    if (btn2) { btn2.disabled = false; btn2.textContent = '부여하기'; }
  }
};

window.revokeCard = async function(giveId, studentId, delta, studentName) {
  if (!confirm('이 카드를 회수할까요? 포인트와 능력치도 원상복구됩니다.')) return;
  try {
    const cardDoc = await getDoc(doc(db, 'givenCards', giveId));
    const cardData = cardDoc.exists() ? cardDoc.data() : {};
    const abilities = cardData.abilities || {};
    const abilityRestore = {};
    Object.entries(abilities).forEach(([k, v]) => {
      abilityRestore[`abilities.${k}`] = increment(delta > 0 ? -v : v);
    });
    await deleteDoc(doc(db, 'givenCards', giveId));
    await updateDoc(doc(db, 'students', studentId), {
      points: increment(-delta),
      accumulatedPoints: increment(-delta),
      ...abilityRestore
    });
    const abMsg = Object.keys(abilities).length
      ? ' · ' + Object.entries(abilities).map(([k,v])=>`${k}${delta>0?'-':'+'}${v}`).join(', ')
      : '';
    await addDoc(collection(db, 'history'), {
      studentId, studentName, delta: -delta,
      reason: `카드 회수${abMsg}`, type: delta > 0 ? 'minus' : 'plus',
      source: 'revoke', createdAt: serverTimestamp()
    });
    showToast(`카드가 회수됐어요${abMsg}`);
    await reloadStudents();
    if (!document.getElementById('studentCardHistoryModal').classList.contains('hidden')) {
      await renderStudentCardHistory(studentId, studentName, currentHistoryTab);
    }
  } catch(e) { showToast('오류: ' + e.message); }
};

// ===== 학생 카드 내역 =====
let currentHistoryStudentId = null;
let currentHistoryTab = 'praise';

window.openStudentCardHistory = async function(studentId, studentName) {
  currentHistoryStudentId = studentId;
  currentHistoryTab = 'praise';
  document.getElementById('studentCardHistoryTitle').textContent = `📋 ${studentName}의 카드 내역`;
  const s = state.students.find(x => x.id === studentId);
  document.getElementById('studentCardHistorySubtitle').textContent =
    `현재 포인트: 🪙 ${(s?.points || 0).toLocaleString()}`;
  await switchHistoryTab('praise');
  openModal('studentCardHistoryModal');
};

window.switchHistoryTab = async function(type) {
  currentHistoryTab = type;
  const praiseBtn = document.getElementById('historyPraiseTab');
  const penaltyBtn = document.getElementById('historyPenaltyTab');
  if (praiseBtn) {
    praiseBtn.style.background = type === 'praise' ? '#fff0f3' : 'transparent';
    praiseBtn.style.color = type === 'praise' ? '#e11d48' : 'var(--text-secondary)';
    praiseBtn.style.boxShadow = type === 'praise' ? 'var(--shadow-sm)' : 'none';
  }
  if (penaltyBtn) {
    penaltyBtn.style.background = type === 'penalty' ? '#fffbeb' : 'transparent';
    penaltyBtn.style.color = type === 'penalty' ? '#d97706' : 'var(--text-secondary)';
    penaltyBtn.style.boxShadow = type === 'penalty' ? 'var(--shadow-sm)' : 'none';
  }
  await renderStudentCardHistory(currentHistoryStudentId, null, type);
};

async function renderStudentCardHistory(studentId, studentName, type) {
  const list = document.getElementById('studentCardHistoryList');
  if (!list) return;
  list.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted);">불러오는 중...</div>';
  try {
    const snap = await getDocs(query(
      collection(db, 'givenCards'),
      where('studentId', '==', studentId),
      where('cardType', '==', type)
    ));
    const cards = snap.docs
      .map(d => ({ giveId: d.id, ...d.data() }))
      .sort((a, b) => (b.givenAt?.seconds || 0) - (a.givenAt?.seconds || 0));

    if (!cards.length) {
      list.innerHTML = `<div class="empty-state" style="padding:40px;">
        <div class="empty-icon">${type === 'praise' ? '💓' : '⚠️'}</div>
        <h3>아직 ${type === 'praise' ? '칭찬' : '벌점'} 카드가 없어요</h3>
      </div>`;
      return;
    }
    const sName = studentName || state.students.find(x => x.id === studentId)?.name || '';
    list.innerHTML = cards.map(c => `
      <div style="background:var(--surface);border-radius:var(--radius-md);border:1px solid var(--border);padding:12px 16px;display:flex;align-items:center;gap:12px;">
        <div style="font-size:22px;">${c.cardEmoji || (type==='praise'?'💓':'⚠️')}</div>
        <div style="flex:1;">
          <div style="font-weight:700;font-size:14px;">${c.cardTitle}</div>
          <div style="font-size:12px;color:var(--text-secondary);">
            ${formatTime(c.givenAt)}${c.memo ? ' · ' + c.memo : ''}
          </div>
        </div>
        <div style="font-size:14px;font-weight:700;color:${type==='praise'?'#e11d48':'#d97706'};flex-shrink:0;">
          ${(()=>{const d=(c.delta!=null&&!isNaN(c.delta))?c.delta:(type==='praise'?(c.cost||c.point||0):-(c.cost||c.point||0));return (d>0?'+':'')+d;})()}🪙
        </div>
        <button class="btn btn-danger btn-sm" style="flex-shrink:0;"
          onclick="revokeCard('${c.giveId}','${studentId}',${(c.delta!=null&&!isNaN(c.delta))?c.delta:(type==='praise'?(c.cost||c.point||0):-(c.cost||c.point||0))},'${sName}')">
          회수
        </button>
      </div>
    `).join('');
  } catch(e) {
    list.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted);">불러오기 실패</div>';
    console.error(e);
  }
}

export function renderRewards() {
  const cats = ['study', 'snack', 'stationery'];
  cats.forEach(cat => {
    const list = document.getElementById(`rewardList-${cat}`);
    if (!list) return;
    const catRewards = state.rewards
      .filter(r => (r.category || 'study') === cat)
      .sort((a, b) => (a.order || 0) - (b.order || 0));
    list.innerHTML = catRewards.length
      ? catRewards.map(r => `
        <div class="reward-card" draggable="true"
          ondragstart="dragStart(event,'${r.id}')"
          ondragover="dragOver(event)"
          ondrop="dragDrop(event,'${r.id}','${cat}')"
          ondragleave="dragLeave(event)"
          ondragend="dragEnd(event)"
          onclick="openRewardStockModal('${r.id}')"
          style="cursor:pointer;${r.tagSoldOut?'background:#f3f4f6;border-color:#d1d5db;filter:grayscale(1);opacity:0.7;':r.discount>0?'background:linear-gradient(135deg,#fff0f3,#ffd6e0);border-color:#f9a8c9;':''}"
        >
          <div class="reward-icon">${r.emoji||'🎁'}</div>
          <div class="reward-info">
            <div class="reward-name" style="display:flex;align-items:center;gap:5px;">
              ${r.name}
              ${r.tagNew?'<span class="item-tag-new">New!</span>':''}
              ${r.tagHot?'<span class="item-tag-hot">Hot!</span>':''}
              ${r.tagSoldOut?'<span class="item-tag-soldout">Sold Out</span>':''}
            </div>
            <div class="reward-cost">${discountHtml(r.cost,r.discount)}${(r.stock !== null && r.stock !== undefined) ? `<span style="font-size:12px;font-weight:600;color:var(--text-secondary);margin-left:8px;">🛒재고 ${r.stock}개</span>` : ''}</div>
          </div>
          <div style="display:flex;gap:6px;flex-shrink:0">
            <button class="btn btn-secondary btn-sm" onclick="event.stopPropagation();openEditReward('${r.id}')">수정</button>
            <button class="btn btn-danger btn-sm" onclick="event.stopPropagation();deleteReward('${r.id}','${r.name}')">삭제</button>
          </div>
        </div>`).join('')
      : `<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:13px;">보상을 추가해 주세요</div>`;
  });
}

window.openAddRewardModal = function() {
  state.pendingRewardEdit = null;
  document.getElementById('rewardModalTitle').textContent = '보상 추가';
  document.getElementById('rewardCategory').value = 'study';
  document.getElementById('rewardName').value = '';
  document.getElementById('rewardEmoji').value = '';
  document.getElementById('rewardCost').value = '';
  document.getElementById('rewardStock').value = '';
  document.getElementById('rewardLimit').value = '';
  document.getElementById('rewardTagNew').checked = false;
  document.getElementById('rewardTagHot').checked = false;
  document.getElementById('rewardTagSoldOut').checked = false;
  document.getElementById('rewardDiscount').value = '0';
  document.getElementById('discountPreview').textContent = '';
  openModal('rewardModal');
};

window.openEditReward = function(id) {
  state.pendingRewardEdit = id;
  const r = state.rewards.find(x => x.id === id);
  document.getElementById('rewardModalTitle').textContent = '보상 수정';
  document.getElementById('rewardCategory').value = r.category || 'study';
  document.getElementById('rewardName').value = r.name;
  document.getElementById('rewardEmoji').value = r.emoji||'';
  document.getElementById('rewardCost').value = r.cost;
  document.getElementById('rewardStock').value = (r.stock !== undefined && r.stock !== null) ? r.stock : '';
  document.getElementById('rewardLimit').value = (r.limit !== undefined && r.limit !== null) ? r.limit : '';
  document.getElementById('rewardTagNew').checked = !!r.tagNew;
  document.getElementById('rewardTagHot').checked = !!r.tagHot;
  document.getElementById('rewardTagSoldOut').checked = !!r.tagSoldOut;
  document.getElementById('rewardDiscount').value = r.discount || 0;
  updateDiscountPreview();
  openModal('rewardModal');
};

window.saveReward = async function() {
  const name = document.getElementById('rewardName').value.trim();
  const emoji = document.getElementById('rewardEmoji').value.trim() || '🎁';
  const cost = parseInt(document.getElementById('rewardCost').value);
  const category = document.getElementById('rewardCategory').value || 'study';
  const stockVal = document.getElementById('rewardStock').value.trim();
  const stock = stockVal !== '' ? parseInt(stockVal) : null;
  const limitVal = document.getElementById('rewardLimit').value.trim();
  const limit = limitVal !== '' ? parseInt(limitVal) : null;
  const tagNew = document.getElementById('rewardTagNew').checked;
  const tagHot = document.getElementById('rewardTagHot').checked;
  const tagSoldOut = document.getElementById('rewardTagSoldOut').checked;
  const discount = parseInt(document.getElementById('rewardDiscount').value) || 0;
  if (!name || !cost) return showToast('이름과 포인트를 입력하세요');
  const rewardData = { name, emoji, cost, category, stock, limit, tagNew, tagHot, tagSoldOut, discount };
  try {
    if (state.pendingRewardEdit) {
      await updateDoc(doc(db, 'rewards', state.pendingRewardEdit), rewardData);
      showToast('보상이 수정됐어요 ✅');
    } else {
      const catRewards = state.rewards.filter(r => (r.category || 'study') === category);
      const order = catRewards.length;
      await addDoc(collection(db, 'rewards'), { ...rewardData, order, createdAt: serverTimestamp() });
      showToast('보상이 추가됐어요 🎁');
    }
    closeModal('rewardModal');
    await reloadRewards();
    renderRewards();
  } catch(e) { showToast('오류: ' + e.message); }
};

window.deleteReward = async function(id, name) {
  if (!confirm(`'${name}' 보상을 삭제할까요?`)) return;
  await deleteDoc(doc(db, 'rewards', id));
  showToast('삭제됐어요');
  await reloadRewards();
  renderRewards();
};

// ===== 학생: 카드 목록 =====
let studentCurrentCardTab = 'praise';

async function renderStudentCards() {
  await reloadPraiseCards();
  const content = document.getElementById('cardPageContent');
  if (content && !document.getElementById('studentCardTabPraise')) {
    content.innerHTML = `
      <div style="display:flex;gap:8px;margin-bottom:16px;">
        <button id="studentPraiseTabBtn" class="card-type-tab active" onclick="switchStudentCardTab('praise',this)">칭찬 카드</button>
        <button id="studentPenaltyTabBtn" class="card-type-tab" onclick="switchStudentCardTab('penalty',this)">벌점 카드</button>
      </div>
      <div id="studentCardTabPraise"></div>
      <div id="studentCardTabPenalty" style="display:none;"></div>`;
  }
  filterStudentCards('praise', 'all');
  filterStudentCards('penalty', 'all');
}

window.switchStudentCardTab = function(type, btn) {
  studentCurrentCardTab = type;
  const praiseBtn = document.getElementById('studentPraiseTabBtn');
  const penaltyBtn = document.getElementById('studentPenaltyTabBtn');
  if (praiseBtn) praiseBtn.className = 'card-type-tab' + (type==='praise'?' active':'');
  if (penaltyBtn) penaltyBtn.className = 'card-type-tab' + (type==='penalty'?' active':'');
  const praisePanel = document.getElementById('studentCardTabPraise');
  const penaltyPanel = document.getElementById('studentCardTabPenalty');
  if (praisePanel) { praisePanel.style.display = type==='praise' ? '' : 'none'; if (type==='praise') fadePanel(praisePanel); }
  if (penaltyPanel) { penaltyPanel.style.display = type==='penalty' ? '' : 'none'; if (type==='penalty') fadePanel(penaltyPanel); }
  updateStudentCardSubTabs(type);
  filterStudentCards(type, 'all');
};

function updateStudentCardSubTabs(type) {
  const cards = praiseCards.filter(c => c.type === type);
  const categories = ['all', ...new Set(cards.map(c => c.category || '기타').filter(Boolean))];
  const barId = type === 'praise' ? 'studentPraiseSubTabBar' : 'studentPenaltySubTabBar';
  const bar = document.getElementById(barId);
  if (!bar) return;
  bar.innerHTML = categories.map((cat, i) =>
    `<button class="tab-btn ${i===0?'active':''}" onclick="filterStudentCards('${type}','${cat}',this)">${cat === 'all' ? '전체' : cat}</button>`
  ).join('');
}

window.filterStudentCards = function(type, category, btn) {
  if (btn) {
    const barId = type === 'praise' ? 'studentPraiseSubTabBar' : 'studentPenaltySubTabBar';
    document.getElementById(barId)?.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  }
  const filtered = praiseCards.filter(c =>
    c.type === type && (category === 'all' || (c.category || '기타') === category)
  ).sort((a, b) => {
    const catDiff = (a.category||'기타').localeCompare(b.category||'기타', 'ko');
    if (catDiff !== 0) return catDiff;
    return (a.title||'').localeCompare(b.title||'', 'ko');
  });
  const listId = type === 'praise' ? 'studentPraiseCardList' : 'studentPenaltyCardList';
  const list = document.getElementById(listId);
  if (!list) return;
  list.innerHTML = filtered.length ? filtered.map(c => `
    <div class="praise-card-box type-${c.type}">
      <div class="praise-card-box-icon">${c.emoji || (c.type==='praise'?'💓':'⚠️')}</div>
      <div class="praise-card-box-title">${c.title}</div>
      <div class="praise-card-box-desc">${c.desc || c.category || '설명 없음'}</div>
      <div class="praise-card-box-point ${c.type==='praise'?'plus':'minus'}">
        ${c.type==='praise'?'+':'-'}${c.point}🪙
      </div>
      ${makeAbilityTags(c.abilities, c.type==='penalty')}
    </div>
  `).join('') : `<div class="empty-state" style="padding:40px;grid-column:1/-1;"><div class="empty-icon">${type==='praise'?'💓':'⚠️'}</div><h3>${type==='praise'?'칭찬 카드':'벌점 카드'}가 없어요</h3></div>`;
};

// ===== 카드 부여 내역 & 회수 =====
window._givenCardsTab = 'recent';

function renderGivenCardRow(item) {
  const ts = item.givenAt || item.createdAt;
  const d = ts?.toDate ? ts.toDate() : null;
  const dateStr = d ? `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}` : '';
  // delta 없는 기존 데이터 폴백: cost + type으로 계산
  const delta = (item.delta !== undefined && item.delta !== null && !isNaN(item.delta))
    ? item.delta
    : ((item.cardType||item.type) === 'praise' ? (item.cost||item.point||0) : -(item.cost||item.point||0));
  const isPlus = delta >= 0;
  const abStr = item.abilities && Object.keys(item.abilities).length
    ? ' · ' + Object.entries(item.abilities).map(([k,v]) => `${k}${isPlus?'+':'-'}${v}`).join(', ')
    : '';
  return `<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:var(--bg);border-radius:10px;border:1px solid var(--border);">
    <span style="font-size:20px;">${item.cardEmoji||'💓'}</span>
    <div style="flex:1;min-width:0;">
      <div style="font-size:13px;font-weight:700;">${item.studentName} · ${item.cardTitle}</div>
      <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">${dateStr}${abStr}</div>
    </div>
    <span style="font-size:13px;font-weight:700;color:${isPlus?'#16a34a':'#ef4444'};white-space:nowrap;">${isPlus?'+':''}${delta}🪙</span>
    <button onclick="reclaimGivenCard('${item.id}')" style="font-size:11px;padding:4px 10px;border-radius:6px;border:1px solid #ef4444;background:transparent;color:#ef4444;cursor:pointer;font-weight:600;font-family:inherit;white-space:nowrap;">회수</button>
  </div>`;
}

window.openGivenCardsModal = async function() {
  openModal('givenCardsModal');
  switchGivenCardsTab(window._givenCardsTab || 'recent');
};

window.switchGivenCardsTab = function(tab) {
  window._givenCardsTab = tab;
  const isStudent = tab === 'student';
  document.getElementById('givenCardsTabRecent').className = 'btn btn-sm ' + (isStudent ? 'btn-secondary' : 'btn-primary');
  document.getElementById('givenCardsTabStudent').className = 'btn btn-sm ' + (isStudent ? 'btn-primary' : 'btn-secondary');
  document.getElementById('givenCardsStudentBar').style.display = isStudent ? '' : 'none';
  document.getElementById('givenCardsSubtitle').textContent = isStudent
    ? '학생을 선택하면 그 학생이 받은 모든 카드를 볼 수 있어요 · 회수 시 포인트·능력치 즉시 복구'
    : '최근 20건 · 회수 시 포인트·능력치 즉시 복구';
  if (isStudent) {
    const sel = document.getElementById('givenCardsStudentSelect');
    const prev = sel.value;
    sel.innerHTML = '<option value="">학생을 선택하세요</option>' +
      [...state.students].filter(s => !s.hidden).sort((a,b) => (a.number||999)-(b.number||999))
        .map(s => `<option value="${s.id}">${s.number||''}번 ${s.name}</option>`).join('');
    if (prev) sel.value = prev;
    loadGivenCardsByStudent();
  } else {
    loadRecentGivenCards();
  }
};

async function loadRecentGivenCards() {
  const listEl = document.getElementById('givenCardsList');
  listEl.innerHTML = '<div style="text-align:center;padding:24px;color:var(--text-muted);">불러오는 중...</div>';
  try {
    const snap = await getDocs(query(
      collection(db, 'givenCards'),
      orderBy('givenAt', 'desc'),
      limit(20)
    ));
    const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (!items.length) {
      listEl.innerHTML = '<div class="empty-state"><div class="empty-icon">📋</div><h3>부여 내역이 없어요</h3></div>';
      return;
    }
    listEl.innerHTML = items.map(renderGivenCardRow).join('');
  } catch(e) { listEl.innerHTML = `<div style="color:#ef4444;padding:16px;">오류: ${e.message}</div>`; }
}

window.loadGivenCardsByStudent = async function() {
  const listEl = document.getElementById('givenCardsList');
  const summaryEl = document.getElementById('givenCardsStudentSummary');
  const studentId = document.getElementById('givenCardsStudentSelect').value;
  if (!studentId) {
    summaryEl.textContent = '';
    listEl.innerHTML = '<div class="empty-state"><div class="empty-icon">👆</div><h3>학생을 선택해주세요</h3></div>';
    return;
  }
  listEl.innerHTML = '<div style="text-align:center;padding:24px;color:var(--text-muted);">불러오는 중...</div>';
  try {
    // 한 가지 조건(studentId)만 쓰므로 별도 인덱스 불필요 → 최신순 정렬은 여기서 처리
    const snap = await getDocs(query(collection(db, 'givenCards'), where('studentId', '==', studentId)));
    const items = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a,b) => ((b.givenAt||b.createdAt)?.seconds||0) - ((a.givenAt||a.createdAt)?.seconds||0));
    if (!items.length) {
      summaryEl.textContent = '';
      listEl.innerHTML = '<div class="empty-state"><div class="empty-icon">📋</div><h3>받은 카드가 없어요</h3></div>';
      return;
    }
    let praise = 0, penalty = 0, net = 0;
    items.forEach(it => {
      const delta = (it.delta !== undefined && it.delta !== null && !isNaN(it.delta))
        ? it.delta
        : ((it.cardType||it.type) === 'praise' ? (it.cost||it.point||0) : -(it.cost||it.point||0));
      if ((it.cardType||it.type) === 'penalty' || delta < 0) penalty++; else praise++;
      net += delta;
    });
    summaryEl.innerHTML = `총 <strong>${items.length}</strong>장 · 💓 칭찬 <strong>${praise}</strong> · ⚠️ 벌점 <strong>${penalty}</strong> · 포인트 합계 <strong style="color:${net>=0?'#16a34a':'#ef4444'};">${net>=0?'+':''}${net}🪙</strong>`;
    listEl.innerHTML = items.map(renderGivenCardRow).join('');
  } catch(e) { listEl.innerHTML = `<div style="color:#ef4444;padding:16px;">오류: ${e.message}</div>`; }
};

window.reclaimGivenCard = async function(givenCardId) {
  if (!confirm('이 카드 부여를 회수할까요?\n포인트와 능력치가 즉시 복구됩니다.')) return;
  try {
    const docRef = doc(db, 'givenCards', givenCardId);
    const fresh = await getDoc(docRef);
    if (!fresh.exists()) return showToast('이미 삭제된 내역이에요');
    const item = fresh.data();
    const studentRef = doc(db, 'students', item.studentId);
    // 포인트 역산
    const update = {
      points: increment(-item.delta),
      accumulatedPoints: increment(-item.delta)
    };
    // 능력치 역산
    if (item.abilities) {
      for (const [k, v] of Object.entries(item.abilities)) {
        const amt = item.delta > 0 ? -v : v; // 칭찬카드면 뺌, 벌점카드면 돌려줌
        update[`abilities.${k}`] = increment(amt);
      }
    }
    await updateDoc(studentRef, update);
    // history 기록
    await addDoc(collection(db, 'history'), {
      studentId: item.studentId, studentName: item.studentName,
      delta: -item.delta,
      reason: `카드 회수: ${item.cardTitle}`,
      type: item.delta > 0 ? 'minus' : 'plus',
      source: 'cardReclaim',
      createdAt: serverTimestamp()
    });
    // givenCards 문서 삭제
    await deleteDoc(docRef);
    showToast(`${item.studentName}의 '${item.cardTitle}' 회수 완료 💨`);
    await reloadStudents();
    // 목록 새로고침 (보고 있던 탭 유지)
    switchGivenCardsTab(window._givenCardsTab || 'recent');
  } catch(e) { showToast('오류: ' + e.message); }
};

window.switchUnifiedCardTab = function(type, btn) {
  document.getElementById('cardTabPraise').className = 'tab-btn' + (type==='praise'?' active':'');
  document.getElementById('cardTabPenalty').className = 'tab-btn' + (type==='penalty'?' active':'');
  document.getElementById('cardTabPraisePanel').style.display = type==='praise'?'':'none';
  document.getElementById('cardTabPenaltyPanel').style.display = type==='penalty'?'':'none';
};

export async function renderCardsPage() {
  const isTeacher = state.currentUser?.role === 'teacher';
  const btns = document.getElementById('cardTeacherBtns');
  if (btns) btns.style.display = isTeacher ? 'flex' : 'none';
  await reloadPraiseCards();
  renderUnifiedCardList('praise', isTeacher);
  renderUnifiedCardList('penalty', isTeacher);
}

function renderUnifiedCardList(type, isTeacher) {
  const listId = type==='praise' ? 'cardPraiseList' : 'cardPenaltyList';
  const list = document.getElementById(listId);
  if (!list) return;
  const filtered = praiseCards.filter(c=>c.type===type).sort((a,b)=>(a.category||'기타').localeCompare(b.category||'기타','ko')||(a.title||'').localeCompare(b.title||'','ko'));
  list.innerHTML = filtered.length ? filtered.map(c=>`
    <div class="praise-card-box type-${c.type}">
      <div class="praise-card-box-icon">${c.emoji||(c.type==='praise'?'💓':'⚠️')}</div>
      <div class="praise-card-box-title">${c.title}</div>
      <div class="praise-card-box-desc">${c.desc||c.category||'설명 없음'}</div>
      <div class="praise-card-box-point ${c.type==='praise'?'plus':'minus'}">${c.type==='praise'?'+':'-'}${c.point}🪙</div>
      ${makeAbilityTags(c.abilities,c.type==='penalty')}
      ${isTeacher ? `<div style="display:flex;gap:12px;margin-top:8px;justify-content:center;font-size:12px;">
        <span onclick="openEditCard('${c.id}')" style="color:var(--primary);cursor:pointer;">수정</span>
        <span onclick="deleteCard('${c.id}','${c.title}')" style="color:#ef4444;cursor:pointer;">삭제</span>
        <span onclick="openGiveCardModal('${c.id}')" style="color:#16a34a;cursor:pointer;font-weight:600;">부여</span>
      </div>` : ''}
    </div>`).join('')
  : `<div class="empty-state" style="padding:40px;"><div class="empty-icon">${type==='praise'?'💓':'⚠️'}</div><h3>${type==='praise'?'칭찬 카드':'벌점 카드'}가 없어요</h3></div>`;
}

// ===== 카드 회수 목록 =====
async function renderRevokeList() {
  const list = document.getElementById('revokeCardList');
  if (!list) return;
  list.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted);">불러오는 중...</div>';
  try {
    const snap = await getDocs(query(collection(db, 'givenCards'), orderBy('givenAt', 'desc'), limit(20)));
    const cards = snap.docs.map(d => ({ giveId: d.id, ...d.data() }));
    if (!cards.length) {
      list.innerHTML = '<div class="empty-state" style="padding:40px;"><div class="empty-icon">🔄</div><h3>부여한 카드가 없어요</h3></div>';
      return;
    }
    list.innerHTML = cards.map(c => `
      <div class="praise-card-item" id="revoke-${c.giveId}">
        <div class="praise-card-icon">${c.cardEmoji || ((c.cardType||c.type)==='praise'?'💓':'⚠️')}</div>
        <div class="praise-card-info">
          <div class="praise-card-title">${c.studentName} · ${c.cardTitle}</div>
          <div class="praise-card-desc">${(c.cardType||c.type)==='praise'?'💓 칭찬':'⚠️ 벌점'} · ${formatTime(c.givenAt)}${c.memo?' · '+c.memo:''}</div>
        </div>
        <div class="praise-card-point ${(c.cardType||c.type)==='praise'?'plus':'minus'}">
          ${(()=>{const d=(c.delta!=null&&!isNaN(c.delta))?c.delta:((c.cardType||c.type)==='praise'?(c.cost||c.point||0):-(c.cost||c.point||0));return (d>0?'+':'')+d;})()}🪙${c.abilities && Object.keys(c.abilities).length ? ' · <span style="font-size:11px;font-weight:500;">' + Object.entries(c.abilities).map(([k,v])=>`${k}${c.delta>0?'+':'-'}${v}`).join(' ') + '</span>' : ''}
        </div>
        <button class="btn btn-danger btn-sm" onclick="revokeCardFromList('${c.giveId}','${c.studentId}',${c.delta},'${c.studentName}','revoke-${c.giveId}')">회수</button>
      </div>
    `).join('');
  } catch(e) {
    list.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted);">불러오기 실패</div>';
    console.error(e);
  }
}

window.revokeCardFromList = async function(giveId, studentId, delta, studentName, elId) {
  if (!confirm(`'${studentName}'에게 부여한 카드를 회수할까요? 포인트와 능력치도 원상복구됩니다.`)) return;
  // 디졸브 효과
  const el = document.getElementById(elId);
  if (el) {
    el.classList.add('dissolve-out');
    await new Promise(r => setTimeout(r, 400));
  }
  try {
    // givenCards에서 abilities 가져오기
    const cardDoc = await getDoc(doc(db, 'givenCards', giveId));
    const cardData = cardDoc.exists() ? cardDoc.data() : {};
    const abilities = cardData.abilities || {};

    // 능력치 역적용
    const abilityRestore = {};
    Object.entries(abilities).forEach(([k, v]) => {
      abilityRestore[`abilities.${k}`] = increment(delta > 0 ? -v : v);
    });

    await deleteDoc(doc(db, 'givenCards', giveId));
    await updateDoc(doc(db, 'students', studentId), {
      points: increment(-delta),
      accumulatedPoints: increment(-delta),
      ...abilityRestore
    });
    const abMsg = Object.keys(abilities).length
      ? ' · ' + Object.entries(abilities).map(([k,v])=>`${k}${delta>0?'-':'+'}${v}`).join(', ')
      : '';
    await addDoc(collection(db, 'history'), {
      studentId, studentName, delta: -delta,
      reason: `카드 회수${abMsg}`, type: delta > 0 ? 'minus' : 'plus',
      source: 'revoke', createdAt: serverTimestamp()
    });
    showToast(`카드가 회수됐어요${abMsg}`);
    await reloadStudents();
    renderRevokeList();
  } catch(e) { showToast('오류: ' + e.message); }
};
