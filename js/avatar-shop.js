// avatar-shop.js — 아바타 상점 (학생)
import { state } from './state.js?v=20261111d';
import {
  addDoc, collection, db, doc, getDocs, increment, query, serverTimestamp, updateDoc, where
} from './firebase.js?v=20261111d';
import { getMyStudentData, showToast } from './core.js?v=20261111d';
import { renderStudentHome } from './home.js?v=20261111d';
import {
  AVATAR_CATS, AVATAR_CAT_ICONS, AVATAR_MANNEQUIN, avatarInventory, avatarItemImg, avatarItemList,
  loadAvatarEquipped, loadAvatarInventory, loadAvatarItemList
} from './avatar.js?v=20261111d';
import { renderStudentSettings } from './profile.js?v=20261111d';
import { renderMyPoints } from './points.js?v=20261111d';

// ===================================================
// 학생: 아바타 상점 (레이어 미리보기 + 구매 시스템)
// ===================================================

// 레이어 순서: top(전신)이 최하단, 그 위에 hair/face/cap/shoe/weapon
export const AVATAR_LAYER_ORDER = ['face', 'hair', 'cap', 'top', 'shoe', 'weapon'];

// 레이어 미리보기 DOM 업데이트 (GIF 위에 PNG 레이어를 절대위치로 쌓음)
function updateAvatarLayerPreview() {
  const wrap = document.getElementById('avatarLayerWrap');
  if (!wrap) return;

  const layers = AVATAR_LAYER_ORDER
    .filter(cat => state.avatarPreviewEquip[cat])
    .map(cat => {
      const id = state.avatarPreviewEquip[cat];
      const item = avatarItemList.find(i => i.category === cat && i.itemId === id);
      const url = item?.layerUrl; // layerUrl만 레이어로 사용
      if (!url) return '';
      return `<img src="${url}"
        style="position:absolute;inset:0;width:100%;height:100%;object-fit:contain;image-rendering:pixelated;"
        onerror="this.style.display='none'" />`;
    }).join('');

  wrap.innerHTML = `
    <div style="position:relative;width:80px;height:100px;margin:0 auto;">
      <img src="${AVATAR_MANNEQUIN}"
        style="width:100%;height:100%;object-fit:contain;image-rendering:pixelated;display:block;position:relative;z-index:0;" />
      ${layers}
    </div>`;
}

// 미리보기 패널의 착용 목록 + 골드 잔고 업데이트
function updateAvatarPreviewPanel() {
  updateAvatarLayerPreview();

  // 착용 아이템 목록
  const listEl = document.getElementById('avatarEquippedList');
  if (listEl) {
    const entries = Object.entries(state.avatarPreviewEquip);
    if (!entries.length) {
      listEl.innerHTML = '<div style="color:var(--text-muted);font-size:11px;text-align:center;padding:4px 0;">착용 아이템 없음</div>';
    } else {
      listEl.innerHTML = entries.map(([cat, id]) => {
        const item = avatarItemList.find(i => i.category === cat && i.itemId === id);
        const owned = avatarInventory[cat]?.has(id);
        return `<div style="display:flex;align-items:center;justify-content:space-between;font-size:11px;padding:2px 0;">
          <span>${AVATAR_CAT_ICONS[cat]} ${item?.name || id}</span>
          ${!owned ? `<span style="color:#f59e0b;font-weight:700;">미구매</span>` : `<span style="color:#22c55e;">✓</span>`}
        </div>`;
      }).join('');
    }
  }

  // 구매 필요 아이템 합계 + 버튼
  const buyArea = document.getElementById('avatarBuyArea');
  if (buyArea) {
    const toBuy = Object.entries(state.avatarPreviewEquip)
      .map(([cat, id]) => avatarItemList.find(i => i.category === cat && i.itemId === id))
      .filter(i => i && !avatarInventory[i.category]?.has(i.itemId) && i.price > 0);
    if (!toBuy.length) {
      buyArea.innerHTML = '';
    } else {
      const total = toBuy.reduce((s, i) => s + i.price, 0);
      buyArea.innerHTML = `
        <div style="background:#fef3c7;border-radius:8px;padding:8px 10px;font-size:11px;margin-bottom:8px;border:1px solid #fcd34d;">
          <div style="font-weight:700;margin-bottom:4px;">🛒 미보유 ${toBuy.length}개</div>
          ${toBuy.map(i=>`<div style="color:var(--text-secondary);">• ${i.name} 🪙${i.price}</div>`).join('')}
          <div style="margin-top:6px;font-weight:700;font-size:12px;color:#b45309;">합계: 🪙${total.toLocaleString()}</div>
        </div>
        <button class="btn btn-primary btn-full" style="font-size:12px;padding:9px;" onclick="bulkBuyAvatar()">
          🛒 선택 아이템 구매 🪙${total.toLocaleString()}
        </button>`;
    }
  }
}

