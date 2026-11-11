// titles.js — 칭호 시스템 (목록·관리·회수·선물·장착)
import { state } from './state.js?v=20261111c';
import {
  addDoc, collection, db, deleteDoc, doc, getDoc, getDocFromServer, getDocs, increment, limit,
  orderBy, query, serverTimestamp, setDoc, updateDoc, where
} from './firebase.js?v=20261111c';
import {
  GRADE_LABELS, GRADE_ORDER, closeModal, getMyStudentData, loadTitleDeletedCache,
  loadTitleInventoryCache, openModal, showToast
} from './core.js?v=20261111c';
import { checkAndGrantRankUp } from './level.js?v=20261111c';
import { reloadStudents } from './realtime.js?v=20261111c';
import { renderDashboard } from './dashboard.js?v=20261111c';
import { initFrameGrids, loadCustomFrames, renderFrameGrid } from './frames.js?v=20261111c';
import { buildCharHtml, renderAvatarManage } from './avatar.js?v=20261111c';
import { renderStudentSettings } from './profile.js?v=20261111c';
import { renderPetManageGrid } from './pets.js?v=20261111c';

export async function renderTitlesPage() {
  const isTeacher = state.currentUser?.role === 'teacher';
  const btns = document.getElementById('titleTeacherBtns');
  if (btns) btns.style.display = isTeacher ? 'flex' : 'none';
  await reloadTitles();
  // 교사/학생 모두 등급별 그룹 표시, 교사에게만 수정/삭제 버튼
  const grid = document.getElementById('titleManageGrid');
  if (!grid) return;
  // 보유 칭호 (학생일 때)
  let ownedIds = new Set();
  if (!isTeacher) {
    const invSnap = await getDocs(query(collection(db,'titleInventory'),where('studentId','==',state.currentUser.uid)));
    ownedIds = new Set(invSnap.docs.map(d=>d.data().titleId));
  }
  // 하사 인원수
  const allInv = await loadTitleInventoryCache();
  const invCounts = {};
  allInv.forEach(d=>{ if(d.titleId) invCounts[d.titleId]=(invCounts[d.titleId]||0)+1; });

  const sorted = [...titles].sort((a,b)=>(GRADE_ORDER[a.grade]||0)-(GRADE_ORDER[b.grade]||0)||(a.name||'').localeCompare(b.name||'','ko'));
  const gradeBg = {
    absolute:'linear-gradient(135deg,rgba(250,204,21,0.14),rgba(244,114,182,0.12),rgba(56,189,248,0.12))',
    special:'linear-gradient(135deg,rgba(245,158,11,0.08),rgba(139,92,246,0.08))',
    legend:'linear-gradient(135deg,rgba(217,119,6,0.1),rgba(253,211,77,0.08))',
    epic:'linear-gradient(135deg,rgba(139,92,246,0.08),rgba(236,72,153,0.06))',
    rare:'linear-gradient(135deg,rgba(2,132,199,0.08),rgba(125,211,252,0.06))',
    normal:'var(--surface)'
  };
  const gradeOrder2 = ['normal','rare','epic','legend','special','absolute'];
  let html = '';
  for (const grade of gradeOrder2) {
    const group = sorted.filter(t => t.grade === grade);
    if (!group.length) continue;
    html += `<div class="section-grade-header">${GRADE_LABELS[grade] || grade}</div>`;
    html += `<div class="title-grade-grid">`;
    html += group.map(t => {
      const bg = gradeBg[t.grade] || 'var(--surface)';
      const owned = ownedIds.has(t.id);
      const count = invCounts[t.id] || 0;
      const teacherBtnsHtml = isTeacher
        ? `<div style="display:flex;gap:12px;margin-top:8px;justify-content:center;font-size:12px;">
            <span onclick="openEditTitle('${t.id}')" style="color:var(--primary);cursor:pointer;">수정</span>
            <span data-del-id="${t.id}" data-del-name="${(t.name||'').replace(/"/g,'&quot;')}" onclick="deleteTitle(this.dataset.delId,this.dataset.delName)" style="color:#ef4444;cursor:pointer;">삭제</span>
            <span onclick="openGiveSpecialTitle('${t.id}')" style="color:#16a34a;cursor:pointer;font-weight:600;">부여</span>
          </div>`
        : (owned ? '<div style="font-size:12px;font-weight:600;color:var(--text-muted);margin-top:auto;text-align:center;">✅ 소지 중</div>' : '<div style="height:20px;margin-top:auto;"></div>');
      return `<div class="title-card ${owned?'title-card-owned':'title-card-unowned'}" style="background:${bg};">
        <div class="title-card-badge-wrap">${getTitleBadgeHtml(t.grade,t.bgColor,t.textColor,t.emoji,t.name,'font-size:14px;padding:6px 16px;')}</div>
        <div class="title-card-name">${t.name}</div>
        <div class="title-card-desc">${t.desc||'설명 없음'}</div>
        <div style="font-size:15px;font-weight:800;color:var(--primary);text-align:center;margin-bottom:4px;">+${t.gold??GRADE_POINTS[t.grade]??200}🪙</div>
        ${makeAbilityTags(t.abilities,false)}
        <div class="title-card-count">하사받은 학생 ${count}명</div>
        ${teacherBtnsHtml}
      </div>`;
    }).join('');
    html += '</div>';
  }
  grid.innerHTML = html;
}

