// home.js — 홈 화면(간판, 교사/학생 랭킹)
import { state } from './state.js?v=20261111a';
import { collection, db, getDocs } from './firebase.js?v=20261111a';
import { getCfgSite, loadTitleInventoryCache } from './core.js?v=20261111a';
import { calcLevel } from './level.js?v=20261111a';
import { reloadStudents } from './realtime.js?v=20261111a';
import { renderStudentPendingExchanges } from './exchanges.js?v=20261111a';
import { getTodayStr, updateAttendBtn } from './attendance.js?v=20261111a';
import { renderTodayRolesBox } from './roles.js?v=20261111a';
import { updateBoardBadge } from './board.js?v=20261111a';
import { updateDungeonBadge, updateMyRolesBadge } from './dungeon.js?v=20261111a';
import { FRAME_DATA, loadCustomFrames } from './frames.js?v=20261111a';
import { getTitleBadgeHtml, reloadTitles, titles } from './titles.js?v=20261111a';
import { buildCharHtml, getStudentChar, loadAvatarItemList } from './avatar.js?v=20261111a';
import { loadNotice } from './notice.js?v=20261111a';
import { updateFloatingCheckBtn } from './checklist.js?v=20261111a';
import { loadPetList } from './pets.js?v=20261111a';

// ===== 간판 데이터 로드 =====
export async function loadBanner(isTeacher) {
  try {
    const d = await getCfgSite();
    const logo = d.logo || '🏫';
    const logoImg = d.logoImg || '';
    const title = d.title || '우리반 홈페이지';
    const startDate = d.startDate || '';

    // 누적 포인트 - students 캐시 사용 (onSnapshot으로 최신 유지)
    let totalPts = 0;
    state.students.forEach(s => { totalPts += (s.accumulatedPoints ?? s.points ?? 0); });

    // 함께한 날 계산
    let daysText = '시작일을 설정해 주세요';
    if (startDate) {
      const [y,m,d] = startDate.split('-').map(Number);
      const start = new Date(y, m-1, d); // 로컬 자정 기준 (UTC 버그 방지)
      const todayMidnight = new Date();
      todayMidnight.setHours(0,0,0,0);
      const diff = Math.floor((todayMidnight - start) / (1000 * 60 * 60 * 24)) + 1;
      daysText = `함께한 지 ${diff}일째 🌱`;
    }

    // 사이드바 간판 업데이트
    const prefix = isTeacher ? 'teacher' : 'student';
    const logoEl = document.getElementById(`${prefix}SidebarLogo`);
    const titleEl = document.getElementById(`${prefix}SidebarTitle`);
    const daysEl = document.getElementById(`${prefix}SidebarDays`);
    const ptsEl = document.getElementById(`${prefix}SidebarPoints`);

    if (logoEl) {
      if (logoImg) {
        logoEl.innerHTML = `<img src="${logoImg}" style="width:40px;height:40px;object-fit:contain;" onerror="this.parentElement.textContent='${logo}'" />`;
      } else {
        logoEl.textContent = logo;
      }
      logoEl.style.opacity = '1';
    }
    if (titleEl) { titleEl.textContent = title; titleEl.style.opacity = '1'; }
    if (daysEl) { daysEl.textContent = daysText; daysEl.style.opacity = '1'; }
    if (ptsEl) { ptsEl.textContent = `누적 ${totalPts.toLocaleString()}🪙`; ptsEl.style.opacity = '1'; }
  } catch(e) { console.error('배너 로드 오류:', e); }
}

