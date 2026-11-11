// dungeon.js — 챌린지 던전 (학생: 로비·전투·단체 던전)
import { state } from './state.js?v=20261111d';
import {
  addDoc, collection, db, deleteDoc, doc, getDoc, getDocFromServer, getDocs, increment,
  serverTimestamp, updateDoc
} from './firebase.js?v=20261111d';
import { RANK_NAMES, closeModal, getRankIdx, openModal, showToast } from './core.js?v=20261111d';
import { getTodayStr } from './attendance.js?v=20261111d';
import { loadRoles, roles } from './roles.js?v=20261111d';
import { DEFAULT_MONSTERS, calcBattleStats } from './dungeon-admin.js?v=20261111d';
import { loadQuizDungeonBoss, renderQuizDungeonSection } from './quiz-dungeon.js?v=20261111d';
import { buildCharHtml, getStudentChar } from './avatar.js?v=20261111d';

// ===== ⚔️ 챌린지 던전 =====
window.startDungeonChallenge = async function() {
  const today = getTodayStr();
  const freshDoc = await getDoc(doc(db,'students',state.currentUser.uid));
  const sData = freshDoc.exists() ? freshDoc.data() : {};
  if (sData.dungeonChallengeDate === today) return showToast('오늘은 이미 챌린지 던전에 참여했어요!');

  if (!state.dungeonConfig) {
    const cfgDoc = await getDoc(doc(db,'config','dungeon'));
    state.dungeonConfig = cfgDoc.exists() ? cfgDoc.data() : {};
  }
  // enterBattle과 동일한 방식으로 챌린지 몬스터로 전투 시작
  await enterBattle('challenge');
};

// ===== 학생: 던전 로비 =====
// 던전 도전 가능 여부 배지 업데이트
export function updateDungeonBadge() {
  const badge = document.getElementById('dungeonBadge');
  if (!badge || !state.currentUser || state.currentUser.role !== 'student') return;
  const today = getTodayStr();
  const me = state.students.find(s => s.id === state.currentUser.uid) || {};
  const soloPlayed = me.dungeonSoloDate === today;
  const raidPlayed = me.dungeonRaidDate === today;
  badge.style.display = (!soloPlayed || !raidPlayed) ? 'block' : 'none';
}

// 1인1역 오늘 수행 여부 배지 업데이트
export async function updateMyRolesBadge() {
  const badge = document.getElementById('myRolesBadge');
  if (!badge || !state.currentUser || state.currentUser.role !== 'student') return;
  try {
    await loadRoles();
    const todayDow = new Date().getDay();
    const myTodayRoles = roles.filter(r =>
      (r.students||[]).includes(state.currentUser.uid) && (r.days||[]).includes(todayDow)
    );
    if (!myTodayRoles.length) { badge.style.display = 'none'; return; }
    badge.style.display = 'block'; // 오늘 역할 있으면 표시
  } catch(e) { badge.style.display = 'none'; }
}

