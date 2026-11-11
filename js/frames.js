// frames.js — 프레임 시스템 (상점·추가·수정)
import { state } from './state.js?v=20261111d';
import {
  addDoc, collection, db, doc, getDoc, getDocs, increment, query, serverTimestamp, setDoc,
  updateDoc, where
} from './firebase.js?v=20261111d';
import { closeModal, getMyStudentData, openModal, showToast } from './core.js?v=20261111d';
import { reloadStudents } from './realtime.js?v=20261111d';
import { AVATAR_MANNEQUIN, buildCharHtml } from './avatar.js?v=20261111d';

// ===== 프레임 시스템 =====
export const FRAME_DATA = {
  cotton:     { name:'코튼 캔디',   grade:'normal',  price:2000, css:'frame-bg-cotton',    neonTxt:'' },
  mint:       { name:'민트 초코',   grade:'normal',  price:2000, css:'frame-bg-mint',      neonTxt:'' },
  peach:      { name:'피치 멜로우', grade:'normal',  price:2000, css:'frame-bg-peach',     neonTxt:'' },
  spring:     { name:'스프링 가든', grade:'normal',  price:2000, css:'frame-bg-spring',    neonTxt:'' },
  strawberry: { name:'딸기 라떼',   grade:'normal',  price:2000, css:'frame-bg-strawberry',neonTxt:'' },
  bubble:     { name:'버블 판타지', grade:'normal',  price:2000, css:'frame-bg-bubble',    neonTxt:'' },
  pinkflame:  { name:'핑크 플레임', grade:'rare',    price:4000, css:'frame-bg-pinkflame', neonTxt:'' },
  oceanmint:  { name:'오션 민트',   grade:'rare',    price:4000, css:'frame-bg-oceanmint', neonTxt:'' },
  aurora:     { name:'오로라',      grade:'rare',    price:4000, css:'frame-bg-aurora',    neonTxt:'' },
  lavender:   { name:'라벤더 드림', grade:'rare',    price:4000, css:'frame-bg-lavender',  neonTxt:'' },
  rose:       { name:'로즈 가든',   grade:'rare',    price:4000, css:'frame-bg-rose',      neonTxt:'' },
  cosmic:     { name:'코스믹',      grade:'rare',    price:4000, css:'frame-bg-cosmic',    neonTxt:'' },
  aqua:       { name:'사이버 아쿠아',grade:'special', price:6000, css:'frame-bg-aqua',     neonTxt:'neon-aqua-txt' },
  magenta:    { name:'네온 마젠타', grade:'special', price:6000, css:'frame-bg-magenta',   neonTxt:'neon-magenta-txt' },
  matrix:     { name:'매트릭스 그린',grade:'special',price:6000, css:'frame-bg-matrix',   neonTxt:'neon-matrix-txt' },
  cyborange:  { name:'사이버 오렌지',grade:'special', price:6000, css:'frame-bg-cyborange', neonTxt:'neon-orange-txt' },
  elecblue:   { name:'일렉트릭 블루',grade:'special', price:6000, css:'frame-bg-elecblue', neonTxt:'neon-blue-txt' },
  laserpink:  { name:'레이저 핑크', grade:'special', price:6000, css:'frame-bg-laserpink', neonTxt:'neon-pink-txt' },
};

const FRAME_GRADE_LABEL = { normal:'⭐ 일반', rare:'💙 희귀', special:'✨ 특별', epic:'🔥 영웅', legend:'👑 전설' };
const FRAME_GRADE_CSS   = { normal:'badge-normal', rare:'badge-rare', special:'badge-special', epic:'badge-epic', legend:'badge-legend' };

function makeFrameCard(id, f, isTeacher, owned) {
  const txtCls = f.neonTxt || '';
  const imgStyle = f.imgUrl ? `background-image:url('${f.imgUrl}');background-size:cover;background-position:center;` : '';
  const isEmojiPattern = !!f.emojiPattern;
  const canvasId = `fpc_${id}_${Date.now()}`;
  const nameTxt = `<span class="${txtCls}" style="${txtCls?'':'color:#fff;text-shadow:0 1px 4px rgba(0,0,0,0.4);'}font-size:18px;font-weight:700;">${f.name}</span>`;
  const ptsTxt  = `<span class="${txtCls}" style="${txtCls?'':'color:rgba(255,255,255,0.95);text-shadow:0 1px 3px rgba(0,0,0,0.3);'}font-size:16px;font-weight:800;">🪙 ${f.price.toLocaleString()}</span>`;
  const lvTxt   = `<span class="${txtCls}" style="${txtCls?'':'color:rgba(255,255,255,0.9);'}font-size:14px;font-weight:700;">Lv.1</span>`;
  // 프레임 카드 배지: 어두운 배경에서도 잘 보이게 항상 반투명 흰색 스타일
  const badgeBg = {
    normal:  'rgba(255,255,255,0.25)',
    rare:    'rgba(100,180,255,0.35)',
    special: 'rgba(255,255,255,0.2)',
    epic:    'rgba(255,100,50,0.35)',
    legend:  'rgba(255,200,50,0.35)',
  }[f.grade] || 'rgba(255,255,255,0.2)';
  const titleBadge = `<span style="font-size:12px;padding:4px 12px;border-radius:8px;background:${badgeBg};color:#fff;font-weight:700;text-shadow:0 1px 3px rgba(0,0,0,0.5);border:1px solid rgba(255,255,255,0.4);">${FRAME_GRADE_LABEL[f.grade]}</span>`;
  const bottomBtns = isTeacher
    ? `<div class="frame-preview-btns">
        <button onclick="openEditFrameModal('${id}')" style="background:none;border:none;cursor:pointer;font-size:12px;font-weight:600;color:rgba(255,255,255,0.8);font-family:inherit;padding:0;text-shadow:0 1px 3px rgba(0,0,0,0.4);">수정</button>
        <button onclick="openDeleteFrameModal('${id}')" style="background:none;border:none;cursor:pointer;font-size:12px;font-weight:600;color:rgba(255,120,120,1);font-family:inherit;padding:0;text-shadow:0 1px 3px rgba(0,0,0,0.4);">삭제</button>
      </div>`
    : owned
      ? `<div style="font-size:12px;font-weight:600;color:rgba(255,255,255,0.7);margin-top:8px;text-shadow:0 1px 3px rgba(0,0,0,0.3);">✅ 소지 중</div>`
      : `<button class="btn btn-primary btn-sm frame-preview-buy" style="text-align:center;white-space:nowrap;width:90%;" onclick="openBuyFrameModal('${id}')">구매하기</button>`;

  // 이모지 패턴: canvas를 z-index:0 배경으로, 내용물은 z-index:1
  const emojiCanvasHtml = isEmojiPattern
    ? `<canvas id="${canvasId}" width="160" height="240" style="position:absolute;inset:0;width:100%;height:100%;border-radius:var(--radius-lg);z-index:0;"></canvas>`
    : '';
  // 모든 프레임 동일한 내부 구조 (이모지만 position:relative 추가)
  const previewExtraStyle = isEmojiPattern ? 'position:relative;overflow:hidden;' : '';

  // 프리뷰 캐릭터: 학생이면 착용 top 우선, 없으면 성별 GIF / 교사면 male.gif 고정
  const previewCharHtml = !isTeacher
    ? buildCharHtml({ id: state.currentUser?.uid, avatarEquipped: state.avatarEquipped, avatarEquippedMeta: state.avatarEquippedMeta }, 'margin:0 auto;filter:drop-shadow(0 2px 8px rgba(0,0,0,0.25));' + (isEmojiPattern ? 'position:relative;z-index:1;' : ''))
    : `<img src="${AVATAR_MANNEQUIN}" style="width:80px;height:100px;object-fit:contain;image-rendering:pixelated;filter:drop-shadow(0 2px 8px rgba(0,0,0,0.25));" />`;

  return `
  <div class="frame-card" style="${!isTeacher && owned ? 'filter:grayscale(100%);' : ''}">
    <div class="frame-preview ${f.imgUrl ? '' : (isEmojiPattern ? '' : f.css)}"
      style="${imgStyle}${previewExtraStyle}"
      ${isEmojiPattern ? `id="${canvasId}_wrap"` : ''}>
      ${emojiCanvasHtml}
      <div class="frame-preview-title" style="${isEmojiPattern ? 'position:relative;z-index:1;' : ''}">${titleBadge}</div>
      ${previewCharHtml}
      <span class="${txtCls}" style="${txtCls?'':'color:#fff;text-shadow:0 1px 4px rgba(0,0,0,0.4);'}font-size:18px;font-weight:700;${isEmojiPattern ? 'position:relative;z-index:1;' : ''}">${f.name}</span>
      <span class="${txtCls}" style="${txtCls?'':'color:rgba(255,255,255,0.95);text-shadow:0 1px 3px rgba(0,0,0,0.3);'}font-size:16px;font-weight:800;${isEmojiPattern ? 'position:relative;z-index:1;' : ''}">🪙 ${f.price.toLocaleString()}</span>
      <span class="${txtCls}" style="${txtCls?'':'color:rgba(255,255,255,0.9);'}font-size:14px;font-weight:700;${isEmojiPattern ? 'position:relative;z-index:1;' : ''}">Lv.1</span>
      <div style="${isEmojiPattern ? 'position:relative;z-index:1;' : ''}">${bottomBtns}</div>
    </div>
  </div>`;
}

