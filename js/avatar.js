// avatar.js — 아바타 시스템 (데이터·교사 관리)
import { state } from './state.js?v=20261111b';
import {
  collection, db, doc, getDoc, getDocs, query, serverTimestamp, setDoc, updateDoc, where
} from './firebase.js?v=20261111b';
import { closeModal, openModal, showToast } from './core.js?v=20261111b';
import { AVATAR_LAYER_ORDER } from './avatar-shop.js?v=20261111b';

// ===================================================
// 🧑 아바타 시스템 v4 (Firestore 목록 + GitHub 이미지)
// ===================================================

const AVATAR_GITHUB_RAW = 'https://raw.githubusercontent.com/aprikotseed-cyber/63class/main/avatar'; // 아바타 파츠는 Firestore URL 사용
export const AVATAR_CATS = {
  hair:'헤어', face:'얼굴', cap:'모자', top:'상의(전신)', shoe:'신발', weapon:'무기'
};
export const AVATAR_CAT_ICONS = {
  hair:'💇', face:'😊', cap:'🎩', top:'👕', shoe:'👟', weapon:'⚔️'
};

// item 객체 또는 ext 문자열로 확장자 결정 (기본 png)
export function avatarItemImg(category, itemId, ext) {
  // Firestore에 저장된 layerUrl 우선 사용
  const item = avatarItemList.find(i => i.category === category && i.itemId === itemId);
  if (item?.layerUrl) return item.layerUrl;
  if (item?.thumb) return item.thumb;
  // layerUrl 없으면 마네킹(빈 슬롯) 표시
  return AVATAR_MANNEQUIN;
}

// 학생 캐릭터 URL 결정:
// 1순위: 전달된 equippedData의 top 아이템
// 2순위: 전역 avatarEquipped (현재 로그인 학생 본인일 때)
// 3순위: 성별 기본 GIF
export function getStudentChar(s) {
  // isMe면 전역 avatarEquipped를 우선 (저장 직후 캐시 갱신 전에도 반영)
  // isMe가 아니면 s의 Firestore 데이터 사용
  const isMe = state.currentUser?.uid === s.id;
  const eq   = isMe ? state.avatarEquipped     : (s.avatarEquipped   || {});
  const meta = isMe ? state.avatarEquippedMeta : (s.avatarEquippedMeta || {});

  const topId = eq?.top;
  if (topId) {
    const extFromMeta = meta?.top?.ext;
    const extFromList = avatarItemList.find(i => i.category === 'top' && i.itemId === topId)?.ext;
    const ext = extFromMeta || extFromList || 'png';
    return avatarItemImg('top', topId, ext);
  }
  return AVATAR_MANNEQUIN;
}

// 학생 캐릭터 레이어 합성 HTML 생성
// top이 베이스, 나머지 파츠를 position:absolute로 겹침
export function buildCharHtml(s, style = '') {
  const isMe = state.currentUser?.uid === s.id;
  const eq   = isMe ? state.avatarEquipped     : (s.avatarEquipped   || {});
  const meta = isMe ? state.avatarEquippedMeta : (s.avatarEquippedMeta || {});

  // 마네킹을 항상 베이스로, layerUrl 있는 파츠만 레이어로 쌓음
  const layers = AVATAR_LAYER_ORDER
    .filter(cat => eq?.[cat])
    .map(cat => {
      const id = eq[cat];
      const item = avatarItemList.find(i => i.category === cat && i.itemId === id);
      const url = item?.layerUrl; // layerUrl만 레이어로 사용 (thumb 제외)
      if (!url) return '';
      return `<img src="${url}"
        style="position:absolute;inset:0;width:100%;height:100%;object-fit:contain;image-rendering:pixelated;"
        onerror="this.style.display='none'" />`;
    }).join('');

  return `<div style="position:relative;width:80px;height:100px;${style}">
    <img src="${AVATAR_MANNEQUIN}"
      style="width:100%;height:100%;object-fit:contain;image-rendering:pixelated;display:block;"
      onerror="this.style.opacity=0" />
    ${layers}
  </div>`;
}

// 꾸미기 상점 미리보기용 마네킹 (성별 무관, 아무것도 입혀지지 않은 베이스)
// 마네킹 이미지 미리 로드 (캐싱)
const _mannequinPreload = new Image();
_mannequinPreload.src = 'https://i.ibb.co/TMcWFtGr/image.png';

export const AVATAR_MANNEQUIN = 'https://i.ibb.co/TMcWFtGr/image.png';

// 상태 변수
export let avatarItemList = [];       // Firestore config/avatarItems.items
export let avatarInventory = {};      // { category: Set(itemId) }