window.renderDungeonLobby = async function() {
  if (state.battleState) state.battleState._processing = false; // 락 해제
  const lobby = document.getElementById('dungeonLobby');
  const battle = document.getElementById('dungeonBattle');
  if (!lobby || !battle) return;
  battle.style.display = 'none';
  // 문제 던전 전투 화면도 초기화
  const quizBattle = document.getElementById('quizDungeonBattle');
  if (quizBattle) { quizBattle.style.display = 'none'; quizBattle.innerHTML = ''; }
  state.quizBattleState = null;
  // 캐시 무효화 - 항상 최신값으로 렌더
  state.quizDungeonBoss = undefined;
  window._raidBossDoc = null;
  // 새로고침으로 인한 잠금 해제
  if (state.currentUser?.uid) {
    try { await deleteDoc(doc(db, 'config', `quizProgress_${state.currentUser.uid}`)); } catch(e) {}
  }
  // students 최신값 반영 (onSnapshot이 있으므로 짧게 대기)
  if (state.currentUser?.role === 'student') {
    const freshMe = await getDoc(doc(db, 'students', state.currentUser.uid));
    if (freshMe.exists()) {
      const idx = state.students.findIndex(s => s.id === state.currentUser.uid);
      const freshData = { id: state.currentUser.uid, ...freshMe.data() };
      if (idx >= 0) state.students[idx] = freshData;
      else state.students.push(freshData);
    }
  }
  lobby.style.display = 'block';
  lobby.style.opacity = '0';
  setTimeout(() => { lobby.style.transition = 'opacity 0.25s'; lobby.style.opacity = '1'; }, 10);

  try {
    // 던전 설정 로드 (캐시: 이미 로드됐으면 재사용)
    if (!state.dungeonConfig) {
      const cfgDoc = await getDoc(doc(db, 'config', 'dungeon'));
      state.dungeonConfig = cfgDoc.exists() ? cfgDoc.data() : {};
    }

    // 오늘 참여 여부 확인 (students 캐시 사용)
    const today = getTodayStr();
    const sData = state.students.find(s => s.id === state.currentUser.uid) || {};
    const soloPlayed = sData.dungeonSoloDate === today;
    const raidPlayed = sData.dungeonRaidDate === today;
    const challengePlayed = sData.dungeonChallengeDate === today;

    // 보스 현황
    const bossDoc = await getDoc(doc(db, 'config', 'dungeonBoss'));
    const bossData = bossDoc.exists() ? bossDoc.data() : null;
    const bossM = { ...DEFAULT_MONSTERS.boss, ...(state.dungeonConfig.boss || {}) };

    // 오늘 공격 참여자 수 계산
    const today2 = getTodayStr();
    let todayAttackerCount = 0;
    if (bossData?.attackers?.length) {
      // attackers에 {uid, date} 형식 또는 uid만 있는 경우 모두 대응
      // students 캐시에서 오늘 공격 참여자 수 계산
      todayAttackerCount = state.students.filter(s => s.dungeonRaidDate === today2).length;
    }

    lobby.innerHTML = `
    <!-- 던전 규칙 안내 박스 -->
    <div style="
      background:linear-gradient(135deg,#ede9fe,#ddd6fe,#c4b5fd);
      border-radius:var(--radius-lg);
      padding:20px 24px;
      margin-bottom:20px;
      border:1px solid rgba(139,92,246,0.2);
      transition:transform 0.2s,box-shadow 0.2s;
      cursor:default;
    "
    onmouseenter="this.style.transform='translateY(-2px)';this.style.boxShadow='0 6px 20px rgba(139,92,246,0.2)'"
    onmouseleave="this.style.transform='';this.style.boxShadow='none'">
      <div style="font-size:17px;font-weight:800;color:#5b21b6;margin-bottom:12px;">📜 던전 규칙 안내</div>
      <div class="m-stack" style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;">
        <div style="background:rgba(255,255,255,0.6);border-radius:10px;padding:12px;">
          <div style="font-size:15px;font-weight:700;color:#6d28d9;margin-bottom:6px;">🗡️ 개인 던전</div>
          <div style="font-size:13px;color:#4c1d95;line-height:1.7;">
            • 하루에 딱 <strong>1번</strong>만 도전할 수 있어요.<br>
            • 쉬움 / 보통 / 어려움 중 <strong>1개 난이도</strong>를 골라서 싸워요.<br>
            • 이기든 지든, 오늘은 더 이상 다시 싸울 수 없어요.<br>
            • <strong>자정(밤 12시)</strong>이 지나면 다시 도전할 수 있어요!
          </div>
        </div>
        <div style="background:rgba(255,255,255,0.6);border-radius:10px;padding:12px;">
          <div style="font-size:15px;font-weight:700;color:#6d28d9;margin-bottom:6px;">🐉 단체 던전</div>
          <div style="font-size:13px;color:#4c1d95;line-height:1.7;">
            • 하루에 딱 <strong>1번</strong>만 보스를 공격할 수 있어요.<br>
            • 우리 반 <strong>모든 학생</strong>이 같은 보스와 싸워요.<br>
            • 보스를 쓰러뜨리면 <strong>싸움에 참여한 학생 모두</strong>가 보상을 받아요.<br>
            • 단, <strong>한 번도 공격하지 않은 학생</strong>은 보상을 받을 수 없어요!
          </div>
        </div>
        <div style="background:rgba(255,255,255,0.6);border-radius:10px;padding:12px;">
          <div style="font-size:15px;font-weight:700;color:#6d28d9;margin-bottom:6px;">📚 문제 던전</div>
          <div style="font-size:13px;color:#4c1d95;line-height:1.7;">
            • 괴물이 깨어날 때만 공격할 수 있어요.<br>
            • 문제를 풀어서 괴물을 무찌르면 보상을 받아요.<br>
            • 목숨(♥)이 많이 남을수록 <strong>추가 보상</strong>이 주어져요.<br>
            • 클리어 못해도 정답 개수에 비례해 <strong>부분 보상</strong>을 받아요.<br>
            • 컨닝 시 모두 <strong>벌점 카드</strong>가 부여돼요.
          </div>
        </div>
      </div>
      <div style="background:rgba(255,255,255,0.6);border-radius:10px;padding:12px;margin-top:12px;">
        <div style="font-size:15px;font-weight:700;color:#6d28d9;margin-bottom:6px;">💡 공격별 유리한 능력치 힌트</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <span style="font-size:13px;background:rgba(239,68,68,0.1);color:#991b1b;padding:3px 10px;border-radius:8px;font-weight:600;">💥 강공격 — 🌟 성실성이 높을수록 강력해요!</span>
          <span style="font-size:13px;background:rgba(59,130,246,0.1);color:#1e40af;padding:3px 10px;border-radius:8px;font-weight:600;">⚔️ 일반공격 — 🌟 성실성이 기본 데미지를 올려줘요!</span>
          <span style="font-size:13px;background:rgba(139,92,246,0.1);color:#4c1d95;padding:3px 10px;border-radius:8px;font-weight:600;">🔮 마법공격 — 📚 지력이 높을수록 마법이 강해져요!</span>
          <span style="font-size:13px;background:rgba(245,158,11,0.1);color:#92400e;padding:3px 10px;border-radius:8px;font-weight:600;">⚡ 집중공격 — ⚡ 집중력이 높으면 크리티컬 확률이 올라요!</span>
          <span style="font-size:13px;background:rgba(34,197,94,0.1);color:#14532d;padding:3px 10px;border-radius:8px;font-weight:600;">🛡️ 방어 — ❤️ 인성이 높을수록 피해를 잘 버텨요!</span>
        </div>
      </div>
    </div>

    <!-- 2줄: 던전 선택 버튼 4개 -->
    <div class="dungeon-tabs m-stack2" style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:12px;margin-bottom:20px;">
      <div class="dungeon-tab ${!soloPlayed?'active':''}" style="${soloPlayed?'opacity:0.55;cursor:not-allowed;pointer-events:none;':'cursor:pointer;'}" ${soloPlayed?'':'onclick="startDungeonSolo()"'}>
        <span class="dungeon-tab-icon">🗡️</span>
        <strong>개인 던전</strong>
        <div class="dungeon-tab-desc" style="font-size:13px;">1인 전투 · 클리어 시 포인트 지급</div>
        ${soloPlayed ? '<div style="margin-top:6px;font-size:11px;color:#ef4444;">✅ 오늘 이미 참여했어요</div>' : '<div style="margin-top:6px;font-size:11px;color:#16a34a;">오늘 참여 가능!</div>'}
      </div>
      <div class="dungeon-tab ${!raidPlayed?'active':''}" style="${raidPlayed?'opacity:0.55;cursor:not-allowed;pointer-events:none;':'cursor:pointer;'}" ${raidPlayed?'':'onclick="startDungeonRaid()"'}>
        <span class="dungeon-tab-icon">🐉</span>
        <strong>단체 던전</strong>
        <div class="dungeon-tab-desc" style="font-size:13px;">반 전체 협력 · 클리어 시 전원 +500🪙</div>
        ${raidPlayed ? '<div style="margin-top:6px;font-size:11px;color:#ef4444;">✅ 오늘 이미 참여했어요</div>' : '<div style="margin-top:6px;font-size:11px;color:#16a34a;">오늘 참여 가능!</div>'}
      </div>
      <div class="dungeon-tab" id="quizDungeonTab" style="cursor:pointer;">
        <span class="dungeon-tab-icon">📚</span>
        <strong>문제 던전</strong>
        <div class="dungeon-tab-desc" style="font-size:13px;">문제 풀기 · 정답률 비례 보상</div>
        <div id="quizTabStatus" style="margin-top:6px;font-size:11px;color:var(--text-muted);">확인 중...</div>
      </div>
      <div class="dungeon-tab ${!challengePlayed?'active':''}" style="background:linear-gradient(135deg,#1e1b4b,#312e81);color:#fff;${challengePlayed?'opacity:0.55;cursor:not-allowed;pointer-events:none;':'cursor:pointer;'}" ${challengePlayed?'':'onclick="startDungeonChallenge()"'}>
        <span class="dungeon-tab-icon">⚔️</span>
        <strong style="color:#fbbf24;">챌린지 던전</strong>
        <div class="dungeon-tab-desc" style="font-size:12px;color:#c7d2fe;">개인던전과 별개 · 고난이도</div>
        <div style="margin-top:4px;font-size:11px;padding:2px 8px;border-radius:10px;display:inline-block;background:rgba(251,191,36,0.2);color:#fbbf24;font-weight:700;">4~5단계 수준 🔥</div>
        ${challengePlayed ? '<div style="margin-top:4px;font-size:11px;color:#f87171;">✅ 오늘 이미 참여했어요</div>' : '<div style="margin-top:4px;font-size:11px;color:#6ee7b7;">오늘 참여 가능!</div>'}
      </div>
    </div>`;

  // 현황 블록 별도 추가
  lobby.innerHTML += `
    <div class="m-stack" style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px;align-items:stretch;">
      <div class="card" style="padding:16px;box-sizing:border-box;display:flex;flex-direction:column;height:100%;">
        <div style="font-size:16px;font-weight:700;margin-bottom:12px;">🐉 단체 던전 현황</div>
        <div style="flex:1;display:flex;flex-direction:column;justify-content:center;min-height:300px;">
      ${bossData ? `
      <div style="
        ${bossData.bgImg ? `background-image:url('${bossData.bgImg}');background-size:cover;background-position:center;` : 'background:linear-gradient(135deg,#0d0520,#1a0535);'}
        border-radius:var(--radius-lg);
        height:300px;
        box-sizing:border-box;
        text-align:center;
        position:relative;
        overflow:hidden;
        transition:box-shadow 0.2s,transform 0.2s;
        display:flex;flex-direction:column;justify-content:flex-start;padding-top:40px;
      "
      onmouseenter="this.style.boxShadow='0 8px 32px rgba(0,0,0,0.45)';this.style.transform='translateY(-4px)'"
      onmouseleave="this.style.boxShadow='';this.style.transform=''">
        <div style="position:absolute;inset:0;background:rgba(0,0,0,0.35);pointer-events:none;border-radius:var(--radius-lg);"></div>
        ${bossM.img ? `<img src="${bossM.img}" style="position:relative;width:135px;height:135px;object-fit:contain;display:block;margin:0 auto 8px;filter:drop-shadow(0 0 12px rgba(0,0,0,0.8));" onerror="this.style.display='none'" />` : `<div style="font-size:64px;text-align:center;margin:8px 0;">${bossM.emoji}</div>`}
        <div style="position:relative;font-size:18px;font-weight:800;margin-bottom:4px;color:#fff;text-shadow:0 2px 8px rgba(0,0,0,0.8);">${bossM.name}</div>
        <div style="position:relative;font-size:15px;color:rgba(255,255,255,0.9);margin-bottom:8px;font-weight:700;">HP ${bossData.currentHp?.toLocaleString()} / ${bossM.hp?.toLocaleString()}</div>
        <div style="position:relative;background:rgba(0,0,0,0.5);border-radius:6px;height:12px;overflow:hidden;margin-bottom:8px;">
          <div style="height:100%;width:${Math.max(0,Math.round((bossData.currentHp/bossM.hp)*100))}%;background:linear-gradient(90deg,#7c3aed,#c026d3,#f59e0b);border-radius:6px;transition:width 0.8s ease;"></div>
        </div>
        <div style="position:relative;font-size:12px;color:rgba(255,255,255,0.85);">오늘 ${todayAttackerCount}명이 공격에 참여했어요</div>
      </div>` : `<div class="empty-state" style="padding:20px;"><div class="empty-icon">🐉</div><p>아직 보스가 설정되지 않았어요</p></div>`}
        </div>
      </div>
      <div id="quizDungeonSection" style="display:flex;flex-direction:column;"></div>
    </div>`;

  // 문제 던전 현황 + 탭 상태 렌더
  renderQuizDungeonSection();
  (async () => {
    const qboss = await loadQuizDungeonBoss();
    const el = document.getElementById('quizTabStatus');
    const tab = document.getElementById('quizDungeonTab');
    if (!el || !tab) return;
    const qParticipated = qboss?.active && (qboss.participants||[]).includes(state.currentUser.uid);
    const qAvailable = qboss?.active && !qParticipated;
    if (!qboss?.active) {
      el.innerHTML = '<span style="color:#94a3b8;">보스가 잠들어 있어요</span>';
      tab.style.opacity = '0.55'; tab.style.cursor = 'not-allowed'; tab.style.pointerEvents = 'none';
    } else if (qParticipated) {
      el.innerHTML = '<span style="color:#ef4444;">✅ 이미 참여했어요</span>';
      tab.style.opacity = '0.55'; tab.style.cursor = 'not-allowed'; tab.style.pointerEvents = 'none';
    } else {
      el.innerHTML = '<span style="color:#16a34a;">참여 가능!</span>';
      tab.style.opacity = ''; tab.style.cursor = 'pointer'; tab.style.pointerEvents = '';
      tab.classList.add('active'); tab.style.background=''; tab.style.borderColor='';
      tab.onclick = () => startQuizDungeonFromSection();
    }
  })();
  } catch(e) { lobby.innerHTML = '<div class="empty-state"><p>불러오기 실패</p></div>'; }
};