// 능력치 태그 HTML 생성 - 항상 고정 높이 박스로 감싸서 레이아웃 통일
export function makeAbilityTags(abilities, isMinus) {
  const icons = {'성실성':'🌟','인성':'❤️','사회성':'🤝','지력':'📚','집중력':'⚡'};
  const tags = (abilities && Object.keys(abilities).length)
    ? Object.entries(abilities).map(([k,v]) =>
        `<span style="font-size:10px;font-weight:600;background:${isMinus?'#fef2f2':'#f0fdf4'};color:${isMinus?'#ef4444':'#16a34a'};padding:2px 6px;border-radius:10px;white-space:nowrap;">${icons[k]||''} ${k}${isMinus?'-':'+'}${v}</span>`
      ).join('')
    : '';
  return `<div style="min-height:48px;max-height:48px;overflow:hidden;display:flex;flex-wrap:wrap;align-content:flex-start;gap:3px;margin-top:6px;">${tags}</div>`;
}

// 이모지만으로 구성된 메시지인지 체크 (1~3개 이모지)
export function isSingleEmoji(str) {
  const s = str.trim();
  // 이모지 세그먼트로 분리
  const segs = [...new Intl.Segmenter('ko', {granularity:'grapheme'}).segment(s)].map(x=>x.segment);
  if (segs.length === 0 || segs.length > 3) return false;
  // 각 세그먼트가 이모지인지 확인
  const emojiReg = /\p{Emoji}/u;
  return segs.every(seg => emojiReg.test(seg));
}

// ===== 칭호 시스템 =====
// 등급별 포인트
export const GRADE_POINTS = { normal: 200, rare: 400, epic: 600, legend: 800, special: 1000, absolute: 1500 };

export let titles = []; // 전체 칭호 목록
let currentTitleFilter = 'shop';
let editingTitleId = null;

function getTitleClass(grade) {
  const map = { normal:'title-normal', rare:'title-rare', epic:'title-epic', legend:'title-legend', special:'title-special', absolute:'title-special' };
  return map[grade] || 'title-normal';
}

