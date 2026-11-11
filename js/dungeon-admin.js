// dungeon-admin.js — 던전 관리 (교사: 설정·이미지 라이브러리·보스)
import { state } from './state.js?v=20261111b';
import {
  collection, db, deleteDoc, doc, getDoc, getDocs, serverTimestamp, setDoc, updateDoc
} from './firebase.js?v=20261111b';
import { closeModal, showToast } from './core.js?v=20261111b';
import { getTodayStr } from './attendance.js?v=20261111b';
import {
  loadQuizDungeonBoss, loadQuizDungeonConfig, loadQuizDungeonManageStatus
} from './quiz-dungeon.js?v=20261111b';

// ===================================================
// ⚔️ 던전 시스템
// ===================================================

// 기본 몬스터 데이터 (교사 미설정 시 사용)
export const DEFAULT_MONSTERS = {
  easy:      { name:'초원의 고블린',    img:'', hp:60,  atk:16, emoji:'👺', reward:100 },
  normal:    { name:'화염 오크 전사',   img:'', hp:110, atk:22, emoji:'👹', reward:150 },
  hard:      { name:'심연의 드래곤',    img:'', hp:190, atk:32, emoji:'🐲', reward:200 },
  challenge: { name:'심연의 군주',      img:'', hp:320, atk:45, emoji:'👿', reward:250, abReward:{성실성:3,집중력:2} },
  boss:      { name:'고대의 드래곤 왕', img:'', hp:2000,atk:45, emoji:'🐉', reward:500 },
};

// 능력치 → 전투 스탯 변환
export function calcBattleStats(abilities) {
  const a = abilities || {};
  return {
    atk:  10 + Math.floor((a['성실성']||0) * 0.8),
    def:  5  + Math.floor((a['인성']  ||0) * 0.6),
    spd:  5  + Math.floor((a['사회성']||0) * 0.4),
    mag:  8  + Math.floor((a['지력']  ||0) * 0.7),
    crit: 0.05 + (a['집중력']||0) * 0.003,
    hp:   100 + Math.floor(((a['인성']||0) + (a['성실성']||0)) * 0.5),
  };
}

// 던전 HP·공격력 토글
window.toggleDungeonStat = function(diff) {
  const panel = document.getElementById(diff + 'StatPanel');
  const arrow = document.getElementById(diff + 'StatArrow');
  const isOpen = panel.style.maxHeight !== '0px' && panel.style.maxHeight !== '';
  if (isOpen) {
    panel.style.maxHeight = '0';
    panel.style.opacity = '0';
    arrow.style.transform = 'rotate(0deg)';
  } else {
    panel.style.maxHeight = '200px';
    panel.style.opacity = '1';
    arrow.style.transform = 'rotate(90deg)';
  }
};

// 던전 능력치 보상 체크박스 토글
window.updateDungeonAbReward = function(diff) {
  ['성실성','인성','사회성','지력','집중력'].forEach(k => {
    const cb = document.querySelector(`input[type="checkbox"][data-ab="${k}"][data-diff="${diff}"]`);
    const inp = document.getElementById(`${diff}Ab_${k}`);
    if (cb && inp) inp.disabled = !cb.checked;
  });
};

// ===== 교사: 던전 기록 초기화 =====
window.resetDungeonDates = async function() {
  if (!confirm('전체 학생의 오늘 개인 던전 참여 기록을 초기화할까요?\n(단체 던전은 영향 없음)')) return;
  try {
    const sSnap = await getDocs(collection(db, 'students'));
    await Promise.all(sSnap.docs.map(d =>
      updateDoc(doc(db, 'students', d.id), { dungeonSoloDate: null })
    ));
    showToast(`개인 던전 기록 초기화 완료 ✅ (${sSnap.docs.length}명)`);
    // 던전 페이지가 열려있으면 로비 새로고침
    const dungeonPage = document.getElementById('page-dungeonSolo');
    if (dungeonPage && !dungeonPage.classList.contains('hidden')) {
      renderDungeonLobby();
    }
  } catch(e) { showToast('오류: ' + e.message); }
};