// ===== 개인 던전 시작 =====
window.startDungeonSolo = async function() {
  const today = getTodayStr();
  // Firestore에서 직접 최신값 확인 (다중 탭 편법 방지)
  const freshDoc = await getDoc(doc(db, 'students', state.currentUser.uid));
  const sData = freshDoc.exists() ? freshDoc.data() : {};
  if (sData.dungeonSoloDate === today) return showToast('오늘은 이미 개인 던전에 참여했어요!');

  // 난이도 선택 모달 대신 화면에서 선택
  const lobby = document.getElementById('dungeonLobby');
  lobby.innerHTML = `
  <div class="card" style="text-align:center;padding:30px;">
    <div style="font-size:24px;font-weight:800;margin-bottom:8px;">🗡️ 난이도 선택</div>
    <div style="font-size:14px;color:var(--text-secondary);margin-bottom:24px;">능력치에 따라 적절한 난이도를 선택하세요!</div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;">
      ${['easy','normal','hard'].map(d => {
        const m = { ...DEFAULT_MONSTERS[d], ...(state.dungeonConfig?.[d]||{}) };
        // 난이도별 배경 스타일
    const diffStyle = d==='easy'
      ? 'background:#fff;border:2px solid #e5e7eb;'
      : d==='normal'
      ? 'background:#fff7ed;border:2px solid #fed7aa;'
      : 'background:linear-gradient(135deg,#fc466b,#3f5efb,#fc466b);background-size:300% 300%;animation:pastel1 4s ease infinite;border:2px solid rgba(252,70,107,0.5);';
    const diffTextColor = d==='hard' ? 'color:#fff;text-shadow:0 1px 4px rgba(0,0,0,0.4);' : '';
    const diffSubColor  = d==='hard' ? 'color:rgba(255,255,255,0.85);' : 'color:var(--text-secondary);';
    const diffPtsColor  = d==='hard' ? 'color:#fff;font-weight:700;' : 'color:var(--primary);font-weight:700;';
    const hoverEffect = d==='easy'
      ? 'onmouseenter="this.style.transform=\'translateY(-4px)\';this.style.boxShadow=\'0 8px 20px rgba(0,0,0,0.1)\';" onmouseleave="this.style.transform=\'\';this.style.boxShadow=\'none\';"'
      : d==='normal'
      ? 'onmouseenter="this.style.transform=\'translateY(-4px)\';this.style.boxShadow=\'0 8px 20px rgba(251,146,60,0.3)\';" onmouseleave="this.style.transform=\'\';this.style.boxShadow=\'none\';"'
      : 'onmouseenter="this.style.transform=\'translateY(-4px)\';this.style.boxShadow=\'0 8px 24px rgba(252,70,107,0.5)\';" onmouseleave="this.style.transform=\'\';this.style.boxShadow=\'none\';"';
    const badgeStyle = d==='easy'
      ? 'background:#dcfce7;color:#16a34a;'
      : d==='normal'
      ? 'background:#fed7aa;color:#c2410c;'
      : 'background:rgba(255,255,255,0.2);color:#fff;';

    return `<div class="dungeon-tab" onclick="enterBattle('${d}')" style="cursor:pointer;${diffStyle}transition:transform 0.2s,box-shadow 0.2s;" ${hoverEffect}>
          ${m.img ? `<img src="${m.img}" style="width:80px;height:80px;object-fit:contain;border-radius:10px;margin:0 auto 8px;display:block;" onerror="this.outerHTML='<div style=\'font-size:56px;margin-bottom:8px;\'>${m.emoji}</div>'" />` : `<div style="font-size:56px;margin-bottom:8px;">${m.emoji}</div>`}
          <strong style="font-size:14px;${diffTextColor}">${m.name}</strong>
          <div class="dungeon-tab-desc" style="${diffSubColor}">HP ${m.hp} · 공격력 ${m.atk}</div>
          <div style="margin-top:8px;font-size:12px;padding:4px 10px;border-radius:8px;display:inline-block;${badgeStyle}">${d==='easy'?'🌿 쉬움':d==='normal'?'🔥 보통':'💀 어려움'}</div>
          <div style="margin-top:6px;font-size:12px;${diffPtsColor}">클리어 시 +${m.reward||100}🪙</div>
          ${m.abReward && Object.keys(m.abReward).length ? `<div style="margin-top:4px;font-size:11px;${d==='hard'?'color:rgba(255,255,255,0.85);':'color:var(--text-secondary);'}">${Object.entries(m.abReward).map(([k,v])=>`${k}+${v}`).join(' · ')}</div>` : ''}
        </div>`;
      }).join('')}
    </div>
    <button class="btn btn-secondary" style="margin-top:16px;" onclick="renderDungeonLobby()">← 돌아가기</button>
  </div>`;
};

