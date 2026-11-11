// pets.js — 펫 시스템
import { state } from './state.js?v=20261111d';
import {
  addDoc, collection, db, doc, getDoc, getDocs, increment, query, serverTimestamp, setDoc,
  updateDoc, where
} from './firebase.js?v=20261111d';
import { closeModal, openModal, showToast } from './core.js?v=20261111d';
import { reloadStudents } from './realtime.js?v=20261111d';
import { initFrameGrids, renderInventoryDecor } from './frames.js?v=20261111d';
import { renderInventoryAvatar, renderInventoryTitles } from './inventory.js?v=20261111d';
import { buildCharHtml } from './avatar.js?v=20261111d';
import { renderAvatarShop } from './avatar-shop.js?v=20261111d';
import { fadePanel } from './ui.js?v=20261111d';
import { renderExchanges } from './exchanges.js?v=20261111d';

// ===== 🐾 펫 시스템 =====
let petEquipped = null;   // 현재 착용한 펫 ID
let _editingPetId = null;

// 펫 데이터 로드
export async function loadPetList() {
  if (state.petList.length) return state.petList;
  const snap = await getDoc(doc(db, 'config', 'pets'));
  state.petList = snap.exists() ? (snap.data().items || []) : [];
  window._cachedPetList = state.petList;
  return state.petList;
}
async function savePetList() {
  window._cachedPetList = null;
  await setDoc(doc(db, 'config', 'pets'), { items: state.petList });
  state.petList = [];
  await loadPetList();
}

// 펫 보관함 로드
async function loadPetInventory() {
  const snap = await getDocs(query(collection(db,'petInventory'), where('studentId','==',state.currentUser.uid)));
  state.petInventory = new Set(snap.docs.map(d=>d.data().petId));
  const me = state.students.find(s=>s.id===state.currentUser.uid)||{};
  petEquipped = me.petEquipped || null;
}

// 교사: 펫 미리보기
window.updatePetPreview = function() {
  const url = document.getElementById('petImgUrl')?.value?.trim();
  const thumbUrl = document.getElementById('petThumbUrl')?.value?.trim();
  // 실제 이미지
  const img = document.getElementById('petPreviewImg');
  const err = document.getElementById('petPreviewErr');
  if (img && err) {
    if (url) { img.src=url; img.style.display='block'; err.style.display='none'; }
    else { img.style.display='none'; err.style.display='block'; }
  }
  // 썸네일 (비우면 실제 이미지로 대체)
  const tImg = document.getElementById('petThumbPreviewImg');
  const tErr = document.getElementById('petThumbPreviewErr');
  if (tImg && tErr) {
    const tSrc = thumbUrl || url;
    if (tSrc) { tImg.src=tSrc; tImg.style.display='block'; tErr.style.display='none'; }
    else { tImg.style.display='none'; tErr.style.display='block'; }
  }
};

// 교사: 펫 추가 모달 열기
window.openAddPetModal = function() {
  _editingPetId = null;
  document.getElementById('addPetModalTitle').textContent = '🐾 펫 추가';
  document.getElementById('petName').value = '';
  document.getElementById('petCategory').value = 'normal';
  document.getElementById('petPrice').value = '0';
  document.getElementById('petDefault').checked = false;
  document.getElementById('petImgUrl').value = '';
  document.getElementById('petThumbUrl').value = '';
  document.getElementById('petTagNew').checked = false;
  document.getElementById('petTagHot').checked = false;
  document.getElementById('petPreviewImg').style.display = 'none';
  document.getElementById('petPreviewErr').style.display = 'block';
  document.getElementById('petThumbPreviewImg').style.display = 'none';
  document.getElementById('petThumbPreviewErr').style.display = 'block';
  openModal('addPetModal');
};