// ===== 교사: 던전 관리 =====
// ===== GitHub 이미지 선택 =====
let _githubImgTargetId = null;
let _githubImgIsMonster = false;

// ===== 던전 이미지 라이브러리 =====
let dungeonImages = { mon: [], bg: [] }; // 세션 캐시

async function loadDungeonImages() {
  if (dungeonImages._loaded) return;
  try {
    const snap = await getDoc(doc(db, 'config', 'dungeonImages'));
    if (snap.exists()) {
      dungeonImages = { ...{ mon: [], bg: [] }, ...snap.data(), _loaded: true };
    } else {
      dungeonImages = { mon: [], bg: [], _loaded: true };
    }
  } catch(e) { dungeonImages = { mon: [], bg: [], _loaded: true }; }
}

async function saveDungeonImages() {
  const data = { mon: dungeonImages.mon, bg: dungeonImages.bg };
  await setDoc(doc(db, 'config', 'dungeonImages'), data, { merge: true });
  dungeonImages._loaded = false; // 캐시 무효화
}

window.addDungeonImage = async function(type) {
  const input = document.getElementById(type === 'mon' ? 'newMonUrl' : 'newBgUrl');
  const url = input.value.trim();
  if (!url || !url.startsWith('http')) return showToast('올바른 URL을 입력하세요');
  await loadDungeonImages();
  if (dungeonImages[type].includes(url)) return showToast('이미 등록된 이미지예요');
  dungeonImages[type].push(url);
  await saveDungeonImages();
  input.value = '';
  renderDungeonImgLibrary();
  showToast('이미지가 추가됐어요 ✅');
};

window.removeDungeonImage = async function(type, idx) {
  dungeonImages[type].splice(idx, 1);
  await saveDungeonImages();
  renderDungeonImgLibrary();
};

function renderDungeonImgLibrary() {
  ['mon', 'bg'].forEach(type => {
    const el = document.getElementById(`dungeonImgList_${type}`);
    if (!el) return;
    const imgs = dungeonImages[type] || [];
    if (!imgs.length) {
      el.innerHTML = '<span style="font-size:12px;color:var(--text-muted);">등록된 이미지가 없어요</span>';
      return;
    }
    el.innerHTML = imgs.map((url, i) => `
      <div style="position:relative;display:inline-block;">
        <img src="${url}" style="width:60px;height:60px;object-fit:cover;border-radius:6px;border:1px solid var(--border);" onerror="this.style.opacity=0.3" />
        <button onclick="removeDungeonImage('${type}',${i})"
          style="position:absolute;top:-5px;right:-5px;width:16px;height:16px;border-radius:50%;background:#ef4444;color:#fff;border:none;cursor:pointer;font-size:10px;line-height:16px;padding:0;">✕</button>
      </div>`).join('');
  });
}

window.openGithubImgPicker = async function(targetInputId, desc, folder, isMonster) {
  _githubImgTargetId = targetInputId;
  _githubImgIsMonster = isMonster;
  document.getElementById('githubImgPickerDesc').textContent = desc;

  const overlay = document.getElementById('githubImgPickerModal');
  overlay.style.opacity = '0';
  overlay.classList.remove('hidden');
  requestAnimationFrame(() => {
    overlay.style.transition = 'opacity 0.35s ease';
    overlay.style.opacity = '1';
  });

  const grid = document.getElementById('githubImgGrid');
  grid.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted);grid-column:1/-1;">불러오는 중...</div>';

  await loadDungeonImages();
  const imgs = dungeonImages[folder] || [];
  renderGithubImgGrid(imgs, folder);
};