// ===== 전투 시작 =====
// enterBattle은 아래에서 한 번만 정의됨

function renderBattle() {
  const b = state.battleState;
  const m = b.monster;
  const s = b.heroStats;
  const eHpPct = Math.max(0, Math.round(b.enemyHp / b.enemyMaxHp * 100));
  const hHpPct = Math.max(0, Math.round(b.heroHp / b.heroMaxHp * 100));
  const diffLabel = b.difficulty==='easy'?'🌿 쉬움':b.difficulty==='normal'?'🔥 보통':b.difficulty==='challenge'?'⚔️ 챌린지':'💀 어려움';
  const monsterDisplay = m.img
    ? `<img src="${m.img}" class="battle-monster-img" onerror="this.outerHTML='<div style=\'font-size:72px;line-height:1;margin:8px 0;\'>${m.emoji}</div>'" />`
    : `<div style="font-size:72px;line-height:1;margin:8px 0;">${m.emoji}</div>`;

  const soloBgStyle = state.battleState.bgImg
    ? `background-image:url('${state.battleState.bgImg}');background-size:cover;background-position:center;`
    : '';
  document.getElementById('dungeonBattle').innerHTML = `
  <div class="battle-screen" style="${soloBgStyle}">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
      <span class="battle-turn">Turn ${b.turn} — ${b.done?'전투 종료':'내 차례'}</span>
      <span style="font-size:12px;color:rgba(255,255,255,0.5);">${diffLabel}</span>
    </div>
    <div class="battle-arena">
      <div class="battle-side">
        <div style="font-size:11px;color:rgba(255,255,255,0.5);margin-bottom:6px;letter-spacing:1px;">⚔ 적</div>
        <div style="flex:1;display:flex;align-items:center;justify-content:center;">
          ${monsterDisplay}
        </div>
        <div class="battle-name" style="margin-top:6px;">${m.name}</div>
        <div style="width:100%;margin-top:8px;">
          <div class="battle-hp-wrap"><div class="battle-hp-bar enemy" style="width:${eHpPct}%"></div></div>
          <div class="battle-hp-label">HP ${Math.max(0,b.enemyHp)} / ${b.enemyMaxHp}</div>
        </div>
        <div class="battle-stats">
          <span class="battle-stat">⚔️ ${m.atk}</span>
          <span class="battle-stat">🛡️ ${Math.floor(m.atk*0.3)}</span>
        </div>
      </div>
      <div class="battle-side">
        <div style="font-size:11px;color:rgba(255,255,255,0.5);margin-bottom:6px;letter-spacing:1px;">🧙 나</div>
        <div style="flex:1;display:flex;align-items:center;justify-content:center;">
          ${buildCharHtml({ id: state.currentUser.uid, avatarEquipped: state.avatarEquipped, avatarEquippedMeta: state.avatarEquippedMeta }, 'filter:drop-shadow(0 0 16px rgba(167,139,250,0.5));')}
        </div>
        <div class="battle-name" style="margin-top:6px;">${state.currentUser.name}</div>
        <div style="width:100%;margin-top:8px;">
          <div class="battle-hp-wrap"><div class="battle-hp-bar hero" style="width:${hHpPct}%"></div></div>
          <div class="battle-hp-label">HP ${Math.max(0,b.heroHp)} / ${b.heroMaxHp}</div>
        </div>
        <div class="battle-stats">
          <span class="battle-stat">⚔️ ${s.atk}</span>
          <span class="battle-stat">🛡️ ${s.def}</span>
          <span class="battle-stat">✨ ${Math.round(s.crit*100)}%</span>
          <span class="battle-stat">🔮 ${s.mag}</span>
        </div>
      </div>
    </div>
    <div class="battle-log" id="battleLog">
      ${b.logs.map(l=>`<div class="battle-log-line ${l.cls}">${l.txt}</div>`).join('')}
    </div>
    <div class="battle-actions" id="battleActions">
      ${b.done ? `
        <button class="battle-action" onclick="renderDungeonLobby()" style="grid-column:1/-1;">🏠 로비로 돌아가기</button>
      ` : `
        <div class="battle-action ${b._processing?'disabled':''}" onclick="doPlayerAction('heavy')">
          <span class="battle-action-icon">💥</span>강공격<div class="battle-action-sub">+50% 위력 · 빗나감 40%</div>
        </div>
        <div class="battle-action ${b._processing?'disabled':''}" onclick="doPlayerAction('normal')">
          <span class="battle-action-icon">⚔️</span>일반공격<div class="battle-action-sub">안정적 · 빗나감 20%</div>
        </div>
        <div class="battle-action ${b._processing?'disabled':''}" onclick="doPlayerAction('magic')">
          <span class="battle-action-icon">🔮</span>마법공격<div class="battle-action-sub">빗나감 없음 · 방어 무시</div>
        </div>
        <div class="battle-action ${b._processing?'disabled':''}" onclick="doPlayerAction('defend')">
          <span class="battle-action-icon">🛡️</span>방어<div class="battle-action-sub">이번 턴 피해 반감</div>
        </div>
        <div class="battle-action ${b._processing?'disabled':''}" onclick="doPlayerAction('heal')">
          <span class="battle-action-icon">💚</span>회복<div class="battle-action-sub">HP 20% · 성공률 50%</div>
        </div>
        <div class="battle-action ${b._processing?'disabled':''}" onclick="doPlayerAction('crit')">
          <span class="battle-action-icon">⚡</span>집중공격<div class="battle-action-sub">빗나감 없음 · 집중력↑시 2연속 공격</div>
        </div>
      `}
    </div>
    <div style="text-align:center;margin-top:10px;">
      <button onclick="tryEscape()" style="background:none;border:1px solid rgba(255,255,255,0.25);color:rgba(255,255,255,0.6);font-size:13px;cursor:pointer;padding:6px 18px;border-radius:8px;font-family:inherit;transition:all 0.2s;" onmouseenter="this.style.color='#fff';this.style.borderColor='rgba(255,255,255,0.5)'" onmouseleave="this.style.color='rgba(255,255,255,0.6)';this.style.borderColor='rgba(255,255,255,0.25)'">← 돌아가기</button>
    </div>
  </div>`;

  const logEl = document.getElementById('battleLog');
  if (logEl) logEl.scrollTop = logEl.scrollHeight;
}

let sDoc2char = 'https://i.ibb.co/TMcWFtGr/image.png'; // 전역 캐릭터 URL
let sDocCharIsImg = true;

