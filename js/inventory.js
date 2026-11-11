// inventory.js — 내 보관함 (보상·칭호·꾸미기·아바타)
import { state } from './state.js?v=20261111d';
import {
  addDoc, collection, db, deleteDoc, doc, getDoc, getDocs, increment, query, serverTimestamp,
  setDoc, updateDoc, where
} from './firebase.js?v=20261111d';
import {
  GRADE_ORDER, closeModal, getMyExchanges, getMyStudentData, loadTitleInventoryCache, openModal, showToast
} from './core.js?v=20261111d';
import { formatTime } from './level.js?v=20261111d';
import { renderStudentHome } from './home.js?v=20261111d';
import { initFrameGrids, loadCustomFrames, renderInventoryDecor } from './frames.js?v=20261111d';
import { GRADE_POINTS, getTitleBadgeHtml, reloadTitles, titles } from './titles.js?v=20261111d';
import {
  AVATAR_CATS, AVATAR_CAT_ICONS, AVATAR_MANNEQUIN, avatarInventory, avatarItemImg, avatarItemList,
  loadAvatarEquipped, loadAvatarInventory, loadAvatarItemList
} from './avatar.js?v=20261111d';
import { AVATAR_LAYER_ORDER } from './avatar-shop.js?v=20261111d';
import { renderStudentSettings } from './profile.js?v=20261111d';
import { renderMyPoints } from './points.js?v=20261111d';