// 아이템 카드 스타일만 빠르게 업데이트 (전체 재렌더 없이)
function refreshAvatarItemCards() {
  document.querySelectorAll('[data-av-cat]').forEach(card => {
    const cat = card.dataset.avCat;
    const id = parseInt(card.dataset.avId);
    const owned = avatarInventory[cat]?.has(id);
    const equipped = state.avatarPreviewEquip[cat] === id;
    const img = card.querySelector('img.av-item-img');
    const badge = card.querySelector('.av-status-badge');
    const outerBorder = card.querySelector('.av-img-wrap');

    if (outerBorder) {
      outerBorder.style.borderColor = equipped ? '#6366f1' : (owned ? '#22c55e' : 'var(--border)');
      outerBorder.style.background   = equipped ? '#eef2ff' : (owned ? '#f0fdf4' : 'var(--bg)');
    }
    if (img) {
      img.style.filter = (!owned && !equipped) ? 'grayscale(55%) opacity(0.65)' : '';
    }
    if (badge) {
      if (equipped)      badge.textContent = '✓착용';
      else if (owned)    badge.textContent = '보유';
      else if (avatarItemList.find(i=>i.category===cat&&i.itemId===id)?.price===0) badge.textContent = '무료';
      else badge.textContent = `🪙${avatarItemList.find(i=>i.category===cat&&i.itemId===id)?.price||0}`;
      badge.style.color = equipped ? '#6366f1' : (owned ? '#22c55e' : 'var(--primary)');
    }
  });
}

export async function renderAvatarShop() {
  const wrap = document.getElementById('avatarShopWrap');
  if (!wrap) return;
  wrap.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-secondary);">아이템 불러오는 중...</div>';

  await loadAvatarItemList();
  await loadAvatarInventory();
  await loadAvatarEquipped();

  if (!avatarItemList.length) {
    wrap.innerHTML = '<div class="empty-state" style="padding:60px;"><div class="empty-icon">🧑</div><h3>아직 등록된 아이템이 없어요</h3><p>선생님이 아이템을 등록할 때까지 기다려주세요</p></div>';
    return;
  }

  // 현재 골드 + 신청 중인 아바타 아이템 조회
  let myGold = 0;
  const pendingAvatarKeys = new Set(); // "cat_itemId"
  try {
    const _myS = state.students.find(s => s.id === state.currentUser.uid);
    myGold = _myS?.points || 0;
    const exSnap = await getDocs(query(
      collection(db, 'exchanges'),
      where('studentId', '==', state.currentUser.uid),
      where('rewardCategory', '==', 'avatar'),
      where('status', '==', 'pending')
    ));
    exSnap.docs.forEach(d => {
      const ad = d.data().avatarData;
      if (ad) pendingAvatarKeys.add(`${ad.category}_${ad.itemId}`);
    });
  } catch(e) {}

  renderAvatarShopUI(myGold, pendingAvatarKeys);
}