window.enterBattle = async function(difficulty) {
  const sData = state.students.find(s => s.id === state.currentUser.uid) || {};
  sDoc2char = getStudentChar({ id: state.currentUser.uid, character: sData.character, avatarEquipped: sData.avatarEquipped, avatarEquippedMeta: sData.avatarEquippedMeta });
  sDocCharIsImg = true;
  const stats = calcBattleStats(sData.abilities);

  // dungeonConfig가 없으면 로드
  if (!state.dungeonConfig) {
    const cfgDoc = await getDoc(doc(db, 'config', 'dungeon'));
    state.dungeonConfig = cfgDoc.exists() ? cfgDoc.data() : {};
  }

  // 난이도별 몬스터 데이터
  const baseM = { ...DEFAULT_MONSTERS[difficulty], ...(state.dungeonConfig?.[difficulty] || {}) };

  // 능력치 기반 몬스터 스케일링 (HP: ratio배, ATK: ratio^0.6배)
  const ab = sData.abilities || {};
  const totalAbility = (ab['성실성']||0)+(ab['인성']||0)+(ab['사회성']||0)+(ab['지력']||0)+(ab['집중력']||0);
  const scaleRatio = 1.0 + (totalAbility / 350) * 1.5;
  const atkRatio   = Math.pow(scaleRatio, 0.6);
  const m = {
    ...baseM,
    hp:  Math.round(baseM.hp  * scaleRatio),
    atk: Math.round(baseM.atk * atkRatio),
  };

  state.battleState = {
    difficulty, turn:1, defending:false,
    heroHp:stats.hp, heroMaxHp:stats.hp,
    enemyHp:m.hp, enemyMaxHp:m.hp,
    heroStats:stats, monster:m, logs:[], done:false,
    bgImg: baseM.bg || '',
    attacked: false,
    abilities: ab,
    _processing: false, // 공격 처리 락 초기화
  };

  const scalePct = Math.round(scaleRatio * 100);
  state.battleState.logs.push({cls:'system', txt:`⚔️ 전투가 시작됐습니다! (난이도 배율 ${scalePct}%) 행동을 선택하세요.`});

  const lobbyEl = document.getElementById('dungeonLobby');
  const battleEl = document.getElementById('dungeonBattle');
  lobbyEl.style.transition = 'opacity 0.15s';
  lobbyEl.style.opacity = '0';
  setTimeout(() => {
    lobbyEl.style.display = 'none';
    battleEl.style.display = 'block';
    battleEl.style.opacity = '0';
    battleEl.style.transition = 'opacity 0.25s';
    setTimeout(() => { battleEl.style.opacity = '1'; }, 10);
    renderBattle();
  }, 150);
};