function renderGithubImgGrid(imgs, folder) {
  const grid = document.getElementById('githubImgGrid');
  if (!imgs.length) {
    grid.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted);grid-column:1/-1;">등록된 이미지가 없어요.<br><small>위 이미지 라이브러리에서 먼저 추가하세요.</small></div>';
    return;
  }
  const isBg = folder === 'bg';
  const imgStyle = isBg
    ? 'width:100%;height:140px;object-fit:cover;image-rendering:auto;display:block;border-radius:6px;'
    : 'width:100%;height:140px;object-fit:contain;image-rendering:auto;display:block;';
  grid.style.cssText = `display:grid;grid-template-columns:1fr 1fr;gap:10px;max-height:420px;overflow-y:auto;overflow-x:hidden;padding:4px;margin-bottom:16px;`;

  // URL 문자열 배열
  grid.innerHTML = imgs.map(url => `
    <div onclick="selectGithubImg('${url}')"
      style="cursor:pointer;border:2px solid var(--border);border-radius:10px;padding:6px;text-align:center;transition:all 0.15s;"
      onmouseenter="this.style.borderColor='var(--primary)';this.style.background='var(--primary-light)'"
      onmouseleave="this.style.borderColor='var(--border)';this.style.background=''">
      <img src="${url}" style="${imgStyle}" onerror="this.style.opacity=0.3" loading="lazy" />
    </div>`).join('');
}

window.selectGithubImg = function(url) {
  // 문제 던전 몬스터/배경 미리보기
  if (_githubImgTargetId === 'qdMonImg') {
    const p = document.getElementById('qdMonPreview');
    const e = document.getElementById('qdMonPreviewEmpty');
    if (p) { p.src = url; p.style.display = 'block'; }
    if (e) e.style.display = 'none';
  }
  if (_githubImgTargetId === 'qdBgImg') {
    const p = document.getElementById('qdBgPreview');
    const e = document.getElementById('qdBgPreviewEmpty');
    if (p) { p.src = url; p.style.display = 'block'; }
    if (e) e.style.display = 'none';
  }
  const input = document.getElementById(_githubImgTargetId);
  if (input) {
    input.value = url;
    if (_githubImgIsMonster) {
      const diffMap = { easyImg:'easy', normalImg:'normal', hardImg:'hard', bossImg:'boss' };
      const diff = diffMap[_githubImgTargetId];
      if (diff) {
        const imgEl = document.getElementById(`preview${diff.charAt(0).toUpperCase()+diff.slice(1)}`);
        const emptyEl = document.getElementById(`preview${diff.charAt(0).toUpperCase()+diff.slice(1)}Empty`);
        if (imgEl) { imgEl.src = url; imgEl.style.display = 'block'; }
        if (emptyEl) emptyEl.style.display = 'none';
      }
    } else {
      // 배경 선택 - 썸네일 업데이트
      const thumbMap = { easyBg:'thumbEasyBg', normalBg:'thumbNormalBg', hardBg:'thumbHardBg', bossBg:'thumbBossBg', raidBgImg:'thumbRaidBg' };
      const thumbId = thumbMap[_githubImgTargetId];
      if (thumbId) {
        const thumb = document.getElementById(thumbId);
        const empty = document.getElementById(thumbId + 'Empty');
        if (thumb) { thumb.src = url; thumb.style.display = 'block'; }
        if (empty) empty.style.display = 'none';
      }
    }
  }
  closeModal('githubImgPickerModal');
  showToast('이미지가 선택됐어요 ✅');
};