// 교사: 펫 수정 모달 열기
window.openEditPetModal = function(petId) {
  _editingPetId = petId;
  const pet = state.petList.find(p=>p.id===petId); if (!pet) return;
  document.getElementById('addPetModalTitle').textContent = '🐾 펫 수정';
  document.getElementById('petName').value = pet.name || '';
  document.getElementById('petCategory').value = pet.category || 'normal';
  document.getElementById('petPrice').value = pet.price || 0;
  document.getElementById('petDefault').checked = !!pet.isDefault;
  document.getElementById('petImgUrl').value = pet.imgUrl || '';
  document.getElementById('petThumbUrl').value = pet.thumb || '';
  document.getElementById('petTagNew').checked = !!pet.tagNew;
  document.getElementById('petTagHot').checked = !!pet.tagHot;
  updatePetPreview();
  openModal('addPetModal');
};

// 교사: 펫 저장
window.savePet = async function() {
  const name = document.getElementById('petName').value.trim();
  const category = document.getElementById('petCategory').value;
  const price = parseInt(document.getElementById('petPrice').value)||0;
  const isDefault = document.getElementById('petDefault').checked;
  const imgUrl = document.getElementById('petImgUrl').value.trim();
  const thumb = document.getElementById('petThumbUrl').value.trim();
  const tagNew = document.getElementById('petTagNew').checked;
  const tagHot = document.getElementById('petTagHot').checked;
  if (!name) return showToast('펫 이름을 입력하세요');
  if (!imgUrl) return showToast('이미지 URL을 입력하세요');

  if (_editingPetId) {
    const idx = state.petList.findIndex(p=>p.id===_editingPetId);
    if (idx>=0) state.petList[idx] = { ...state.petList[idx], name, category, price, isDefault, imgUrl, thumb, tagNew, tagHot };
  } else {
    const newId = `pet_${Date.now()}`;
    state.petList.push({ id:newId, name, category, price, isDefault, imgUrl, thumb, tagNew, tagHot });
    // 기본 아이템이면 모든 학생에게 즉시 지급
    if (isDefault) {
      const vis = state.students.filter(s=>!s.hidden);
      for (const s of vis) {
        await setDoc(doc(db,'petInventory',`${s.id}_${newId}`), {
          studentId:s.id, petId:newId, petName:name, obtainedAt:serverTimestamp()
        });
      }
    }
  }
  await savePetList();
  closeModal('addPetModal');
  showToast('펫이 저장됐어요 ✅');
  renderPetManageGrid();
};

// 교사: 펫 삭제
window.deletePet = async function(petId) {
  const pet = state.petList.find(p=>p.id===petId);
  if (!confirm(`'${pet?.name}' 펫을 삭제할까요?`)) return;
  state.petList = state.petList.filter(p=>p.id!==petId);
  await savePetList();
  showToast('삭제됐어요');
  renderPetManageGrid();
};