// ===== 플레이어 행동 =====
window.doPlayerAction = async function(action) {
  const b = state.battleState;
  if (b.done) return;
  // JS 레벨 락 — async 처리 중 연타 완전 차단
  if (b._processing) return;
  b._processing = true;
  b.attacked = true; // 1턴 진행 기록
  const s = b.heroStats;
  const m = b.monster;
  const eDef = Math.floor(m.atk * 0.3);
  let dmg = 0;
  let actionLog = '';
  b.defending = false;

  const isCrit = Math.random() < (action==='crit' ? s.crit*2.0 : s.crit);
  let missed = false;

  if (action === 'heavy') {
    // 강공격: 40% 확률로 빗나감
    missed = Math.random() < 0.40;
    if (missed) {
      b.logs.push({cls:'system', txt:`💨 강공격이 빗나갔어요! ${m.name}이(가) 재빠르게 피했습니다.`});
    } else {
      dmg = Math.max(1, Math.round((s.atk * 1.5 - eDef * 0.5) * (isCrit?1.8:1) * (0.9+Math.random()*0.2)));
      b.logs.push({cls: isCrit?'crit':'dmg', txt: isCrit?`💥 크리티컬! ${m.name}에게 <strong>${dmg}</strong> 피해!`:`💥 강공격! ${m.name}에게 <strong>${dmg}</strong> 피해!`});
    }
  } else if (action === 'normal') {
    // 일반공격: 20% 확률로 빗나감
    missed = Math.random() < 0.20;
    if (missed) {
      b.logs.push({cls:'system', txt:`💨 공격이 빗나갔어요! ${m.name}이(가) 피했습니다.`});
    } else {
      dmg = Math.max(1, Math.round((s.atk - eDef * 0.3) * (isCrit?1.8:1) * (0.9+Math.random()*0.2)));
      b.logs.push({cls: isCrit?'crit':'dmg', txt: isCrit?`⚔️ 크리티컬! ${m.name}에게 <strong>${dmg}</strong> 피해!`:`⚔️ 일반공격! ${m.name}에게 <strong>${dmg}</strong> 피해!`});
    }
  } else if (action === 'magic') {
    // 마법: 빗나감 없음 (방어 무시)
    dmg = Math.max(1, Math.round(s.mag * 1.2 * (isCrit?1.8:1) * (0.9+Math.random()*0.2)));
    b.logs.push({cls: isCrit?'crit':'dmg', txt: isCrit?`🔮 마법 크리티컬! ${m.name}에게 <strong>${dmg}</strong> 피해!`:`🔮 마법공격! ${m.name}에게 <strong>${dmg}</strong> 피해!`});
  } else if (action === 'defend') {
    b.defending = true;
    b.logs.push({cls:'heal', txt:'🛡️ 방어 태세! 이번 턴 받는 피해 반감.'});
  } else if (action === 'heal') {
    // 회복: 50% 확률로 성공/실패
    const healSuccess = Math.random() < 0.50;
    if (healSuccess) {
      const healAmt = Math.round(b.heroMaxHp * 0.2);
      b.heroHp = Math.min(b.heroMaxHp, b.heroHp + healAmt);
      b.logs.push({cls:'heal', txt:`💚 회복 성공! HP +${healAmt} 회복했어요.`});
    } else {
      b.logs.push({cls:'system', txt:`💔 회복 실패! 집중이 흐트러졌어요.`});
    }
  } else if (action === 'crit') {
    // 집중공격: 빗나감 없음, 일반공격의 80%
    // 2연속 발동 확률: 집중력 0→20%, 10마다 5%씩 증가, 최대 70%
    const 집중력 = b.abilities?.['집중력'] || 0;
    const doubleChance = Math.min(0.70, 0.20 + Math.floor(집중력 / 10) * 0.05);
    const isDouble = Math.random() < doubleChance;
    dmg = Math.max(1, Math.round(s.atk * 0.8 * (0.9 + Math.random() * 0.2)));
    if (isDouble) {
      const dmg2 = Math.max(1, Math.round(s.atk * 0.8 * (0.9 + Math.random() * 0.2)));
      dmg += dmg2;
      b.logs.push({cls:'crit', txt:`⚡ 집중력이 폭발했다! ${m.name}에게 연속 2회 공격! <strong>${dmg}</strong> 피해!`});
    } else {
      b.logs.push({cls:'dmg', txt:`⚡ 집중공격! ${m.name}에게 <strong>${dmg}</strong> 피해!`});
    }
  }

  b.enemyHp = Math.max(0, b.enemyHp - dmg);
  renderBattle();

  // 방어/회복/빗나감 → 즉시 반격으로 넘김 (적 사망 체크 불필요)
  if (action === 'defend' || action === 'heal' || missed) {
    setTimeout(() => {
      const eDmg = Math.max(1, Math.round(m.atk * (1 - s.def/(s.def+30)) * (b.defending?0.5:1) * (0.85+Math.random()*0.3)));
      b.heroHp = Math.max(0, b.heroHp - eDmg);
      b.logs.push({cls:'dmg', txt:`👹 ${m.name}의 반격! <strong>${eDmg}</strong> 피해!`});
      b.defending = false;
      b.turn++;
      if (b.heroHp <= 0) {
        b.logs.push({cls:'system', txt:'💀 쓰러졌습니다... 내일 다시 도전하세요!'});
        b.done = true;
        const today2 = getTodayStr();
        updateDoc(doc(db, 'students', state.currentUser.uid), { [state.battleState.difficulty==='challenge'?'dungeonChallengeDate':'dungeonSoloDate']: today2 }); if(state.battleState.difficulty!=='challenge') updateDungeonBadge();
      } else {
        b.logs.push({cls:'system', txt:`⚡ Turn ${b.turn} — 내 차례`});
        b._processing = false; // 락 해제 먼저 → renderBattle에서 버튼 활성화
      }
      renderBattle();
    }, 600);
    return;
  }

  // 적 사망
  if (b.enemyHp <= 0) {
    const reward = m.reward || 100;
    const abReward = m.abReward || {};
    const abMsg = Object.entries(abReward).map(([k,v])=>`${k}+${v}`).join(', ');
    b.logs.push({cls:'system', txt:`🎉 ${m.name}을(를) 처치했습니다! +${reward}🪙 획득!${abMsg?` (${abMsg})`:''}`});
    b.done = true;
    renderBattle();
    // 보상 지급
    const today = getTodayStr();

    // 랭크업 체크 (능력치 보상이 있을 때)
    let rankBonus = 0;
    const rankGrantedUpdate2 = {};
    const rankUpNames2 = [];
    if (Object.keys(abReward).length > 0) {
      const freshDoc2 = await getDocFromServer(doc(db, 'students', state.currentUser.uid));
      const freshData2 = freshDoc2.exists() ? freshDoc2.data() : {};
      const prevAbilities2 = freshData2.abilities || {};
      const rankGranted2 = freshData2.abilityRankGranted || {};
      for (const [k, v] of Object.entries(abReward)) {
        const prev = prevAbilities2[k] || 0;
        const next = prev + v;
        const prevRankIdx = getRankIdx(prev);
        const nextRankIdx = getRankIdx(next);
        const grantedSoFar = rankGranted2[k] !== undefined ? rankGranted2[k] : 0;
        const fromRank = Math.max(prevRankIdx, grantedSoFar);
        if (nextRankIdx > fromRank) {
          rankBonus += 500 * (nextRankIdx - fromRank);
          rankGrantedUpdate2[`abilityRankGranted.${k}`] = nextRankIdx;
          rankUpNames2.push(`${k} ${RANK_NAMES[nextRankIdx]}`);
        }
      }
    }

    const updateData = {
      points: increment(reward),
      accumulatedPoints: increment(reward),
      [state.battleState.difficulty==='challenge'?'dungeonChallengeDate':'dungeonSoloDate']: today,
    };
    // 능력치 보상
    Object.entries(abReward).forEach(([ab, v]) => {
      updateData[`abilities.${ab}`] = increment(v);
    });
    await updateDoc(doc(db, 'students', state.currentUser.uid), updateData);

    // 랭크업 보상 별도 지급
    if (rankBonus > 0) {
      await updateDoc(doc(db, 'students', state.currentUser.uid), {
        points: increment(rankBonus),
        accumulatedPoints: increment(rankBonus),
        ...rankGrantedUpdate2
      });
      b.logs.push({cls:'system', txt:`🏆 랭크업! ${rankUpNames2.join(', ')} — 보상 +${rankBonus}🪙`});
      renderBattle();
      await addDoc(collection(db, 'notifications'), {
        studentId: state.currentUser.uid, type: 'rankUp',
        rankUpDetails: rankUpNames2.map(n => ({ rank: n })),
        bonus: rankBonus, createdAt: serverTimestamp(), read: false
      });
    }

    updateDungeonBadge();
    await addDoc(collection(db, 'history'), {
      studentId: state.currentUser.uid, studentName: state.currentUser.name,
      delta: reward, reason: `던전 클리어 (${m.name})${abMsg?' ['+abMsg+']':''}`,
      abilities: abReward,
      type: 'plus', source: 'dungeon', createdAt: serverTimestamp()
    });
    b._processing = false; // 클리어 시 락 해제
    return;
  }

  // 적 반격
  setTimeout(() => {
    const isExposed = action === 'crit' && Math.random() < 0.4;
    const eDmg = Math.max(1, Math.round(m.atk * (1 - s.def/(s.def+30)) * (b.defending?0.5:1) * (0.85+Math.random()*0.3) * (isExposed ? 1.3 : 1)));
    b.heroHp = Math.max(0, b.heroHp - eDmg);
    if (isExposed) {
      b.logs.push({cls:'dmg', txt:`😵 공격에 집중한 탓에 방어가 허술해졌다! 👹 ${m.name}의 반격! <strong>${eDmg}</strong> 피해! (×1.3)`});
    } else {
      b.logs.push({cls:'dmg', txt:`👹 ${m.name}의 반격! <strong>${eDmg}</strong> 피해!`});
    }
    b.turn++;
    if (b.heroHp <= 0) {
      b.logs.push({cls:'system', txt:'💀 쓰러졌습니다... 내일 다시 도전하세요!'});
      b.done = true;
      const today = getTodayStr();
      updateDoc(doc(db, 'students', state.currentUser.uid), { [state.battleState.difficulty==='challenge'?'dungeonChallengeDate':'dungeonSoloDate']: today });
    } else {
      b.logs.push({cls:'system', txt:`⚡ Turn ${b.turn} — 내 차례`});
      b._processing = false; // 락 해제 먼저 → renderBattle에서 버튼 활성화
    }
    renderBattle();
  }, 600);
};

// ===== 단체 던전 참여 =====
window.startDungeonRaid = async function() {
  const today = getTodayStr();
  // Firestore에서 직접 최신값 확인 (다중 탭 편법 방지)
  const freshDoc = await getDoc(doc(db, 'students', state.currentUser.uid));
  const sData = freshDoc.exists() ? freshDoc.data() : {};
  if (sData.dungeonRaidDate === today) return showToast('오늘은 이미 단체 던전에 참여했어요!');

  if (!window._raidBossDoc) window._raidBossDoc = await getDoc(doc(db, 'config', 'dungeonBoss'));
  const bossDoc = window._raidBossDoc;
  if (!bossDoc.exists()) return showToast('아직 보스가 설정되지 않았어요. 선생님께 문의하세요!');

  const bossData = bossDoc.data();
  if (bossData.currentHp <= 0 || bossData.cleared) return showToast('이미 클리어된 보스예요! 선생님이 새 보스를 설정할 때까지 기다려요.');

  const bossM = { ...DEFAULT_MONSTERS.boss, ...(state.dungeonConfig?.boss||{}) };
  const stats = calcBattleStats(sData.abilities);

  // 단체 던전 전투 (1회 공격)
  sDoc2char = getStudentChar({ id: state.currentUser.uid, character: sData.character, avatarEquipped: sData.avatarEquipped });
  sDocCharIsImg = true;
  state.battleState = {
    mode: 'raid',
    turn:1, defending:false,
    heroHp: stats.hp, heroMaxHp: stats.hp,
    enemyHp: bossData.currentHp, enemyMaxHp: bossM.hp,
    heroStats: stats, monster: bossM, logs:[], done:false,
    raidData: bossData,
    attacked: false,
  };
  state.battleState.logs.push({cls:'boss', txt:'🐉 단체 던전! 보스에게 공격하세요!'});
  state.battleState.logs.push({cls:'system', txt:'⚡ 사망하거나 보스를 쓰러뜨릴 때까지 공격할 수 있어요!'});

  const lobbyEl2 = document.getElementById('dungeonLobby');
  const battleEl2 = document.getElementById('dungeonBattle');
  lobbyEl2.style.transition = 'opacity 0.15s';
  lobbyEl2.style.opacity = '0';
  setTimeout(() => {
    lobbyEl2.style.display = 'none';
    battleEl2.style.display = 'block';
    battleEl2.style.opacity = '0';
    battleEl2.style.transition = 'opacity 0.25s';
    setTimeout(() => { battleEl2.style.opacity = '1'; }, 10);
    renderRaidBattle();
  }, 150);
};

