// shop.js — 보상 상점·보상 관리·할인·재고 현황
import { state } from './state.js?v=20261111a';
import {
  addDoc, collection, db, doc, getDoc, getDocs, increment, query, serverTimestamp, updateDoc,
  where
} from './firebase.js?v=20261111a';
import { closeModal, getMyStudentData, openModal, showToast } from './core.js?v=20261111a';
import { reloadRewards, reloadStudents } from './realtime.js?v=20261111a';
import { renderRewards } from './cards.js?v=20261111a';
import { loadBanner } from './home.js?v=20261111a';
import { renderCrowdfunding } from './crowdfunding.js?v=20261111a';

// 할인 미리보기
window.updateDiscountPreview = function() {
  const cost = parseInt(document.getElementById('rewardCost')?.value) || 0;
  const discount = parseInt(document.getElementById('rewardDiscount')?.value) || 0;
  const preview = document.getElementById('discountPreview');
  if (!preview) return;
  if (discount > 0 && cost > 0) {
    const discounted = Math.round(cost * (1 - discount/100));
    preview.textContent = '→ 학생 구매가: 🪙' + discounted.toLocaleString() + ' (' + discount + '%↓)';
  } else {
    preview.textContent = '';
  }
};
function getDiscountedCost(cost, discount) {
  if (!discount || discount <= 0) return cost;
  return Math.round(cost * (1 - discount/100));
}
export function discountHtml(cost, discount) {
  if (!discount || discount <= 0) return '🪙 ' + cost + ' <span style="font-size:12px;font-weight:400;color:var(--text-secondary)">포인트</span>';
  const discounted = getDiscountedCost(cost, discount);
  return '<span style="text-decoration:line-through;color:var(--text-muted);font-size:12px;">🪙' + cost + '</span>'
    + '<span style="color:#dc2626;font-weight:700;margin-left:4px;">🪙' + discounted.toLocaleString() + '</span>'
    + '<span style="color:#dc2626;font-size:11px;font-weight:700;margin-left:4px;">' + discount + '%↓</span>';
}

// ===== 드래그앤드롭 =====
let dragId = null;
window.dragStart = function(e, id) {
  dragId = id;
  e.target.classList.add('dragging');
};
window.dragEnd = function(e) {
  e.target.classList.remove('dragging');
  document.querySelectorAll('.reward-card').forEach(c => c.classList.remove('drag-over'));
};
window.dragOver = function(e) {
  e.preventDefault();
  const card = e.currentTarget;
  if (card.dataset && dragId && !card.classList.contains('dragging')) {
    card.classList.add('drag-over');
  }
};
window.dragLeave = function(e) {
  e.currentTarget.classList.remove('drag-over');
};
window.dragDrop = async function(e, targetId, category) {
  e.preventDefault();
  e.currentTarget.classList.remove('drag-over');
  if (!dragId || dragId === targetId) return;
  // 같은 카테고리 내 순서 재정렬
  const catRewards = state.rewards
    .filter(r => (r.category || 'study') === category)
    .sort((a, b) => (a.order || 0) - (b.order || 0));
  const dragIdx = catRewards.findIndex(r => r.id === dragId);
  const targetIdx = catRewards.findIndex(r => r.id === targetId);
  if (dragIdx === -1 || targetIdx === -1) return;
  const moved = catRewards.splice(dragIdx, 1)[0];
  catRewards.splice(targetIdx, 0, moved);
  // 순서 저장
  for (let i = 0; i < catRewards.length; i++) {
    await updateDoc(doc(db, 'rewards', catRewards[i].id), { order: i });
  }
  dragId = null;
  await reloadRewards();
  renderRewards();
};

