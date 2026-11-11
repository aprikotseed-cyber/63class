// points.js — 학생: 내 포인트
import { state } from './state.js?v=20261111d';
import { collection, db, getDocs, limit, orderBy, query, where } from './firebase.js?v=20261111d';
import { calcLevel, formatTime, getAbilityRank } from './level.js?v=20261111d';
import { reloadStudents } from './realtime.js?v=20261111d';
import { FRAME_DATA } from './frames.js?v=20261111d';
import { getTitleBadgeHtml } from './titles.js?v=20261111d';
import { buildCharHtml } from './avatar.js?v=20261111d';

// ===== 학생: 내 포인트 =====
export async function renderMyPoints() {
  // 항상 최신 데이터로 갱신 (캐시 무효화)
  window._myHistory = null;
  await reloadStudents();

  const _sMe2 = state.students.find(s => s.id === state.currentUser.uid) || {};
  const gold = _sMe2.points || 0;

  // 누적 포인트 = Firestore students.accumulatedPoints
  const accumulated = _sMe2.accumulatedPoints ?? _sMe2.points ?? 0;

  // ===== 캐릭터 카드 렌더 =====
  const charEl = document.getElementById('myStatChar');
  if (charEl) {
    const petItem = (window._cachedPetList||[]).find(p=>p.id===_sMe2.petEquipped);
    if (petItem) {
      charEl.innerHTML = `<div style="width:160px;margin:0 auto;display:flex;align-items:flex-end;flex-shrink:0;">
        <div style="flex:7;display:flex;justify-content:flex-end;align-items:flex-end;">${buildCharHtml({ id: state.currentUser.uid, avatarEquipped: _sMe2.avatarEquipped, avatarEquippedMeta: _sMe2.avatarEquippedMeta })}</div>
        <div style="flex:3;display:flex;align-items:flex-end;justify-content:flex-start;">
          <img src="${petItem.imgUrl}" style="width:60px;height:100px;object-fit:contain;" onerror="this.style.display='none'" />
        </div>
      </div>`;
    } else {
      charEl.innerHTML = `<div style="width:160px;margin:0 auto;display:flex;justify-content:center;">${buildCharHtml({ id: state.currentUser.uid, avatarEquipped: _sMe2.avatarEquipped, avatarEquippedMeta: _sMe2.avatarEquippedMeta })}</div>`;
    }
  }

  const nameEl = document.getElementById('myStatName');
  if (nameEl) {
    const emoji = _sMe2.avatarEmoji ? `<span style="font-size:17px;">${_sMe2.avatarEmoji}</span> ` : '';
    nameEl.innerHTML = emoji + state.currentUser.name;
  }

  // 장착 칭호 - _cachedTitleInventory 사용 (홈 렌더 시 이미 로드됨)
  const titleEl = document.getElementById('myStatTitle');
  if (titleEl && _sMe2.equippedTitleId) {
    const tInv = window._cachedTitleInventory?.find(i => i.studentId === state.currentUser.uid && i.titleId === _sMe2.equippedTitleId);
    if (tInv) {
      titleEl.innerHTML = getTitleBadgeHtml(tInv.titleGrade, tInv.bgColor, tInv.textColor, tInv.titleEmoji, tInv.titleName);
    } else titleEl.innerHTML = '';
  } else if (titleEl) titleEl.innerHTML = '';

  // 레벨 및 경험치 바
  const lv = calcLevel(accumulated);
  const lvEl = document.getElementById('myStatLevel');
  if (lvEl) lvEl.textContent = `Lv.${lv}`;

  // 경험치 바 계산 - 현재 레벨 시작 포인트와 다음 레벨 포인트 계산
  function getPtsForLevel(targetLv) {
    // targetLv 레벨에 도달하기 위한 총 누적 포인트
    const tiers = [
      { maxLv:10, perLv:300 },
      { maxLv:20, perLv:600 },
      { maxLv:30, perLv:900 },
      { maxLv:40, perLv:1200 },
      { maxLv:Infinity, perLv:1500 },
    ];
    let total = 0, prevMax = 0;
    for (const t of tiers) {
      const lvInTier = Math.min(targetLv, t.maxLv) - prevMax;
      if (lvInTier <= 0) break;
      total += lvInTier * t.perLv;
      if (targetLv <= t.maxLv) break;
      prevMax = t.maxLv;
    }
    return total;
  }
  const lvStartPts = getPtsForLevel(lv - 1);  // 현재 레벨 시작점
  const lvEndPts   = getPtsForLevel(lv);       // 다음 레벨 시작점
  const perLvPts   = lvEndPts - lvStartPts;
  const expInLv    = accumulated - lvStartPts;
  const expPct     = Math.min(100, Math.round((expInLv / perLvPts) * 100));
  const expBar = document.getElementById('myExpBar');
  const expLabel = document.getElementById('myExpLabel');
  if (expBar) setTimeout(() => expBar.style.width = expPct + '%', 100);
  if (expLabel) expLabel.textContent = `${expInLv.toLocaleString()} / ${perLvPts.toLocaleString()} EXP`;

  // 포인트/골드
  const accumEl = document.getElementById('myStatAccum');
  const goldEl2 = document.getElementById('myStatGold');
  if (accumEl) accumEl.textContent = '🪙 ' + accumulated.toLocaleString();
  const accumEl2 = document.getElementById('myStatAccum2');
  if (accumEl2) accumEl2.textContent = accumulated.toLocaleString() + '🪙';
  

  // 프레임 적용 - 카드 배경에 직접
  const statCard = document.getElementById('myStatCard');
  if (statCard) {
    if (_sMe2.equippedFrameId && FRAME_DATA[_sMe2.equippedFrameId]) {
      const fd = FRAME_DATA[_sMe2.equippedFrameId];
      statCard.className = fd.css;
      statCard.style.borderRadius = 'var(--radius-lg)';
      statCard.style.padding = '30px';
      statCard.style.textAlign = 'center';
      statCard.style.boxShadow = 'var(--shadow-sm)';
      statCard.style.transition = 'opacity 0.3s,transform 0.2s ease,box-shadow 0.2s ease';
      const neonTxt = fd.neonTxt || '';
      // 이름/포인트/레벨에만 네온 or 흰색 적용 (내 프로필 텍스트·캐릭터는 제외)
      ['myStatName','myStatAccum','myStatLevel'].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        if (neonTxt) {
          el.classList.add(neonTxt);
        } else {
          el.style.color = '#fff';
          el.style.textShadow = '0 1px 4px rgba(0,0,0,0.5)';
        }
      });
    }
    statCard.style.opacity = '1';
  }

  // 능력치 랭크 계산
  // 능력치 랭크 계산은 전역 getAbilityRank() 사용

  // 능력치 렌더
  const abilityList = document.getElementById('myStatAbilityList');
  if (abilityList) {
    const abilities = [
      { key:'성실성', icon:'🌟', color:'#10b981', desc:'약속을 잘 지키고, 꾸준히 노력하는 힘이야. 매일 열심히 하면 이 능력이 자라나!' },
      { key:'인성',   icon:'❤️', color:'#ef4444', desc:'도와주고, 배려하고, 함께 잘 지낼 수 있는 마음의 힘이야. 따뜻한 사람이 되면 쑥쑥 올라!' },
      { key:'사회성', icon:'🤝', color:'#3b82f6', desc:'내 생각을 말하고, 친구의 이야기도 잘 들어주는 소통 능력이야. 협력이나 발표를 통해 키울 수 있어!' },
      { key:'지력',   icon:'📚', color:'#8b5cf6', desc:'새로운 지식을 배우고, 문제를 잘 풀 수 있는 머리 힘! 공부하고 책 읽으면 지력이 올라가!' },
      { key:'집중력', icon:'⚡', color:'#f59e0b', desc:'한 가지 일에 집중해서 끝까지 해내는 힘이야. 수업 시간에 집중하면 이 능력이 자라나!' },
    ];
    abilityList.innerHTML = abilities.map(a => {
      const val = _sMe2.abilities?.[a.key] || 0;
      const isNeg = val < 0;
      const pct = isNeg ? Math.min(100, Math.abs(val)) : Math.min(100, Math.floor((val / 500) * 100)); // 500(신화)을 100%로 잡아 표시
      const barColor = isNeg ? '#ef4444' : a.color;
      const { rank, color: rankColor, cls: rankCls } = getAbilityRank(val);
      return `
      <div class="ability-item" style="display:flex;flex-direction:column;justify-content:center;flex:1;padding:6px 4px;">
        <div class="ability-tooltip">
          <strong>${a.icon} ${a.key}</strong><br>${a.desc}
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px;">
          <span style="font-size:13px;font-weight:700;">${a.icon} ${a.key}
            <span style="font-size:11px;font-weight:400;color:var(--text-muted);margin:0 3px;">│</span>
            <span class="${rankCls||''}" style="font-size:12px;font-weight:800;color:${rankColor};">Rank ${rank}</span>
          </span>
          <span style="font-size:13px;font-weight:700;color:${a.color};">${val}</span>
        </div>
        <div style="height:6px;background:var(--border);border-radius:3px;overflow:hidden;">
          <div style="height:100%;width:${pct}%;background:${barColor};border-radius:3px;transition:width 0.6s ease;"></div>
        </div>
      </div>`;
    }).join('');

    // 레이더 차트
    const radarDescs = {
      '성실성': '모든 일을 끝까지 성실하게 수행할 줄 아는 인재입니다.',
      '인성':   '따뜻한 마음으로 주변을 배려하는 훌륭한 인성을 지녔습니다.',
      '사회성': '누구와도 잘 어울리고 관계를 소중히 여기는 학생입니다.',
      '지력':   '깊이 생각하고 탐구하는 것을 즐기는 지적인 학생입니다.',
      '집중력': '한 가지에 온 힘을 다해 몰입할 줄 아는 집중력이 뛰어난 학생입니다.',
    };
    const abVals = abilities.map(a => _sMe2.abilities?.[a.key] || 0);
    const topAb = abilities.reduce((best, a, i) => abVals[i] >= abVals[best.i] ? {a, i} : best, {a: abilities[0], i: 0});
    const descNameEl = document.getElementById('abilityDescName');
    const descTextEl = document.getElementById('abilityDescText');
    if (descNameEl) descNameEl.textContent = topAb.a.key;
    if (descTextEl) descTextEl.textContent = radarDescs[topAb.a.key] || '';

    const radarCanvas = document.getElementById('abilityRadarChart');
    if (radarCanvas && window.Chart) {
      if (window._abilityRadarInstance) { window._abilityRadarInstance.destroy(); }
      const isDark = matchMedia('(prefers-color-scheme: dark)').matches;
      // 동적 최대값: 최대 능력치 기준으로 여유있게 설정
      const maxVal = Math.max(...abVals, 1);
      const radarMax = Math.ceil(maxVal / 20) * 20 + 20;
      const stepSize = radarMax<=8?2:radarMax<=15?5:radarMax<=25?5:radarMax<=50?10:20;

      window._abilityRadarInstance = new Chart(radarCanvas, {
        type: 'radar',
        data: {
          labels: abilities.map(a => a.key),
          datasets: [{
            data: abVals,
            backgroundColor: 'rgba(99,102,241,0.15)',
            borderColor: '#6366f1',
            borderWidth: 2,
            pointBackgroundColor: abilities.map(a => a.color),
            pointBorderColor: isDark ? '#1e1e1e' : '#fff',
            pointBorderWidth: 2,
            pointRadius: 5,
            pointHoverRadius: 7,
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: { duration: 800, easing: 'easeOutQuart' },
          plugins: {
            legend: { display: false },
            tooltip: {
              mode: 'nearest',
              intersect: true,
              callbacks: {
                title: (items) => items[0]?.label || '',
                label: (item) => ` ${item.label}: ${item.raw}`,
              }
            }
          },
          scales: {
            r: {
              min: 0,
              max: radarMax,
              ticks: { stepSize, display: false },
              grid: { color: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.07)' },
              angleLines: { color: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.07)' },
              pointLabels: {
                font: { size: 11 },
                color: isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.45)',
                padding: 4,
              }
            }
          }
        }
      });
    }
  }

  // 누적 카드 개수 - 세션 캐시
  try {
    if (!window._myGivenCards) {
      const givenSnap = await getDocs(query(collection(db, 'givenCards'), where('studentId', '==', state.currentUser.uid)));
      window._myGivenCards = givenSnap.docs.map(d => d.data());
    }
    const givenCards = window._myGivenCards;
    const praiseCount = givenCards.filter(c => (c.cardType||c.type) === 'praise').length;
    const penaltyCount = givenCards.filter(c => (c.cardType||c.type) === 'penalty').length;
    const praiseEl = document.getElementById('myPraiseCount');
    const penaltyEl = document.getElementById('myPenaltyCount');
    if (praiseEl) { praiseEl.textContent = praiseCount; praiseEl.style.opacity = '1'; }
    if (penaltyEl) { penaltyEl.textContent = penaltyCount; penaltyEl.style.opacity = '1'; }
  } catch(e) { console.error('카드 개수 로드 오류:', e); }

  // 교환 신청 현황 - exchanges 캐시(onSnapshot)에서 필터
  try {
    const myPending = state.exchanges.filter(e => e.studentId === state.currentUser.uid && e.status === 'pending');
    const exSnap = { docs: myPending.map(e => ({ id: e.id, data: () => e })) };
    const pendingEx = exSnap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.createdAt?.seconds||0) - (a.createdAt?.seconds||0));
    const box = document.getElementById('myExchangeStatusBox');
    const list = document.getElementById('myExchangeStatusList');
    if (box && list) {
      if (pendingEx.length > 0) {
        box.style.display = '';
        list.innerHTML = pendingEx.map(e => `
          <div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--border);">
            <div style="font-size:22px;">${e.rewardEmoji||'🎁'}</div>
            <div style="flex:1;">
              <div style="font-size:13px;font-weight:700;">${e.rewardName}</div>
              <div style="font-size:11px;color:var(--text-secondary);">${formatTime(e.createdAt)}</div>
            </div>
            <div style="font-size:13px;font-weight:700;color:var(--warning);">🪙 ${e.rewardCost}</div>
            <span style="font-size:11px;font-weight:600;color:#d97706;background:#fffbeb;padding:3px 10px;border-radius:12px;border:1px solid #fcd34d;">승인 대기 중</span>
          </div>
        `).join('');
      } else {
        box.style.display = 'none';
      }
    }
  } catch(e) { console.error('교환 현황 오류:', e); }

  // 포인트 내역 (최근 10개만 표시)
  // (읽기 절약) 최근 10개만 서버에 요청. 이 조회에는 Firestore 복합 색인(history: studentId + createdAt 내림차순)이
  // 필요해요. 색인이 아직 없으면 예전처럼 내 내역 전체를 읽어서 보여줘요 (화면은 똑같이 동작).
  if (!window._myHistory) {
    try {
      const _hSnap = await getDocs(query(collection(db, 'history'), where('studentId', '==', state.currentUser.uid), orderBy('createdAt', 'desc'), limit(10)));
      window._myHistory = _hSnap.docs.map(d => d.data());
    } catch (e) {
      if (e?.code === 'failed-precondition') console.warn('포인트 내역 색인이 없어 전체를 읽어요. 콘솔 링크로 색인을 만들면 읽기가 줄어요:', e.message);
      const _hSnap = await getDocs(query(collection(db, 'history'), where('studentId', '==', state.currentUser.uid)));
      window._myHistory = _hSnap.docs.map(d => d.data());
    }
  }
  const hSnap = { docs: window._myHistory.map(d => ({ data: () => d })) };
  const history = hSnap.docs
    .map(d => d.data())
    .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0))
    .slice(0, 10);
  const container = document.getElementById('myHistory');
  container.innerHTML = history.length ? history.map(h => {
    const isPlus = h.type === 'plus';
    let msg;
    const isAttendance = h.source === 'attendance' || h.reason === '출석 체크';
    const isShop = h.source === 'shop'
      || (h.reason && (h.reason.includes('칭호 구매') || h.reason.includes('보상 교환')));
    const isPraiseCard = h.source === 'praiseCard';
    const isPenaltyCard = h.source === 'penaltyCard';
    const isRevoke = h.source === 'revoke';
    const isExchangeReq = h.source === 'exchange_request';
    const isExchangeApproved = h.source === 'exchange_approved';
    const isExchangeRejected = h.source === 'exchange_rejected';
    if (isAttendance) {
      msg = `출석 체크를 통해 ${Math.abs(h.delta)}🪙을 얻었어요.`;
    } else if (isExchangeReq) {
      msg = `구매할 보상 '${h.reason}'을(를) 교환 신청하여 ${Math.abs(h.delta)}🪙이 차감됐어요.`;
    } else if (isExchangeApproved) {
      msg = `보상 교환 신청이 승인됐어요.`;
    } else if (isExchangeRejected) {
      msg = `보상 교환 신청이 거절되어 ${Math.abs(h.delta)}🪙을 돌려받았어요.`;
    } else if (isShop) {
      const itemName = h.reason.replace('칭호 구매: ','').replace('보상 교환: ','');
      msg = `상점에서 '${itemName}'을(를) 구매하여 ${Math.abs(h.delta)}🪙를 사용했어요. 🛒`;
    } else if (isPraiseCard) {
      msg = `선생님께서 칭찬 카드 '${h.reason}'을(를) 부여해서 ${Math.abs(h.delta)}🪙을 주셨어요. 👏🏻`;
    } else if (isPenaltyCard) {
      msg = `선생님께서 벌점 카드 '${h.reason}'을(를) 부여해서 ${Math.abs(h.delta)}🪙을 깎으셨어요. 😭`;
    } else if (isRevoke) {
      msg = isPlus
        ? `카드 회수로 ${Math.abs(h.delta)}🪙이 복구됐어요.`
        : `카드 회수로 ${Math.abs(h.delta)}🪙이 차감됐어요.`;
    } else if (isPlus) {
      msg = `선생님께서 '${h.reason}'을(를) 이유로 ${Math.abs(h.delta)}🪙을 주셨어요. 👏🏻`;
    } else {
      msg = `선생님께서 '${h.reason}'을(를) 이유로 ${Math.abs(h.delta)}🪙을 깎으셨어요. 😭`;
    }
    return `
    <div class="history-item">
      <div class="history-icon ${h.type}">${isExchangeApproved ? '✅' : isPlus ? '📈' : '📉'}</div>
      <div class="history-text">
        <div class="history-reason">${msg}</div>
        <div class="history-date">${formatTime(h.createdAt)}</div>
      </div>
      <div class="history-point ${h.type}">${isExchangeApproved ? '' : (isPlus ? '+' : '') + h.delta}</div>
    </div>`;
  }).join('') : '<div class="empty-state"><div class="empty-icon">📋</div><h3>아직 내역이 없어요</h3><p>포인트를 받으면 여기 표시돼요</p></div>';
}