// ===== Firestore: 아이템 목록 =====
export async function loadAvatarItemList() {
  if (avatarItemList.length > 0) return; // 이미 로드됨
  try {
    const snap = await getDoc(doc(db, 'config', 'avatarItems'));
    avatarItemList = snap.exists() ? (snap.data().items || []) : [];
  } catch(e) { avatarItemList = []; }
}
async function saveAvatarItemList() {
  window._cachedAvatarItems = null; await setDoc(doc(db, 'config', 'avatarItems'), { items: avatarItemList });
  avatarItemList = []; // 저장 후 캐시 무효화 → 다음 로드 시 새로 읽음
}

// ===== Firestore: 인벤토리 =====
export async function loadAvatarInventory() {
  if (!state.currentUser) return;
  try {
    const snap = await getDocs(query(
      collection(db, 'avatarInventory'),
      where('studentId', '==', state.currentUser.uid)
    ));
    avatarInventory = {};
    snap.docs.forEach(d => {
      const data = d.data();
      if (!avatarInventory[data.category]) avatarInventory[data.category] = new Set();
      avatarInventory[data.category].add(Number(data.itemId));
    });
  } catch(e) {}
}

// ===== Firestore: 장착 정보 =====
export async function loadAvatarEquipped() {
  if (!state.currentUser) return;
  try {
    // students 캐시가 아직 안 채워졌을 수 있으므로 직접 읽기
    const sDoc = await getDoc(doc(db, 'students', state.currentUser.uid));
    state.avatarEquipped     = sDoc.exists() ? (sDoc.data().avatarEquipped     || {}) : {};
    state.avatarEquippedMeta = sDoc.exists() ? (sDoc.data().avatarEquippedMeta || {}) : {};
    state.avatarPreviewEquip = { ...state.avatarEquipped };
  } catch(e) { state.avatarEquipped = {}; state.avatarEquippedMeta = {}; state.avatarPreviewEquip = {}; }
}

// ===== 기본 아이템 자동 지급 =====
async function giveDefaultAvatarItems() {
  const defaults = avatarItemList.filter(i => i.price === 0);
  for (const item of defaults) {
    const owned = avatarInventory[item.category]?.has(item.itemId);
    if (!owned) {
      const docId = `${state.currentUser.uid}_${item.category}_${item.itemId}`;
      await setDoc(doc(db, 'avatarInventory', docId), {
        studentId: state.currentUser.uid, category: item.category,
        itemId: item.itemId, name: item.name, acquiredAt: serverTimestamp()
      }, { merge: true });
      if (!avatarInventory[item.category]) avatarInventory[item.category] = new Set();
      avatarInventory[item.category].add(item.itemId);
    }
  }
}

// ===== 로그인 직후 아바타 초기화 =====
// 1) 0원 아이템 자동 지급
// 2) avatarEquipped 비어있으면 → 카테고리별 가격순 첫 아이템 자동 착용
export async function initStudentAvatar() {
  await loadAvatarItemList();
  await loadAvatarInventory();
  await loadAvatarEquipped();
  await giveDefaultAvatarItems();
  await loadAvatarInventory(); // 지급 후 재로드

  // avatarEquipped가 완전히 비어있을 때만 기본 착용 설정
  if (Object.keys(state.avatarEquipped).length > 0) return;

  // 카테고리별로 보유 아이템 중 가격순 첫 번째를 기본 착용
  const defaultEquip = {};
  const defaultMeta  = {};
  const cats = Object.keys(AVATAR_CATS); // 등록된 카테고리 순서
  for (const cat of cats) {
    const owned = avatarItemList
      .filter(i => i.category === cat && avatarInventory[cat]?.has(i.itemId))
      .sort((a, b) => (a.price - b.price) || (a.name || '').localeCompare(b.name || '', 'ko'));
    if (owned.length > 0) {
      defaultEquip[cat] = owned[0].itemId;
      if (owned[0].ext) defaultMeta[cat] = { ext: owned[0].ext };
    }
  }

  if (Object.keys(defaultEquip).length === 0) return; // 보유 아이템 없으면 패스

  // Firestore에 저장
  await updateDoc(doc(db, 'students', state.currentUser.uid), {
    avatarEquipped: defaultEquip,
    avatarEquippedMeta: defaultMeta
  });
  state.avatarEquipped     = { ...defaultEquip };
  state.avatarEquippedMeta = { ...defaultMeta };
  state.avatarPreviewEquip = { ...defaultEquip };
}