// ===== 내 보관함: 아바타 탭 =====
export async function renderInventoryAvatar() {
  const wrap = document.getElementById('inventoryAvatarContent');
  if (!wrap) return;
  wrap.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted);">불러오는 중...</div>';

  await loadAvatarItemList();
  await loadAvatarInventory();
  await loadAvatarEquipped();

  const hasAny = Object.values(avatarInventory).some(s => s.size > 0);
  if (!hasAny) {
    wrap.innerHTML = `<div class="empty-state" style="padding:60px;">
      <div class="empty-icon">🧑</div>
      <h3>보유한 아바타 아이템이 없어요</h3>
      <p>꾸미기 상점 → 아바타 탭에서 구매해 보세요!</p>
    </div>`;
    return;
  }

  const defaultImg = AVATAR_MANNEQUIN;

  function makeInvPreviewHtml(eq) {
    const layers = AVATAR_LAYER_ORDER
      .filter(cat => eq[cat])
      .map(cat => {
        const id = eq[cat];
        const item = avatarItemList.find(i => i.category === cat && i.itemId === id);
        const url = item?.layerUrl;
        if (!url) return '';
        return `<img src="${url}"
        style="position:absolute;inset:0;width:100%;height:100%;object-fit:contain;image-rendering:pixelated;"
        onerror="this.style.display='none'" />`;
      }).join('');
    return `<div style="position:relative;width:80px;height:100px;margin:0 auto;">
      <img src="${AVATAR_MANNEQUIN}" style="width:100%;height:100%;object-fit:contain;image-rendering:pixelated;display:block;" />
      ${layers}</div>`;
  }

  function makeEquippedListHtml(eq) {
    const entries = Object.entries(eq);
    if (!entries.length) return `<div style="color:var(--text-muted);text-align:center;font-size:11px;padding:4px 0;">착용 아이템 없음</div>`;
    return entries.map(([cat, id]) => {
      const item = avatarItemList.find(i => i.category === cat && i.itemId === id);
      return `<div style="display:flex;align-items:center;justify-content:space-between;font-size:12px;line-height:1.8;">
        <span>${AVATAR_CAT_ICONS[cat]} ${item?.name || id}</span>
        <span style="color:#22c55e;font-size:11px;">✓</span></div>`;
    }).join('');
  }

  // 카테고리별 보유 아이템 (무료→가격순→가나다순)
  const grouped = {};
  avatarItemList.forEach(item => {
    if (avatarInventory[item.category]?.has(item.itemId)) {
      if (!grouped[item.category]) grouped[item.category] = [];
      grouped[item.category].push(item);
    }
  });
  Object.keys(grouped).forEach(cat => {
    grouped[cat].sort((a, b) => (a.price - b.price) || (a.name||'').localeCompare(b.name||'','ko'));
  });

  const equipped = { ...state.avatarEquipped };

  wrap.innerHTML = `
  <div style="display:grid;grid-template-columns:180px 1fr;gap:20px;align-items:start;margin-top:12px;">

    <!-- 왼쪽: 미리보기 + 저장 -->
    <div style="position:sticky;top:0;">
      <div style="background:linear-gradient(160deg,#e0e7ff,#f0f4ff);border-radius:var(--radius-lg);padding:16px 12px;border:1px solid var(--border);text-align:center;">
        <div style="font-size:13px;color:var(--text-secondary);font-weight:600;margin-bottom:8px;">착용 미리보기</div>
        <div style="background:rgba(255,255,255,0.85);border-radius:12px;padding:14px 10px;min-height:96px;
          display:flex;align-items:center;justify-content:center;margin-bottom:10px;border:1px solid rgba(99,102,241,0.15);">
          <div id="invAvatarPreview">${makeInvPreviewHtml(equipped)}</div>
        </div>
        <div id="invAvatarEquippedList" style="margin-bottom:10px;padding:0 2px;">${makeEquippedListHtml(equipped)}</div>
        <button class="btn btn-success btn-full" style="font-size:12px;padding:8px;" onclick="saveInventoryAvatarEquip()">
          💾 착용 저장
        </button>
        <button class="btn btn-secondary btn-full" style="font-size:11px;padding:7px;margin-top:6px;" onclick="resetInventoryAvatarEquip()">
          🔄 전체 해제
        </button>
      </div>
    </div>

    <!-- 오른쪽: 카테고리별 보유 목록 -->
    <div id="invAvatarGrid" style="display:flex;flex-direction:column;gap:14px;">
      ${Object.keys(AVATAR_CATS).filter(cat => grouped[cat]?.length).map(cat => `
      <div style="background:var(--surface);border-radius:var(--radius-lg);border:1px solid var(--border);padding:14px;">
        <div style="font-size:15px;font-weight:700;margin-bottom:10px;">
          ${AVATAR_CAT_ICONS[cat]} ${AVATAR_CATS[cat]}
          <span style="font-size:13px;color:var(--text-muted);font-weight:400;">${grouped[cat].length}개 보유</span>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(80px,1fr));gap:8px;">
          ${grouped[cat].map(item => {
            const isOn = equipped[cat] === item.itemId;
            return `
            <div data-inv-cat="${cat}" data-inv-id="${item.itemId}"
              style="text-align:center;cursor:pointer;" onclick="toggleInventoryAvatar('${cat}',${item.itemId})">
              <div class="inv-av-wrap" style="border-radius:8px;border:2px solid ${isOn?'#6366f1':'var(--border)'};
                background:${isOn?'#eef2ff':'var(--bg)'};
                padding:4px 3px;position:relative;transition:all 0.15s;margin-bottom:3px;">
                <img src="${item.thumb || avatarItemImg(cat, item.itemId, item.ext)}"
                  style="width:80px;height:100px;object-fit:contain;image-rendering:pixelated;display:block;margin:0 auto;"
                  onerror="this.style.opacity=0.3" />
                ${isOn ? `<div style="position:absolute;top:2px;left:2px;font-size:9px;background:#6366f1;color:#fff;border-radius:3px;padding:1px 4px;line-height:1.4;font-weight:700;">ON</div>` : ''}
              </div>
              <div style="font-size:11px;color:var(--text-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${item.name}</div>
              <div style="font-size:11px;color:${item.price===0?'#16a34a':'var(--text-muted)'};">${item.price===0?'🆓 무료':`🪙${item.price}`}</div>
              <div class="inv-av-status" style="font-size:12px;font-weight:700;color:${isOn?'#6366f1':'var(--text-muted)'};">${isOn?'착용 중':'보유'}</div>
            </div>`;
          }).join('')}
        </div>
      </div>`).join('')}
    </div>
  </div>`;

  wrap._equipped = { ...equipped };
}