export async function renderDungeonManage() {
  loadBossStatus();
  await loadDungeonImages();
  renderDungeonImgLibrary();
  const qcfg = await loadQuizDungeonConfig();
  // 문제 던전 썸네일 복원
  if (qcfg?.monImg) {
    const p = document.getElementById('qdMonPreview');
    const e = document.getElementById('qdMonPreviewEmpty');
    if (p) { p.src = qcfg.monImg; p.style.display = 'block'; }
    if (e) e.style.display = 'none';
    const inp = document.getElementById('qdMonImg');
    if (inp) inp.value = qcfg.monImg;
  }
  if (qcfg?.bgImg) {
    const p = document.getElementById('qdBgPreview');
    const e = document.getElementById('qdBgPreviewEmpty');
    if (p) { p.src = qcfg.bgImg; p.style.display = 'block'; }
    if (e) e.style.display = 'none';
    const inp = document.getElementById('qdBgImg');
    if (inp) inp.value = qcfg.bgImg;
  }
  await loadQuizDungeonBoss();
  loadQuizDungeonManageStatus();
  try {
    if (!window._dungeonBossDoc) {
      window._dungeonBossDoc = await getDoc(doc(db, 'config', 'dungeonBoss'));
    }
    const bossDoc = window._dungeonBossDoc;
    if (bossDoc.exists() && bossDoc.data().bgImg) {
      const bgEl = document.getElementById('raidBgImg');
      if (bgEl) {
        bgEl.value = bossDoc.data().bgImg;
        const thumb = document.getElementById('thumbRaidBg');
        const thumbEmpty = document.getElementById('thumbRaidBgEmpty');
        if (thumb) { thumb.src = bgEl.value; thumb.style.display = 'block'; }
        if (thumbEmpty) thumbEmpty.style.display = 'none';
      }
    }
  } catch(e) {}
  try {
    if (!window._dungeonCfgDoc) {
      window._dungeonCfgDoc = await getDoc(doc(db, 'config', 'dungeon'));
    }
    const cfgDoc = window._dungeonCfgDoc;
    if (cfgDoc.exists()) {
      const d = cfgDoc.data();
      ['easy','normal','hard','challenge','boss'].forEach(k => {
        if (d[k]) {
          const m = d[k];
          if (document.getElementById(k+'Name'))   document.getElementById(k+'Name').value   = m.name   || '';
          if (document.getElementById(k+'Hp'))     document.getElementById(k+'Hp').value     = m.hp     || '';
          if (document.getElementById(k+'Atk'))    document.getElementById(k+'Atk').value    = m.atk    || '';
          if (document.getElementById(k+'Reward')) document.getElementById(k+'Reward').value = m.reward || (k==='boss'?500:k==='challenge'?250:100);
          // hidden input 로드 + 배경 썸네일 표시
          const setHidden = (id, val) => {
            const el = document.getElementById(id);
            if (el && val) {
              el.value = val;
              const thumbMap = { easyBg:'thumbEasyBg', normalBg:'thumbNormalBg', hardBg:'thumbHardBg', challengeBg:'thumbChallengeBg', bossBg:'thumbBossBg' };
              const thumbId = thumbMap[id];
              if (thumbId) {
                const thumb = document.getElementById(thumbId);
                const empty = document.getElementById(thumbId + 'Empty');
                if (thumb) { thumb.src = val; thumb.style.display = 'block'; }
                if (empty) empty.style.display = 'none';
              }
            }
          };
          setHidden(k+'Img', m.img);
          setHidden(k+'Bg',  m.bg);
          if (m.img) previewMonsterImg(k, m.img);
          // 능력치 보상 로드
          if (m.abReward && k !== 'boss') {
            Object.entries(m.abReward).forEach(([ab, v]) => {
              const cb = document.querySelector(`input[type="checkbox"][data-ab="${ab}"][data-diff="${k}"]`);
              const inp = document.getElementById(`${k}Ab_${ab}`);
              if (cb) { cb.checked = true; }
              if (inp) { inp.value = v; inp.disabled = false; }
            });
          }
        }
      });
    }
  } catch(e) {}
  // 챌린지 현황 로드
  loadChallengeStatus();
}

async function loadChallengeStatus() {
  const box = document.getElementById('challengeStatusBox');
  const list = document.getElementById('challengeStatusList');
  if (!box) return;
  const today = getTodayStr();
  const vis = state.students.filter(s=>!s.hidden).sort((a,b)=>(a.number||0)-(b.number||0));
  const count = vis.filter(s=>s.dungeonChallengeDate===today).length;
  // 요약 (항상 보임)
  box.innerHTML = `오늘 참여: <strong style="color:var(--primary);">${count}명</strong> / ${vis.length}명`;
  // 명단 (토글)
  if (list) {
    const rows = vis.map(s => {
      const played = s.dungeonChallengeDate === today;
      return `<div style="display:flex;align-items:center;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);font-size:13px;">
        <span>${s.number||''}번 ${s.name}</span>
        <span style="font-weight:700;color:${played?'#16a34a':'#94a3b8'};">${played?'✅ 참여':'—'}</span>
      </div>`;
    }).join('');
    list.innerHTML = rows || '<div style="color:var(--text-muted);">학생이 없어요</div>';
  }
}