export async function renderFrameGrid(containerId, isTeacher) {
  const grades = ['normal','rare','special','epic','legend'];
  const gradeNames = { normal:'⭐ 일반 등급', rare:'💙 희귀 등급', special:'✨ 특별 등급', epic:'🔥 영웅 등급', legend:'👑 전설 등급' };

  // 학생 소유 프레임 조회
  let ownedSet = new Set();
  let deletedSet = new Set();
  if (!isTeacher && state.currentUser) {
    try {
      const [ownSnap, delSnap] = await Promise.all([
        getDocs(query(collection(db, 'frameInventory'), where('studentId','==', state.currentUser.uid))),
        getDocs(collection(db, 'frameDeleted'))
      ]);
      ownSnap.docs.forEach(d => ownedSet.add(d.data().frameId));
      delSnap.docs.filter(d => d.data().studentId === state.currentUser.uid).forEach(d => deletedSet.add(d.data().frameId));
    } catch(e) {}
  }

  let html = '';
  for (const grade of grades) {
    const items = Object.entries(FRAME_DATA).filter(([,f]) => f.grade === grade);
    if (!items.length) continue;
html += `<div class="section-grade-header">${gradeNames[grade]}</div>`;
    html += `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:16px;margin-bottom:24px;">`;
    html += items.map(([id,f]) => {
      const owned = ownedSet.has(id) || deletedSet.has(id);
      return makeFrameCard(id, f, isTeacher, owned);
    }).join('');
    html += '</div>';
  }
  const el = document.getElementById(containerId);
  if (el) {
    el.innerHTML = html;
    setTimeout(() => {
      Object.entries(FRAME_DATA).forEach(([id, f]) => {
        if (!f.emojiPattern) return;
        el.querySelectorAll(`canvas[id^="fpc_${id}_"]`).forEach(c => {
          renderEmojiPatternCanvas(c, f.emojiPattern);
        });
      });
    }, 30);
  }
}

// 프레임 렌더 진입점
export function initFrameGrids(isTeacher) {
  if (isTeacher) {
    renderFrameGrid('manageFrameGrid', true);
  } else {
    renderFrameGrid('shopFrameGrid', false);
  }
}

// ===== 교사: 프레임 수정 =====
let editingFrameId = null;
let currentEditFrameTab = 'emoji';
let editSelectedFrameSample = null;

window.openEditFrameModal = function(id) {
  editingFrameId = id;
  const f = FRAME_DATA[id];
  editSelectedFrameSample = null;
  document.getElementById('editFrameName').value = f.name;
  document.getElementById('editFramePrice').value = f.price;
  document.getElementById('editFrameGrade').value = f.grade;

  // 기존 데이터로 탭/패널 초기화
  if (f.emojiPattern) {
    switchEditFrameTab('emoji');
    const cfg = f.emojiPattern;
    document.getElementById('eEditEmojiChar').value = cfg.emoji || '💓';
    document.getElementById('eEditBgColor').value   = cfg.bg || '#1a1a3e';
    document.getElementById('eEditBgText').value    = cfg.bg || '#1a1a3e';
    document.getElementById('eEditSize').value      = cfg.size || 22;
    document.getElementById('eEditGap').value       = cfg.gap || 38;
    document.getElementById('eEditAlpha').value     = cfg.alpha || 70;
    document.getElementById('eEditSizeOut').textContent  = (cfg.size||22) + 'px';
    document.getElementById('eEditGapOut').textContent   = cfg.gap || 38;
    document.getElementById('eEditAlphaOut').textContent = (cfg.alpha||70) + '%';
    setTimeout(drawEditEmojiPreview, 80);
  } else if (f.imgUrl) {
    switchEditFrameTab('url');
    document.getElementById('eEditImgUrl').value = f.imgUrl;
    previewEditFrame();
  } else {
    switchEditFrameTab('sample');
  }
  openModal('editFrameModal');
};

window.switchEditFrameTab = function(tab, btn) {
  currentEditFrameTab = tab;
  ['emoji','url','sample'].forEach(t => {
    const el = document.getElementById('editFrameTab' + t.charAt(0).toUpperCase() + t.slice(1));
    if (el) el.style.display = t === tab ? '' : 'none';
  });
  document.querySelectorAll('.frame-edit-tab').forEach(b => {
    b.className = b.dataset.tab === tab
      ? 'frame-edit-tab btn btn-primary btn-sm active'
      : 'frame-edit-tab btn btn-secondary btn-sm';
  });
  if (tab === 'sample') renderEditFrameSamples();
  if (tab === 'emoji') setTimeout(drawEditEmojiPreview, 50);
};