function renderRaidBattle() {
  const b = state.battleState;
  const m = b.monster;
  const s = b.heroStats;
  const eHpPct = Math.max(0, Math.round(b.enemyHp / b.enemyMaxHp * 100));
  const hHpPct = Math.max(0, Math.round(b.heroHp / b.heroMaxHp * 100));
  const monsterDisplay = m.img
    ? `<img src="${m.img}" style="width:100px;height:100px;object-fit:contain;border-radius:12px;margin:6px auto;display:block;filter:drop-shadow(0 0 20px rgba(251,146,60,.6));" onerror="this.outerHTML='<div style=\'font-size:72px;text-align:center;\'>${m.emoji}</div>'" />`
    : `<div style="font-size:72px;text-align:center;margin:6px 0;">${m.emoji}</div>`;

  const bgStyle = b.raidData?.bgImg
    ? `background-image:url('${b.raidData.bgImg}');background-size:cover;background-position:center;`
    : '';
  document.getElementById('dungeonBattle').innerHTML = `
  <div class="battle-screen" style="${bgStyle}">
    <div style="text-align:center;margin-bottom:16px;">
      <span class="battle-turn" style="background:rgba(251,146,60,.25);border-color:rgba(251,146,60,.6);color:#fb923c;font-size:17px;font-weight:800;padding:8px 24px;border-radius:12px;">🐉 단체 던전 — 보스전</span>
    </div>
    <div style="text-align:center;margin-bottom:8px;">
      ${m.img
        ? `<img src="${m.img}" style="width:280px;height:280px;object-fit:contain;border-radius:16px;margin:0 auto;display:block;filter:drop-shadow(0 0 30px rgba(251,146,60,0.7));" onerror="this.outerHTML='<div style=\'font-size:160px;text-align:center;\'>${m.emoji}</div>'" />`
        : `<div style="font-size:160px;text-align:center;line-height:1;">${m.emoji}</div>`}
    </div>
    <div style="text-align:center;margin-bottom:6px;font-size:20px;font-weight:800;text-shadow:0 0 10px rgba(251,146,60,0.5);">${m.name}</div>
    <div class="raid-hp-bar-wrap" style="margin:10px 0;"><div class="raid-hp-bar" style="width:${eHpPct}%"></div></div>
    <div style="text-align:center;font-size:14px;color:rgba(255,255,255,.75);margin-bottom:16px;font-weight:600;">HP ${Math.max(0,b.enemyHp).toLocaleString()} / ${b.enemyMaxHp.toLocaleString()} · ${new Set(b.raidData.attackers||[]).size}명 참여</div>

    <div class="battle-log" id="battleLog">
      ${b.logs.map(l=>`<div class="battle-log-line ${l.cls}">${l.txt}</div>`).join('')}
    </div>

    <div class="battle-actions" id="battleActions">
      ${b.done ? `<button class="battle-action" onclick="renderDungeonLobby()" style="grid-column:1/-1;">🏠 로비로 돌아가기</button>` : `
      <div class="battle-action" onclick="doRaidAction('heavy')">
        <span class="battle-action-icon">💥</span>강공격
        <div class="battle-action-sub">+50% 위력 · 빗나감 40%</div>
      </div>
      <div class="battle-action" onclick="doRaidAction('normal')">
        <span class="battle-action-icon">⚔️</span>일반공격
        <div class="battle-action-sub">안정적 · 빗나감 20%</div>
      </div>
      <div class="battle-action" onclick="doRaidAction('magic')">
        <span class="battle-action-icon">🔮</span>마법공격
        <div class="battle-action-sub">빗나감 30% · 연속타 40%</div>
      </div>
      `}
    </div>
    <div style="text-align:center;margin-top:10px;">
      <button onclick="tryRaidEscape()" style="background:none;border:1px solid rgba(255,255,255,0.25);color:rgba(255,255,255,0.6);font-size:13px;cursor:pointer;padding:6px 18px;border-radius:8px;font-family:inherit;transition:all 0.2s;" onmouseenter="this.style.color='#fff';this.style.borderColor='rgba(255,255,255,0.5)'" onmouseleave="this.style.color='rgba(255,255,255,0.6)';this.style.borderColor='rgba(255,255,255,0.25)'">← 돌아가기</button>
    </div>
  </div>`;
  const logEl = document.getElementById('battleLog');
  if (logEl) logEl.scrollTop = logEl.scrollHeight;
}