function renderAvatarShopUI(myGold = 0, pendingAvatarKeys = new Set()) {
  const wrap = document.getElementById('avatarShopWrap');
  if (!wrap) return;

  const grouped = {};
  avatarItemList.forEach(item => {
    if (!grouped[item.category]) grouped[item.category] = [];
    grouped[item.category].push(item);
  });
  // 카테고리별 가격 오름차순, 같으면 가나다순
  Object.keys(grouped).forEach(cat => {
    grouped[cat].sort((a, b) => {
      if (a.price !== b.price) return a.price - b.price;
      return (a.name || '').localeCompare(b.name || '', 'ko');
    });
  });

  wrap.innerHTML = `
  <div style="display:grid;grid-template-columns:210px 1fr;gap:20px;align-items:start;">

    <!-- ── 왼쪽: 미리보기 패널 ── -->
    <div style="position:sticky;top:0;">
      <div style="background:linear-gradient(160deg,#e0e7ff 0%,#f0f4ff 100%);border-radius:var(--radius-lg);padding:18px 14px;border:1px solid var(--border);text-align:center;">

        <!-- 골드 잔고 -->
        <div style="background:rgba(255,255,255,0.7);border-radius:10px;padding:7px 10px;margin-bottom:12px;display:flex;align-items:center;justify-content:space-between;">

        </div>

        <!-- 캐릭터 미리보기 (레이어 합성) -->
        <div style="font-size:11px;color:var(--text-secondary);font-weight:600;margin-bottom:8px;">꾸미기 미리보기</div>
        <div style="background:rgba(255,255,255,0.85);border-radius:14px;padding:16px 12px;margin-bottom:12px;min-height:100px;display:flex;align-items:center;justify-content:center;border:1px solid rgba(99,102,241,0.15);">
          <div id="avatarLayerWrap"></div>
        </div>

        <!-- 착용 아이템 목록 -->
        <div id="avatarEquippedList" style="font-size:11px;text-align:left;min-height:20px;margin-bottom:10px;padding:0 2px;"></div>

        <!-- 구매 버튼 영역 -->
        <div id="avatarBuyArea"></div>

        <!-- 착용 저장 / 초기화 -->
        <button class="btn btn-success btn-full" style="font-size:12px;padding:9px;margin-top:6px;" onclick="saveAvatarEquipToDB()">
          💾 착용 저장
        </button>
        <button class="btn btn-secondary btn-full" style="font-size:11px;padding:7px;margin-top:6px;" onclick="resetAvatarPreview()">
          🔄 미리보기 초기화
        </button>
      </div>
    </div>

    <!-- ── 오른쪽: 아이템 목록 ── -->
    <div style="display:flex;flex-direction:column;gap:16px;">
      ${Object.keys(AVATAR_CATS).filter(cat => grouped[cat]).map(cat => {
        const items = grouped[cat];
        return `
        <div style="background:var(--surface);border-radius:var(--radius-lg);border:1px solid var(--border);padding:16px;">
          <div style="font-size:16px;font-weight:700;margin-bottom:12px;display:flex;align-items:center;gap:6px;">
            <span>${AVATAR_CAT_ICONS[cat]}</span>
            <span>${AVATAR_CATS[cat]}</span>
            <span style="font-size:13px;color:var(--text-muted);font-weight:400;margin-left:4px;">${items.length}종</span>
          </div>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(90px,1fr));gap:10px;">
            ${items.map(item => {
              const owned = avatarInventory[cat]?.has(item.itemId);
              const equipped = state.avatarPreviewEquip[cat] === item.itemId;
              const isFree = item.price === 0;
              return `
              <div data-av-cat="${cat}" data-av-id="${item.itemId}"
                style="text-align:center;cursor:pointer;"
                onclick="toggleAvatarPreview('${cat}',${item.itemId})">

                <!-- 이미지 박스: 상단(태그 20px) + 하단(썸네일 100px) -->
                <div class="av-img-wrap" style="border-radius:10px;border:2px solid ${equipped?'#6366f1':owned?'#22c55e':'var(--border)'};
                  background:${equipped?'#eef2ff':owned?'#f0fdf4':'var(--bg)'};
                  padding:4px;transition:all 0.15s;margin-bottom:4px;overflow:hidden;">
                  <!-- 상단: 태그/ON/🔒 영역 (20px) -->
                  <div style="height:20px;display:flex;align-items:center;justify-content:space-between;padding:0 2px;margin-bottom:2px;">
                    <div style="flex:1;display:flex;justify-content:flex-start;">
                      ${equipped ? `<span style="font-size:9px;background:#6366f1;color:#fff;border-radius:4px;padding:1px 5px;line-height:1.6;font-weight:700;">ON</span>` : '<span></span>'}
                    </div>
                    <div style="flex:1;display:flex;justify-content:center;">
                      ${item.tagNew ? `<span class="av-top-tag new" style="position:static;transform:none;font-size:9px;">New!</span>` : item.tagHot ? `<span class="av-top-tag hot" style="position:static;transform:none;font-size:9px;">Hot!</span>` : ''}
                    </div>
                    <div style="flex:1;display:flex;justify-content:flex-end;">
                      ${(!owned && !isFree) ? `<span style="font-size:12px;">🔒</span>` : '<span></span>'}
                    </div>
                  </div>
                  <!-- 하단: 썸네일 이미지 (100px) -->
                  <img src="${item.thumb || avatarItemImg(cat, item.itemId)}"
                    class="av-item-img"
                    style="width:80px;height:100px;object-fit:contain;image-rendering:pixelated;display:block;margin:0 auto;
                      ${(!owned&&!equipped)?'filter:grayscale(55%) opacity(0.65);':''}"
                    onerror="this.style.display='none'" />
                </div>

                <!-- 아이템명 -->
                <div style="font-size:12px;color:var(--text-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:0 2px;">${item.name}</div>
                <!-- 상태 배지 -->
                <div class="av-status-badge" style="font-size:12px;font-weight:700;color:${equipped?'#6366f1':owned?'#22c55e':'var(--primary)'};">
                  ${equipped?'✓착용':owned?'보유':isFree?'무료':`🪙${item.price}`}
                </div>

                <!-- 개별 구매 버튼 (미보유 유료 아이템에만 표시) -->
                ${(!owned && !isFree) ? (() => {
                  const isPending = pendingAvatarKeys.has(`${cat}_${item.itemId}`);
                  return `<button
                    onclick="event.stopPropagation();buyAvatarItemById(this)"
                    data-avatar-buy="${cat}_${item.itemId}"
                    data-cat="${cat}"
                    data-id="${item.itemId}"
                    data-price="${item.price}"
                    data-ext="${item.ext||'png'}"
                    class="btn btn-primary btn-sm"
                    style="width:100%;font-size:12px;padding:6px 4px;margin-top:4px;border-radius:6px;text-align:center;display:block;box-sizing:border-box;line-height:1.4;${isPending?'background:var(--text-muted);cursor:default;':''}"
                    ${isPending ? 'disabled' : ''}>
                    ${isPending ? '⏳ 신청 중' : '구매'}
                  </button>`;
                })() : ''}
              </div>`;
            }).join('')}
          </div>
        </div>`;
      }).join('')}
    </div>
  </div>`;

  updateAvatarPreviewPanel();
}