window.toggleInventoryAvatar = function(cat, itemId) {
  const wrap = document.getElementById('inventoryAvatarContent');
  if (!wrap) return;
  if (!wrap._equipped) wrap._equipped = { ...state.avatarEquipped };

  if (wrap._equipped[cat] === itemId) {
    delete wrap._equipped[cat];
  } else {
    wrap._equipped[cat] = itemId;
  }

  const eq = wrap._equipped;
  const defaultImg = AVATAR_MANNEQUIN;

  // 미리보기 업데이트
  const preview = document.getElementById('invAvatarPreview');
  if (preview) {
    const layers = AVATAR_LAYER_ORDER
      .filter(c => eq[c])
      .map(c => {
        const id = eq[c];
        const item = avatarItemList.find(i => i.category === c && i.itemId === id);
        const url = item?.layerUrl;
        if (!url) return '';
        return `<img src="${url}"
        style="position:absolute;inset:0;width:100%;height:100%;object-fit:contain;image-rendering:pixelated;"
        onerror="this.style.display='none'" />`;
      }).join('');
    preview.innerHTML = `<div style="position:relative;width:80px;height:100px;margin:0 auto;">
      <img src="${AVATAR_MANNEQUIN}" style="width:100%;height:100%;object-fit:contain;image-rendering:pixelated;display:block;" />
      ${layers}</div>`;
  }

  // 착용 목록 텍스트 업데이트
  const listEl = document.getElementById('invAvatarEquippedList');
  if (listEl) {
    const entries = Object.entries(eq);
    listEl.innerHTML = entries.length
      ? entries.map(([c, id]) => {
          const item = avatarItemList.find(i => i.category === c && i.itemId === id);
          return `<div style="display:flex;align-items:center;justify-content:space-between;font-size:10px;line-height:1.8;">
            <span>${AVATAR_CAT_ICONS[c]} ${item?.name || id}</span>
            <span style="color:#22c55e;font-size:9px;">✓</span></div>`;
        }).join('')
      : `<div style="color:var(--text-muted);text-align:center;font-size:11px;padding:4px 0;">착용 아이템 없음</div>`;
  }

  // 카드 테두리/라벨 업데이트 (전체 재렌더 없이)
  document.querySelectorAll('#invAvatarGrid [data-inv-cat]').forEach(card => {
    const c = card.dataset.invCat;
    const id = parseInt(card.dataset.invId);
    const isOn = eq[c] === id;
    const imgWrap = card.querySelector('.inv-av-wrap');
    const statusEl = card.querySelector('.inv-av-status');
    if (imgWrap) {
      imgWrap.style.borderColor = isOn ? '#6366f1' : 'var(--border)';
      imgWrap.style.background  = isOn ? '#eef2ff' : 'var(--bg)';
      // ON 뱃지
      let badge = imgWrap.querySelector('.inv-on-badge');
      if (isOn && !badge) {
        badge = document.createElement('div');
        badge.className = 'inv-on-badge';
        badge.style.cssText = 'position:absolute;top:2px;left:2px;font-size:9px;background:#6366f1;color:#fff;border-radius:3px;padding:1px 4px;line-height:1.4;font-weight:700;';
        badge.textContent = 'ON';
        imgWrap.style.position = 'relative';
        imgWrap.appendChild(badge);
      } else if (!isOn && badge) {
        badge.remove();
      }
    }
    if (statusEl) {
      statusEl.style.color = isOn ? '#6366f1' : 'var(--text-muted)';
      statusEl.textContent  = isOn ? '착용 중' : '보유';
    }
  });
};