window.setEditColor = function(hex) {
  document.getElementById('eEditBgColor').value = hex;
  document.getElementById('eEditBgText').value = hex;
  drawEditEmojiPreview();
};
window.syncEditColorText = function() {
  document.getElementById('eEditBgText').value = document.getElementById('eEditBgColor').value;
};
window.syncEditColorPicker = function() {
  const v = document.getElementById('eEditBgText').value;
  if (/^#[0-9a-fA-F]{6}$/.test(v)) document.getElementById('eEditBgColor').value = v;
};

window.drawEditEmojiPreview = function() {
  const canvas = document.getElementById('eEditCanvas');
  if (!canvas) return;
  const cfg = {
    emoji: document.getElementById('eEditEmojiChar')?.value || '💓',
    bg:    document.getElementById('eEditBgColor')?.value   || '#1a1a3e',
    size:  parseInt(document.getElementById('eEditSize')?.value  || 22),
    gap:   parseInt(document.getElementById('eEditGap')?.value   || 38),
    alpha: parseInt(document.getElementById('eEditAlpha')?.value || 70),
  };
  renderEmojiPatternCanvas(canvas, cfg);
};

window.previewEditFrame = function() {
  const url = document.getElementById('eEditImgUrl')?.value?.trim();
  const preview = document.getElementById('eEditImgPreview');
  if (url && preview) {
    preview.style.display = 'block';
    preview.innerHTML = `<img src="${url}" style="width:100%;height:100%;object-fit:cover;" onerror="this.parentElement.style.display='none'" />`;
  } else if (preview) preview.style.display = 'none';
};

window.renderEditFrameSamples = function() {
  const grade = document.getElementById('editFrameGrade').value;
  const samples = FRAME_SAMPLES[grade] || [];
  const grid = document.getElementById('editFrameSampleGrid');
  if (!grid) return;
  const SAMPLE_INLINE = {
    'frame-bg-cotton':'background:linear-gradient(135deg,#fce4ec,#f8bbd0,#f48fb1);',
    'frame-bg-mint':'background:linear-gradient(135deg,#e0f7fa,#b2ebf2,#80deea);',
    'frame-bg-peach':'background:linear-gradient(135deg,#fff3e0,#ffe0b2,#ffcc80);',
    'frame-bg-spring':'background:linear-gradient(135deg,#f1f8e9,#dcedc8,#c5e1a5);',
    'frame-bg-strawberry':'background:linear-gradient(135deg,#fce4ec,#ef9a9a,#e57373);',
    'frame-bg-bubble':'background:linear-gradient(135deg,#ede7f6,#d1c4e9,#b39ddb);',
    'frame-bg-sample-n1':'background:linear-gradient(135deg,#d4f5c8,#b8f5e8);',
    'frame-bg-sample-n2':'background:linear-gradient(135deg,#c8e8f5,#d5eeff);',
    'frame-bg-sample-n3':'background:linear-gradient(135deg,#fff5c8,#fffac8);',
    'frame-bg-pinkflame':'background:linear-gradient(135deg,#f8bbd0,#e91e63);',
    'frame-bg-oceanmint':'background:linear-gradient(135deg,#00bcd4,#00acc1);',
    'frame-bg-aurora':'background:linear-gradient(135deg,#7c4dff,#40c4ff,#69f0ae);',
    'frame-bg-lavender':'background:linear-gradient(135deg,#9c27b0,#ce93d8);',
    'frame-bg-rose':'background:linear-gradient(135deg,#c62828,#ef9a9a);',
    'frame-bg-cosmic':'background:linear-gradient(135deg,#fc466b,#3f5efb);',
    'frame-bg-sample-r1':'background:linear-gradient(135deg,#fa709a,#fee140);',
    'frame-bg-sample-r2':'background:linear-gradient(135deg,#11998e,#38ef7d);',
    'frame-bg-sample-r3':'background:linear-gradient(135deg,#f7971e,#ffd200);',
    'frame-bg-aqua':'background:linear-gradient(135deg,#001f3f,#00bcd4);',
    'frame-bg-magenta':'background:linear-gradient(135deg,#200028,#c026d3);',
    'frame-bg-matrix':'background:linear-gradient(135deg,#001a00,#00ff41);',
    'frame-bg-cyborange':'background:linear-gradient(135deg,#1a0800,#f97316);',
    'frame-bg-elecblue':'background:linear-gradient(135deg,#00001a,#3b82f6);',
    'frame-bg-laserpink':'background:linear-gradient(135deg,#1a001a,#ec4899);',
    'frame-bg-sample-s1':'background:linear-gradient(135deg,#1a1a2e,#533483);',
    'frame-bg-sample-s2':'background:linear-gradient(135deg,#200028,#2d0050);',
    'frame-bg-sample-s3':'background:linear-gradient(135deg,#1a1000,#281800);',
    'frame-bg-epic-fire':'background:linear-gradient(135deg,#7c1200,#ea580c);',
    'frame-bg-epic-storm':'background:linear-gradient(135deg,#1e1b4b,#7c3aed);',
    'frame-bg-epic-lava':'background:linear-gradient(135deg,#450a0a,#f97316);',
    'frame-bg-epic-blood':'background:linear-gradient(135deg,#3b0000,#b91c1c);',
    'frame-bg-epic-shadow':'background:linear-gradient(135deg,#0a0a0a,#44403c);',
    'frame-bg-epic-inferno':'background:linear-gradient(135deg,#431407,#fbbf24);',
    'frame-bg-legend-gold':'background:linear-gradient(135deg,#78350f,#fbbf24);',
    'frame-bg-legend-rainbow':'background:linear-gradient(135deg,#ef4444,#8b5cf6);',
    'frame-bg-legend-galaxy':'background:linear-gradient(135deg,#030712,#312e81);',
    'frame-bg-legend-divine':'background:linear-gradient(135deg,#fefce8,#fcd34d);',
    'frame-bg-legend-dragon':'background:linear-gradient(135deg,#0c0a09,#c2410c);',
    'frame-bg-legend-cosmos':'background:linear-gradient(135deg,#030712,#ec4899);',
  };
  grid.innerHTML = samples.map(s => {
    const inlineStyle = SAMPLE_INLINE[s.css] || 'background:#333;';
    return `<div onclick="selectEditFrameSample('${s.id}','${s.css}','${s.name}')"
      style="cursor:pointer;border-radius:10px;overflow:hidden;border:2px solid transparent;transition:all 0.2s;${inlineStyle}"
      id="eSample_${s.id}">
      <div style="height:80px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;">
        <img src="https://i.ibb.co/TMcWFtGr/image.png" style="width:26px;height:26px;object-fit:contain;image-rendering:auto;" />
        <div style="font-size:9px;font-weight:700;color:#fff;text-shadow:0 1px 3px rgba(0,0,0,0.5);text-align:center;padding:0 4px;">${s.name}</div>
      </div>
    </div>`;
  }).join('');
};

window.selectEditFrameSample = function(id, css, name) {
  editSelectedFrameSample = { id, css, name };
  document.querySelectorAll('[id^="eSample_"]').forEach(el => {
    el.style.border = '2px solid transparent'; el.style.transform = '';
  });
  const el = document.getElementById(`eSample_${id}`);
  if (el) { el.style.border = '2px solid #fff'; el.style.transform = 'scale(1.05)'; }
  const box = document.getElementById('editSelectedFrameBox');
  const wrap = document.getElementById('editSelectedFramePreview');
  if (box) {
    box.className = css;
    box.style.cssText = 'width:100px;height:120px;border-radius:12px;margin:0 auto;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;';
    box.innerHTML = `<img src="https://i.ibb.co/TMcWFtGr/image.png" style="width:40px;height:40px;object-fit:contain;image-rendering:auto;" /><div style="font-size:11px;font-weight:700;color:#fff;text-shadow:0 1px 3px rgba(0,0,0,0.5);">${name}</div>`;
  }
  if (wrap) wrap.style.display = 'block';
};

window.saveFrameEdit = async function() {
  if (!editingFrameId) return;
  const name  = document.getElementById('editFrameName').value.trim();
  const price = parseInt(document.getElementById('editFramePrice').value);
  const grade = document.getElementById('editFrameGrade').value;
  if (!name || !price) return showToast('이름과 가격을 입력하세요');

  const tab = currentEditFrameTab;
  const imgUrl = document.getElementById('eEditImgUrl')?.value?.trim();
  let frameData = { ...FRAME_DATA[editingFrameId], name, price, grade };

  if (tab === 'emoji') {
    const cfg = {
      emoji: document.getElementById('eEditEmojiChar')?.value || '💓',
      bg:    document.getElementById('eEditBgColor')?.value   || '#1a1a3e',
      size:  parseInt(document.getElementById('eEditSize')?.value  || 22),
      gap:   parseInt(document.getElementById('eEditGap')?.value   || 38),
      alpha: parseInt(document.getElementById('eEditAlpha')?.value || 70),
    };
    frameData = { name, grade, price, css:'frame-emoji-pattern', neonTxt:'', emojiPattern: cfg };
  } else if (tab === 'url' && imgUrl) {
    frameData = { name, grade, price, css:'frame-bg-custom-img', neonTxt:'', imgUrl };
  } else if (tab === 'sample' && editSelectedFrameSample) {
    const neonTxt = FRAME_DATA[editSelectedFrameSample.id]?.neonTxt || '';
    frameData = { name, grade, price, css: editSelectedFrameSample.css, neonTxt };
  }

  FRAME_DATA[editingFrameId] = frameData;
  // 기본 프레임 포함 모든 수정사항 Firestore에 저장
  try {
    await setDoc(doc(db, 'config', 'customFrames'), { [editingFrameId]: frameData }, { merge: true });
  } catch(e) { console.error('프레임 저장 오류:', e); }
  closeModal('editFrameModal');
  showToast('프레임이 수정됐어요 ✅');
  renderFrameGrid('manageFrameGrid', true);
  renderFrameGrid('shopFrameGrid', false);
};

// ===== 교사: 프레임 삭제 =====
let deletingFrameId = null;
window.openDeleteFrameModal = function(id) {
  deletingFrameId = id;
  document.getElementById('deleteFrameNameDisplay').textContent = FRAME_DATA[id]?.name || '';
  openModal('deleteFrameModal');
};

window.confirmDeleteFrame = async function() {
  if (!deletingFrameId) return;
  // 커스텀 프레임이면 Firestore에서도 삭제
  // 모든 프레임(기본 포함) customFrames에서 삭제 기록
  try {
    const snap = await getDoc(doc(db, 'config', 'customFrames'));
    if (snap.exists()) {
      const data = snap.data();
      delete data[deletingFrameId];
      await setDoc(doc(db, 'config', 'customFrames'), data);
    }
  } catch(e) {}
  delete FRAME_DATA[deletingFrameId];
  closeModal('deleteFrameModal');
  showToast('프레임이 삭제됐어요');
  renderFrameGrid('manageFrameGrid', true);
  renderFrameGrid('shopFrameGrid', false);
};

// ===== 학생: 프레임 구매 =====
let buyingFrameId = null;
window.openBuyFrameModal = async function(id) {
  buyingFrameId = id;
  const f = FRAME_DATA[id];
  document.getElementById('buyFrameNameDisplay').textContent = f.name;
  document.getElementById('buyFramePriceDisplay').textContent = `🪙 ${f.price.toLocaleString()}`;
  // 미리보기
  const preview = document.getElementById('buyFramePreview');
  const txtCls = f.neonTxt || '';
  preview.className = `${f.css}`;
  preview.style.cssText = 'width:160px;height:200px;border-radius:16px;margin:0 auto 12px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;';
  preview.innerHTML = `
    <img src="https://i.ibb.co/TMcWFtGr/image.png" style="width:80px;height:100px;object-fit:contain;image-rendering:pixelated;filter:drop-shadow(0 2px 6px rgba(0,0,0,0.2));" />
    <div class="${txtCls}" style="${txtCls?'':'color:#fff;text-shadow:0 1px 4px rgba(0,0,0,0.4);'}font-size:13px;font-weight:700;">${f.name}</div>
    <div class="${txtCls}" style="${txtCls?'':'color:rgba(255,255,255,0.9);'}font-size:12px;">Lv.1</div>`;
  openModal('buyFrameModal');
};

window.confirmBuyFrame = async function() {
  const id = buyingFrameId;
  if (!id) return;
  const f = FRAME_DATA[id];
  const _ms = getMyStudentData();
  const sDoc = { exists: () => Object.keys(_ms).length > 0, data: () => _ms };
  const sData = sDoc.exists() ? sDoc.data() : {};
  const myPts = sData.points || 0;
  if (myPts < f.price) {
    closeModal('buyFrameModal');
    return showToast('골드가 부족해요 🪙');
  }
  // 이미 신청 중인지 확인
  const existing = await getDocs(query(
    collection(db, 'exchanges'),
    where('studentId', '==', state.currentUser.uid),
    where('rewardId', '==', id),
    where('status', '==', 'pending')
  ));
  if (!existing.empty) {
    closeModal('buyFrameModal');
    return showToast('이미 교환 신청 중인 프레임이에요!');
  }
  try {
    // 즉시 골드 차감
    await updateDoc(doc(db, 'students', state.currentUser.uid), { points: increment(-f.price) });
    // 교환 신청 저장 (type: 'frame' 구분)
    await addDoc(collection(db, 'exchanges'), {
      studentId: state.currentUser.uid, studentName: state.currentUser.name,
      rewardId: id, rewardName: f.name, rewardEmoji: '🖼️',
      rewardCost: f.price, rewardCategory: 'frame',
      frameData: { css: f.css, grade: f.grade, neonTxt: f.neonTxt||'', imgUrl: f.imgUrl||'', emojiPattern: f.emojiPattern||null },
      status: 'pending', createdAt: serverTimestamp()
    });
    await addDoc(collection(db, 'history'), {
      studentId: state.currentUser.uid, studentName: state.currentUser.name,
      delta: -f.price, reason: `프레임 신청: ${f.name}`, type: 'minus',
      source: 'exchange_request', createdAt: serverTimestamp()
    });
    closeModal('buyFrameModal');
    showToast(`'${f.name}' 교환 신청을 보냈어요! 선생님 승인을 기다려주세요 🖼️`);
    await reloadStudents();
    renderFrameGrid('shopFrameGrid', false);
  } catch(e) { showToast('오류: ' + e.message); }
};

// ===== 내 보관함: 꾸미기 (프레임) =====
export async function renderInventoryDecor() {
  const el = document.getElementById('inventoryDecorList');
  if (!el) return;
  el.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted);">불러오는 중...</div>';
  try {
    // 커스텀 프레임 먼저 로드 (FRAME_DATA에 병합)
    await loadCustomFrames();
    const snap = await getDocs(query(
      collection(db, 'frameInventory'),
      where('studentId', '==', state.currentUser.uid)
    ));
    const myFrames = snap.docs.map(d => ({ docId: d.id, ...d.data() }));

    if (!myFrames.length) {
      el.innerHTML = '<div class="empty-state" style="padding:60px;"><div class="empty-icon">🖼️</div><h3>보유한 프레임이 없어요</h3><p>꾸미기 상점에서 구매해 보세요!</p></div>';
      return;
    }

    // 등급별 섹션
    const gradeOrder3 = { normal:0, rare:1, epic:2, legend:3, special:4 };
    const gradeLabels3 = { normal:'⭐ 일반 등급', rare:'💙 희귀 등급', epic:'💜 영웅 등급', legend:'🏅 전설 등급', special:'✨ 특별 등급' };
    const grouped3 = {};
    myFrames.forEach(f => {
      const fd = FRAME_DATA[f.frameId];
      const g = fd?.grade || f.frameGrade || 'normal';
      if (!grouped3[g]) grouped3[g] = [];
      grouped3[g].push(f);
    });

    // 현재 장착된 프레임
    // 보관함 프레임 카드 프리뷰 캐릭터
    const previewChar = buildCharHtml({ id: state.currentUser.uid, avatarEquipped: state.avatarEquipped, avatarEquippedMeta: state.avatarEquippedMeta }, 'margin:0 auto;filter:drop-shadow(0 2px 8px rgba(0,0,0,0.25));');
    const _ms = getMyStudentData();
    const sDoc = { exists: () => Object.keys(_ms).length > 0, data: () => _ms };
    const equippedFrameId = sDoc.exists() ? sDoc.data().equippedFrameId : null;

    const sortedGrades3 = Object.keys(grouped3).sort((a,b) => (gradeOrder3[a]||0)-(gradeOrder3[b]||0));
    el.innerHTML = sortedGrades3.map(grade => {
      const items = grouped3[grade].map(f => {
        const fd = FRAME_DATA[f.frameId] || {};
        const isEquipped = equippedFrameId === f.frameId;
        // fd 우선, 없으면 frameInventory에 저장된 값 사용
        const css          = fd.css          || f.frameCss     || '';
        const neonTxt      = fd.neonTxt      || f.frameNeonTxt || '';
        const imgUrl       = fd.imgUrl       || f.imgUrl       || '';
        const emojiPattern = fd.emojiPattern  || f.emojiPattern || null;
        const grade2       = fd.grade        || f.frameGrade   || 'normal';
        const isEmojiPat   = !!emojiPattern;
        const canvasId     = `invfpc_${f.docId}`;

        const txtCls  = neonTxt || '';
        const tBadge  = `<span class="title-badge ${FRAME_GRADE_CSS[grade2]||'title-normal'}" style="font-size:12px;padding:4px 12px;">${FRAME_GRADE_LABEL[grade2]||''}</span>`;
        const nameTxt = `<span class="${txtCls}" style="${txtCls?'':'color:#fff;text-shadow:0 1px 4px rgba(0,0,0,0.4);'}font-size:18px;font-weight:700;">${fd.name||f.frameName}</span>`;
        const lvTxt   = `<span class="${txtCls}" style="${txtCls?'':'color:rgba(255,255,255,0.9);'}font-size:14px;font-weight:700;">Lv.1</span>`;
        const equippedLabel = isEquipped ? `<div style="font-size:12px;font-weight:600;color:rgba(255,255,255,0.8);text-shadow:0 1px 3px rgba(0,0,0,0.3);margin-top:8px;margin-bottom:4px;">✓ 장착 중</div>` : `<div style="height:0px;margin-top:8px;"></div>`;
        const btnRow  = `<div style="display:flex;gap:8px;margin-top:4px;">
              ${isEquipped
                ? `<button class="btn btn-secondary btn-sm" onclick="unequipFrame()">해제</button>`
                : `<button class="btn btn-primary btn-sm" onclick="equipFrame('${f.frameId}')">사용</button>`}
              <button class="btn btn-danger btn-sm" onclick="deleteMyFrame('${f.docId}','${f.frameId}','${fd.name||f.frameName}')">삭제</button>
        </div>`;

        const emojiCanvasHtml = isEmojiPat
          ? `<canvas id="${canvasId}" width="210" height="280" style="position:absolute;inset:0;width:100%;height:100%;border-radius:var(--radius-lg);"></canvas>`
          : '';
        const imgStyle = imgUrl ? `background-image:url('${imgUrl}');background-size:cover;background-position:center;` : '';
        const previewStyle = `${imgStyle}${isEmojiPat ? 'position:relative;overflow:hidden;' : ''}`;

        return `
        <div id="invFrame-${f.docId}" class="frame-card">
          <div class="frame-preview ${isEmojiPat ? '' : css}" style="${previewStyle}">
            ${emojiCanvasHtml}
            <div class="frame-preview-title" style="${isEmojiPat?'position:relative;z-index:1;':''}">${tBadge}</div>
            <div style="${isEmojiPat?'position:relative;z-index:1;':''}">${previewChar}</div>
            <span style="${isEmojiPat?'position:relative;z-index:1;':''}${txtCls?'':'color:#fff;text-shadow:0 1px 4px rgba(0,0,0,0.4);'}font-size:18px;font-weight:700;">${fd.name||f.frameName}</span>
            <span style="${isEmojiPat?'position:relative;z-index:1;':''}${txtCls?'':'color:rgba(255,255,255,0.9);'}font-size:14px;font-weight:700;">Lv.1</span>
            ${equippedLabel}
            <div style="${isEmojiPat?'position:relative;z-index:1;':''}display:flex;gap:8px;margin-top:4px;">
              ${isEquipped
                ? `<button class="btn btn-secondary btn-sm" onclick="unequipFrame()">해제</button>`
                : `<button class="btn btn-primary btn-sm" onclick="equipFrame('${f.frameId}')">사용</button>`}
              <button class="btn btn-danger btn-sm" onclick="deleteMyFrame('${f.docId}','${f.frameId}','${fd.name||f.frameName}')">삭제</button>
            </div>
          </div>
        </div>`;
      }).join('');
      return `<div class="section-grade-header" style="margin-bottom:10px;">${gradeLabels3[grade]}</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:16px;margin-bottom:16px;">${items}</div>`;
    }).join('');

    // 이모지 패턴 canvas 렌더링
    setTimeout(() => {
      myFrames.forEach(f => {
        const fd = FRAME_DATA[f.frameId] || {};
        const emojiPattern = fd.emojiPattern || f.emojiPattern;
        if (!emojiPattern) return;
        const canvas = document.getElementById(`invfpc_${f.docId}`);
        if (canvas) renderEmojiPatternCanvas(canvas, emojiPattern);
      });
    }, 50);
  } catch(e) {
    el.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted);">불러오기 실패</div>';
    console.error(e);
  }
}