// 아이템 클릭 → 미리보기 토글 (전체 재렌더 없이 빠르게)
window.toggleAvatarPreview = function(cat, itemId) {
  if (state.avatarPreviewEquip[cat] === itemId) {
    delete state.avatarPreviewEquip[cat];
  } else {
    state.avatarPreviewEquip[cat] = itemId;
  }
  updateAvatarPreviewPanel();
  refreshAvatarItemCards();
};

// 개별 아이템 구매
// 버튼 data 속성에서 아이템 정보 읽어 구매 처리 (이름 특수문자 문제 우회)
window.buyAvatarItemById = function(btn) {
  const cat   = btn.dataset.cat;
  const id    = parseInt(btn.dataset.id);
  const price = parseInt(btn.dataset.price);
  const ext   = btn.dataset.ext || 'png';
  const item  = avatarItemList.find(i => i.category === cat && i.itemId === id);
  const name  = item?.name || `아이템 ${id}`;
  buyAvatarItem(cat, id, name, price, ext);
};

// 개별 아이템 구매 → 교환 신청 방식
window.buyAvatarItem = async function(cat, itemId, name, price, ext) {
  const myGold = getMyStudentData().points || 0;
  if (myGold < price) return showToast(`골드가 부족해요 (보유: 🪙${myGold.toLocaleString()}, 필요: 🪙${price})`);
  if (!confirm(`'${name}'을(를) 🪙${price}에 구매 신청할까요?\n선생님 승인 후 보관함에 들어옵니다.`)) return;
  try {
    // 골드 즉시 차감
    await updateDoc(doc(db, 'students', state.currentUser.uid), { points: increment(-price) });
    // 포인트 내역 기록
    await addDoc(collection(db, 'history'), {
      studentId: state.currentUser.uid, studentName: state.currentUser.name,
      delta: -price, reason: `아바타 구매 신청: ${name}`, type: 'minus',
      source: 'avatar_request', createdAt: serverTimestamp()
    });
    // 교환 신청 생성
    await addDoc(collection(db, 'exchanges'), {
      studentId: state.currentUser.uid, studentName: state.currentUser.name,
      rewardName: name, rewardEmoji: '🧑',
      rewardCategory: 'avatar', rewardCost: price,
      avatarData: { category: cat, itemId, name, ext: ext || 'png' },
      status: 'pending', createdAt: serverTimestamp()
    });
    // 골드 표시 즉시 갱신
    const newGold = myGold - price;
    const goldEl = document.getElementById('avatarMyGold');
    if (goldEl) goldEl.textContent = `🪙 ${newGold.toLocaleString()}`;
    showToast(`'${name}' 구매 신청 완료! 선생님 승인을 기다려요 🧑`);
    // 버튼 즉시 "신청 중"으로 변경
    const btn = document.querySelector(`button[data-avatar-buy="${cat}_${itemId}"]`);
    if (btn) {
      btn.textContent = '⏳ 신청 중';
      btn.disabled = true;
      btn.style.cssText += ';background:var(--text-muted);cursor:default;';
    }
  } catch(e) { showToast('오류: ' + e.message); }
};