window.saveInventoryAvatarEquip = async function() {
  const wrap = document.getElementById('inventoryAvatarContent');
  const eq = wrap?._equipped ?? {};
  try {
    // ext 메타 정보 구성 (getStudentChar가 avatarItemList 없이도 ext 알 수 있도록)
    const meta = {};
    Object.entries(eq).forEach(([cat, id]) => {
      const item = avatarItemList.find(i => i.category === cat && i.itemId === id);
      if (item?.ext) meta[cat] = { ext: item.ext };
    });
    await updateDoc(doc(db, 'students', state.currentUser.uid), {
      avatarEquipped: eq,
      avatarEquippedMeta: meta
    });
    state.avatarEquipped = { ...eq };
    state.avatarEquippedMeta = { ...meta };
    state.avatarPreviewEquip = { ...eq };
    // students 캐시 즉시 갱신
    const meIdx = state.students.findIndex(s => s.id === state.currentUser.uid);
    if (meIdx >= 0) {
      state.students[meIdx] = { ...state.students[meIdx], avatarEquipped: { ...eq }, avatarEquippedMeta: { ...meta } };
    }
    if (!state.currentUser.avatarEquipped) state.currentUser.avatarEquipped = {};
    state.currentUser.avatarEquipped = { ...eq };
    state.currentUser.avatarEquippedMeta = { ...meta };
    showToast('아바타 착용이 저장됐어요 🧑 ✅');
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

window.resetInventoryAvatarEquip = async function() {
  if (!confirm('착용 중인 모든 아바타 아이템을 해제할까요?')) return;
  const wrap = document.getElementById('inventoryAvatarContent');
  if (wrap) wrap._equipped = {};
  try {
    await updateDoc(doc(db, 'students', state.currentUser.uid), { avatarEquipped: {}, avatarEquippedMeta: {} });
    state.avatarEquipped = {};
    state.avatarEquippedMeta = {};
    state.avatarPreviewEquip = {};
    if (state.currentUser.avatarEquipped) state.currentUser.avatarEquipped = {};
    state.currentUser.avatarEquippedMeta = {};
    showToast('전체 해제됐어요');
    renderInventoryAvatar();
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

window.equipFrame = async function(frameId) {
  try {
    await updateDoc(doc(db, 'students', state.currentUser.uid), { equippedFrameId: frameId });
    showToast('프레임을 장착했어요 🖼️');
    const el = document.getElementById('inventoryDecorList');
    if (el) { el.style.transition='opacity 0.25s'; el.style.opacity='0'; }
    await new Promise(r => setTimeout(r, 250));
    await renderInventoryDecor();
    if (el) { el.style.opacity='1'; }
  } catch(e) { showToast('오류: ' + e.message); }
};

window.unequipFrame = async function() {
  try {
    await updateDoc(doc(db, 'students', state.currentUser.uid), { equippedFrameId: null });
    showToast('프레임을 해제했어요');
    const el = document.getElementById('inventoryDecorList');
    if (el) { el.style.transition='opacity 0.25s'; el.style.opacity='0'; }
    await new Promise(r => setTimeout(r, 250));
    await renderInventoryDecor();
    if (el) { el.style.opacity='1'; }
  } catch(e) { showToast('오류: ' + e.message); }
};

window.deleteMyFrame = async function(docId, frameId, frameName) {
  if (!confirm(`⚠️ 프레임을 삭제하면 다시는 이 프레임을 구매할 수 없습니다.\n그래도 삭제하시겠어요?`)) return;
  const el = document.getElementById(`invFrame-${docId}`);
  if (el) { el.classList.add('dissolve-out'); await new Promise(r => setTimeout(r, 400)); }
  try {
    await deleteDoc(doc(db, 'frameInventory', docId));
    await setDoc(doc(db, 'frameDeleted', `${state.currentUser.uid}_${frameId}`), {
      studentId: state.currentUser.uid, frameId, frameName, deletedAt: serverTimestamp()
    });
    const _ms = getMyStudentData();
    const sDoc = { exists: () => Object.keys(_ms).length > 0, data: () => _ms };
    if (sDoc.exists() && sDoc.data().equippedFrameId === frameId) {
      await updateDoc(doc(db, 'students', state.currentUser.uid), { equippedFrameId: null });
    }
    showToast(`'${frameName}' 프레임을 영구 삭제했어요`);
    renderInventoryDecor();
  } catch(e) { showToast('오류: ' + e.message); }
};

// ===== 학생: 꾸미기 상점 =====

// ===== 내 보관함 - 보상 사용/환불/칭호 =====
let pendingUseReward = null;

// 일괄 사용
window.bulkUseRewards = async function(cat) {
  const listEl = document.getElementById(`inventory${cat.charAt(0).toUpperCase()+cat.slice(1)}List`);
  if (!listEl) return;
  // 현재 렌더된 '사용' 버튼이 있는 항목 수집
  const btns = listEl.querySelectorAll('button.btn-primary');
  const pending = [];
  btns.forEach(btn => {
    const match = btn.getAttribute('onclick')?.match(/openUseRewardModal\('([^']+)','([^']+)'/);
    if (match) pending.push({ id: match[1], name: match[2] });
  });
  if (!pending.length) return showToast('사용 가능한 보상이 없어요');
  if (!confirm(`${pending.length}개의 보상을 일괄 사용할까요?`)) return;
  showToast('일괄 사용 처리 중...');
  let done = 0;
  for (const item of pending) {
    try {
      await updateDoc(doc(db, 'exchanges', item.id), { status: 'used', usedAt: serverTimestamp() });
      done++;
    } catch(e) { console.error('일괄 사용 오류:', item.name, e); }
  }
  showToast(`✅ ${done}개 사용 완료!`);
  filterInventoryReward(inventoryRewardCategory);
};

window.openUseRewardModal = function(exchangeId, name, emoji) {
  pendingUseReward = { exchangeId, name, emoji };
  document.getElementById('useRewardEmoji').textContent = emoji;
  document.getElementById('useRewardName').textContent = name;
  openModal('useRewardModal');
};

window.confirmUseReward = async function() {
  if (!pendingUseReward) return;
  const { exchangeId, name } = pendingUseReward;
  const el = document.getElementById(`inv-${exchangeId}`);
  if (el) {
    el.classList.add('dissolve-out');
    await new Promise(r => setTimeout(r, 400));
  }
  try {
    await updateDoc(doc(db, 'exchanges', exchangeId), { status: 'used', usedAt: serverTimestamp() });
    closeModal('useRewardModal');
    showToast(`'${name}' 사용됐어요! ✅`);
    filterInventoryReward(inventoryRewardCategory);
  } catch(e) { showToast('오류: ' + e.message); }
};

window.refundReward = async function(exchangeId, cost, name, elId) {
  if (!confirm(`'${name}' 보상을 환불할까요? 🪙 ${cost} 포인트가 복구돼요.`)) return;
  const el = document.getElementById(elId);
  if (el) { el.classList.add('dissolve-out'); await new Promise(r => setTimeout(r, 400)); }
  try {
    // 재고 복구 (승인된 보상이므로 exchanges 문서에서 rewardId 가져오기)
    const exDoc = await getDoc(doc(db, 'exchanges', exchangeId));
    if (exDoc.exists()) {
      const rewardId = exDoc.data().rewardId;
      if (rewardId) {
        const rDoc = await getDoc(doc(db, 'rewards', rewardId));
        if (rDoc.exists() && rDoc.data().stock !== null && rDoc.data().stock !== undefined) {
          await updateDoc(doc(db, 'rewards', rewardId), { stock: increment(1), tagSoldOut: false });
        }
      }
    }
    await deleteDoc(doc(db, 'exchanges', exchangeId));
    await updateDoc(doc(db, 'students', state.currentUser.uid), { points: increment(cost) });
    await addDoc(collection(db, 'history'), {
      studentId: state.currentUser.uid, studentName: state.currentUser.name,
      delta: cost, reason: `환불: ${name}`, type: 'plus', source: 'refund',
      createdAt: serverTimestamp()
    });
    showToast(`'${name}' 환불됐어요 🪙 +${cost}`);
    filterInventoryReward(inventoryRewardCategory);
  } catch(e) { showToast('오류: ' + e.message); }
};

// 칭호 목록 (등급 높은 순)

export async function renderInventoryTitles() {
  const list = document.getElementById('inventoryTitleList');
  if (!list) return;
  list.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted);">불러오는 중...</div>';
  try {
    // 캐시 대신 항상 Firestore에서 직접 조회 (칭호 누락 방지)
    const snap = await getDocs(query(
      collection(db, 'titleInventory'),
      where('studentId', '==', state.currentUser.uid)
    ));
    const myTitles = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a,b) => (GRADE_ORDER[b.titleGrade]||0) - (GRADE_ORDER[a.titleGrade]||0));

    // 현재 장착 칭호
    const _ms = getMyStudentData();
    const sDoc = { exists: () => Object.keys(_ms).length > 0, data: () => _ms };
    const equippedId = sDoc.exists() ? sDoc.data().equippedTitleId : null;

    if (!myTitles.length) {
      list.innerHTML = '<div class="empty-state" style="padding:40px;"><div class="empty-icon">🏅</div><h3>보유한 칭호가 없어요</h3><p>선생님께 칭호를 받아보세요!</p></div>';
      return;
    }
    // 등급별 섹션 분리
    const gradeOrder2 = { normal:0, rare:1, epic:2, legend:3, special:4, absolute:5 };
    const gradeLabels2 = { normal:'⭐ 일반 등급', rare:'💙 희귀 등급', epic:'💜 영웅 등급', legend:'🏅 전설 등급', special:'✨ 특별 등급', absolute:'🔱 절대신 등급' };
    const gradeBg2 = {
      absolute:'linear-gradient(135deg,rgba(250,204,21,0.14),rgba(244,114,182,0.12),rgba(56,189,248,0.12))',
    special:'linear-gradient(135deg,rgba(245,158,11,0.08),rgba(139,92,246,0.08))',
      legend:'linear-gradient(135deg,rgba(217,119,6,0.1),rgba(253,211,77,0.08))',
      epic:'linear-gradient(135deg,rgba(139,92,246,0.08),rgba(236,72,153,0.06))',
      rare:'linear-gradient(135deg,rgba(2,132,199,0.08),rgba(125,211,252,0.06))',
      normal:'var(--surface)'
    };
    const grouped2 = {};
    myTitles.forEach(t => {
      const g = t.titleGrade || 'normal';
      if (!grouped2[g]) grouped2[g] = [];
      grouped2[g].push(t);
    });
    const sortedGrades = Object.keys(grouped2).sort((a,b) => (gradeOrder2[a]||0)-(gradeOrder2[b]||0));
    list.innerHTML = sortedGrades.map(grade => {
      const items = grouped2[grade].map(t => `
        <div id="invTitle-${t.id}" style="background:${gradeBg2[grade]||'var(--surface)'};border-radius:var(--radius-md);border:1px solid var(--border);padding:14px 16px;display:flex;align-items:center;gap:12px;">
          ${getTitleBadgeHtml(t.titleGrade, t.bgColor, t.textColor, t.titleEmoji, t.titleName)}
          <div style="margin-left:auto;display:flex;gap:6px;align-items:center;">
            ${t.titleId === equippedId
              ? `<span style="font-size:12px;color:var(--primary);font-weight:600;margin-right:2px;">✓ 장착 중</span>
                 <button class="btn btn-secondary btn-sm" onclick="unequipTitleFromInventory()">해제</button>`
              : `<button class="btn btn-primary btn-sm" onclick="equipTitleFromInventory('${t.titleId}')">사용</button>`}
            <button class="btn btn-danger btn-sm" onclick="deleteMyTitle('${t.id}','${t.titleId}','${t.titleName}')">삭제</button>
          </div>
        </div>
      `).join('');
      return `<div class="section-grade-header" style="margin-bottom:10px;">${gradeLabels2[grade]}</div>
      <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:16px;">${items}</div>`;
    }).join('');
  } catch(e) {
    list.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted);">불러오기 실패</div>';
  }
}

window.deleteMyTitle = async function(invDocId, titleId, titleName) {
  if (!confirm(`⚠️ 칭호를 삭제하면 다시는 이 칭호를 받을 수 없습니다.\n그래도 삭제하시겠어요?`)) return;
  const el = document.getElementById(`invTitle-${invDocId}`);
  if (el) { el.classList.add('dissolve-out'); await new Promise(r => setTimeout(r, 400)); }
  try {
    await deleteDoc(doc(db, 'titleInventory', invDocId));
    // 영구 삭제 기록 저장 (다시 부여받지 못하도록)
    window._cachedTitleDeleted = null; // 캐시 무효화
    await setDoc(doc(db, 'titleDeleted', `${state.currentUser.uid}_${titleId}`), {
      studentId: state.currentUser.uid, titleId, titleName,
      deletedAt: serverTimestamp()
    });
    // 장착 중이면 해제
    const _ms = getMyStudentData();
    const sDoc = { exists: () => Object.keys(_ms).length > 0, data: () => _ms };
    if (sDoc.exists() && sDoc.data().equippedTitleId === titleId) {
      await updateDoc(doc(db, 'students', state.currentUser.uid), { equippedTitleId: null });
    }
    showToast(`'${titleName}' 칭호를 영구 삭제했어요`);
    renderInventoryTitles();
  } catch(e) { showToast('오류: ' + e.message); }
};

window.equipTitleFromInventory = async function(titleId) {
  try {
    await updateDoc(doc(db, 'students', state.currentUser.uid), { equippedTitleId: titleId });
    showToast('칭호를 장착했어요 🏅');
    renderInventoryTitles();
  } catch(e) { showToast('오류: ' + e.message); }
};

window.unequipTitleFromInventory = async function() {
  try {
    await updateDoc(doc(db, 'students', state.currentUser.uid), { equippedTitleId: null });
    showToast('칭호를 해제했어요');
    const list = document.getElementById('inventoryTitleList');
    if (list) { list.style.transition='opacity 0.25s'; list.style.opacity='0'; }
    await new Promise(r => setTimeout(r, 250));
    await renderInventoryTitles();
    if (list) { list.style.opacity='1'; }
  } catch(e) { showToast('오류: ' + e.message); }
};

export async function renderMyInventory() {
  // 진입 시 캐시 무효화 → 항상 최신 교환 내역 반영
  window._myExchanges = null;
  inventoryRewardCategory = 'study';
  const tabs = document.querySelectorAll('#page-myInventory .decor-top-tab');
  tabs.forEach((b,i) => b.classList.toggle('active', i===0));
  document.getElementById('inventoryTabReward').style.display = '';
  document.getElementById('inventoryTabTitle').style.display = 'none';
  document.getElementById('inventoryTabDecor').style.display = 'none';
  document.getElementById('inventoryTabAvatar').style.display = 'none';
  const subBar = document.getElementById('inventoryRewardSubTab');
  if (subBar) {
    subBar.querySelectorAll('.tab-btn').forEach((b,i) => b.classList.toggle('active', i===0));
  }
  filterInventoryReward('study');
}

// ===== 내 보관함 =====
export let inventoryRewardCategory = 'study';

window.filterInventoryReward = async function(category, btn) {
  inventoryRewardCategory = category || 'study';
  const studyList = document.getElementById('inventoryStudyList');
  const snackList = document.getElementById('inventorySnackList');
  const stationeryList = document.getElementById('inventoryStationeryList');
  if (!studyList || !snackList) return;
  studyList.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted);font-size:13px;">불러오는 중...</div>';
  snackList.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted);font-size:13px;">불러오는 중...</div>';
  if (stationeryList) stationeryList.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted);font-size:13px;">불러오는 중...</div>';
  try {
    // (읽기 절약) 실시간으로 받고 있는 내 신청 목록에서 승인/사용된 것만
    const myEx = (await getMyExchanges()).filter(ex => ['approved', 'used'].includes(ex.status));
    const snap = { docs: myEx.map(ex => ({ id: ex.id, data: () => ex })) };
    const rewardsSnap = await getDocs(collection(db, 'rewards'));
    const rewardCatMap = {};
    rewardsSnap.docs.forEach(d => {
      rewardCatMap[d.id] = d.data().category || 'study';
    });
    const allEx = snap.docs.map(d => {
      const ex = { id: d.id, ...d.data() };
      if (!ex.rewardCategory) {
        ex.rewardCategory = rewardCatMap[ex.rewardId] || 'study';
      }
      return ex;
    }).filter(ex => ex.type !== 'pet' && ex.type !== 'avatar' && ex.rewardCategory !== 'frame')
      .sort((a, b) => (b.createdAt?.seconds||0) - (a.createdAt?.seconds||0));

    const makeItems = (cat) => allEx.filter(e => e.rewardCategory === cat);

    const catLabel = { study:'학습', snack:'간식', stationery:'문구' };
    const renderList = (items, cat, el) => {
      if (!el) return;
      if (!items.length) {
        el.innerHTML = `<div style="text-align:center;padding:20px;color:var(--text-muted);font-size:12px;">아직 ${catLabel[cat]||cat} 보상이 없어요</div>`;
        return;
      }
      el.innerHTML = items.map(e => `
        <div class="reward-card" id="inv-${e.id}" style="cursor:default;${e.status==='used'?'opacity:0.6;':''}">
          <div class="reward-icon">${e.rewardEmoji||'🎁'}</div>
          <div class="reward-info">
            <div class="reward-name" style="font-size:13px;">${e.rewardName}</div>
            <div class="reward-cost" style="font-size:11px;color:var(--text-secondary);">교환일: ${formatTime(e.createdAt)}</div>
          </div>
          <div style="display:flex;gap:4px;flex-shrink:0;">
            ${e.status === 'used'
              ? `<span style="font-size:12px;color:var(--text-muted);font-weight:600;padding:4px 8px;">✅ 사용 완료</span>`
              : `<button class="btn btn-primary btn-sm" onclick="openUseRewardModal('${e.id}','${e.rewardName}','${e.rewardEmoji||'🎁'}')">사용</button>
                 <button class="btn btn-secondary btn-sm" onclick="refundReward('${e.id}',${e.rewardCost},'${e.rewardName}','inv-${e.id}')">환불</button>`
            }
          </div>
        </div>
      `).join('');
    };

    renderList(makeItems('study'), 'study', studyList);
    renderList(makeItems('snack'), 'snack', snackList);
    renderList(makeItems('stationery'), 'stationery', stationeryList);
  } catch(e) {
    studyList.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted);">불러오기 실패</div>';
    console.error(e);
  }
};