window.previewMonsterImg = function(key, urlOverride) {
  const capKey = key.charAt(0).toUpperCase() + key.slice(1);
  const url = urlOverride || document.getElementById(key+'Img')?.value?.trim();
  const img = document.getElementById('preview'+capKey);
  const empty = document.getElementById('preview'+capKey+'Empty');
  if (img && url) {
    img.style.display = 'none'; // 일단 숨기고
    if (empty) empty.style.display = 'flex';
    const testImg = new Image();
    testImg.onload = () => {
      img.src = url;
      img.style.display = 'block';
      if (empty) empty.style.display = 'none';
    };
    testImg.onerror = () => {
      img.style.display = 'none';
      if (empty) { empty.style.display = 'flex'; empty.textContent = '❌'; }
    };
    testImg.src = url;
  } else if (img) {
    img.style.display = 'none';
    if (empty) empty.style.display = 'flex';
  }
};

window.activateRaidBoss = async function() {
  const cfgDoc = await getDoc(doc(db, 'config', 'dungeon'));
  const bossM = cfgDoc.exists() ? cfgDoc.data().boss : null;
  const maxHp = bossM?.hp || 2000;
  const name = bossM?.name || '고대의 드래곤 왕';
  const bgImg = document.getElementById('raidBgImg')?.value?.trim() || '';
  if (!confirm(`'${name}' 보스를 HP ${maxHp.toLocaleString()}으로 활성화할까요?`)) return;
  await setDoc(doc(db, 'config', 'dungeonBoss'), {
    currentHp: maxHp, maxHp, name, attackers: [], bgImg, activatedAt: serverTimestamp()
  });
  window._raidBossDoc = null;
  showToast(`${name} 보스가 활성화됐어요! ⚔️`);
  loadBossStatus();
};

window.deduplicateAttackers = async function() {
  try {
    const snap = await getDoc(doc(db, 'config', 'dungeonBoss'));
    if (!snap.exists()) return showToast('활성화된 보스가 없어요');
    const attackers = snap.data().attackers || [];
    const deduped = [...new Set(attackers)];
    if (attackers.length === deduped.length) return showToast('중복 없음 ✅ 이미 정상이에요');
    await updateDoc(doc(db, 'config', 'dungeonBoss'), { attackers: deduped });
    showToast(`중복 정리 완료 ✅ ${attackers.length}명 → ${deduped.length}명`);
    loadBossStatus();
  } catch(e) { showToast('오류: ' + e.message); }
};

window.resetRaidBoss = async function() {
  if (!confirm('보스를 초기화할까요? 모든 참여 기록이 삭제돼요.')) return;
  await deleteDoc(doc(db, 'config', 'dungeonBoss'));
  window._raidBossDoc = null;
  showToast('보스가 초기화됐어요');
  loadBossStatus();
};

// 단체 던전 알 수 없는 참여자 제거
window.removeRaidParticipant = async function(uid) {
  if (!confirm('명단에서 제거할까요?')) return;
  const bossDoc = await getDoc(doc(db, 'config', 'dungeonBoss'));
  if (!bossDoc.exists()) return;
  const attackers = (bossDoc.data().attackers || []).filter(id => id !== uid);
  await updateDoc(doc(db, 'config', 'dungeonBoss'), { attackers });
  window._raidBossDoc = null;
  showToast('제거됐어요');
  openRaidParticipantsModal();
};

// 문제 던전 알 수 없는 참여자 제거
window.removeQuizParticipant = async function(uid) {
  if (!confirm('명단에서 제거할까요?')) return;
  const boss = await loadQuizDungeonBoss();
  if (!boss) return;
  const participants = (boss.participants || []).filter(id => id !== uid);
  const clearers = (boss.clearers || []).filter(id => id !== uid);
  await updateDoc(doc(db, 'config', 'quizDungeonBoss'), { participants, clearers });
  state.quizDungeonBoss = undefined;
  showToast('제거됐어요');
  openQuizParticipantsModal();
};