// 교사: 펫 관리 그리드 렌더
export async function renderPetManageGrid() {
  const grid = document.getElementById('petManageGrid');
  if (!grid) return;
  await loadPetList();
  const CAT_LABELS = { normal:'일반', rare:'희귀', special:'특별', legend:'전설' };
  const CAT_COLORS = { normal:'#6b7280', rare:'#3b82f6', special:'#f59e0b', legend:'#8b5cf6' };
  const cats = ['normal','rare','special','legend'];

  if (!state.petList.length) {
    grid.innerHTML = '<div style="color:var(--text-muted);font-size:13px;padding:20px 0;">등록된 펫이 없어요. + 펫 추가 버튼을 눌러 추가하세요.</div>';
    return;
  }

  const grouped = {};
  cats.forEach(cat => {
    grouped[cat] = state.petList
      .filter(p => (p.category||'normal') === cat)
      .sort((a,b) => (a.price||0) - (b.price||0));
  });

  grid.innerHTML = cats.filter(cat => grouped[cat].length).map(cat => `
    <div style="background:var(--surface);border-radius:var(--radius-lg);border:1px solid var(--border);padding:14px;margin-bottom:10px;">
      <div style="font-size:14px;font-weight:700;margin-bottom:10px;display:flex;align-items:center;gap:6px;">
        <span style="width:10px;height:10px;border-radius:50%;background:${CAT_COLORS[cat]};display:inline-block;"></span>
        <span style="color:${CAT_COLORS[cat]};">${CAT_LABELS[cat]}</span>
        <span style="font-size:12px;color:var(--text-muted);font-weight:400;">${grouped[cat].length}마리</span>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:8px;">
        ${grouped[cat].map(p => `
          <div style="background:var(--bg);border-radius:var(--radius-md);padding:8px;border:1px solid var(--border);text-align:center;">
            <div style="position:relative;display:inline-block;">
              <img src="${p.thumb||p.imgUrl}" style="width:80px;height:80px;object-fit:contain;" onerror="this.style.opacity=0.2" />
              ${p.thumb?`<span title="썸네일 별도 등록됨" style="position:absolute;top:0;right:0;font-size:9px;background:#6366f1;color:#fff;border-radius:3px;padding:1px 3px;line-height:1.4;">T</span>`:''}
            </div>
            <div style="font-size:12px;font-weight:700;margin-top:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${p.name}">${p.name}</div>
            <div style="font-size:12px;font-weight:700;color:${p.isDefault?'#16a34a':'var(--primary)'};">${p.isDefault?'🆓 무료':`🪙 ${p.price}`}</div>
            <div style="display:flex;gap:4px;justify-content:center;margin-top:2px;min-height:18px;">
              ${p.tagNew?'<span class="item-tag-new">New!</span>':''}
              ${p.tagHot?'<span class="item-tag-hot">Hot!</span>':''}
            </div>
            <div style="display:flex;gap:4px;justify-content:center;margin-top:6px;">
              <button onclick="openEditPetModal('${p.id}')"
                style="font-size:11px;padding:2px 8px;background:var(--surface);border:1px solid var(--border);border-radius:4px;cursor:pointer;">수정</button>
              <button onclick="deletePet('${p.id}')"
                style="font-size:11px;padding:2px 8px;background:none;border:1px solid #fca5a5;color:#ef4444;border-radius:4px;cursor:pointer;">삭제</button>
            </div>
          </div>`).join('')}
      </div>
    </div>`).join('');
}