// 현재 꾸미기 상점 탭 상태
let decorCurrentTab = 'shop'; // 'shop' | 'special'
let decorShopData = { myPts: 0, ownedIds: new Set(), allInvCounts: {} };

export async function renderDecorShop() {
  await loadCustomFrames();
  await reloadTitles();
  // (읽기 절약) 들어올 때마다 전교생 칭호 보유 기록을 새로 읽지 않음. 내가 칭호를 사면 그때 새로 읽어요.
  // 프레임 탭 기본 활성화
  setTimeout(() => {
    initFrameGrids(false);
  }, 100);
  // 데이터 로드
  const _sMe = state.students.find(s => s.id === state.currentUser.uid);
  decorShopData.myPts = _sMe?.points || 0;
  // 꾸미기 상점 골드 표시 업데이트
  const goldEl = document.getElementById('decorShopGold');
  if (goldEl) goldEl.textContent = `🪙 ${decorShopData.myPts.toLocaleString()}`;
  const _tiMe = (await loadTitleInventoryCache()).filter(d => d.studentId === state.currentUser.uid);
  const invSnap = { docs: _tiMe.map(d => ({ id: d.id, data: () => d })) };
  decorShopData.ownedIds = new Set(invSnap.docs.map(d => d.data().titleId));

  // 전체 구매자 수 계산
  const allInvSnap = { docs: (await loadTitleInventoryCache()).map(d => ({ id: d.id, data: () => d })) };
  decorShopData.allInvCounts = {};
  allInvSnap.docs.forEach(d => {
    const tid = d.data().titleId;
    decorShopData.allInvCounts[tid] = (decorShopData.allInvCounts[tid] || 0) + 1;
  });

  renderDecorShopGrid(decorCurrentTab);
}