export async function renderShopPage() {
  const isTeacher = state.currentUser?.role === 'teacher';
  const btns = document.getElementById('shopTeacherBtns');
  const goldEl = document.getElementById('shopStudentGold');
  const goldAmountEl = document.getElementById('shopGoldAmount');
  if (btns) btns.style.display = isTeacher ? 'flex' : 'none';
  if (goldEl) goldEl.style.display = isTeacher ? 'none' : 'block';
  if (!isTeacher && goldAmountEl) {
    const me = state.students.find(s => s.id === state.currentUser.uid);
    goldAmountEl.textContent = (me?.points || 0).toLocaleString();
  }
  if (isTeacher) {
    // 교사: 항상 최신 데이터로 갱신
    window._cachedRewards = null;
    await reloadRewards();
    ['rewardList-study','rewardList-snack','rewardList-stationery'].forEach(id=>{ const el=document.getElementById(id); if(el) el.style.display=''; });
    ['shopList-study','shopList-snack','shopList-stationery'].forEach(id=>{ const el=document.getElementById(id); if(el) el.style.display='none'; });
    renderRewards();
  } else {
    // 학생: shopList-* 표시, rewardList-* 숨김
    ['rewardList-study','rewardList-snack','rewardList-stationery'].forEach(id=>{ const el=document.getElementById(id); if(el) el.style.display='none'; });
    ['shopList-study','shopList-snack','shopList-stationery'].forEach(id=>{ const el=document.getElementById(id); if(el) el.style.display=''; });
    await renderRewardShop();
  }
  // 크라우드펀딩은 교사/학생 모두 렌더
  renderCrowdfunding();
}

// ===== 학생: 보상 상점 =====
async function renderRewardShop() {
  // 항상 최신 보상 데이터 로드
  window._cachedRewards = null;
  const _rs = await getDocs(collection(db, 'rewards'));
  window._cachedRewards = _rs.docs.map(d => ({id:d.id,...d.data()}));
  const shopRewards = window._cachedRewards.slice();

  // students가 비어있으면 재로드
  if (!state.students.length) await reloadStudents();
  const _meFrame = state.students.find(s => s.id === state.currentUser.uid) || {};
  const myPts = _meFrame.points || 0;

  // 내 구매 이력 (pending+approved) 집계 - 일반 보상(study/snack/stationery)만
  const myExSnap = await getDocs(query(
    collection(db, 'exchanges'),
    where('studentId', '==', state.currentUser.uid)
  ));
  const myCountMap = {};
  myExSnap.docs.forEach(d => {
    const ex = d.data();
    // rewardId가 있고, 일반 보상 카테고리이며, pending/approved인 것만 집계
    if (!ex.rewardId) return;
    if (['frame','avatar','pet'].includes(ex.type||ex.rewardCategory)) return;
    if (['pending','approved'].includes(ex.status)) {
      myCountMap[ex.rewardId] = (myCountMap[ex.rewardId]||0) + 1;
    }
  });

  const cats = ['study', 'snack', 'stationery'];
  cats.forEach(cat => {
    const list = document.getElementById(`shopList-${cat}`);
    if (!list) return;
    const catRewards = shopRewards
      .filter(r => (r.category || 'study') === cat)
      .sort((a, b) => (a.order || 0) - (b.order || 0));
    list.innerHTML = catRewards.length
      ? catRewards.map(r => {
          const myCount = myCountMap[r.id] || 0;
          const hasLimit = r.limit !== null && r.limit !== undefined;
          const limitReached = hasLimit && myCount >= r.limit;
          const outOfStock = r.stock !== null && r.stock !== undefined && r.stock <= 0;
          const blocked = limitReached || outOfStock;
          const finalCost = getDiscountedCost(r.cost, r.discount||0);
          const canBuy = myPts >= finalCost && !blocked;
          return `
          <div class="reward-card" style="cursor:default;${r.tagSoldOut?'background:#f3f4f6;border-color:#d1d5db;filter:grayscale(1);opacity:0.75;':(r.discount||0)>0?'background:linear-gradient(135deg,#fff0f3,#ffd6e0);border-color:#f9a8c9;':''}">
            <div class="reward-icon">${r.emoji||'🎁'}</div>
            <div class="reward-info">
              <div class="reward-name" style="display:flex;align-items:center;gap:5px;">
                ${r.name}
                ${r.tagNew?'<span class="item-tag-new">New!</span>':''}
                ${r.tagHot?'<span class="item-tag-hot">Hot!</span>':''}
                ${(r.tagSoldOut||outOfStock)?'<span class="item-tag-soldout">Sold Out</span>':''}
              </div>
              <div class="reward-cost">${discountHtml(r.cost,r.discount)}
                ${(r.stock !== null && r.stock !== undefined) ? `<span style="font-size:12px;font-weight:600;color:var(--text-secondary);margin-left:8px;">🛒재고 ${r.stock}개</span>` : ''}
                ${hasLimit ? `<span style="font-size:12px;font-weight:600;color:${limitReached?'#ef4444':'var(--text-secondary)'};margin-left:8px;">👤${myCount}/${r.limit}</span>` : ''}
              </div>
            </div>
            <button class="btn ${(canBuy&&!blocked)?'btn-primary':'btn-secondary'} btn-sm"
              ${(!canBuy||blocked)?'disabled style="opacity:0.5;cursor:not-allowed"':''}
              onclick="openExchangeModal('${r.id}','${r.name}','${r.emoji||'🎁'}',${finalCost},${myPts},'${r.category||'study'}')" >
              ${outOfStock?'품절':limitReached?'한도초과':canBuy?'신청':'부족'}
            </button>
          </div>`;
        }).join('')
      : `<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:13px;">아직 보상이 없어요</div>`;
  });
}