// 꾸미기 상점 탭 (프레임 / 아바타 / 펫)
window.switchDecorTab = function(tab, btn) {
  document.querySelectorAll('#page-decorShop .decor-top-tab').forEach(b=>b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  ['frame','avatar','pet'].forEach(t => {
    const el = document.getElementById(`decorTab${t.charAt(0).toUpperCase()+t.slice(1)}`);
    if (el) { el.style.display=t===tab?'':'none'; if(t===tab) fadePanel(el); }
  });
  if (tab==='frame') initFrameGrids(false);
  if (tab==='avatar') renderAvatarShop();
  if (tab==='pet') renderPetShop();
};

// 내 보관함 탭 (보상 / 칭호 / 꾸미기 / 아바타 / 펫)
window.switchInventoryTab = function(tab, btn) {
  document.querySelectorAll('#page-myInventory .decor-top-tab').forEach(b=>b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  ['reward','title','decor','avatar','pet'].forEach(t => {
    const el = document.getElementById(`inventoryTab${t.charAt(0).toUpperCase()+t.slice(1)}`);
    if (el) { el.style.display=t===tab?'':'none'; if(t===tab) fadePanel(el); }
  });
  if (tab==='title') renderInventoryTitles?.();
  if (tab==='decor') renderInventoryDecor?.();
  if (tab==='avatar') renderInventoryAvatar?.();
  if (tab==='pet') renderInventoryPet();
};

// 학생: 펫 상점 렌더 (7:3 레이아웃 + 등급별 탭)
async function renderPetShop() {
  const wrap = document.getElementById('petShopWrap');
  if (!wrap) return;
  wrap.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-secondary);">불러오는 중...</div>';

  state.petList = []; window._cachedPetList = null; // 항상 최신 데이터
  await loadPetList();
  await loadPetInventory();

  if (!state.petList.length) {
    wrap.innerHTML = '<div class="empty-state" style="padding:60px;"><div class="empty-icon">🐾</div><h3>아직 등록된 펫이 없어요</h3><p>선생님이 펫을 등록할 때까지 기다려주세요</p></div>';
    return;
  }

  const me = state.students.find(s => s.id === state.currentUser.uid) || {};
  let myGold = me.points || 0;
  const pendingPetIds = new Set();
  try {
    const exSnap = await getDocs(query(
      collection(db, 'exchanges'),
      where('studentId', '==', state.currentUser.uid),
      where('type', '==', 'pet'),
      where('status', '==', 'pending')
    ));
    exSnap.docs.forEach(d => pendingPetIds.add(d.data().rewardId));
  } catch(e) {}

  const CAT_LABELS = { normal:'일반', rare:'희귀', special:'특별', legend:'전설' };
  const CAT_COLORS = { normal:'#6b7280', rare:'#3b82f6', special:'#f59e0b', legend:'#8b5cf6' };
  const cats = ['normal','rare','special','legend'];

  const grouped = {};
  state.petList.forEach(p => { if (!grouped[p.category]) grouped[p.category] = []; grouped[p.category].push(p); });
  cats.forEach(cat => {
    if (grouped[cat]) grouped[cat].sort((a,b) => (a.price-b.price)||((a.name||'').localeCompare(b.name||'','ko')));
  });

  // 미리보기용 현재 착용 펫 (전역 petEquipped 기준)
  let previewPetId = petEquipped;

  function buildPreviewPanel() {
    const pet = state.petList.find(p=>p.id===previewPetId);
    const avatarHtml = buildCharHtml({id:state.currentUser.uid,avatarEquipped:me.avatarEquipped,avatarEquippedMeta:me.avatarEquippedMeta});
    return `
      <!-- 캐릭터+펫 미리보기 -->
      <div style="font-size:11px;color:var(--text-secondary);font-weight:600;margin-bottom:8px;">꾸미기 미리보기</div>
      <div style="background:rgba(255,255,255,0.85);border-radius:14px;padding:16px 12px;margin-bottom:12px;min-height:100px;
        display:flex;align-items:flex-end;justify-content:center;border:1px solid rgba(99,102,241,0.15);">
        <div style="width:160px;display:flex;align-items:flex-end;">
          <div style="flex:7;display:flex;justify-content:flex-end;">${avatarHtml}</div>
          <div style="flex:3;display:flex;align-items:flex-end;justify-content:flex-start;">
            ${pet ? `<img src="${pet.imgUrl}" style="width:60px;height:100px;object-fit:contain;" onerror="this.style.display='none'" />` :
              `<div style="width:48px;height:60px;border:2px dashed #c7d2fe;border-radius:10px;display:flex;align-items:center;justify-content:center;"><span style="font-size:18px;">🐾</span></div>`}
          </div>
        </div>
      </div>
      <!-- 착용 펫 -->
      <div style="font-size:11px;text-align:left;min-height:20px;margin-bottom:10px;padding:0 2px;">
        ${pet ? `<span style="font-size:11px;color:var(--text-secondary);">🐾 ${pet.name}</span>` : '<span style="font-size:11px;color:var(--text-muted);">착용 중인 펫 없음</span>'}
      </div>
      <!-- 구매/착용 버튼 -->
      <div id="petBuyArea">
        ${previewPetId ? (() => {
          const p = state.petList.find(x=>x.id===previewPetId);
          if (!p) return '';
          const owned = state.petInventory.has(p.id);
          const isEquipped = petEquipped===p.id;
          const isPending = pendingPetIds.has(p.id);
          if (isEquipped) return `<button onclick="petUnequip()" class="btn btn-secondary btn-full" style="font-size:12px;padding:9px;">🐾 착용 해제</button>`;
          if (owned) return `<button onclick="petEquip('${p.id}')" class="btn btn-success btn-full" style="font-size:12px;padding:9px;">💾 착용 저장</button>`;
          if (isPending) return `<button disabled class="btn btn-secondary btn-full" style="font-size:12px;padding:9px;background:var(--text-muted);">⏳ 신청 중</button>`;
          return `<button onclick="petBuyFromShop('${p.id}')" class="btn btn-primary btn-full" style="font-size:12px;padding:9px;">구매 (🪙${p.price})</button>`;
        })() : ''}
      </div>
      <button class="btn btn-secondary btn-full" style="font-size:11px;padding:7px;margin-top:6px;" onclick="previewPetReset()">🔄 미리보기 초기화</button>`;
  }

  wrap.innerHTML = `
  <div style="display:grid;grid-template-columns:210px 1fr;gap:20px;align-items:start;">
    <!-- 왼쪽: 미리보기 패널 -->
    <div style="position:sticky;top:0;">
      <div id="petShopPreviewPanel" style="background:linear-gradient(160deg,#d1fae5 0%,#f0fdf4 100%);border-radius:var(--radius-lg);padding:18px 14px;border:1px solid var(--border);text-align:center;">
        ${buildPreviewPanel()}
      </div>
    </div>
    <!-- 오른쪽: 펫 목록 -->
    <div style="display:flex;flex-direction:column;gap:16px;">
      ${cats.filter(cat=>grouped[cat]?.length).map(cat => {
        const items = grouped[cat];
        return `
        <div style="background:var(--surface);border-radius:var(--radius-lg);border:1px solid var(--border);padding:16px;">
          <div style="font-size:16px;font-weight:700;margin-bottom:12px;display:flex;align-items:center;gap:6px;">
            <span style="width:12px;height:12px;border-radius:50%;background:${CAT_COLORS[cat]};display:inline-block;"></span>
            <span style="color:${CAT_COLORS[cat]};">${CAT_LABELS[cat]}</span>
            <span style="font-size:13px;color:var(--text-muted);font-weight:400;margin-left:4px;">${items.length}종</span>
          </div>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:10px;">
            ${items.map(pet => {
              const owned = state.petInventory.has(pet.id);
              const isPreviewing = previewPetId === pet.id;
              const isEquipped = petEquipped === pet.id;
              const isFree = pet.price === 0;
              const isPending = pendingPetIds.has(pet.id);
              return `
              <div data-pet-id="${pet.id}" style="text-align:center;cursor:pointer;" onclick="petShopPreviewToggle('${pet.id}')">
                <div style="border-radius:10px;border:2px solid ${isPreviewing?CAT_COLORS[cat]:owned?'#22c55e':'var(--border)'};
                  background:${isPreviewing?CAT_COLORS[cat]+'22':owned?'#f0fdf4':'var(--bg)'};
                  padding:4px;transition:all 0.15s;margin-bottom:4px;overflow:hidden;">
                  <!-- 태그 영역 -->
                  <div style="height:20px;display:flex;align-items:center;justify-content:space-between;padding:0 2px;margin-bottom:2px;">
                    <div style="flex:1;display:flex;justify-content:flex-start;">
                      ${isEquipped ? `<span style="font-size:9px;background:#059669;color:#fff;border-radius:4px;padding:1px 5px;font-weight:700;">ON</span>` : '<span></span>'}
                    </div>
                    <div style="flex:1;display:flex;justify-content:center;">
                      ${pet.tagNew ? `<span class="av-top-tag new" style="position:static;transform:none;font-size:9px;">New!</span>` : pet.tagHot ? `<span class="av-top-tag hot" style="position:static;transform:none;font-size:9px;">Hot!</span>` : ''}
                    </div>
                    <div style="flex:1;display:flex;justify-content:flex-end;">
                      ${(!owned&&!isFree) ? `<span style="font-size:12px;">🔒</span>` : '<span></span>'}
                    </div>
                  </div>
                  <!-- 펫 썸네일 100×100 정사각형 -->
                  <img src="${pet.thumb||pet.imgUrl}" style="width:100px;height:100px;object-fit:contain;display:block;margin:0 auto;
                    ${(!owned&&!isEquipped)?'filter:grayscale(55%) opacity(0.65);':''}"
                    onerror="this.style.display='none'" />
                </div>
                <div style="font-size:12px;color:var(--text-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:0 2px;">${pet.name}</div>
                <div style="font-size:12px;font-weight:700;color:${isPreviewing?CAT_COLORS[cat]:owned?'#22c55e':'var(--primary)'};">
                  ${isEquipped?'✓착용':owned?'보유':isFree?'무료':`🪙${pet.price}`}
                </div>
                ${(!owned&&!isFree) ? `<button
                  onclick="event.stopPropagation();petBuyFromShopBtn(this)"
                  data-pet-id="${pet.id}"
                  data-price="${pet.price}"
                  class="btn btn-primary btn-sm"
                  style="width:100%;font-size:12px;padding:6px 4px;margin-top:4px;border-radius:6px;display:block;box-sizing:border-box;${isPending?'background:var(--text-muted);cursor:default;':''}"
                  ${isPending?'disabled':''}>
                  ${isPending?'⏳ 신청 중':'구매'}
                </button>` : ''}
              </div>`;
            }).join('')}
          </div>
        </div>`;
      }).join('')}
    </div>
  </div>`;

  // 미리보기 토글
  window.petShopPreviewToggle = function(petId) {
    previewPetId = previewPetId===petId ? null : petId;
    const panel = document.getElementById('petShopPreviewPanel');
    if (panel) panel.innerHTML = buildPreviewPanel();
    // 아이템 카드 선택 표시 갱신
    wrap.querySelectorAll('[data-pet-id]').forEach(el => {
      const pid = el.dataset.petId;
      const pet = state.petList.find(p=>p.id===pid);
      if (!pet) return;
      const box = el.querySelector('div');
      const owned = state.petInventory.has(pid);
      const color = CAT_COLORS[pet.category];
      const isPrev = previewPetId===pid;
      if (box) {
        box.style.border = `2px solid ${isPrev?color:owned?'#22c55e':'var(--border)'}`;
        box.style.background = isPrev?color+'22':owned?'#f0fdf4':'var(--bg)';
      }
      const statusEl = el.querySelectorAll('div')[1];
      if (statusEl) statusEl.style.color = isPrev?color:owned?'#22c55e':'var(--primary)';
    });
  };

  // 버튼 클릭 구매
  window.petBuyFromShopBtn = function(btn) {
    petBuyFromShop(btn.dataset.petId);
  };

  // 미리보기 초기화
  window.previewPetReset = function() {
    previewPetId = null;
    const panel = document.getElementById('petShopPreviewPanel');
    if (panel) panel.innerHTML = buildPreviewPanel();
    wrap.querySelectorAll('[data-pet-id]').forEach(el => {
      const box = el.querySelector('div');
      const pid = el.dataset.petId;
      const owned = state.petInventory.has(pid);
      if (box) {
        box.style.border = `2px solid ${owned?'#22c55e':'var(--border)'}`;
        box.style.background = owned?'#f0fdf4':'var(--bg)';
      }
    });
  };
}

window.petBuyFromShop = async function(petId) {
  const pet = state.petList.find(p=>p.id===petId); if (!pet) return;
  const me = state.students.find(s=>s.id===state.currentUser.uid)||{};
  const myGold = me.points||0;
  if (myGold < pet.price) return showToast(`골드가 부족해요 (보유: 🪙${myGold.toLocaleString()}, 필요: 🪙${pet.price})`);
  if (!confirm(`'${pet.name}'을(를) 🪙${pet.price}에 구매 신청할까요?\n선생님 승인 후 보관함에 들어옵니다.`)) return;
  await addDoc(collection(db,'exchanges'), {
    studentId:state.currentUser.uid, studentName:state.currentUser.name,
    type:'pet', rewardId:petId, rewardName:pet.name, rewardImg:pet.imgUrl,
    cost:pet.price, status:'pending', createdAt:serverTimestamp()
  });
  await updateDoc(doc(db,'students',state.currentUser.uid), { points: increment(-pet.price) });
  showToast('구매 신청 완료! 선생님 승인을 기다려요 😊');
  await reloadStudents();
  renderPetShop();
};

// 학생: 펫 착용 + 보관함 즉시 미리보기 갱신
window.petEquipAndPreview = async function(petId) {
  petEquipped = petId;
  await updateDoc(doc(db,'students',state.currentUser.uid), { petEquipped: petId });
  // 미리보기 패널만 즉시 갱신
  const previewEl = document.getElementById('invPetPreview');
  if (previewEl) {
    const pet = state.petList.find(p=>p.id===petId);
    previewEl.innerHTML = pet
      ? `<img src="${pet.imgUrl}" style="width:60px;height:100px;object-fit:contain;" onerror="this.style.display='none'" />`
      : `<div style="font-size:32px;">🐾</div><div style="font-size:11px;color:var(--text-muted);margin-top:4px;">없음</div>`;
  }
  // 아이템 카드 ON 배지 갱신
  await reloadStudents();
  renderInventoryPet();
};
// 학생: 펫 착용
window.petEquip = async function(petId) {
  const pet = state.petList.find(p=>p.id===petId); if (!pet) return;
  petEquipped = petId;
  await updateDoc(doc(db,'students',state.currentUser.uid), { petEquipped: petId });
  showToast(`${pet.name} 착용! 🐾`);
  await reloadStudents();
  renderPetShop();
};
window.petUnequip = async function() {
  petEquipped = null;
  await updateDoc(doc(db,'students',state.currentUser.uid), { petEquipped: null });
  showToast('펫 착용이 해제됐어요');
  await reloadStudents();
  renderPetShop();
};

// 학생: 펫 구매 신청 (아바타와 동일한 교환 방식)
window.petBuy = async function(petId) {
  const pet = state.petList.find(p=>p.id===petId); if (!pet) return;
  const me = state.students.find(s=>s.id===state.currentUser.uid)||{};
  const myGold = me.points||0;
  if (myGold < pet.price) return showToast('포인트가 부족해요');
  if (!confirm(`'${pet.name}'을(를) 🪙${pet.price}에 구매 신청할까요?\n선생님 승인 후 보관함에 들어옵니다.`)) return;
  await addDoc(collection(db,'exchanges'), {
    studentId:state.currentUser.uid, studentName:state.currentUser.name,
    type:'pet', rewardId:petId, rewardName:pet.name, rewardImg:pet.imgUrl,
    cost:pet.price, status:'pending', createdAt:serverTimestamp()
  });
  await updateDoc(doc(db,'students',state.currentUser.uid), { points: increment(-pet.price) });
  showToast('구매 신청 완료! 선생님 승인을 기다려요 😊');
  await reloadStudents();
  renderPetShop();
};

// 학생: 펫 보관함 렌더 (아바타 보관함과 동일한 인터페이스)
window.renderInventoryPet = renderInventoryPet; // 펫 해제 버튼에서 호출
export async function renderInventoryPet() {
  const wrap = document.getElementById('inventoryPetContent');
  if (!wrap) return;
  wrap.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted);">불러오는 중...</div>';
  await loadPetList();
  await loadPetInventory();

  const ownedPets = state.petList.filter(p => state.petInventory.has(p.id));
  if (!ownedPets.length) {
    wrap.innerHTML = `<div class="empty-state" style="padding:60px;">
      <div class="empty-icon">🐾</div>
      <h3>보유한 펫이 없어요</h3>
      <p>꾸미기 상점 → 펫 탭에서 구매해 보세요!</p>
    </div>`;
    return;
  }

  const CAT_LABELS = { normal:'일반', rare:'희귀', special:'특별', legend:'전설' };
  const CAT_COLORS = { normal:'#6b7280', rare:'#3b82f6', special:'#f59e0b', legend:'#8b5cf6' };
  const cats = ['normal','rare','special','legend'];

  // 등급별 그룹
  const grouped = {};
  ownedPets.forEach(p => {
    if (!grouped[p.category]) grouped[p.category] = [];
    grouped[p.category].push(p);
  });

  let currentEquipped = petEquipped;

  function renderPreview() {
    const pet = state.petList.find(p=>p.id===currentEquipped);
    const previewEl = document.getElementById('invPetPreview');
    if (!previewEl) return;
    previewEl.innerHTML = pet
      ? `<img src="${pet.imgUrl}" style="width:60px;height:100px;object-fit:contain;" onerror="this.style.display='none'" />`
      : `<div style="font-size:32px;">🐾</div><div style="font-size:11px;color:var(--text-muted);margin-top:4px;">없음</div>`;
  }

  wrap.innerHTML = `
  <div style="display:grid;grid-template-columns:180px 1fr;gap:20px;align-items:start;margin-top:12px;">
    <!-- 왼쪽: 미리보기 -->
    <div style="position:sticky;top:0;">
      <div style="background:linear-gradient(160deg,#d1fae5,#f0fdf4);border-radius:var(--radius-lg);padding:16px 12px;border:1px solid var(--border);text-align:center;">
        <div style="font-size:13px;color:var(--text-secondary);font-weight:600;margin-bottom:8px;">착용 중인 펫</div>
        <div style="background:rgba(255,255,255,0.85);border-radius:12px;padding:14px 10px;min-height:96px;
          display:flex;flex-direction:column;align-items:center;justify-content:center;margin-bottom:10px;border:1px solid rgba(5,150,105,0.15);">
          <div id="invPetPreview"></div>
        </div>
        <button class="btn btn-danger btn-full" style="font-size:12px;padding:8px;margin-top:6px;" onclick="petUnequip();renderInventoryPet();">
          🐾 착용 해제
        </button>
      </div>
    </div>

    <!-- 오른쪽: 등급별 보유 목록 -->
    <div style="display:flex;flex-direction:column;gap:14px;">
      ${cats.filter(cat=>grouped[cat]?.length).map(cat=>`
      <div style="background:var(--surface);border-radius:var(--radius-lg);border:1px solid var(--border);padding:14px;">
        <div style="font-size:15px;font-weight:700;margin-bottom:10px;color:${CAT_COLORS[cat]};">
          ${CAT_LABELS[cat]}
          <span style="font-size:13px;color:var(--text-muted);font-weight:400;">${grouped[cat].length}마리 보유</span>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:8px;">
          ${grouped[cat].map(pet=>{
            const isOn = currentEquipped===pet.id;
            return `<div style="text-align:center;cursor:pointer;" onclick="petEquipAndPreview('${pet.id}')">
              <div style="border-radius:8px;border:2px solid ${isOn?CAT_COLORS[cat]:'var(--border)'};background:${isOn?CAT_COLORS[cat]+'11':'var(--bg)'};padding:6px;position:relative;transition:all 0.15s;margin-bottom:3px;">
                <img src="${pet.thumb||pet.imgUrl}" style="width:60px;height:80px;object-fit:contain;display:block;margin:0 auto;" onerror="this.style.display='none'" />
                ${isOn?`<div style="position:absolute;top:2px;left:2px;font-size:9px;background:${CAT_COLORS[cat]};color:#fff;border-radius:3px;padding:1px 4px;font-weight:700;">ON</div>`:''}
              </div>
              <div style="font-size:11px;color:var(--text-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${pet.name}</div>
              <div style="font-size:12px;font-weight:700;color:${isOn?CAT_COLORS[cat]:'var(--text-muted)'};">${isOn?'착용 중':'보유'}</div>
            </div>`;
          }).join('')}
        </div>
      </div>`).join('')}
    </div>
  </div>`;

  renderPreview();
}

// 교사: 펫 구매 승인 (exchanges에서 type==='pet')
window.approveExchange = async function(exId) {
  const snap = await getDoc(doc(db,'exchanges',exId));
  if (!snap.exists()) return showToast('신청 내역을 찾을 수 없어요');
  const ex = snap.data();
  if (ex.type === 'pet') {
    if (ex.status && ex.status !== 'pending') return showToast('이미 처리된 신청이에요');
    await setDoc(doc(db,'petInventory',`${ex.studentId}_${ex.rewardId}`), {
      studentId:ex.studentId, petId:ex.rewardId, petName:ex.rewardName,
      obtainedAt:serverTimestamp()
    });
    await updateDoc(doc(db,'exchanges',exId), { status:'approved', approvedAt:serverTimestamp() });
    await addDoc(collection(db,'notifications'), {
      studentId:ex.studentId, type:'exchangeApproved',
      rewardName:ex.rewardName, createdAt:serverTimestamp(), read:false
    });
    showToast(`${ex.studentName} 펫 구매 승인 ✅`);
    renderExchanges();
    return;
  }
};