window.doRaidAction = async function(action) {
  const b = state.battleState;
  if (b.done) return;
  b.done = true; // 즉시 잠금 (비동기 처리 중 중복 클릭 방지)
  b.attacked = true;
  document.querySelectorAll('.battle-action').forEach(el => el.classList.add('disabled'));
  const s = b.heroStats;
  const m = b.monster;
  const isCrit = Math.random() < s.crit;
  let dmg = 0;

  // ===== 1. 빗나감 체크 (강공격 40%, 일반공격 20%, 마법공격 30%) =====
  const missRate = action==='heavy' ? 0.40 : action==='normal' ? 0.20 : 0.30;
  const missed = Math.random() < missRate;

  if (missed) {
    const missMsg = action==='heavy' ? '💨 강공격이 빗나갔어요!' : action==='normal' ? '💨 공격이 빗나갔어요!' : '💨 마법이 빗나갔어요!';
    b.logs.push({cls:'system', txt:`${missMsg} ${m.name}이(가) 피했습니다.`});
  } else {
    // ===== 2. 공격 성공 =====
    if (action==='heavy') {
      dmg = Math.max(1, Math.round(s.atk * 1.5 * (isCrit?1.8:1) * (0.9+Math.random()*.2)));
      b.logs.push({cls:isCrit?'crit':'dmg', txt:isCrit?`💥 크리티컬! 보스에게 <strong>${dmg}</strong> 피해!`:`💥 강공격! 보스에게 <strong>${dmg}</strong> 피해!`});
    } else if (action==='normal') {
      dmg = Math.max(1, Math.round(s.atk * (isCrit?1.8:1) * (0.9+Math.random()*.2)));
      b.logs.push({cls:isCrit?'crit':'dmg', txt:isCrit?`⚔️ 크리티컬! 보스에게 <strong>${dmg}</strong> 피해!`:`⚔️ 일반공격! 보스에게 <strong>${dmg}</strong> 피해!`});
    } else {
      // 마법: 성공 시 40% 확률로 데미지 50% 추가
      dmg = Math.max(1, Math.round(s.mag * 1.3 * (isCrit?1.8:1) * (0.9+Math.random()*.2)));
      b.logs.push({cls:isCrit?'crit':'dmg', txt:isCrit?`🔮 마법 크리티컬! 보스에게 <strong>${dmg}</strong> 피해!`:`🔮 마법공격! 보스에게 <strong>${dmg}</strong> 피해!`});
      if (Math.random() < 0.40) {
        const bonusDmg = Math.round(dmg * 0.5);
        dmg += bonusDmg;
        b.logs.push({cls:'crit', txt:`✨ 마법이 연속으로 작렬! 추가 <strong>${bonusDmg}</strong> 피해!`});
      }
    }
  }

  renderRaidBattle();

  // ===== 3. 보스 반격 (공격 성공/실패 무관) =====
  setTimeout(async () => {
    b.logs.push({cls:'boss', txt:`🐉 ${m.name}의 반격!`});
    const counterRoll = Math.random();
    if (counterRoll < 0.50) {
      // 50% 확률: 즉사
      b.heroHp = 0;
      b.logs.push({cls:'dmg', txt:`💀 ${m.name}의 강력한 일격! <strong>즉사!</strong> 쓰러졌습니다...`});
    } else {
      // 50% 확률: 체력 50% 감소
      const halfDmg = Math.round(b.heroMaxHp * 0.5);
      b.heroHp = Math.max(0, b.heroHp - halfDmg);
      b.logs.push({cls:'dmg', txt:`💥 ${m.name}의 강타! 체력이 <strong>50%</strong> 감소했습니다! (-${halfDmg})`});
    }

    // Firestore 보스 HP 차감 & 참여 기록
    const today = getTodayStr();
    const bossRef = doc(db, 'config', 'dungeonBoss');
    const newHp = Math.max(0, b.enemyHp - dmg);
    const prevAttackers = b.raidData.attackers || [];
    const attackers = prevAttackers.includes(state.currentUser.uid)
      ? prevAttackers
      : [...prevAttackers, state.currentUser.uid];
    await updateDoc(bossRef, { currentHp: newHp, attackers });
    // 참여 기록 항상 저장 (생존/사망/보스처치 무관)
    await updateDoc(doc(db, 'students', state.currentUser.uid), { dungeonRaidDate: today }); updateDungeonBadge();
    b.enemyHp = newHp;

    if (newHp <= 0) {
      // 트랜잭션으로 중복 클리어 완전 차단
      const { runTransaction } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
      let alreadyCleared = false;
      try {
        await runTransaction(db, async (transaction) => {
          const freshBoss = await transaction.get(bossRef);
          if (freshBoss.data()?.cleared) { alreadyCleared = true; return; }
          transaction.update(bossRef, { cleared: true, clearedAt: serverTimestamp() });
        });
      } catch(e) { alreadyCleared = true; }

      if (alreadyCleared) {
        b.logs.push({cls:'boss', txt:`🎉 보스가 이미 처치됐어요! 보상은 곧 지급돼요.`});
        b.done = true;
        renderRaidBattle();
        return;
      }

      const bossReward = state.dungeonConfig?.boss?.reward || 500;
      b.done = true;
      b.logs.push({cls:'boss', txt:`🎉 보스를 처치했습니다! 전원 +${bossReward}🪙 보상 지급!`});
      const sSnap = await getDocs(collection(db, 'students'));
      const todayStr = getTodayStr();
      const participantIds = new Set(attackers);
      // Promise.all 대신 순차 처리 - 한 명 실패해도 나머지 계속
      for (const sd of sSnap.docs) {
        try {
          const sdata = sd.data();
          if (sdata.hidden) continue; // 숨긴 학생 제외
          const participated = participantIds.has(sd.id) || sdata.dungeonRaidDate === todayStr;
          if (!participated) continue;
          await updateDoc(doc(db, 'students', sd.id), {
            points: increment(bossReward),
            accumulatedPoints: increment(bossReward)
          });
          await addDoc(collection(db, 'history'), {
            studentId: sd.id, studentName: sdata.name,
            delta: bossReward, reason: `단체 던전 클리어 (${m.name})`,
            type: 'plus', source: 'dungeon', createdAt: serverTimestamp()
          });
          await addDoc(collection(db, 'notifications'), {
            studentId: sd.id, type: 'bossCleared',
            bossName: m.name, reward: bossReward,
            createdAt: serverTimestamp(), read: false
          });
        } catch(e) {
          console.warn('보스 보상 지급 오류:', sd.id, e.message);
        }
      }
    } else if (b.heroHp <= 0) {
      // 학생 사망
      b.done = true;
      b.logs.push({cls:'system', txt:`🐉 보스 남은 HP: ${newHp.toLocaleString()} / 누적 ${new Set(attackers).size}명 참여`});
    } else {
      // 생존 - 계속 공격 가능 (잠금 해제)
      b.done = false;
      b.logs.push({cls:'system', txt:`🐉 보스 남은 HP: ${newHp.toLocaleString()} · 계속 공격하세요!`});
    }
    renderRaidBattle();
  }, 700);
};

// ===== 던전 도망 처리 =====
window.tryEscape = function() {
  const b = state.battleState;
  if (!b) return;
  if (b) b._processing = false; // 락 해제
  if (!b.attacked) {
    // 챌린지 던전은 난이도 선택 없이 바로 로비로
    if (b.difficulty === 'challenge') {
      renderDungeonLobby();
    } else {
      // 한 번도 공격 안 함 → 즉시 난이도 선택으로
      showDifficultySelect();
    }
  } else {
    // 공격한 적 있음 → 확인창
    openModal('dungeonEscapeModal');
  }
};

window.confirmEscape = async function() {
  closeModal('dungeonEscapeModal');
  if (state.battleState) state.battleState._processing = false; // 락 해제
  // 도전 기회 소모 처리
  const today = getTodayStr();
  await updateDoc(doc(db, 'students', state.currentUser.uid), { [state.battleState.difficulty==='challenge'?'dungeonChallengeDate':'dungeonSoloDate']: today });
  updateDungeonBadge();
  showToast('도망쳤어요... 오늘의 도전 기회가 사라졌어요 🏃');
  // 로비로 이동 후 오늘 참여 표시
  await renderDungeonLobby();
};

// 단체 던전 도망
window.tryRaidEscape = function() {
  const b = state.battleState;
  if (!b || b.done) { renderDungeonLobby(); return; }
  // 단체 던전은 공격 전이면 바로 로비로
  if (!b.attacked) {
    renderDungeonLobby();
  } else {
    openModal('dungeonEscapeModal');
  }
};

// 단체 던전 도망 확인 - confirmEscape를 그대로 사용
// (이미 dungeonRaidDate가 저장된 상태이므로 추가 처리 불필요)

// 난이도 선택 화면으로 돌아가기
function showDifficultySelect() {
  const battleEl = document.getElementById('dungeonBattle');
  const lobbyEl = document.getElementById('dungeonLobby');
  battleEl.style.transition = 'opacity 0.15s';
  battleEl.style.opacity = '0';
  setTimeout(() => {
    battleEl.style.display = 'none';
    battleEl.style.opacity = '';
    lobbyEl.style.display = 'block';
    lobbyEl.style.opacity = '0';
    lobbyEl.style.transition = 'opacity 0.25s';
    setTimeout(() => { lobbyEl.style.opacity = '1'; }, 10);
    window.startDungeonSolo(); // 난이도 선택 화면
  }, 150);
}