window.openExchangeModal = function(id, name, emoji, cost, myPts, category) {
  state.pendingExchangeId = { id, name, emoji, cost, category: category || 'study' };
  document.getElementById('exchangeModalSubtitle').innerHTML = `<strong>${emoji} ${name}</strong>을(를) 교환할까요?<br><br>필요 포인트: 🪙 ${cost}<br>내 포인트: 🪙 ${myPts}`;
  openModal('exchangeModal');
};

window.doExchange = async function() {
  const { id, name, emoji, cost, category: rewardCategory } = state.pendingExchangeId;
  try {
    const _ms = getMyStudentData();
    const sDoc = { exists: () => Object.keys(_ms).length > 0, data: () => _ms };
    const myPts = sDoc.data().points || 0;
    if (myPts < cost) return showToast('포인트가 부족해요');

    // 재고 & 제한 Firestore에서 최신값으로 확인
    const rewardDoc = await getDoc(doc(db, 'rewards', id));
    if (rewardDoc.exists()) {
      const rData = rewardDoc.data();

      // 1인 구매 제한 확인 (재고 차감 전에 먼저!)
      const limit = rData.limit;
      if (limit !== null && limit !== undefined) {
        // studentId만으로 쿼리 후 클라이언트에서 rewardId 필터 (인덱스 불필요)
        const myExSnap = await getDocs(query(
          collection(db, 'exchanges'),
          where('studentId', '==', state.currentUser.uid)
        ));
        const myCount = myExSnap.docs.filter(d => {
          const ex = d.data();
          return ex.rewardId === id && ['pending','approved'].includes(ex.status);
        }).length;
        if (myCount >= limit) {
          return showToast(`이 상품은 1인당 최대 ${limit}개까지만 구매할 수 있어요 🚫`);
        }
      }

      // 재고 확인 및 차감
      const stock = rData.stock;
      if (stock !== null && stock !== undefined) {
        if (stock <= 0) return showToast('재고가 부족해요 😢');
        const newStock = stock - 1;
        const stockUpdate = { stock: increment(-1) };
        if (newStock === 0) stockUpdate.tagSoldOut = true; // 재고 0이면 자동 Sold Out
        await updateDoc(doc(db, 'rewards', id), stockUpdate);
        window._cachedRewards = null;
      }
    }

    // 신청 즉시 포인트 차감
    await updateDoc(doc(db, 'students', state.currentUser.uid), { points: increment(-cost) });
    await addDoc(collection(db, 'exchanges'), {
      studentId: state.currentUser.uid, studentName: state.currentUser.name,
      rewardId: id, rewardName: name, rewardEmoji: emoji, rewardCost: cost,
      rewardCategory: rewardCategory || 'study',
      status: 'pending', createdAt: serverTimestamp()
    });
    await addDoc(collection(db, 'history'), {
      studentId: state.currentUser.uid, studentName: state.currentUser.name,
      delta: -cost, reason: name, type: 'minus',
      source: 'exchange_request', createdAt: serverTimestamp()
    });
    closeModal('exchangeModal');
    showToast('교환 신청을 보냈어요! 선생님 승인을 기다려주세요 🎁');
    await reloadStudents();
    window._cachedRewards = null; // 재고 캐시 무효화
    loadBanner(false);
    renderRewardShop();
  } catch(e) { showToast('오류: ' + e.message); }
};