// 문제 던전 참여자 확인 모달
window.openQuizParticipantsModal = async function() {
  const boss = await loadQuizDungeonBoss();
  if (!boss) return showToast('활성화된 문제 던전이 없어요');
  const participantIds = boss.participants || [];
  const clearerIds = boss.clearers || [];
  const total = participantIds.length;
  const cleared = clearerIds.length;
  const rows = participantIds.map(id => {
    const s = state.students.find(st => st.id === id);
    const isCleared = clearerIds.includes(id);
    const label = s ? `${s.number||''}번 ${s.name}` : `<span style="color:#94a3b8;font-style:italic;">알 수 없는 계정</span>`;
    return `<div style="display:flex;align-items:center;gap:10px;padding:8px 12px;border-bottom:1px solid var(--border);">
      <span style="font-size:13px;flex:1;">${label}</span>
      <span style="font-size:12px;font-weight:600;color:${isCleared?'#16a34a':'#94a3b8'}">${isCleared?'✅ 클리어':'참여'}</span>
      ${!s ? `<button onclick="removeQuizParticipant('${id}')" style="font-size:11px;color:#dc2626;background:#fee2e2;border:none;padding:2px 8px;border-radius:6px;cursor:pointer;">제거</button>` : ''}
    </div>`;
  }).join('') || '<div style="padding:20px;text-align:center;color:var(--text-muted);">참여자가 없어요</div>';

  let modal = document.getElementById('quizParticipantsModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'quizParticipantsModal';
    modal.className = 'modal-overlay hidden';
    modal.innerHTML = `<div class="modal" style="max-width:400px;max-height:80vh;overflow:hidden;padding:0;">
      <div style="padding:20px 20px 0;">
        <div style="font-size:17px;font-weight:700;margin-bottom:4px;">📚 문제 던전 참여자</div>
        <div id="quizParticipantsSummary" style="font-size:13px;color:var(--text-muted);margin-bottom:12px;"></div>
      </div>
      <div id="quizParticipantsList" style="overflow-y:auto;max-height:50vh;"></div>
      <div style="padding:12px 20px;"><button class="btn btn-secondary btn-full" onclick="closeModal('quizParticipantsModal')">닫기</button></div>
    </div>`;
    document.body.appendChild(modal);
  }
  document.getElementById('quizParticipantsSummary').textContent = `총 ${total}명 참여 · ${cleared}명 클리어`;
  document.getElementById('quizParticipantsList').innerHTML = rows;
  modal.classList.remove('hidden');
  modal.style.opacity = '0';
  requestAnimationFrame(() => { modal.style.transition = 'opacity 0.35s ease'; modal.style.opacity = '1'; });
};

// 참여자 확인 모달
window.openRaidParticipantsModal = async function() {
  const bossDoc = await getDoc(doc(db, 'config', 'dungeonBoss'));
  if (!bossDoc.exists()) return showToast('활성화된 보스가 없어요');
  const d = bossDoc.data();
  const attackerIds = [...new Set(d.attackers || [])];
  const rows = attackerIds.map(id => {
    const s = state.students.find(st => st.id === id);
    const label = s ? `${s.number||''}번 ${s.name}` : `<span style="color:#94a3b8;font-style:italic;">알 수 없는 계정</span>`;
    return `<div style="display:flex;align-items:center;gap:10px;padding:8px 12px;border-bottom:1px solid var(--border);">
      <span style="font-size:13px;flex:1;">${label}</span>
      ${!s ? `<button onclick="removeRaidParticipant('${id}')" style="font-size:11px;color:#dc2626;background:#fee2e2;border:none;padding:2px 8px;border-radius:6px;cursor:pointer;">제거</button>` : ''}
    </div>`;
  }).join('') || '<div style="padding:20px;text-align:center;color:var(--text-muted);">참여자가 없어요</div>';

  let modal = document.getElementById('raidParticipantsModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'raidParticipantsModal';
    modal.className = 'modal-overlay hidden';
    modal.innerHTML = `<div class="modal" style="max-width:400px;max-height:80vh;overflow:hidden;padding:0;">
      <div style="padding:24px 24px 0;font-size:17px;font-weight:700;">👥 누적 참여자 명단</div>
      <div id="raidParticipantsList" style="overflow-y:auto;max-height:50vh;margin:16px 0;"></div>
      <div style="padding:0 24px 24px;"><button class="btn btn-secondary btn-full" onclick="closeModal('raidParticipantsModal')">닫기</button></div>
    </div>`;
    document.body.appendChild(modal);
  }
  document.getElementById('raidParticipantsList').innerHTML = rows;
  modal.classList.remove('hidden');
  modal.style.opacity = '0';
  requestAnimationFrame(() => { modal.style.transition = 'opacity 0.35s ease'; modal.style.opacity = '1'; });
};