// 색상 정보가 있으면 인라인 스타일, 없으면 기존 CSS 클래스 사용
// 절대신 등급: 교사가 만든 투명 PNG 칭호 이미지(주소는 bgColor 필드에 저장) + 사방 반짝임 효과
function absTitleUrl(u) { return encodeURI(String(u||'')).replace(/'/g,'%27').replace(/"/g,'%22').replace(/\(/g,'%28').replace(/\)/g,'%29'); }
export function getTitleBadgeHtml(grade, bgColor, textColor, emoji, name, extraStyle='') {
  if (grade === 'absolute') {
    const nm = String(name||'').replace(/</g,'&lt;');
    if (!bgColor) return `<span class="title-badge title-special">${nm}</span>`;
    const u = absTitleUrl(bgColor);
    return `<span class="title-absolute" style="--img:url('${u}');"><img src="${u}" alt="${nm}" onerror="this.style.display='none';this.nextElementSibling.style.display='inline-block';this.parentNode.classList.add('abs-broken')" /><span class="title-badge title-special" style="display:none;">${nm}</span></span>`;
  }
  if (bgColor) {
    // 교사가 색을 직접 지정한 경우 → 등급 무관하게 지정 색 사용
    return `<span class="title-badge" style="background:${bgColor};color:${textColor||'#334155'};border:1.5px solid ${textColor||'#334155'}40;${extraStyle}">${emoji||''} ${name||''}</span>`;
  }
  // 색 미지정 → 등급별 기본 CSS 클래스
  return `<span class="title-badge ${getTitleClass(grade)}" style="${extraStyle}">${emoji||''} ${name||''}</span>`;
}
function getTitleGradeName(grade) {
  const map = { normal:'일반', rare:'희귀', epic:'영웅', legend:'전설', special:'특별', absolute:'절대신' };
  return map[grade] || '일반';
}

export async function reloadTitles() {
  if (window._cachedTitles && window._cachedTitles.length > 0) {
    titles = window._cachedTitles;
    return;
  }
  const snap = await getDocs(collection(db, 'titles'));
  titles = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  window._cachedTitles = titles;
}

// ===== 교사: 꾸미기 관리 =====
export async function renderDecorManage() {
  await loadCustomFrames();
  switchManageTab('frame');
  setTimeout(() => initFrameGrids(true), 100);
}

// 칭호 관리 페이지 렌더
async function renderTitleManage() {
  await reloadTitles();
  const container = document.getElementById('titlePageContent');
  if (container) {
    container.innerHTML = `
      <div style="margin-bottom:16px;">
        <button class="btn btn-secondary btn-sm" onclick="openAddTitleModal()">+ 칭호 추가</button>
      </div>
      <div id="titleManageGrid"></div>`;
  }
  await filterTitleManage('special');
}

window.switchManageTab = function(tab, btn) {
  document.querySelectorAll('#page-decorManage .decor-top-tab').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  ['title','frame','avatar','pet'].forEach(t => {
    const el = document.getElementById(`manageTab${t.charAt(0).toUpperCase()+t.slice(1)}`);
    if (el) el.style.display = t === tab ? '' : 'none';
  });
  if (tab === 'avatar') renderAvatarManage();
  if (tab === 'frame') renderFrameGrid('manageFrameGrid', true);
  if (tab === 'pet') renderPetManageGrid();
};

window.filterTitleManage = async function(type, btn) {
  currentTitleFilter = type;
  // 칭호 차상위 탭만 선택
  const tabBar = document.getElementById('manageTitleTabBar');
  if (tabBar) {
    tabBar.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    else tabBar.querySelector('.tab-btn')?.classList.add('active');
  }

  const filtered = titles.filter(t => t.type === type);
  const grid = document.getElementById('titleManageGrid');
  if (!grid) return;

  // 전체 구매/수령자 수 계산
  const allInvSnap = { docs: (await loadTitleInventoryCache()).map(d => ({ id: d.id, data: () => d })) };
  const invCounts = {};
  allInvSnap.docs.forEach(d => {
    const tid = d.data().titleId;
    invCounts[tid] = (invCounts[tid] || 0) + 1;
  });

  if (!filtered.length) {
    grid.innerHTML = `<div class="empty-state" style="padding:40px;"><div class="empty-icon">🎨</div>
      <h3>${type==='shop' ? '판매 칭호가 없어요' : '칭호가 없어요'}</h3>
      <p>칭호를 추가해 주세요</p></div>`;
    return;
  }

  // 등급 낮은→높은 순, 동등 등급 내 가나다순
  filtered.sort((a, b) => {
    const gDiff = (GRADE_ORDER[a.grade]||0) - (GRADE_ORDER[b.grade]||0);
    if (gDiff !== 0) return gDiff;
    return (a.name||'').localeCompare(b.name||'', 'ko');
  });

  // 등급별 배경색
  const gradeBg = {
    absolute:'linear-gradient(135deg,rgba(250,204,21,0.14),rgba(244,114,182,0.12),rgba(56,189,248,0.12))',
    special: 'linear-gradient(135deg,rgba(245,158,11,0.08),rgba(139,92,246,0.08))',
    legend:  'linear-gradient(135deg,rgba(217,119,6,0.1),rgba(253,211,77,0.08))',
    epic:    'linear-gradient(135deg,rgba(139,92,246,0.08),rgba(236,72,153,0.06))',
    rare:    'linear-gradient(135deg,rgba(2,132,199,0.08),rgba(125,211,252,0.06))',
    normal:  'var(--surface)'
  };

  // 등급별 섹션으로 분리
  const gradeGroups = { normal:[], rare:[], epic:[], legend:[], special:[], absolute:[] };
  filtered.forEach(t => { (gradeGroups[t.grade] || gradeGroups.normal).push(t); });
  const gradeLabels = { normal:'⭐ 일반 등급', rare:'💙 희귀 등급', epic:'💜 영웅 등급', legend:'🏅 전설 등급', special:'✨ 특별 등급', absolute:'🔱 절대신 등급' };

  grid.innerHTML = Object.entries(gradeGroups).filter(([,arr]) => arr.length > 0).map(([grade, arr]) => {
    const cards = arr.map(t => {
      const count = invCounts[t.id] || 0;
      const countLabel = `선생님께 하사받은 학생 ${count}명`;
      const bg = gradeBg[grade] || 'var(--surface)';
      return `
      <div class="title-card" style="background:${bg};">
        <div class="title-card-badge-wrap">
          ${getTitleBadgeHtml(t.grade, t.bgColor, t.textColor, t.emoji, t.name, 'font-size:14px;padding:6px 16px;')}
        </div>
        <div class="title-card-name">${t.name}</div>
        <div class="title-card-desc">${t.desc || '설명 없음'}</div>
        ${makeAbilityTags(t.abilities, false)}
        <div style="font-size:15px;font-weight:800;color:var(--primary);text-align:center;margin-bottom:4px;margin-top:6px;">+${t.gold ?? GRADE_POINTS[t.grade] ?? 200}🪙</div>
        <div style="height:8px;"></div>
        <div class="title-card-count">${countLabel}</div>
        <div style="display:flex;gap:16px;justify-content:center;margin-top:auto;padding-top:4px;">
          <button onclick="openGiveSpecialTitle('${t.id}')" style="background:none;border:none;cursor:pointer;font-size:13px;font-weight:600;color:var(--primary);font-family:inherit;padding:4px 0;">부여</button>
          <button onclick="openEditTitle('${t.id}')" style="background:none;border:none;cursor:pointer;font-size:13px;font-weight:600;color:var(--text-secondary);font-family:inherit;padding:4px 0;">수정</button>
          <button data-title-id="${t.id}" data-title-name="${t.name.replace(/"/g,'&quot;')}" onclick="deleteTitle(this.dataset.titleId, this.dataset.titleName)" style="background:none;border:none;cursor:pointer;font-size:13px;font-weight:600;color:#ef4444;font-family:inherit;padding:4px 0;">삭제</button>
        </div>
      </div>`;
    }).join('');
    return `<div class="section-grade-header">${gradeLabels[grade]}</div>
    <div class="title-grade-grid">${cards}</div>`;
  }).join('');
};

// ===== 칭호 회수 =====
window.openTitleReclaimModal = async function() {
  openModal('titleReclaimModal');
  const listEl = document.getElementById('titleReclaimList');
  listEl.innerHTML = '<div style="text-align:center;padding:24px;color:var(--text-muted);">불러오는 중...</div>';
  try {
    const snap = await getDocs(query(
      collection(db, 'titleInventory'),
      orderBy('givenAt', 'desc'),
      limit(10)
    ));
    const items = snap.docs.map(d => ({ docId: d.id, ...d.data() }));
    if (!items.length) {
      listEl.innerHTML = '<div class="empty-state"><div class="empty-icon">🏅</div><h3>부여 내역이 없어요</h3></div>';
      return;
    }
    listEl.innerHTML = items.map(item => {
      const d = item.givenAt?.toDate();
      const dateStr = d ? `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}` : '';
      // studentName이 없으면 students 배열에서 찾기
      const student = state.students.find(s => s.id === item.studentId);
      const studentName = item.studentName || student?.name || '(알 수 없음)';
      // 칭호 원본에서 보상 정보 찾기
      const t = titles.find(x => x.id === item.titleId);
      const gold = t ? (t.gold || GRADE_POINTS[t.grade] || 200) : 200;
      const abStr = t?.abilities && Object.keys(t.abilities).length
        ? Object.entries(t.abilities).map(([k,v]) => `${k} +${v}`).join(', ')
        : null;
      const rewardStr = abStr ? `+${gold}🪙 · ${abStr}` : `+${gold}🪙`;
      return `<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:var(--bg);border-radius:10px;border:1px solid var(--border);">
        <span style="font-size:20px;">${item.titleEmoji||'🏅'}</span>
        <div style="flex:1;min-width:0;">
          <div style="font-size:13px;font-weight:700;">${studentName} · ${item.titleName}</div>
          <div style="font-size:11px;color:var(--primary);margin-top:1px;">${rewardStr}</div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:1px;">${dateStr}</div>
        </div>
        <button onclick="reclaimTitle('${item.docId}')" style="font-size:11px;padding:4px 10px;border-radius:6px;border:1px solid #ef4444;background:transparent;color:#ef4444;cursor:pointer;font-weight:600;font-family:inherit;white-space:nowrap;">회수</button>
      </div>`;
    }).join('');
  } catch(e) { listEl.innerHTML = `<div style="color:#ef4444;padding:16px;">오류: ${e.message}</div>`; }
};

window.reclaimTitle = async function(docId) {
  if (!confirm('이 칭호를 회수할까요?\n보상으로 지급된 포인트와 능력치가 즉시 되돌아갑니다.')) return;
  try {
    const fresh = await getDoc(doc(db, 'titleInventory', docId));
    if (!fresh.exists()) return showToast('이미 삭제된 내역이에요');
    const item = fresh.data();
    const t = titles.find(x => x.id === item.titleId);
    const totalGrant = t ? (t.gold || GRADE_POINTS[t.grade] || 200) : 200;

    // 포인트 역산
    const student = state.students.find(s => s.id === item.studentId);
    const studentName = item.studentName || student?.name || '(알 수 없음)';
    const titleName = item.titleName || '(알 수 없음)';
    const titleEmoji = item.titleEmoji || '';
    const update = {
      points: increment(-totalGrant),
      accumulatedPoints: increment(-totalGrant)
    };
    // 능력치 역산
    if (t?.abilities) {
      Object.entries(t.abilities).forEach(([k, v]) => {
        update[`abilities.${k}`] = increment(-v);
      });
    }
    await updateDoc(doc(db, 'students', item.studentId), update);
    // 장착 중이면 해제
    if (student?.equippedTitleId === item.titleId) {
      await updateDoc(doc(db, 'students', item.studentId), { equippedTitleId: null });
    }
    // titleInventory 삭제 (핵심 — history보다 먼저)
    await deleteDoc(doc(db, 'titleInventory', docId));
    // history 기록 (실패해도 핵심 처리는 완료)
    try {
      await addDoc(collection(db, 'history'), {
        studentId: item.studentId, studentName,
        delta: -totalGrant,
        reason: `칭호 회수: ${titleEmoji} ${titleName}`,
        type: 'minus', source: 'titleReclaim',
        createdAt: serverTimestamp()
      });
    } catch(he) { console.warn('history 기록 실패(무시):', he.message); }
    // 캐시 무효화
    window._cachedTitleInventory = null;
    // 토스트 메시지 구성
    const abParts = t?.abilities && Object.keys(t.abilities).length
      ? ', ' + Object.entries(t.abilities).map(([k,v]) => `${k} ${v}`).join(', ') + '이(가)'
      : '';
    showToast(`칭호와 함께 보상으로 지급된 포인트 ${totalGrant}${abParts} 회수되었어요 ↩️`);
    await reloadStudents();
    // 목록 새로고침
    openTitleReclaimModal();
    // 칭호 페이지 갱신
    if (!document.getElementById('page-titles').classList.contains('hidden')) {
      renderTitlesPage();
    }
  } catch(e) { showToast('오류: ' + e.message); }
};

window.openAddTitleModal = function() {
  editingTitleId = null;
  document.getElementById('addTitleModalTitle').textContent = '🏅 칭호 추가';
  document.getElementById('titleEmoji').value = '';
  document.getElementById('titleName').value = '';
  document.getElementById('titleGrade').value = 'normal';
  document.getElementById('titleImgUrl').value = '';
  document.getElementById('titleDesc').value = '';
  ['성실성','인성','사회성','지력','집중력'].forEach(k => {
    const el = document.getElementById(`titleAb_${k}`);
    if (el) el.value = '';
  });
  updateTitlePreview();
  openModal('addTitleModal');
};

window.openEditTitle = function(id) {
  editingTitleId = id;
  const t = titles.find(x => x.id === id);
  if (!t) return showToast('칭호 정보를 찾을 수 없어요. 페이지를 새로고침해 주세요.');
  document.getElementById('addTitleModalTitle').textContent = '🏅 칭호 수정';
  document.getElementById('titleEmoji').value = t.emoji || '';
  document.getElementById('titleName').value = t.name;
  document.getElementById('titleGrade').value = t.grade || 'normal';
  document.getElementById('titleDesc').value = t.desc || '';
  document.getElementById('titleImgUrl').value = t.grade === 'absolute' ? (t.imgUrl || t.bgColor || '') : '';
  // 색상 복원
  if (t.grade === 'normal' || !t.grade) {
    document.getElementById('titleBgColor').value   = t.bgColor   || '#f8fafc';
    document.getElementById('titleTextColor').value = t.textColor || '#334155';
  }
  ['성실성','인성','사회성','지력','집중력'].forEach(k => {
    const el = document.getElementById(`titleAb_${k}`);
    if (el) el.value = t.abilities?.[k] || '';
  });
  const goldEl = document.getElementById('titleGold');
  if (goldEl) goldEl.value = t.gold || 0;
  onTitleGradeChange();
  openModal('addTitleModal');
};

function onTitleGradeChange() {
  const grade = document.getElementById('titleGrade')?.value;
  const picker = document.getElementById('titleColorPicker');
  if (picker) picker.style.display = grade === 'normal' ? 'flex' : 'none';
  const ig = document.getElementById('titleImgUrlGroup'); if (ig) ig.style.display = grade === 'absolute' ? '' : 'none';
  const eg = document.getElementById('titleEmojiGroup'); if (eg) eg.style.display = grade === 'absolute' ? 'none' : '';
  updateTitlePreview();
}

function updateTitlePreview() {
  const emoji = document.getElementById('titleEmoji')?.value.trim() || '';
  const name  = document.getElementById('titleName')?.value.trim()  || '칭호 이름';
  const grade = document.getElementById('titleGrade')?.value || 'normal';
  const prev  = document.getElementById('titlePreview');
  if (!prev) return;
  if (grade === 'absolute') {
    const u = document.getElementById('titleImgUrl')?.value.trim() || '';
    prev.innerHTML = u ? getTitleBadgeHtml('absolute', u, '', '', name) : '<span style="font-size:12px;color:var(--text-muted);">이미지 주소를 입력하면 미리보기가 나와요</span>';
  } else if (grade === 'normal') {
    const bg  = document.getElementById('titleBgColor')?.value  || '#f8fafc';
    const txt = document.getElementById('titleTextColor')?.value || '#334155';
    prev.innerHTML = `<span class="title-badge" style="background:${bg};color:${txt};border:1.5px solid ${txt}40;">${emoji} ${name}</span>`;
  } else {
    prev.innerHTML = `<span class="title-badge ${getTitleClass(grade)}">${emoji} ${name}</span>`;
  }
}

// 모달 실시간 미리보기
document.addEventListener('input', e => {
  if (['titleEmoji','titleName','titleGrade','titleBgColor','titleTextColor','titleImgUrl'].includes(e.target.id)) updateTitlePreview();
});
document.addEventListener('change', e => {
  if (['titleGrade'].includes(e.target.id)) onTitleGradeChange();
});

window.saveTitle = async function() {
  const emoji = document.getElementById('titleGrade').value === 'absolute' ? '' : document.getElementById('titleEmoji').value.trim();
  const name = document.getElementById('titleName').value.trim();
  const desc = document.getElementById('titleDesc')?.value.trim() || '';
  const grade = document.getElementById('titleGrade').value;
  if (!name) return showToast('칭호 이름을 입력하세요');
  const imgUrl = grade === 'absolute' ? (document.getElementById('titleImgUrl')?.value.trim() || '') : '';
  if (grade === 'absolute' && !/^https?:\/\//i.test(imgUrl)) return showToast('절대신 등급은 칭호 이미지 주소(https://...)를 입력해야 해요');
  // 절대신 등급은 이미지 주소를 bgColor 필드에 함께 저장 (기존 칭호 표시 코드가 그대로 이미지를 찾을 수 있도록)
  const bgColor   = grade === 'absolute' ? imgUrl : (grade === 'normal' ? (document.getElementById('titleBgColor')?.value  || '#f8fafc') : '');
  const textColor = grade === 'normal' ? (document.getElementById('titleTextColor')?.value || '#334155') : '';
  // 부가 능력치 수집
  const abilities = {};
  ['성실성','인성','사회성','지력','집중력'].forEach(k => {
    const v = parseInt(document.getElementById(`titleAb_${k}`)?.value || '0');
    if (v > 0) abilities[k] = v;
  });
  const gold = parseInt(document.getElementById('titleGold')?.value || '0') || 0;
  try {
    const data = { type: 'special', emoji, name, desc, grade, cost: 0, gold, abilities, ...(bgColor ? { bgColor, textColor } : {}), ...(grade === 'absolute' ? { imgUrl } : {}), createdAt: serverTimestamp() };
    if (editingTitleId && !bgColor) { data.bgColor = ''; data.textColor = ''; } // 등급을 바꿔 수정할 때 이전 색/이미지 잔재 제거
    if (editingTitleId && grade !== 'absolute') data.imgUrl = '';
    if (editingTitleId) {
      await updateDoc(doc(db, 'titles', editingTitleId), data);
      showToast('칭호가 수정됐어요 ✅');
    } else {
      await addDoc(collection(db, 'titles'), data);
      showToast('칭호가 추가됐어요 🏅');
    }
    window._cachedTitles = null; // 캐시 무효화
    closeModal('addTitleModal');
    await renderTitleManage();
  } catch(e) { showToast('오류: ' + e.message); }
};
window.deleteTitle = async function(id, name) {
  if (!confirm(`'${name}' 칭호를 삭제할까요?\n이미 부여받은 학생들의 칭호도 모두 삭제됩니다.`)) return;
  try {
    console.log('[deleteTitle] 시작:', id, name);

    // titleInventory에서 해당 칭호 보유 내역 직접 쿼리
    const invSnap = await getDocs(query(
      collection(db, 'titleInventory'),
      where('titleId', '==', id)
    ));
    console.log('[deleteTitle] 부여 내역:', invSnap.docs.length, '건');

    const tasks = [];
    invSnap.docs.forEach(d => {
      tasks.push(deleteDoc(doc(db, 'titleInventory', d.id)));
      const data = d.data();
      if (data.studentId) {
        tasks.push(
          getDoc(doc(db, 'students', data.studentId)).then(sDoc => {
            if (sDoc.exists() && sDoc.data().equippedTitleId === id) {
              return updateDoc(doc(db, 'students', data.studentId), { equippedTitleId: null });
            }
          })
        );
      }
    });

    await Promise.all(tasks);
    console.log('[deleteTitle] 부여 내역 삭제 완료');

    await deleteDoc(doc(db, 'titles', id));
    console.log('[deleteTitle] 칭호 삭제 완료');

    window._cachedTitles = null;
    window._cachedTitleInventory = null;
    showToast(`'${name}' 칭호가 삭제됐어요 ✅`);
    await renderTitleManage();
  } catch(e) {
    console.error('[deleteTitle] 오류:', e);
    showToast('오류: ' + e.message);
  }
};

// ===== 비매품 칭호 선물 =====
let selectedTitleStudentIds = new Set();
let pendingGiveTitleId = null;

let eligibleTitleStudentIds = new Set(); // 부여 가능한 학생만

window.openGiveSpecialTitle = async function(titleId) {
  pendingGiveTitleId = titleId;
  selectedTitleStudentIds = new Set();
  const t = titles.find(x => x.id === titleId);
  document.getElementById('giveTitleModalTitle').textContent = `🏅 ${t?.emoji||''} ${t?.name||''} 부여`;
  document.getElementById('giveTitleModalSubtitle').textContent = `${getTitleGradeName(t?.grade||'normal')} 등급 칭호`;

  // 체크박스 초기화
  const chk = document.getElementById('titleNoRewardChk');
  if (chk) chk.checked = false;

  // 이미 받은 학생 + 삭제한 학생 제외
  const [invSnap, delSnap] = await Promise.all([
    getDocs(query(collection(db,'titleInventory'), where('titleId','==',titleId))),
    getDocs(collection(db, 'titleDeleted'))
  ]);
  window._titleAlreadyHas = new Set(invSnap.docs.map(d => d.data().studentId));
  const alreadyDel = new Set(
    delSnap.docs.filter(d => d.data().titleId === titleId).map(d => d.data().studentId)
  );
  window._titleAlreadyDel = alreadyDel;

  eligibleTitleStudentIds = new Set(
    state.students.map(s => s.id).filter(id => !window._titleAlreadyHas.has(id) && !alreadyDel.has(id))
  );

  // 체크박스 onchange: 기존 지급 학생 명단 토글
  if (chk) {
    chk.onchange = function() {
      if (this.checked) {
        // 기존 지급된 학생 + '영구 삭제' 이력이 있는 학생도 추가 (교사가 복구용으로 재부여 가능)
        state.students.forEach(s => eligibleTitleStudentIds.add(s.id));
      } else {
        // 원래 명단으로 복원
        eligibleTitleStudentIds = new Set(
          state.students.map(s => s.id).filter(id => !window._titleAlreadyHas.has(id) && !window._titleAlreadyDel.has(id))
        );
      }
      selectedTitleStudentIds = new Set();
      renderGiveTitleStudentGrid();
    };
  }

  renderGiveTitleStudentGrid();
  openModal('giveSpecialTitleModal');
};

function renderGiveTitleStudentGrid() {
  const sorted = [...state.students]
    .filter(s => eligibleTitleStudentIds.has(s.id))
    .sort((a,b) => (a.number||999)-(b.number||999));
  const grid = document.getElementById('giveTitleStudentGrid');
  if (!grid) return;
  if (sorted.length === 0) {
    grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--text-muted);font-size:14px;">이 칭호를 받을 수 있는 학생이 없어요</div>';
    return;
  }
  grid.innerHTML = sorted.map(s => {
    const selected = selectedTitleStudentIds.has(s.id);
    const alreadyOwns = window._titleAlreadyHas?.has(s.id);
    const wasDeleted = window._titleAlreadyDel?.has(s.id);
    return `
    <div class="give-student-card ${selected?'selected':''}" onclick="toggleTitleStudent('${s.id}')" id="gtsc-${s.id}" style="position:relative;">
      ${wasDeleted ? `<div style="position:absolute;top:4px;left:4px;font-size:9px;background:#ef4444;color:#fff;border-radius:4px;padding:1px 5px;font-weight:700;z-index:1;">삭제 이력</div>` : (alreadyOwns ? `<div style="position:absolute;top:4px;left:4px;font-size:9px;background:#f59e0b;color:#fff;border-radius:4px;padding:1px 5px;font-weight:700;z-index:1;">재지급</div>` : '')}
      ${buildCharHtml(s, 'margin-bottom:6px;')}
      <div class="gs-name">${s.number||''}번 ${s.name}</div>
    </div>`;
  }).join('');
}

window.toggleTitleStudent = function(studentId) {
  if (selectedTitleStudentIds.has(studentId)) {
    selectedTitleStudentIds.delete(studentId);
  } else {
    selectedTitleStudentIds.add(studentId);
  }
  const el = document.getElementById(`gtsc-${studentId}`);
  if (el) el.classList.toggle('selected', selectedTitleStudentIds.has(studentId));
};

window.selectAllTitleStudents = function(selectAll) {
  eligibleTitleStudentIds.forEach(id => {
    if (selectAll) selectedTitleStudentIds.add(id);
    else selectedTitleStudentIds.delete(id);
  });
  renderGiveTitleStudentGrid();
};

window.giveSpecialTitle = async function() {
  if (!pendingGiveTitleId) return;
  if (selectedTitleStudentIds.size === 0) return showToast('학생을 선택해주세요');
  const t = titles.find(x => x.id === pendingGiveTitleId);
  if (!t) return;
  const selectedStudents = state.students.filter(s => selectedTitleStudentIds.has(s.id));
  const totalGrant = t.gold || GRADE_POINTS[t.grade] || 200;
  const noReward = document.getElementById('titleNoRewardChk')?.checked || false;
  try {
    for (const s of selectedStudents) {
      const invData = {
        studentId: s.id, titleId: t.id,
        titleName: t.name, titleEmoji: t.emoji||'',
        titleGrade: t.grade, type: 'special',
        givenAt: serverTimestamp()
      };
      if (t.bgColor)   invData.bgColor   = t.bgColor;
      if (t.textColor) invData.textColor = t.textColor;
      await setDoc(doc(db, 'titleInventory', `${s.id}_${t.id}`), invData);
      // 학생이 예전에 '영구 삭제'한 이력이 있으면 정리 (재부여 후에도 막히지 않도록)
      if (window._titleAlreadyDel?.has(s.id)) {
        try {
          const delQ = await getDocs(query(collection(db, 'titleDeleted'), where('studentId','==', s.id), where('titleId','==', t.id)));
          await Promise.all(delQ.docs.map(d => deleteDoc(d.ref)));
          window._cachedTitleDeleted = null;
        } catch(e) { console.warn('삭제 이력 정리 실패', e); }
      }

      if (!noReward) {
        // 포인트 + 능력치 지급
        const titleAbilityUpdate = {};
        if (t.abilities && Object.keys(t.abilities).length > 0) {
          Object.entries(t.abilities).forEach(([k, v]) => {
            titleAbilityUpdate[`abilities.${k}`] = increment(v);
          });
        }
        await updateDoc(doc(db, 'students', s.id), {
          points: increment(totalGrant),
          accumulatedPoints: increment(totalGrant),
          ...titleAbilityUpdate
        });
        // 랭크업 체크
        if (t.abilities && Object.keys(t.abilities).length > 0) {
          const freshSnap = await getDocFromServer(doc(db, 'students', s.id));
          if (freshSnap.exists()) {
            const freshData = freshSnap.data();
            const prevAb = {};
            for (const k of Object.keys(t.abilities)) {
              prevAb[k] = (freshData.abilities?.[k] || 0) - (t.abilities[k] || 0);
            }
            const { rankBonus } = await checkAndGrantRankUp(
              s.id, prevAb, t.abilities, freshData.abilityRankGranted || {}
            );
            if (rankBonus > 0) showToast(`${s.name} 랭크업! +${rankBonus}🪙 추가 지급 🎉`);
          }
        }
        await addDoc(collection(db, 'history'), {
          studentId: s.id, studentName: s.name,
          delta: totalGrant,
          reason: `${t.emoji||''} ${t.name} (+${totalGrant}🪙)`,
          type: 'plus', source: 'titleGrant',
          createdAt: serverTimestamp()
        });
      } // end if (!noReward)
    }
    window._cachedTitleInventory = null;
    await loadTitleInventoryCache();
    // 체크박스 초기화
    const chk = document.getElementById('titleNoRewardChk');
    if (chk) chk.checked = false;
    closeModal('giveSpecialTitleModal');
    showToast(noReward
      ? `${selectedStudents.length}명에게 '${t.emoji||''} ${t.name}' 칭호 지급 완료 (보상 없음) 🏅`
      : `${selectedStudents.length}명에게 '${t.emoji||''} ${t.name}' 칭호 부여 & +${totalGrant}🪙! 🏅`);
    await reloadStudents();
    renderDashboard();
  } catch(e) { showToast('오류: ' + e.message); }
};

// ===== 학생 설정: 칭호 장착 =====
window.openEquipTitleModal = async function() {
  const _tiMe = (await loadTitleInventoryCache()).filter(d => d.studentId === state.currentUser.uid);
  const invSnap = { docs: _tiMe.map(d => ({ id: d.id, data: () => d })) };
  const myTitles = invSnap.docs.map(d => d.data());
  const _ms = getMyStudentData();
  const sDoc = { exists: () => Object.keys(_ms).length > 0, data: () => _ms };
  const equippedId = sDoc.exists() ? sDoc.data().equippedTitleId : null;

  const list = document.getElementById('equipTitleList');
  list.innerHTML = myTitles.length ? myTitles.map(t => `
    <div style="display:flex;align-items:center;gap:10px;padding:10px;border-radius:var(--radius-md);border:1.5px solid ${t.titleId===equippedId?'var(--primary)':'var(--border)'};cursor:pointer;background:${t.titleId===equippedId?'var(--primary-light)':''}" onclick="equipTitle('${t.titleId}')">
      ${getTitleBadgeHtml(t.titleGrade, t.bgColor, t.textColor, t.titleEmoji, t.titleName)}
      ${t.titleId===equippedId ? '<span style="margin-left:auto;font-size:12px;color:var(--primary);font-weight:600;">장착 중 ✓</span>' : ''}
    </div>
  `).join('') : '<div class="empty-state" style="padding:30px;"><p>보유한 칭호가 없어요<br>꾸미기 상점에서 구매해 보세요!</p></div>';
  openModal('equipTitleModal');
};

window.equipTitle = async function(titleId) {
  try {
    await updateDoc(doc(db, 'students', state.currentUser.uid), { equippedTitleId: titleId });
    closeModal('equipTitleModal');
    showToast('칭호를 장착했어요 🎨');
    renderStudentSettings();
  } catch(e) { showToast('오류: ' + e.message); }
};

window.unequipTitle = async function() {
  try {
    await updateDoc(doc(db, 'students', state.currentUser.uid), { equippedTitleId: null });
    closeModal('equipTitleModal');
    showToast('칭호를 해제했어요');
    renderStudentSettings();
  } catch(e) { showToast('오류: ' + e.message); }
};