// ===== 🛒 보상 재고 현황 모달 (교사) =====
window.openRewardStockModal = async function(rewardId) {
  const r = state.rewards.find(x => x.id === rewardId);
  if (!r) return;

  document.getElementById('rewardStockModalTitle').textContent = `${r.emoji||'🎁'} ${r.name}`;
  document.getElementById('rewardStockModalSubtitle').innerHTML =
    `${discountHtml(r.cost, r.discount)} ${r.stock != null ? `· 남은 재고 ${r.stock}개` : ''}`;
  document.getElementById('rewardStockContent').innerHTML =
    '<div style="text-align:center;padding:20px;color:var(--text-muted);">불러오는 중...</div>';
  openModal('rewardStockModal');

  // 해당 보상의 exchanges 조회
  const snap = await getDocs(query(
    collection(db, 'exchanges'),
    where('rewardId', '==', rewardId)
  ));

  // 학생별 집계
  const studentMap = {};
  snap.docs.forEach(d => {
    const ex = d.data();
    const sid = ex.studentId;
    if (!sid) return;
    if (!studentMap[sid]) {
      studentMap[sid] = { name: ex.studentName || '', pending: 0, approved: 0, used: 0 };
    }
    if (ex.status === 'pending') studentMap[sid].pending++;
    else if (ex.status === 'approved') studentMap[sid].approved++;
    else if (ex.status === 'used') studentMap[sid].used++;
  });

  // 학생 번호순 정렬
  const rows = Object.entries(studentMap)
    .map(([sid, d]) => {
      const s = state.students.find(x => x.id === sid);
      return { sid, name: d.name, number: s?.number || 0, ...d };
    })
    .sort((a, b) => a.number - b.number);

  if (!rows.length) {
    document.getElementById('rewardStockContent').innerHTML =
      '<div style="text-align:center;padding:30px;color:var(--text-muted);">아직 구매한 학생이 없어요</div>';
    return;
  }

  // 합계
  const totPending = rows.reduce((s, r) => s + r.pending, 0);
  const totApproved = rows.reduce((s, r) => s + r.approved, 0);
  const totUsed = rows.reduce((s, r) => s + r.used, 0);

  document.getElementById('rewardStockContent').innerHTML = `
    <!-- 요약 -->
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:16px;">
      <div style="background:#fef9c3;border-radius:8px;padding:10px;text-align:center;">
        <div style="font-size:10px;color:#a16207;font-weight:600;">승인 대기</div>
        <div style="font-size:18px;font-weight:800;color:#a16207;">${totPending}개</div>
      </div>
      <div style="background:#dbeafe;border-radius:8px;padding:10px;text-align:center;">
        <div style="font-size:10px;color:#1d4ed8;font-weight:600;">미사용 보유</div>
        <div style="font-size:18px;font-weight:800;color:#1d4ed8;">${totApproved}개</div>
      </div>
      <div style="background:#dcfce7;border-radius:8px;padding:10px;text-align:center;">
        <div style="font-size:10px;color:#15803d;font-weight:600;">사용 완료</div>
        <div style="font-size:18px;font-weight:800;color:#15803d;">${totUsed}개</div>
      </div>
    </div>
    <!-- 학생별 명단 -->
    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      <thead>
        <tr style="background:var(--bg);">
          <th style="padding:8px;text-align:left;border-bottom:1px solid var(--border);">학생</th>
          <th style="padding:8px;text-align:center;border-bottom:1px solid var(--border);color:#a16207;">대기</th>
          <th style="padding:8px;text-align:center;border-bottom:1px solid var(--border);color:#1d4ed8;">미사용</th>
          <th style="padding:8px;text-align:center;border-bottom:1px solid var(--border);color:#15803d;">사용</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(r => `
        <tr style="border-bottom:1px solid var(--border);${r.approved>0?'font-weight:600;':''}">
          <td style="padding:8px;">${r.number?r.number+'번 ':''}${r.name}</td>
          <td style="padding:8px;text-align:center;color:#a16207;">${r.pending>0?r.pending+'개':'-'}</td>
          <td style="padding:8px;text-align:center;color:#1d4ed8;">${r.approved>0?r.approved+'개':'-'}</td>
          <td style="padding:8px;text-align:center;color:#15803d;">${r.used>0?r.used+'개':'-'}</td>
        </tr>`).join('')}
      </tbody>
    </table>`;
};
window.recalcAllCardCounts = async function() {
  if (!confirm('전체 학생의 칭찬/벌점 카드 개수를 givenCards에서 새로 집계할까요?\n잠시 시간이 걸릴 수 있어요.')) return;
  showToast('재계산 중... 잠시 기다려주세요');

  // 전체 givenCards 로드
  const snap = await getDocs(collection(db, 'givenCards'));

  // studentId별 집계
  const countMap = {};
  snap.docs.forEach(d => {
    const data = d.data();
    const sid = data.studentId;
    if (!sid) return;
    if (!countMap[sid]) countMap[sid] = { praise: 0, penalty: 0, unknown: 0 };
    const t = data.cardType || data.type;
    if (t === 'praise') countMap[sid].praise++;
    else if (t === 'penalty') countMap[sid].penalty++;
    else countMap[sid].unknown++; // cardType/type 둘 다 없는 케이스
  });

  // 결과 로그
  console.log('=== 카드 카운트 재계산 결과 ===');
  let unknownTotal = 0;
  Object.entries(countMap).forEach(([sid, cnt]) => {
    const s = state.students.find(x=>x.id===sid);
    console.log(`${s?.name||sid}: 칭찬 ${cnt.praise}, 벌점 ${cnt.penalty}${cnt.unknown?`, 타입불명 ${cnt.unknown}`:''}`);
    unknownTotal += cnt.unknown;
  });
  if (unknownTotal > 0) {
    console.warn(`⚠️ cardType/type 필드가 없는 항목 ${unknownTotal}건 발견. Firestore에서 직접 확인 필요.`);
  }

  // givenCards에 cardType/type 둘 다 없는 항목 → source 기반으로 복구 시도
  let fixed = 0;
  for (const d of snap.docs) {
    const data = d.data();
    const t = data.cardType || data.type;
    if (!t) {
      // source 기반 추정
      let guessedType = null;
      if (data.source === 'praiseCard' || data.delta > 0) guessedType = 'praise';
      else if (data.source === 'penaltyCard' || data.delta < 0) guessedType = 'penalty';
      if (guessedType) {
        await updateDoc(doc(db, 'givenCards', d.id), { cardType: guessedType, type: guessedType });
        fixed++;
      }
    }
  }

  showToast(`✅ 재계산 완료! ${Object.keys(countMap).length}명 집계, ${fixed}건 타입 복구됨. 콘솔 확인하세요.`);
  console.log(`총 ${fixed}건 타입 필드 복구 완료`);
};
function updateToggleBtn(isCollapsed) {
  const btn = document.getElementById('sidebarToggleBtn');
  if (!btn) return;
  btn.textContent = isCollapsed ? '›' : '‹';
  btn.style.left = isCollapsed ? '60px' : '220px';
}