// ===================================================
// 교사: 아바타 관리
// ===================================================
export async function renderAvatarManage() {
  const grid = document.getElementById('avatarManageGrid');
  if (!grid) return;
  await loadAvatarItemList();

  const grouped = {};
  avatarItemList.forEach(item => {
    if (!grouped[item.category]) grouped[item.category] = [];
    grouped[item.category].push(item);
  });
  Object.keys(grouped).forEach(cat => {
    grouped[cat].sort((a, b) => (a.price - b.price) || (a.name||'').localeCompare(b.name||'','ko'));
  });

  if (!avatarItemList.length) {
    grid.innerHTML = `<div class="empty-state" style="padding:40px;">
      <div class="empty-icon">🧑</div>
      <h3>등록된 아이템이 없어요</h3>
      <p>+ 아이템 추가 버튼으로 등록해주세요</p>
      <p style="font-size:12px;color:var(--text-secondary);">GitHub 이미지 경로: avatar/{카테고리}/{아이템ID}.png 또는 .gif</p>
    </div>`;
    return;
  }

  grid.innerHTML = Object.keys(AVATAR_CATS).filter(cat => grouped[cat]).map(cat => `
    <div style="background:var(--surface);border-radius:var(--radius-lg);border:1px solid var(--border);padding:14px;margin-bottom:10px;">
      <div style="font-size:14px;font-weight:700;margin-bottom:10px;">${AVATAR_CAT_ICONS[cat]} ${AVATAR_CATS[cat]}</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:8px;">
        ${grouped[cat].map(item => `
          <div style="background:var(--bg);border-radius:var(--radius-md);padding:8px;border:1px solid var(--border);text-align:center;">
            <div style="position:relative;display:inline-block;">
              <img src="${item.thumb || avatarItemImg(cat, item.itemId)}"
                style="width:80px;height:100px;object-fit:contain;image-rendering:pixelated;"
                onerror="this.style.opacity=0.2" />
              ${item.thumb ? `<span title="썸네일 별도 등록됨" style="position:absolute;top:0;right:0;font-size:9px;background:#6366f1;color:#fff;border-radius:3px;padding:1px 3px;line-height:1.4;">T</span>` : ''}
            </div>
            <div style="font-size:12px;font-weight:700;margin-top:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${item.name}</div>
            <div style="font-size:11px;color:var(--text-secondary);">ID: ${item.itemId}</div>
            <div style="font-size:12px;font-weight:700;color:${item.price===0?'#16a34a':'var(--primary)'};">${item.price===0?'🆓 무료':`🪙 ${item.price}`}</div>
            <div style="display:flex;gap:4px;justify-content:center;margin-top:4px;min-height:20px;">
              ${item.tagNew?'<span class="item-tag-new">New!</span>':''}
              ${item.tagHot?'<span class="item-tag-hot">Hot!</span>':''}
            </div>
            <div style="display:flex;gap:4px;justify-content:center;margin-top:6px;">
              <button onclick="openAvatarItemEdit(${avatarItemList.indexOf(item)})"
                style="font-size:11px;padding:2px 8px;background:var(--surface);border:1px solid var(--border);border-radius:4px;cursor:pointer;">수정</button>
              <button onclick="deleteAvatarItemByIdx(${avatarItemList.indexOf(item)})"
                style="font-size:11px;padding:2px 8px;background:none;border:1px solid #fca5a5;color:#ef4444;border-radius:4px;cursor:pointer;">삭제</button>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `).join('');
}

window.openAddAvatarItemModal = function() {
  document.getElementById('avItemCategory').value = 'hair';
  document.getElementById('avItemId').value = '';
  document.getElementById('avItemName').value = '';
  document.getElementById('avItemPrice').value = '0';
  document.getElementById('avItemDefault').checked = false;
  document.getElementById('avItemExt').value = 'png';
  document.getElementById('avItemLayerUrl').value = '';
  document.getElementById('avItemThumb').value = '';
  document.getElementById('avItemPreviewImg').src = '';
  document.getElementById('avItemPreviewImg').style.display = 'none';
  document.getElementById('avItemPreviewErr').style.display = 'block';
  document.getElementById('avItemThumbPreview').src = '';
  document.getElementById('avItemThumbPreview').style.display = 'none';
  document.getElementById('avItemThumbErr').style.display = 'block';
  document.getElementById('avItemEditIdx').value = '-1';
  document.getElementById('avItemTagNew').checked = false;
  document.getElementById('avItemTagHot').checked = false;
  document.getElementById('addAvatarItemModal').querySelector('.modal-title').textContent = '🧑 아바타 아이템 추가';
  openModal('addAvatarItemModal');
};

window.openAvatarItemEdit = function(idx) {
  const item = avatarItemList[idx];
  if (!item) return;
  document.getElementById('avItemCategory').value = item.category;
  document.getElementById('avItemId').value = item.itemId;
  document.getElementById('avItemName').value = item.name;
  document.getElementById('avItemPrice').value = item.price;
  document.getElementById('avItemDefault').checked = item.price === 0;
  document.getElementById('avItemExt').value = item.ext || 'png';
  document.getElementById('avItemLayerUrl').value = item.layerUrl || '';
  document.getElementById('avItemThumb').value = item.thumb || '';
  document.getElementById('avItemEditIdx').value = idx;
  document.getElementById('avItemTagNew').checked = !!item.tagNew;
  document.getElementById('avItemTagHot').checked = !!item.tagHot;
  document.getElementById('addAvatarItemModal').querySelector('.modal-title').textContent = '🧑 아바타 아이템 수정';
  updateAvItemPreview();
  openModal('addAvatarItemModal');
};

window.deleteAvatarItemByIdx = async function(idx) {
  const item = avatarItemList[idx];
  if (!item || !confirm(`'${item.name}'을(를) 삭제할까요?`)) return;
  avatarItemList.splice(idx, 1);
  await saveAvatarItemList();
  showToast('삭제됐어요');
  renderAvatarManage();
};

window.updateAvItemPreview = function() {
  const cat      = document.getElementById('avItemCategory').value;
  const id       = document.getElementById('avItemId').value;
  const ext      = document.getElementById('avItemExt').value || 'png';
  const layerUrl = document.getElementById('avItemLayerUrl').value.trim();
  const thumbUrl = document.getElementById('avItemThumb').value.trim();

  // ── 레이어 파일 미리보기 (layerUrl 우선, 없으면 GitHub Raw)
  const layerImg = document.getElementById('avItemPreviewImg');
  const layerErr = document.getElementById('avItemPreviewErr');
  const layerSrc = layerUrl || (id ? `${AVATAR_GITHUB_RAW}/${cat}/${id}.${ext}` : '');
  if (layerSrc) {
    layerImg.style.display = 'block';
    layerImg.src = layerSrc;
    layerImg.onload  = () => { layerErr.style.display = 'none'; };
    layerImg.onerror = () => { layerImg.style.display = 'none'; layerErr.style.display = 'block'; };
  } else {
    layerImg.style.display = 'none';
    layerErr.style.display = 'block';
  }

  // ── 썸네일 미리보기 (thumbUrl 없으면 layerUrl 사용)
  const thumbImg = document.getElementById('avItemThumbPreview');
  const thumbErr = document.getElementById('avItemThumbErr');
  const thumbSrc = thumbUrl || layerUrl;
  if (thumbSrc) {
    thumbImg.style.display = 'block';
    thumbImg.src = thumbSrc;
    thumbImg.onload  = () => { thumbErr.style.display = 'none'; };
    thumbImg.onerror = () => { thumbImg.style.display = 'none'; thumbErr.style.display = 'block'; thumbErr.textContent = '로드 실패'; };
  } else if (id) {
    // 썸네일 URL 없으면 레이어 파일로 대체 표시
    thumbImg.style.display = 'block';
    thumbImg.src = avatarItemImg(cat, id, ext);
    thumbImg.onload  = () => { thumbErr.style.display = 'none'; };
    thumbImg.onerror = () => { thumbImg.style.display = 'none'; thumbErr.style.display = 'block'; thumbErr.textContent = '미리보기'; };
  } else {
    thumbImg.style.display = 'none';
    thumbErr.style.display = 'block';
    thumbErr.textContent = '미리보기';
  }
};

window.saveAvatarItem = async function() {
  const category = document.getElementById('avItemCategory').value;
  const itemId   = parseInt(document.getElementById('avItemId').value);
  const name     = document.getElementById('avItemName').value.trim();
  const isDefault = document.getElementById('avItemDefault').checked;
  const price    = isDefault ? 0 : (parseInt(document.getElementById('avItemPrice').value) || 0);
  const ext      = document.getElementById('avItemExt').value || 'png';
  const layerUrl = document.getElementById('avItemLayerUrl').value.trim();
  const thumbRaw = document.getElementById('avItemThumb').value.trim();
  const thumb    = thumbRaw || layerUrl || '';
  const editIdx  = parseInt(document.getElementById('avItemEditIdx').value);
  if (!itemId || !name) return showToast('카테고리, ID, 이름을 입력하세요');

  const tagNew = document.getElementById('avItemTagNew').checked;
  const tagHot = document.getElementById('avItemTagHot').checked;

  const data = { category, itemId, name, price, ext,
    tagNew, tagHot,
    ...(layerUrl ? { layerUrl } : {}),
    ...(thumb ? { thumb } : {}) };

  if (editIdx >= 0) {
    avatarItemList[editIdx] = data;
  } else {
    const dup = avatarItemList.find(i => String(i.itemId) === String(itemId) && i.category === category);
    if (dup) return showToast(`이미 등록된 아이템이에요 (${dup.name})`);
    avatarItemList.push(data);
  }
  await saveAvatarItemList();
  closeModal('addAvatarItemModal');
  showToast(editIdx >= 0 ? '수정됐어요 ✅' : `'${name}' 추가됐어요 ✅`);
  renderAvatarManage();
};