function renderDecorShopGrid(tabType) {
  decorCurrentTab = tabType;
  const filtered = titles.filter(t => t.type === tabType);
  const grid = document.getElementById('decorShopGrid');
  if (!grid) return;

  if (!filtered.length) {
    grid.innerHTML = `<div class="empty-state" style="padding:60px;"><div class="empty-icon">🎨</div><h3>${tabType==='shop'?'판매 중인 칭호가 없어요':'특별 칭호가 없어요'}</h3></div>`;
    return;
  }

  if (tabType === 'shop') {
    grid.innerHTML = filtered.map(t => {
      const owned = decorShopData.ownedIds.has(t.id);
      const canBuy = !owned && decorShopData.myPts >= t.cost;
      const buyerCount = decorShopData.allInvCounts[t.id] || 0;
      return `
      <div class="title-card">
        <div class="title-card-badge-wrap">
          ${getTitleBadgeHtml(t.grade, t.bgColor, t.textColor, t.emoji, t.name, 'font-size:14px;padding:6px 16px;')}
        </div>
        <div class="title-card-name">${t.name}</div>
        <div class="title-card-desc">${t.desc || '설명이 없어요'}</div>
        <div class="title-card-count">구매한 학생 ${buyerCount}명 · 🪙 ${t.cost}</div>
        ${owned
          ? `<button class="btn btn-secondary btn-sm title-card-btn" disabled style="opacity:0.6;">✅ 보유 중</button>`
          : `<button class="btn ${canBuy?'btn-primary':'btn-secondary'} btn-sm title-card-btn"
              ${!canBuy?'disabled style="opacity:0.5;cursor:not-allowed"':''}
              onclick="buyTitle('${t.id}','${t.name}','${t.emoji||''}','${t.grade}',${t.cost},${decorShopData.myPts})">
              ${canBuy ? '🛒 구매하기' : '포인트 부족'}
            </button>`
        }
      </div>`;
    }).join('');
  } else {
    // 특별 칭호
    grid.innerHTML = filtered.map(t => {
      const owned = decorShopData.ownedIds.has(t.id);
      const givenCount = decorShopData.allInvCounts[t.id] || 0;
      return `
      <div class="title-card">
        <div class="title-card-badge-wrap">
          ${getTitleBadgeHtml(t.grade, t.bgColor, t.textColor, t.emoji, t.name, 'font-size:14px;padding:6px 16px;')}
        </div>
        <div class="title-card-name">${t.name}</div>
        <div class="title-card-desc">${t.desc || '설명이 없어요'}</div>
        <div style="font-size:15px;font-weight:800;color:var(--primary);text-align:center;margin-bottom:4px;">+${t.gold ?? GRADE_POINTS[t.grade] ?? 200}🪙</div>
        <div class="title-card-count">선생님께 하사받은 학생 ${givenCount}명</div>
        <div class="title-card-btn" style="width:100%;padding:8px 0;border-radius:var(--radius-sm);font-size:13px;font-weight:600;text-align:center;
          background:${owned?'var(--success-light)':'var(--bg)'};
          color:${owned?'#15803D':'var(--text-muted)'};">
          ${owned ? '✅ 소지 중' : '미소지'}
        </div>
      </div>`;
    }).join('');
  }
}