window.togglePCSidebar = function() {
  const sidebar = document.getElementById('sidebar');
  const menuTexts = sidebar.querySelectorAll('.menu-text, .sidebar-label, .sidebar-banner');

  if (!sidebar.classList.contains('collapsed')) {
    // 접기: 텍스트 즉시 숨기고 → 사이드바 축소
    menuTexts.forEach(el => { el.style.opacity = '0'; el.style.transition = 'none'; });
    sidebar.classList.add('collapsed');
    updateToggleBtn(true);
    localStorage.setItem('sidebarCollapsed', '1');
  } else {
    // 펼치기: 사이드바 먼저 확장 → transition 완료 후 텍스트 표시
    sidebar.classList.remove('collapsed');
    updateToggleBtn(false);
    localStorage.setItem('sidebarCollapsed', '0');
    setTimeout(() => {
      menuTexts.forEach(el => {
        el.style.transition = 'opacity 0.2s ease';
        el.style.opacity = '1';
      });
    }, 250);
  }
};

// 페이지 로드 시 사이드바 상태 복원
(function() {
  const saved = localStorage.getItem('sidebarCollapsed');
  if (saved === '1') {
    const sidebar = document.getElementById('sidebar');
    if (sidebar) {
      sidebar.classList.add('collapsed');
      // 텍스트도 즉시 숨기기
      sidebar.querySelectorAll('.menu-text, .sidebar-label, .sidebar-banner').forEach(el => {
        el.style.opacity = '0';
      });
    }
    setTimeout(() => updateToggleBtn(true), 0);
  }
})();