// ===== 교사: 홈 (전체 랭킹) =====
export async function renderTeacherHome() {
  updateBoardBadge();
  await loadAvatarItemList();
  await loadCustomFrames();
  await loadBanner(true);
  await reloadTitles(); // 칭호 색상 표시에 필요
  if (!window._noticeLoadedTeacher) {
    await loadNotice(true);
  }
  // 오늘의 1인1역 박스
  renderTodayRolesBox();
  // students는 onSnapshot 리스너가 항상 최신으로 유지 → 캐시 사용
  const allStudents = [...state.students].map(s => ({
    ...s,
    _accum: s.accumulatedPoints ?? s.points ?? 0
  })).sort((a, b) => {
    const pd = b._accum - a._accum;
    if (pd !== 0) return pd;
    return (a.number || 999) - (b.number || 999);
  });

  const ranks = [];
  let currentRank = 1;
  for (let i = 0; i < allStudents.length; i++) {
    const cur = allStudents[i]._accum;
    const prev = i > 0 ? allStudents[i-1]._accum : cur;
    if (i > 0 && cur < prev) currentRank = i + 1;
    ranks.push(currentRank);
  }
  const rankCount = {};
  ranks.forEach(r => { rankCount[r] = (rankCount[r] || 0) + 1; });

  // titleInventory - 캐시 사용
  const allInventory = [];
  const studentsWithTitle = allStudents.filter(s => s.equippedTitleId);
  if (studentsWithTitle.length > 0) {
    if (!window._cachedTitleInventory) {
      const invSnap2 = { docs: (await loadTitleInventoryCache()).map(d => ({ id: d.id, data: () => d })) };
      window._cachedTitleInventory = invSnap2.docs.map(d => d.data());
    }
    window._cachedTitleInventory.forEach(inv => {
      if (studentsWithTitle.some(s => s.id === inv.studentId && s.equippedTitleId === inv.titleId)) {
        allInventory.push(inv);
      }
    });
  }

  // frameInventory - 캐시 사용
  const frameInvMap2 = {};
  const studentsWithFrame = allStudents.filter(s => s.equippedFrameId);
  if (studentsWithFrame.length > 0) {
    if (!window._cachedFrameInventory) {
      const frameInvSnap2 = await getDocs(collection(db, 'frameInventory'));
      window._cachedFrameInventory = frameInvSnap2.docs.map(d => d.data());
    }
    window._cachedFrameInventory.forEach(data => {
      if (studentsWithFrame.some(s => s.id === data.studentId && s.equippedFrameId === data.frameId)) {
        frameInvMap2[data.studentId] = data;
      }
    });
  }

  const todayT = getTodayStr();
  // 펫 목록 로드 (카드에서 petEquipped 표시용)
  await loadPetList();
  const grid = document.getElementById('teacherHomeGrid');
  grid.innerHTML = allStudents.map((s, i) => {
    const char = getStudentChar(s);
    const rank = ranks[i];
    const isTied = rankCount[rank] > 1;
    const medal = rank===1?'🥇':rank===2?'🥈':rank===3?'🥉':null;
    const rankLabel = medal ? medal : (isTied ? `공동 ${rank}위` : `${rank}위`);
    const rankColor = rank <= 3 ? 'var(--warning)' : 'var(--text-muted)';
    const soloCountT = s.dungeonSoloDate === todayT ? 0 : 1;
    const raidCountT  = s.dungeonRaidDate === todayT ? 0 : 1;
    // 장착된 칭호 (없으면 빈칸으로 높이 고정)
    let titleHtml = '';
    if (s.equippedTitleId) {
      const inv = allInventory?.find(x => x.studentId === s.id && x.titleId === s.equippedTitleId)
        || allInventory?.find(x => x.studentId === s.id && !x.titleId && x.titleName);
      if (inv) {
        // bgColor/textColor가 inventory에 없으면 titles 원본에서 보완
        const titleMaster = titles.find(t => t.id === inv.titleId);
        const bgColor = inv.bgColor || titleMaster?.bgColor;
        const textColor = inv.textColor || titleMaster?.textColor;
        titleHtml = getTitleBadgeHtml(inv.titleGrade||'normal', bgColor, textColor, inv.titleEmoji, inv.titleName);
      }
    }
    const titleShadow = titleHtml ? 'drop-shadow(0 2px 4px rgba(0,0,0,0.18))' : 'none';

    // 프레임 적용
    const fi2 = frameInvMap2[s.id];
    const efId2 = s.equippedFrameId;
    const fd2 = efId2 && fi2?.frameId === efId2 ? fi2 : null;
    const fCss2 = fd2 ? (FRAME_DATA[fd2.frameId]?.css || fd2.frameCss || '') : '';
    const fNeon2 = fd2 ? (FRAME_DATA[fd2.frameId]?.neonTxt || '') : '';
    const hf2 = !!fCss2;
    const tw2   = 'color:#fff;text-shadow:0 1px 4px rgba(0,0,0,0.5);';
    const ns2   = fNeon2 ? '' : tw2;
    const nc2   = hf2 ? `${ns2}font-size:18px;font-weight:700;margin-bottom:6px;` : 'font-size:18px;font-weight:700;margin-bottom:6px;';
    const pc2   = hf2 ? (fNeon2 ? '' : 'color:#fff;text-shadow:0 1px 3px rgba(0,0,0,0.3);') : 'color:var(--primary);';
    const lc2   = hf2 ? (fNeon2 ? '' : 'color:rgba(255,255,255,0.9);') : 'color:#6366f1;';
    const rc2   = hf2 ? (fNeon2 ? '' : 'color:rgba(255,255,255,0.9);text-shadow:0 1px 3px rgba(0,0,0,0.4);') : `color:${rankColor};`;
    const tc2   = hf2 && fNeon2 ? fNeon2 : '';
    const isEmojiPat2 = !!(fd2 && (FRAME_DATA[fd2.frameId]?.emojiPattern || fd2.emojiPattern));
    const emojiCanvas2 = isEmojiPat2
      ? `<canvas id="tfpc_${s.id}" width="210" height="280" style="position:absolute;inset:0;width:100%;height:100%;border-radius:var(--radius-lg);z-index:0;"></canvas>`
      : '';

    return `
    <div class="${fCss2}" style="position:relative;overflow:hidden;border-radius:var(--radius-lg);border:${hf2?'none':'1px solid var(--border)'};padding:30px;text-align:center;box-shadow:var(--shadow-sm);transition:transform 0.2s ease,box-shadow 0.2s ease;cursor:pointer;"
      onclick="openStudentDetail('${s.id}','${s.name.replace(/'/g,String.fromCharCode(39))}')"
      onmouseenter="this.style.transform='translateY(-4px)';this.style.boxShadow='0 8px 24px rgba(0,0,0,0.18)'"
      onmouseleave="this.style.transform='';this.style.boxShadow='var(--shadow-sm)'">
      ${emojiCanvas2}
      <div class="${tc2}" style="position:relative;z-index:1;font-size:${rank<=3?'22':'16'}px;font-weight:700;margin-bottom:6px;${rc2}">${rankLabel}</div>
      <div style="position:relative;z-index:1;height:42px;display:flex;align-items:center;justify-content:center;margin-bottom:9px;filter:${titleShadow};">${titleHtml}</div>
      ${(() => {
        const petItem = (window._cachedPetList||[]).find(p=>p.id===s.petEquipped);
        if (petItem) return `<div style="position:relative;z-index:1;display:flex;width:160px;margin:0 auto;align-items:flex-end;">
          <div style="flex:7;display:flex;justify-content:flex-end;align-items:flex-end;">${buildCharHtml(s, 'margin:0 0 12px 0;')}</div>
          <div style="flex:3;display:flex;align-items:flex-end;justify-content:flex-start;padding-bottom:12px;">
            <img src="${petItem.imgUrl}" style="width:60px;height:100px;object-fit:contain;" onerror="this.style.display='none'" />
          </div>
        </div>`;
        return `<div style="position:relative;z-index:1;">${buildCharHtml(s, 'margin:0 auto 12px;')}</div>`;
      })()}
      <div class="${tc2}" style="position:relative;z-index:1;${nc2}">
        ${s.avatarEmoji ? `<span style="font-size:17px;">${s.avatarEmoji}</span> ` : ''}${s.name}
      </div>
      ${s.profileMsg ? `<div style="position:relative;z-index:1;margin:4px auto 2px;display:inline-block;max-width:90%;padding:3px 10px;border-radius:8px;border:1px solid ${hf2?'rgba(255,255,255,0.3)':'rgba(0,0,0,0.1)'};background:${hf2?'rgba(0,0,0,0.25)':'rgba(0,0,0,0.06)'};font-size:12px;font-weight:500;color:${hf2?'rgba(255,255,255,0.9)':'var(--text-secondary)'};backdrop-filter:blur(4px);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${s.profileMsg}</div>` : '<div style="height:4px;"></div>'}
      <div class="${tc2}" style="position:relative;z-index:1;font-size:21px;font-weight:800;${pc2}">🪙 ${s._accum.toLocaleString()}</div>
      <div style="position:relative;z-index:1;margin-top:5px;display:inline-block;padding:3px 10px;border-radius:8px;border:1px solid ${hf2?'rgba(255,255,255,0.3)':'rgba(0,0,0,0.1)'};background:${hf2?'rgba(0,0,0,0.25)':'rgba(0,0,0,0.05)'};font-size:12px;font-weight:600;color:${hf2?'rgba(255,255,255,0.9)':'var(--text-secondary)'};backdrop-filter:blur(4px);">⚔️ ${soloCountT}/1 · 🐉 ${raidCountT}/1</div>
      <div class="${tc2}" style="position:relative;z-index:1;font-size:18px;font-weight:700;margin-top:4px;${lc2}">Lv.${calcLevel(s._accum)}</div>
    </div>`;
  }).join('') || '<div class="empty-state"><p>아직 학생이 없어요</p></div>';

  // 이모지 패턴 프레임 canvas 렌더링 (교사 홈)
  setTimeout(() => {
    allStudents.forEach(s => {
      const fInv2 = frameInvMap2[s.id];
      if (!fInv2) return;
      const fdT = FRAME_DATA[fInv2.frameId];
      const pat2 = fdT?.emojiPattern || fInv2.emojiPattern;
      if (!pat2) return;
      const canvas = document.getElementById(`tfpc_${s.id}`);
      if (canvas) renderEmojiPatternCanvas(canvas, pat2);
    });
  }, 50);
}

// ===== 학생: 홈 (전체 랭킹) =====
export async function renderStudentHome() {
  updateDungeonBadge(); updateMyRolesBadge(); updateFloatingCheckBtn(); updateBoardBadge();
  await loadAvatarItemList();
  await loadCustomFrames();
  await loadBanner(false);
  await reloadTitles();
  if (!window._noticeLoaded) {
    await loadNotice(false);
  }
  await updateAttendBtn();
  // profileMsg 등 최신 데이터 반영을 위해 students 갱신
  await reloadStudents();
  // 펫 목록 로드 (프로필 카드에서 petEquipped 표시용)
  await loadPetList();
  // 교환 신청 내역 렌더 (pending 중인 것만)
  renderStudentPendingExchanges();
  // 오늘의 1인1역 박스
  renderTodayRolesBox();
  // students는 onSnapshot 리스너가 항상 최신으로 유지 → 캐시 사용
  const allStudents = [...state.students].filter(s => !s.hidden).map(s => ({
    ...s,
    _accum: s.accumulatedPoints ?? s.points ?? 0
  })).sort((a, b) => {
    const pd = b._accum - a._accum;
    if (pd !== 0) return pd;
    return (a.number || 999) - (b.number || 999);
  });

  // 공동 순위 계산
  const ranks = [];
  let currentRank = 1;
  for (let i = 0; i < allStudents.length; i++) {
    const cur = allStudents[i]._accum;
    const prev = i > 0 ? allStudents[i-1]._accum : cur;
    if (i > 0 && cur < prev) currentRank = i + 1;
    ranks.push(currentRank);
  }

  // 같은 순위가 여러 명인지 체크
  const rankCount = {};
  ranks.forEach(r => { rankCount[r] = (rankCount[r] || 0) + 1; });

  const grid = document.getElementById('classRankGrid');
  // titleInventory - 장착 칭호 있는 학생만 (읽기 최소화)
  const allInventory = [];
  const studentsWithTitle2 = allStudents.filter(s => s.equippedTitleId);
  if (studentsWithTitle2.length > 0) {
    // 이미 캐시된 titleInventory가 있으면 재사용, 없으면 1회 조회
    if (!window._cachedTitleInventory) {
      if (!window._cachedTitleInventory) {
    await loadTitleInventoryCache();
  }
  const invSnap = { docs: window._cachedTitleInventory.map(d => ({ data: () => d })) };
      window._cachedTitleInventory = invSnap.docs.map(d => d.data());
    }
    window._cachedTitleInventory.forEach(inv => {
      if (studentsWithTitle2.some(s => s.id === inv.studentId && s.equippedTitleId === inv.titleId)) {
        allInventory.push(inv);
      }
    });
  }

  // frameInventory - 장착 프레임 있는 학생만 (읽기 최소화)
  const frameInvMap = {};
  const studentsWithFrame2 = allStudents.filter(s => s.equippedFrameId);
  if (studentsWithFrame2.length > 0) {
    if (!window._cachedFrameInventory) {
      if (!window._cachedFrameInventory) { const _fi3 = await getDocs(collection(db, 'frameInventory')); window._cachedFrameInventory = _fi3.docs.map(d => d.data()); }
    }
    window._cachedFrameInventory.forEach(data => {
      if (studentsWithFrame2.some(s => s.id === data.studentId && s.equippedFrameId === data.frameId)) {
        frameInvMap[data.studentId] = data;
      }
    });
  }

  const today = getTodayStr();
  grid.innerHTML = allStudents.map((s, i) => {
    const isMe = s.id === state.currentUser.uid;
    const char = getStudentChar(s);
    const rank = ranks[i];
    const isTied = rankCount[rank] > 1;
    const medal = rank===1?'🥇':rank===2?'🥈':rank===3?'🥉':null;
    const rankLabel = medal ? medal : (isTied ? `공동 ${rank}위` : `${rank}위`);
    const rankColor = rank <= 3 ? 'var(--warning)' : 'var(--text-muted)';
    // 던전 잔여 횟수 (참여 안 했으면 1, 참여했으면 0)
    const soloCount = s.dungeonSoloDate === today ? 0 : 1;
    const raidCount  = s.dungeonRaidDate === today ? 0 : 1;
    let titleHtml = '';
    if (s.equippedTitleId) {
      // titleInventory에서 해당 학생의 장착 칭호 찾기
      // titleId 필드 또는 문서ID 패턴으로 찾기 (구버전 데이터 대응)
      const inv = allInventory.find(x =>
        x.studentId === s.id && (x.titleId === s.equippedTitleId)
      ) || allInventory.find(x =>
        x.studentId === s.id && !x.titleId && x.titleName // fallback
      );
      if (inv) {
        const titleMaster = titles.find(t => t.id === inv.titleId);
        const bgColor = inv.bgColor || titleMaster?.bgColor;
        const textColor = inv.textColor || titleMaster?.textColor;
        titleHtml = getTitleBadgeHtml(inv.titleGrade||'normal', bgColor, textColor, inv.titleEmoji, inv.titleName);
      }
    }
    const titleShadow2 = titleHtml ? 'drop-shadow(0 2px 4px rgba(0,0,0,0.18))' : 'none';

    // 프레임 적용
    const frameInv = frameInvMap[s.id];
    const equippedFrameId = s.equippedFrameId;
    const frameData = equippedFrameId && frameInv?.frameId === equippedFrameId ? frameInv : null;
    const frameCss = frameData ? (FRAME_DATA[frameData.frameId]?.css || frameData.frameCss || '') : '';
    const frameNeonTxt = frameData ? (FRAME_DATA[frameData.frameId]?.neonTxt || '') : '';
    const hasFrame = !!frameCss;

    // 프레임 적용 시 텍스트 색상 조정
    // 프레임 텍스트 스타일: 네온=글로우색, 파스텔=흰색, 없음=기본색
    const txtWhite  = 'color:#fff;text-shadow:0 1px 4px rgba(0,0,0,0.5);';
    const neonStyle = frameNeonTxt ? '' : txtWhite; // 네온은 CSS 클래스가 처리, 파스텔은 인라인
    const nameColor = hasFrame ? `${neonStyle}font-size:18px;font-weight:700;margin-bottom:6px;` : 'font-size:18px;font-weight:700;margin-bottom:6px;';
    const ptsStyle  = hasFrame ? (frameNeonTxt ? '' : 'color:#fff;text-shadow:0 1px 3px rgba(0,0,0,0.3);') : 'color:var(--primary);';
    const lvStyle   = hasFrame ? (frameNeonTxt ? '' : 'color:rgba(255,255,255,0.9);') : 'color:#6366f1;';
    const rankStyle = hasFrame ? (frameNeonTxt ? '' : 'color:rgba(255,255,255,0.9);text-shadow:0 1px 3px rgba(0,0,0,0.4);') : `color:${rankColor};`;
    const txtClass  = hasFrame && frameNeonTxt ? frameNeonTxt : '';
    const border    = hasFrame ? 'none' : (isMe ? '3px solid var(--primary)' : '1px solid var(--border)');
    const isEmojiPat = !!(frameData && (FRAME_DATA[frameData.frameId]?.emojiPattern || frameData.emojiPattern));
    const emojiCanvasHtml = isEmojiPat
      ? `<canvas id="fpc_${s.id}" width="210" height="280" style="position:absolute;inset:0;width:100%;height:100%;border-radius:var(--radius-lg);z-index:0;"></canvas>`
      : '';

    return `
    <div class="${frameCss}" style="position:relative;border-radius:var(--radius-lg);border:${border};padding:30px;text-align:center;box-shadow:var(--shadow-sm);transition:transform 0.2s ease,box-shadow 0.2s ease;cursor:${isMe?'default':'pointer'};overflow:hidden;"
      onmouseenter="this.style.transform='translateY(-4px)';this.style.boxShadow='0 8px 24px rgba(0,0,0,0.18)'"
      onmouseleave="this.style.transform='';this.style.boxShadow='var(--shadow-sm)'"
      ${!isMe ? `onclick="openFriendDetail('${s.id}','${s.name.replace(/'/g,'\\x27')}')"` : ''}>
      ${emojiCanvasHtml}
      <div class="${txtClass}" style="position:relative;z-index:1;font-size:${rank<=3?'22':'16'}px;font-weight:700;margin-bottom:6px;${rankStyle}">${rankLabel}</div>
      <div style="position:relative;z-index:1;height:42px;display:flex;align-items:center;justify-content:center;margin-bottom:6px;filter:${titleShadow2};">${titleHtml}</div>
      ${(() => {
        const petItem = (window._cachedPetList||[]).find(p=>p.id===s.petEquipped);
        if (petItem) return `<div style="position:relative;z-index:1;display:flex;width:160px;margin:0 auto;align-items:flex-end;">
          <div style="flex:7;display:flex;justify-content:flex-end;align-items:flex-end;">${buildCharHtml(s, 'margin:0 0 8px 0;')}</div>
          <div style="flex:3;display:flex;align-items:flex-end;justify-content:flex-start;padding-bottom:8px;">
            <img src="${petItem.imgUrl}" style="width:60px;height:100px;object-fit:contain;" onerror="this.style.display='none'" />
          </div>
        </div>`;
        return `<div style="position:relative;z-index:1;">${buildCharHtml(s, 'margin:0 auto 8px;')}</div>`;
      })()}
      <div class="${txtClass}" style="position:relative;z-index:1;${nameColor}display:flex;align-items:center;justify-content:center;gap:6px;">
        <span>${s.avatarEmoji ? `<span style="font-size:17px;">${s.avatarEmoji}</span> ` : ''}${s.name}${isMe ? ` <span style="font-size:14px;${hasFrame?'color:rgba(255,255,255,0.7)':'color:var(--primary);'}">(나)</span>` : ''}</span>
        ${isMe ? `<span onclick="openProfileMsgModal(event)" style="font-size:14px;cursor:pointer;opacity:0.7;line-height:1;" title="프로필 메시지 설정">✏️</span>` : ''}
      </div>
      ${s.profileMsg ? `<div style="position:relative;z-index:1;margin:4px auto 2px;display:inline-block;max-width:90%;padding:3px 10px;border-radius:8px;border:1px solid ${hasFrame?'rgba(255,255,255,0.3)':'rgba(0,0,0,0.1)'};background:${hasFrame?'rgba(0,0,0,0.25)':'rgba(0,0,0,0.06)'};font-size:12px;font-weight:500;color:${hasFrame?'rgba(255,255,255,0.9)':'var(--text-secondary)'};backdrop-filter:blur(4px);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${s.profileMsg}</div>` : (isMe ? `<div style="height:4px;"></div>` : `<div style="height:4px;"></div>`)}
      <div class="${txtClass}" style="position:relative;z-index:1;font-size:21px;font-weight:800;${ptsStyle}">🪙 ${s._accum.toLocaleString()}</div>
      <div style="position:relative;z-index:1;margin-top:5px;display:inline-block;padding:3px 10px;border-radius:8px;border:1px solid ${hasFrame?'rgba(255,255,255,0.3)':'rgba(0,0,0,0.1)'};background:${hasFrame?'rgba(0,0,0,0.25)':'rgba(0,0,0,0.05)'};font-size:12px;font-weight:600;color:${hasFrame?'rgba(255,255,255,0.9)':'var(--text-secondary)'};backdrop-filter:blur(4px);">⚔️ ${soloCount}/1 · 🐉 ${raidCount}/1</div>
      <div class="${txtClass}" style="position:relative;z-index:1;font-size:18px;font-weight:700;margin-top:4px;${lvStyle}">Lv.${calcLevel(s._accum)}</div>
    </div>`;
  }).join('') || '<div class="empty-state"><p>아직 학생이 없어요</p></div>';

  // 이모지 패턴 프레임 canvas 렌더링
  setTimeout(() => {
    allStudents.forEach(s => {
      const fInv = frameInvMap[s.id];
      if (!fInv) return;
      const fd2 = FRAME_DATA[fInv.frameId];
      const pattern = fd2?.emojiPattern || fInv.emojiPattern;
      if (!pattern) return;
      const canvas = document.getElementById(`fpc_${s.id}`);
      if (canvas) renderEmojiPatternCanvas(canvas, pattern);
    });
  }, 50);
}