// 일괄 구매 (미리보기에 올려놓은 미보유 유료 아이템 전부)
window.bulkBuyAvatar = async function() {
  const toBuy = Object.entries(state.avatarPreviewEquip)
    .map(([cat, id]) => avatarItemList.find(i => i.category === cat && i.itemId === id))
    .filter(i => i && !avatarInventory[i.category]?.has(i.itemId) && i.price > 0);
  if (!toBuy.length) return showToast('구매할 아이템이 없어요');
  const total = toBuy.reduce((s, i) => s + i.price, 0);
  const _ms = getMyStudentData();
  const sDoc = { exists: () => Object.keys(_ms).length > 0, data: () => _ms };
  const myGold = sDoc.exists() ? (sDoc.data().points || 0) : 0;
  if (myGold < total) return showToast(`골드 부족! (보유: 🪙${myGold.toLocaleString()}, 필요: 🪙${total.toLocaleString()})`);
  if (!confirm(`총 ${toBuy.length}개 아이템을 🪙${total.toLocaleString()}에 구매 신청할까요?\n선생님 승인 후 보관함에 들어옵니다.`)) return;

  try {
    // 골드 즉시 차감
    await updateDoc(doc(db, 'students', state.currentUser.uid), { points: increment(-total) });
    // 포인트 내역 기록
    await addDoc(collection(db, 'history'), {
      studentId: state.currentUser.uid, studentName: state.currentUser.name,
      delta: -total, reason: `아바타 ${toBuy.length}개 구매 신청`, type: 'minus',
      source: 'avatar_request', createdAt: serverTimestamp()
    });
    // 아이템별 교환 신청 생성
    for (const item of toBuy) {
      await addDoc(collection(db, 'exchanges'), {
        studentId: state.currentUser.uid, studentName: state.currentUser.name,
        rewardName: item.name, rewardEmoji: '🧑',
        rewardCategory: 'avatar', rewardCost: item.price,
        avatarData: { category: item.category, itemId: item.itemId, name: item.name, ext: item.ext || 'png' },
        status: 'pending', createdAt: serverTimestamp()
      });
    }
    // 골드 표시 갱신
    const newGold = myGold - total;
    const goldEl = document.getElementById('avatarMyGold');
    if (goldEl) goldEl.textContent = `🪙 ${newGold.toLocaleString()}`;
    showToast(`${toBuy.length}개 구매 신청 완료! 선생님 승인을 기다려요 🧑`);
    updateAvatarPreviewPanel();
    refreshAvatarItemCards();
  } catch(e) { showToast('오류: ' + e.message); }
};

window.saveAvatarEquipToDB = async function() {
  const unowned = Object.entries(state.avatarPreviewEquip)
    .filter(([cat, id]) => !avatarInventory[cat]?.has(id));
  if (unowned.length > 0) {
    return showToast('미보유 아이템은 착용 저장이 안 돼요. 먼저 구매해 주세요! 🛒');
  }
  try {
    const eq = { ...state.avatarPreviewEquip };
    // ext 메타 정보 구성
    const meta = {};
    Object.entries(eq).forEach(([cat, id]) => {
      const item = avatarItemList.find(i => i.category === cat && i.itemId === id);
      if (item?.ext) meta[cat] = { ext: item.ext };
    });
    await updateDoc(doc(db, 'students', state.currentUser.uid), {
      avatarEquipped: eq,
      avatarEquippedMeta: meta
    });
    // 전역 변수 갱신
    state.avatarEquipped     = { ...eq };
    state.avatarEquippedMeta = { ...meta };
    state.avatarPreviewEquip = { ...eq };
    // students 캐시 즉시 갱신
    const meIdx = state.students.findIndex(s => s.id === state.currentUser.uid);
    if (meIdx >= 0) {
      state.students[meIdx] = { ...state.students[meIdx], avatarEquipped: { ...eq }, avatarEquippedMeta: { ...meta } };
    }
    showToast('아바타가 저장됐어요 🧑 ✅');
    // 현재 열린 페이지 즉시 재렌더
    const active = document.querySelector('section[id^="page-"]:not(.hidden)');
    if (active) {
      const page = active.id.replace('page-', '');
      if (page === 'studentHome') renderStudentHome();
      else if (page === 'myPoints') renderMyPoints();
      else if (page === 'studentSettings') renderStudentSettings();
    }
  } catch(e) { showToast('오류: ' + e.message); }
};

window.resetAvatarPreview = function() {
  state.avatarPreviewEquip = { ...state.avatarEquipped }; // 저장된 상태로 되돌리기
  updateAvatarPreviewPanel();
  refreshAvatarItemCards();
};