// ===== 프레임 추가 시스템 =====
let selectedFrameSample = null;
let currentFrameAddTab = 'emoji';

// 탭 전환
window.switchFrameTab = function(tab, btn) {
  currentFrameAddTab = tab;
  ['emoji','url','sample'].forEach(t => {
    const el = document.getElementById('frameTab' + t.charAt(0).toUpperCase() + t.slice(1));
    if (el) el.style.display = t === tab ? '' : 'none';
  });
  document.querySelectorAll('.frame-add-tab').forEach(b => {
    b.className = b.dataset.tab === tab
      ? 'frame-add-tab btn btn-primary btn-sm active'
      : 'frame-add-tab btn btn-secondary btn-sm';
  });
  if (tab === 'sample') renderFrameSamples();
  if (tab === 'emoji') setTimeout(drawEmojiPreview, 50);
};

// 추천 색상 클릭
window.setEmojiColor = function(hex) {
  document.getElementById('fEmojiBgColor').value = hex;
  document.getElementById('fEmojiBgText').value = hex;
  drawEmojiPreview();
};
window.syncEmojiColorText = function() {
  document.getElementById('fEmojiBgText').value = document.getElementById('fEmojiBgColor').value;
};
window.syncEmojiColorPicker = function() {
  const v = document.getElementById('fEmojiBgText').value;
  if (/^#[0-9a-fA-F]{6}$/.test(v)) document.getElementById('fEmojiBgColor').value = v;
};

// Canvas 이모지 패턴 그리기
window.drawEmojiPreview = function() {
  const canvas = document.getElementById('fEmojiCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const emoji = document.getElementById('fEmojiChar')?.value || '💓';
  const bg = document.getElementById('fEmojiBgColor')?.value || '#1a1a3e';
  const size = parseInt(document.getElementById('fEmojiSize')?.value || 22);
  const gap = parseInt(document.getElementById('fEmojiGap')?.value || 38);
  const alpha = parseInt(document.getElementById('fEmojiAlpha')?.value || 70) / 100;
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0,0,w,h);
  ctx.fillStyle = bg;
  ctx.fillRect(0,0,w,h);
  ctx.save();
  ctx.font = `${size}px serif`;
  ctx.textBaseline = 'top';
  ctx.globalAlpha = alpha;
  const cols = Math.ceil(w/gap) + 2;
  const rows = Math.ceil(h/gap) + 2;
  for (let r = -1; r < rows; r++) {
    for (let c = -1; c < cols; c++) {
      const x = c*gap + (r%2===0 ? 0 : gap/2);
      const y = r*gap;
      ctx.fillText(emoji, x, y);
    }
  }
  ctx.globalAlpha = 1;
  ctx.restore();
  // 이름 미리보기 업데이트
  const nameEl = document.getElementById('fEmojiNamePreview');
  if (nameEl) nameEl.textContent = document.getElementById('newFrameName')?.value || '학생 이름';
};

// Canvas를 dataURL로 저장
function getEmojiPatternConfig() {
  return {
    emoji: document.getElementById('fEmojiChar')?.value || '💓',
    bg: document.getElementById('fEmojiBgColor')?.value || '#1a1a3e',
    size: parseInt(document.getElementById('fEmojiSize')?.value || 22),
    gap: parseInt(document.getElementById('fEmojiGap')?.value || 38),
    alpha: parseInt(document.getElementById('fEmojiAlpha')?.value || 70),
  };
}

// 홈화면/상점에서 이모지 패턴 Canvas 렌더링 (저장된 config로)
window.renderEmojiPatternCanvas = function(canvas, cfg) {
  if (!canvas || !cfg) return;
  const { emoji='💓', bg='#1a1a3e', size=22, gap=38, alpha=70 } = cfg;
  // 고해상도 렌더링 (devicePixelRatio 반영)
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.offsetWidth  || canvas.width;
  const cssH = canvas.offsetHeight || canvas.height;
  canvas.width  = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const w = cssW, h = cssH;
  ctx.clearRect(0,0,w,h);
  ctx.fillStyle = bg;
  ctx.fillRect(0,0,w,h);
  ctx.save();
  ctx.font = `${size}px serif`;
  ctx.textBaseline = 'top';
  ctx.globalAlpha = alpha/100;
  const cols = Math.ceil(w/gap)+2;
  const rows = Math.ceil(h/gap)+2;
  for (let r=-1;r<rows;r++) {
    for (let c=-1;c<cols;c++) {
      const x = c*gap+(r%2===0?0:gap/2);
      const y = r*gap;
      ctx.fillText(emoji, x, y);
    }
  }
  ctx.globalAlpha = 1;
  ctx.restore();
};

window.openAddFrameModal = function() {
  selectedFrameSample = null;
  document.getElementById('newFrameName').value = '';
  document.getElementById('newFramePrice').value = '2000';
  document.getElementById('newFrameGrade').value = 'normal';
  document.getElementById('newFrameImgUrl').value = '';
  document.getElementById('customFramePreview').style.display = 'none';
  document.getElementById('selectedFramePreview').style.display = 'none';
  currentFrameAddTab = 'emoji';
  // 탭 초기화
  switchFrameTab('emoji');
  openModal('addFrameModal');
  setTimeout(drawEmojiPreview, 100);
};

const FRAME_SAMPLES = {
  normal: [
    { id:'cotton',     name:'코튼 캔디',   css:'frame-bg-cotton' },
    { id:'mint',       name:'민트 초코',   css:'frame-bg-mint' },
    { id:'peach',      name:'피치 멜로우', css:'frame-bg-peach' },
    { id:'spring',     name:'스프링 가든', css:'frame-bg-spring' },
    { id:'strawberry', name:'딸기 라떼',   css:'frame-bg-strawberry' },
    { id:'bubble',     name:'버블 판타지', css:'frame-bg-bubble' },
    { id:'sample_n1',  name:'라임 소다',   css:'frame-bg-sample-n1' },
    { id:'sample_n2',  name:'하늘 구름',   css:'frame-bg-sample-n2' },
    { id:'sample_n3',  name:'레몬 드롭',   css:'frame-bg-sample-n3' },
  ],
  rare: [
    { id:'pinkflame',  name:'핑크 플레임', css:'frame-bg-pinkflame' },
    { id:'oceanmint',  name:'오션 민트',   css:'frame-bg-oceanmint' },
    { id:'aurora',     name:'오로라',      css:'frame-bg-aurora' },
    { id:'lavender',   name:'라벤더 드림', css:'frame-bg-lavender' },
    { id:'rose',       name:'로즈 가든',   css:'frame-bg-rose' },
    { id:'cosmic',     name:'코스믹',      css:'frame-bg-cosmic' },
    { id:'sample_r1',  name:'선셋 글로우', css:'frame-bg-sample-r1' },
    { id:'sample_r2',  name:'에메랄드',    css:'frame-bg-sample-r2' },
    { id:'sample_r3',  name:'골든 아워',   css:'frame-bg-sample-r3' },
  ],
  special: [
    { id:'aqua',       name:'사이버 아쿠아',  css:'frame-bg-aqua' },
    { id:'magenta',    name:'네온 마젠타',    css:'frame-bg-magenta' },
    { id:'matrix',     name:'매트릭스 그린',  css:'frame-bg-matrix' },
    { id:'cyborange',  name:'사이버 오렌지',  css:'frame-bg-cyborange' },
    { id:'elecblue',   name:'일렉트릭 블루',  css:'frame-bg-elecblue' },
    { id:'laserpink',  name:'레이저 핑크',    css:'frame-bg-laserpink' },
    { id:'sample_s1',  name:'딥 스페이스',    css:'frame-bg-sample-s1' },
    { id:'sample_s2',  name:'사이버 퍼플',    css:'frame-bg-sample-s2' },
    { id:'sample_s3',  name:'네온 골드',      css:'frame-bg-sample-s3' },
  ],
  epic: [
    { id:'epic_fire',    name:'화염 폭풍',    css:'frame-bg-epic-fire' },
    { id:'epic_storm',   name:'번개 폭풍',    css:'frame-bg-epic-storm' },
    { id:'epic_lava',    name:'용암 균열',    css:'frame-bg-epic-lava' },
    { id:'epic_blood',   name:'블러드 문',    css:'frame-bg-epic-blood' },
    { id:'epic_shadow',  name:'다크 섀도우',  css:'frame-bg-epic-shadow' },
    { id:'epic_inferno', name:'인페르노',     css:'frame-bg-epic-inferno' },
  ],
  legend: [
    { id:'legend_gold',    name:'황금 왕좌',    css:'frame-bg-legend-gold' },
    { id:'legend_rainbow', name:'레인보우',     css:'frame-bg-legend-rainbow' },
    { id:'legend_galaxy',  name:'은하수',       css:'frame-bg-legend-galaxy' },
    { id:'legend_divine',  name:'신성한 빛',    css:'frame-bg-legend-divine' },
    { id:'legend_dragon',  name:'드래곤 스케일',css:'frame-bg-legend-dragon' },
    { id:'legend_cosmos',  name:'코스모스',     css:'frame-bg-legend-cosmos' },
  ],
};

window.renderFrameSamples = function() {
  const grade = document.getElementById('newFrameGrade').value;
  const samples = FRAME_SAMPLES[grade] || [];
  const grid = document.getElementById('frameSampleGrid');
  if (!grid) return;
  selectedFrameSample = null;
  document.getElementById('selectedFramePreview').style.display = 'none';
  // 등급별 인라인 스타일 (CSS 클래스 미적용 대비)
  const SAMPLE_INLINE = {
    'frame-bg-cotton':    'background:linear-gradient(135deg,#fce4ec,#f8bbd0,#f48fb1);',
    'frame-bg-mint':      'background:linear-gradient(135deg,#e0f7fa,#b2ebf2,#80deea);',
    'frame-bg-peach':     'background:linear-gradient(135deg,#fff3e0,#ffe0b2,#ffcc80);',
    'frame-bg-spring':    'background:linear-gradient(135deg,#f1f8e9,#dcedc8,#c5e1a5);',
    'frame-bg-strawberry':'background:linear-gradient(135deg,#fce4ec,#ef9a9a,#e57373);',
    'frame-bg-bubble':    'background:linear-gradient(135deg,#ede7f6,#d1c4e9,#b39ddb);',
    'frame-bg-sample-n1': 'background:linear-gradient(135deg,#d4f5c8,#b8f5e8,#c8f5d4);',
    'frame-bg-sample-n2': 'background:linear-gradient(135deg,#c8e8f5,#d5eeff,#c8d8f5);',
    'frame-bg-sample-n3': 'background:linear-gradient(135deg,#fff5c8,#fffac8,#f5f0b0);',
    'frame-bg-pinkflame': 'background:linear-gradient(135deg,#f8bbd0,#f48fb1,#e91e63);',
    'frame-bg-oceanmint': 'background:linear-gradient(135deg,#00bcd4,#26c6da,#00acc1);',
    'frame-bg-aurora':    'background:linear-gradient(135deg,#7c4dff,#40c4ff,#69f0ae);',
    'frame-bg-lavender':  'background:linear-gradient(135deg,#9c27b0,#ba68c8,#ce93d8);',
    'frame-bg-rose':      'background:linear-gradient(135deg,#c62828,#e53935,#ef9a9a);',
    'frame-bg-cosmic':    'background:linear-gradient(135deg,#fc466b,#3f5efb,#fc466b);',
    'frame-bg-sample-r1': 'background:linear-gradient(135deg,#fa709a,#fee140,#fa709a);',
    'frame-bg-sample-r2': 'background:linear-gradient(135deg,#11998e,#38ef7d,#11998e);',
    'frame-bg-sample-r3': 'background:linear-gradient(135deg,#f7971e,#ffd200,#f7971e);',
    'frame-bg-aqua':      'background:linear-gradient(135deg,#001f3f,#00bcd4,#001f3f);',
    'frame-bg-magenta':   'background:linear-gradient(135deg,#200028,#c026d3,#200028);',
    'frame-bg-matrix':    'background:linear-gradient(135deg,#001a00,#00ff41,#001a00);',
    'frame-bg-cyborange': 'background:linear-gradient(135deg,#1a0800,#f97316,#1a0800);',
    'frame-bg-elecblue':  'background:linear-gradient(135deg,#00001a,#3b82f6,#00001a);',
    'frame-bg-laserpink': 'background:linear-gradient(135deg,#1a001a,#ec4899,#1a001a);',
    'frame-bg-sample-s1': 'background:linear-gradient(135deg,#1a1a2e,#16213e,#0f3460,#533483);',
    'frame-bg-sample-s2': 'background:linear-gradient(135deg,#200028,#360040,#1a0030,#2d0050);',
    'frame-bg-sample-s3': 'background:linear-gradient(135deg,#1a1000,#2d1e00,#1a1500,#281800);',
    'frame-bg-epic-fire':    'background:linear-gradient(135deg,#7c1200,#c2410c,#ea580c);',
    'frame-bg-epic-storm':   'background:linear-gradient(135deg,#1e1b4b,#4338ca,#7c3aed);',
    'frame-bg-epic-lava':    'background:linear-gradient(135deg,#450a0a,#991b1b,#f97316);',
    'frame-bg-epic-blood':   'background:linear-gradient(135deg,#3b0000,#7f1d1d,#b91c1c);',
    'frame-bg-epic-shadow':  'background:linear-gradient(135deg,#0a0a0a,#1c1917,#44403c);',
    'frame-bg-epic-inferno': 'background:linear-gradient(135deg,#431407,#9a3412,#f97316,#fbbf24);',
    'frame-bg-legend-gold':    'background:linear-gradient(135deg,#78350f,#d97706,#fbbf24,#f59e0b);',
    'frame-bg-legend-rainbow': 'background:linear-gradient(135deg,#ef4444,#f97316,#eab308,#22c55e,#3b82f6,#8b5cf6);',
    'frame-bg-legend-galaxy':  'background:linear-gradient(135deg,#030712,#1e1b4b,#312e81);',
    'frame-bg-legend-divine':  'background:linear-gradient(135deg,#fefce8,#fef9c3,#fcd34d);',
    'frame-bg-legend-dragon':  'background:linear-gradient(135deg,#0c0a09,#7c2d12,#c2410c);',
    'frame-bg-legend-cosmos':  'background:linear-gradient(135deg,#030712,#7c3aed,#ec4899);',
  };

  grid.innerHTML = samples.map(s => {
    const inlineStyle = SAMPLE_INLINE[s.css] || 'background:#333;';
    return `<div onclick="selectFrameSample('${s.id}','${s.css}','${s.name}')"
      style="cursor:pointer;border-radius:10px;overflow:hidden;border:2px solid transparent;transition:all 0.2s;${inlineStyle}"
      id="fSample_${s.id}">
      <div style="height:80px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;">
        <img src="https://i.ibb.co/TMcWFtGr/image.png" style="width:28px;height:28px;object-fit:contain;image-rendering:auto;" />
        <div style="font-size:9px;font-weight:700;color:#fff;text-shadow:0 1px 3px rgba(0,0,0,0.5);text-align:center;padding:0 4px;">${s.name}</div>
      </div>
    </div>`;
  }).join('');
};

window.selectFrameSample = function(id, css, name) {
  selectedFrameSample = { id, css, name };
  document.querySelectorAll('[id^="fSample_"]').forEach(el => {
    el.style.border = '2px solid transparent';
    el.style.transform = '';
  });
  const el = document.getElementById(`fSample_${id}`);
  if (el) { el.style.border = '2px solid #fff'; el.style.transform = 'scale(1.05)'; }
  const preview = document.getElementById('selectedFrameBox');
  const previewWrap = document.getElementById('selectedFramePreview');
  preview.className = css;
  preview.style.cssText = 'width:100px;height:120px;border-radius:12px;margin:0 auto;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;';
  preview.innerHTML = `<img src="https://i.ibb.co/TMcWFtGr/image.png" style="width:42px;height:42px;object-fit:contain;image-rendering:auto;" /><div style="font-size:11px;font-weight:700;color:#fff;text-shadow:0 1px 3px rgba(0,0,0,0.5);">${name}</div>`;
  previewWrap.style.display = 'block';
  if (!document.getElementById('newFrameName').value) {
    document.getElementById('newFrameName').value = name;
  }
};

window.previewCustomFrame = function() {
  const url = document.getElementById('newFrameImgUrl').value.trim();
  const preview = document.getElementById('customFramePreview');
  if (url) {
    preview.style.display = 'block';
    preview.style.cssText = 'margin-top:8px;display:block;border-radius:12px;overflow:hidden;width:100px;height:100px;';
    preview.innerHTML = `<img src="${url}" style="width:100%;height:100%;object-fit:cover;" onerror="this.parentElement.innerHTML='<div style=\'color:#ef4444;font-size:12px;padding:8px;\'>이미지 로드 실패</div>'" />`;
  } else {
    preview.style.display = 'none';
  }
};

window.saveNewFrame = async function() {
  const name = document.getElementById('newFrameName').value.trim();
  const price = parseInt(document.getElementById('newFramePrice').value) || 2000;
  const grade = document.getElementById('newFrameGrade').value;
  const imgUrl = document.getElementById('newFrameImgUrl')?.value?.trim();
  const tab = currentFrameAddTab;

  if (!name) return showToast('프레임 이름을 입력하세요');

  const newId = 'custom_' + Date.now();
  let frameData = null;

  if (tab === 'emoji') {
    const cfg = getEmojiPatternConfig();
    frameData = { name, grade, price, css: 'frame-emoji-pattern', neonTxt:'', emojiPattern: cfg };
  } else if (tab === 'url' && imgUrl) {
    frameData = { name, grade, price, css: 'frame-bg-custom-img', neonTxt:'', imgUrl };
  } else if (tab === 'sample' && selectedFrameSample) {
    const existSample = Object.values(FRAME_DATA).find(f => f.css === selectedFrameSample.css);
    const neonTxt = existSample?.neonTxt || '';
    frameData = { name, grade, price, css: selectedFrameSample.css, neonTxt };
  } else {
    return showToast('방식을 선택하고 설정을 완료해주세요');
  }

  // Firestore에 저장
  try {
    await setDoc(doc(db, 'config', 'customFrames'), { [newId]: frameData }, { merge: true });
    FRAME_DATA[newId] = frameData;
    closeModal('addFrameModal');
    showToast(`'${name}' 프레임이 추가됐어요! ✅`);
    renderFrameGrid('manageFrameGrid', true);
    if (document.getElementById('shopFrameGrid')) renderFrameGrid('shopFrameGrid', false);
  } catch(e) {
    showToast('저장 실패: ' + e.message);
  }
};

// 커스텀 프레임 Firestore에서 불러오기
export async function loadCustomFrames() {
  if (window._cfgCustomFrames) return; // 세션 캐시
  try {
    const snap = await getDoc(doc(db, 'config', 'customFrames'));
    if (snap.exists()) {
      const data = snap.data();
      Object.entries(data).forEach(([id, f]) => {
        FRAME_DATA[id] = f;
      });
    }
    window._cfgCustomFrames = true; // 캐시 완료
  } catch(e) {}
}