window.switchTitleShopTab = function(type, btn) {
  document.querySelectorAll('#decorTabTitle .tab-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderDecorShopGrid(type);
};

window.buyTitle = async function(titleId, name, emoji, grade, cost, myPts) {
  if (myPts < cost) return showToast('포인트가 부족해요');
  if (!confirm(`'${emoji} ${name}' 칭호를 🪙 ${cost}에 구매할까요?`)) return;
  try {
    window._cachedTitleInventory = null; // 캐시 무효화
    await setDoc(doc(db, 'titleInventory', `${state.currentUser.uid}_${titleId}`), {
      studentId: state.currentUser.uid, titleId, titleName: name, titleEmoji: emoji,
      titleGrade: grade, type: 'shop', boughtAt: serverTimestamp()
    });
    await updateDoc(doc(db, 'students', state.currentUser.uid), { points: increment(-cost) });
    await addDoc(collection(db, 'history'), {
      studentId: state.currentUser.uid, studentName: state.currentUser.name,
      delta: -cost, reason: `${emoji} ${name}`, type: 'minus',
      source: 'shop',
      createdAt: serverTimestamp()
    });
    showToast(`'${emoji} ${name}' 칭호를 구매했어요 🎨`);
    await renderDecorShop();
  } catch(e) { showToast('오류: ' + e.message); }
};