async function loadBossStatus() {
  const statusEl = document.getElementById('currentBossStatus');
  if (!statusEl) return;
  const bossDoc = await getDoc(doc(db, 'config', 'dungeonBoss'));
  if (bossDoc.exists()) {
    const d = bossDoc.data();
    const pct = Math.round((d.currentHp / d.maxHp) * 100);
    statusEl.innerHTML = `<strong>현재 보스:</strong> ${d.name} | HP ${d.currentHp?.toLocaleString()} / ${d.maxHp?.toLocaleString()} (${pct}%) | 누적 참여자 ${new Set(d.attackers||[]).size}명`;
  } else {
    statusEl.textContent = '현재 활성화된 보스가 없어요.';
  }
}

window.saveDungeonConfig = async function() {
  const data = {};
  ['easy','normal','hard','challenge','boss'].forEach(k => {
    const defaultReward = k === 'boss' ? 500 : k === 'challenge' ? 250 : 100;
    // 능력치 보상 수집
    const abReward = {};
    if (k !== 'boss') {
      ['성실성','인성','사회성','지력','집중력'].forEach(ab => {
        const cb = document.querySelector(`input[type="checkbox"][data-ab="${ab}"][data-diff="${k}"]`);
        if (cb?.checked) {
          const v = parseInt(document.getElementById(`${k}Ab_${ab}`)?.value || '1');
          if (v > 0) abReward[ab] = v;
        }
      });
    }
    data[k] = {
      name:   document.getElementById(k+'Name')?.value?.trim()    || DEFAULT_MONSTERS[k].name,
      img:    document.getElementById(k+'Img')?.value?.trim()     || '',
      hp:     parseInt(document.getElementById(k+'Hp')?.value)    || DEFAULT_MONSTERS[k].hp,
      atk:    parseInt(document.getElementById(k+'Atk')?.value)   || DEFAULT_MONSTERS[k].atk,
      reward: parseInt(document.getElementById(k+'Reward')?.value) || defaultReward,
      bg:     document.getElementById(k+'Bg')?.value?.trim()      || '',
      ...(Object.keys(abReward).length ? { abReward } : {}),
    };
  });
  try {
    await setDoc(doc(db, 'config', 'dungeon'), data, { merge: true });
    // 보스 배경 이미지도 dungeonBoss에 저장
    const bgImg = document.getElementById('raidBgImg')?.value?.trim() || '';
    if (!window._raidBossDoc) window._raidBossDoc = await getDoc(doc(db, 'config', 'dungeonBoss'));
    const bossDoc = window._raidBossDoc;
    if (bossDoc.exists()) {
      await updateDoc(doc(db, 'config', 'dungeonBoss'), { bgImg });
    }
    window._dungeonCfgDoc = null; window._dungeonBossDoc = null;
    // 문제 던전 이미지도 함께 저장
    const qdMonImg = document.getElementById('qdMonImg')?.value?.trim() || '';
    const qdBgImg  = document.getElementById('qdBgImg')?.value?.trim()  || '';
    if (qdMonImg || qdBgImg) {
      const existing = await loadQuizDungeonConfig();
      const quizUpdate = { ...(existing||{}), monImg: qdMonImg, bgImg: qdBgImg };
      await setDoc(doc(db, 'config', 'quizDungeon'), quizUpdate, { merge: true });
      state.quizDungeonConfig = null; // 캐시 무효화
    }
    showToast('던전 설정이 저장됐어요 ⚔️');
  } catch(e) { showToast('오류: ' + e.message); }
};
