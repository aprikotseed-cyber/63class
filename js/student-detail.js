// student-detail.js — 학생/친구 상세 보기
import { collection, db, doc, getDoc, getDocs, query, where } from './firebase.js?v=20261111d';
import { openModal } from './core.js?v=20261111d';
import { formatTime, getAbilityRank } from './level.js?v=20261111d';
import { loadChartJs } from './books.js?v=20261111d';

// ===== 교사 홈: 학생 상세 정보 모달 =====
// ===== 학생: 친구 상세 보기 =====
window.openFriendDetail = async function(studentId, studentName) {
  document.getElementById('friendDetailTitle').textContent = `👤 ${studentName}`;
  document.getElementById('friendDetailContent').innerHTML =
    '<div style="text-align:center;padding:30px;color:var(--text-muted);">불러오는 중...</div>';
  openModal('friendDetailModal');
  try {
    const sDoc = await getDoc(doc(db, 'students', studentId));
    const sData = sDoc.exists() ? sDoc.data() : {};
    const ab = sData.abilities || {};
    const cardSnap = await getDocs(query(collection(db,'givenCards'), where('studentId','==',studentId)));
    let praiseCount=0, penaltyCount=0;
    cardSnap.docs.forEach(d => {
      const data = d.data();
      if ((data.cardType||data.type)==='praise') praiseCount++; else penaltyCount++;
    });
    const abilities = [
      { key:'성실성', icon:'🌟', color:'#10b981' },
      { key:'인성',   icon:'❤️', color:'#ef4444' },
      { key:'사회성', icon:'🤝', color:'#3b82f6' },
      { key:'지력',   icon:'📚', color:'#8b5cf6' },
      { key:'집중력', icon:'⚡', color:'#f59e0b' },
    ];
    const abilityBarsHtml = abilities.map(a => {
      const val = ab[a.key] || 0;
      const isNeg = val < 0;
      const pct = isNeg ? Math.min(100,Math.abs(val)) : Math.min(100,Math.floor((val/500)*100)); // 500(신화)을 100%로 잡아 표시
      const barColor = isNeg ? '#ef4444' : a.color;
      const { rank, color: rankColor, cls: rankCls } = getAbilityRank(val);
      return `<div style="margin-bottom:8px;">
        <div style="display:flex;justify-content:space-between;align-items:center;font-size:13px;margin-bottom:3px;">
          <span>${a.icon} ${a.key} <span class="${rankCls||''}" style="font-size:10px;font-weight:700;color:${rankColor};margin-left:3px;">${rank}</span></span>
          <span style="font-weight:700;color:${isNeg?'#ef4444':'inherit'}">${val}</span>
        </div>
        <div style="height:6px;background:var(--border);border-radius:3px;overflow:hidden;">
          <div style="height:100%;width:${pct}%;background:${barColor};border-radius:3px;transition:width 0.5s;"></div>
        </div>
      </div>`;
    }).join('');
    document.getElementById('friendDetailContent').innerHTML = `
      <div style="background:linear-gradient(135deg,#fef9c3,#fde68a);border-radius:12px;padding:14px;text-align:center;margin-bottom:10px;">
        <div style="font-size:11px;color:#a16207;font-weight:600;margin-bottom:4px;">보유 골드</div>
        <div style="font-size:22px;font-weight:800;color:#a16207;">🪙 ${(sData.points||0).toLocaleString()}</div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:18px;">
        <div style="background:#dcfce7;border-radius:10px;padding:14px;text-align:center;">
          <div style="font-size:11px;color:#15803d;font-weight:600;margin-bottom:4px;">칭찬 카드</div>
          <div style="font-size:20px;font-weight:800;color:#15803d;">💓 ${praiseCount}개</div>
        </div>
        <div style="background:#fff7ed;border-radius:10px;padding:14px;text-align:center;">
          <div style="font-size:11px;color:#c2410c;font-weight:600;margin-bottom:4px;">벌점 카드</div>
          <div style="font-size:20px;font-weight:800;color:#c2410c;">⚠️ ${penaltyCount}개</div>
        </div>
      </div>
      <div style="font-size:14px;font-weight:700;margin-bottom:10px;">⚡ 능력치</div>
      <div style="background:var(--bg);border-radius:10px;padding:12px;margin-bottom:16px;">${abilityBarsHtml}</div>
      <div style="font-size:14px;font-weight:700;margin-bottom:10px;">📊 능력치 그래프</div>
      <canvas id="friendRadarChart" style="width:100%;max-height:220px;"></canvas>`;
    await loadChartJs();
    if (window.Chart) {
      const abVals = abilities.map(a => ab[a.key] || 0);
      const maxVal = Math.max(...abVals, 1);
      const radarMax = Math.ceil(maxVal / 20) * 20 + 20;
      new Chart(document.getElementById('friendRadarChart'), {
        type:'radar',
        data:{ labels:abilities.map(a=>a.key), datasets:[{
          data:abVals, backgroundColor:'rgba(99,102,241,0.15)',
          borderColor:'#6366f1', borderWidth:2, pointBackgroundColor:'#6366f1', pointRadius:3
        }]},
        options:{ animation:{duration:600}, scales:{ r:{
          min:0, max:radarMax, ticks:{display:false}, grid:{color:'rgba(0,0,0,0.08)'},
          pointLabels:{font:{size:12,weight:'600'}}
        }}, plugins:{legend:{display:false}} }
      });
    }
  } catch(e) {
    document.getElementById('friendDetailContent').innerHTML =
      `<div style="color:#ef4444;padding:16px;">불러오기 실패: ${e.message}</div>`;
  }
};

window.openStudentDetail = async function(studentId, studentName) {
  try {
    // 데이터 먼저 모두 로드
    const sDoc = await getDoc(doc(db, 'students', studentId));
    const sData = sDoc.exists() ? sDoc.data() : {};
    const accum = sData.accumulatedPoints ?? sData.points ?? 0;
    const gold  = sData.points ?? 0;
    const ab    = sData.abilities || {};

    const cardSnap = await getDocs(query(collection(db, 'givenCards'), where('studentId','==',studentId)));
    let praiseCount = 0, penaltyCount = 0;
    const recentCards = [];
    cardSnap.docs.forEach(d => {
      const data = d.data();
      if ((data.cardType||data.type) === 'praise') praiseCount++;
      else penaltyCount++;
      recentCards.push(data);
    });
    recentCards.sort((a,b) => (b.givenAt?.seconds||0) - (a.givenAt?.seconds||0));
    recentCards.splice(10);

    // 최근 포인트 내역 (랭크업 보상 포함)
    const histSnap = await getDocs(query(
      collection(db, 'history'),
      where('studentId','==',studentId)
    ));
    const recentHistory = histSnap.docs.map(d => d.data())
      .sort((a,b) => (b.createdAt?.seconds||0) - (a.createdAt?.seconds||0))
      .slice(0, 10);

    // 프로필 메시지 변경 이력
    const msgLogSnap = await getDocs(query(
      collection(db, 'profileMsgLog'),
      where('studentId','==',studentId)
    ));
    const msgLogs = msgLogSnap.docs.map(d => d.data())
      .sort((a,b) => (b.changedAt?.seconds||0) - (a.changedAt?.seconds||0))
      .slice(0, 10);

    const exchSnap = await getDocs(query(
      collection(db, 'exchanges'),
      where('studentId','==',studentId),
      where('status','in',['approved','used'])
    ));
    // 꾸미기(frame, avatar) 제외 — 일회성 보상만 표시
    const rewards = exchSnap.docs.map(d => d.data())
      .filter(r => r.rewardCategory !== 'frame' && r.rewardCategory !== 'avatar')
      .sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));

    const ABILITY_ICONS = { '성실성':'⭐','인성':'💎','사회성':'🤝','지력':'📚','집중력':'🎯' };
    const abilityHtml = Object.entries(ABILITY_ICONS).map(([key, icon]) => {
      const val = ab[key] || 0;
      const isNeg = val < 0;
      const pct = isNeg ? Math.min(100, Math.abs(val)) : Math.min(100, Math.floor((val / 500) * 100)); // 500(신화)을 100%로 잡아 표시
      const barColor = isNeg ? '#ef4444' : 'var(--primary)';
      const { rank, color: rankColor, cls: rankCls } = getAbilityRank(val);
      return `
      <div style="margin-bottom:8px;">
        <div style="display:flex;justify-content:space-between;align-items:center;font-size:13px;margin-bottom:3px;">
          <span>${icon} ${key} <span class="${rankCls||''}" style="font-size:10px;font-weight:700;color:${rankColor};margin-left:3px;">${rank}</span></span>
          <span style="font-weight:700;color:${isNeg?'#ef4444':'inherit'}">${val}</span>
        </div>
        <div style="height:6px;background:var(--border);border-radius:3px;overflow:hidden;">
          <div style="height:100%;width:${pct}%;background:${barColor};border-radius:3px;transition:width 0.5s;"></div>
        </div>
      </div>`;
    }).join('');

    const rewardHtml = rewards.length ? rewards.slice(0,10).map(r => `
      <div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border);">
        <span style="font-size:18px;">${r.rewardEmoji||'🎁'}</span>
        <div style="flex:1;">
          <div style="font-size:13px;font-weight:600;">${r.rewardName}</div>
          <div style="font-size:11px;color:var(--text-muted);">${formatTime(r.createdAt)}</div>
        </div>
        <span style="font-size:12px;${r.status==='used'?'color:var(--text-muted);':'color:var(--warning);'}">
          ${r.status==='used' ? '✅ 사용 완료' : `🪙${r.rewardCost||r.cost||0}`}
        </span>
      </div>`).join('') :
      '<div style="color:var(--text-muted);font-size:13px;padding:8px 0;">교환한 보상이 없어요</div>';

    // 콘텐츠 완성 후 모달 표시
    document.getElementById('studentDetailTitle').textContent = `👤 ${studentName}`;
    document.getElementById('studentDetailContent').innerHTML = `
      <!-- 기본 통계 -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:18px;">
        <div style="background:var(--primary-light);border-radius:10px;padding:14px;text-align:center;">
          <div style="font-size:11px;color:var(--primary);font-weight:600;margin-bottom:4px;">누적 포인트</div>
          <div style="font-size:20px;font-weight:800;color:var(--primary);">🪙 ${accum.toLocaleString()}</div>
        </div>
        <div style="background:#fef9c3;border-radius:10px;padding:14px;text-align:center;">
          <div style="font-size:11px;color:#a16207;font-weight:600;margin-bottom:4px;">보유 골드</div>
          <div style="font-size:20px;font-weight:800;color:#a16207;">🪙 ${gold.toLocaleString()}</div>
        </div>
        <div style="background:#dcfce7;border-radius:10px;padding:14px;text-align:center;">
          <div style="font-size:11px;color:#15803d;font-weight:600;margin-bottom:4px;">칭찬 카드</div>
          <div style="font-size:20px;font-weight:800;color:#15803d;">💓 ${praiseCount}개</div>
        </div>
        <div style="background:#fff7ed;border-radius:10px;padding:14px;text-align:center;">
          <div style="font-size:11px;color:#c2410c;font-weight:600;margin-bottom:4px;">벌점 카드</div>
          <div style="font-size:20px;font-weight:800;color:#c2410c;">⚠️ ${penaltyCount}개</div>
        </div>
      </div>

      <!-- 능력치 -->
      <div style="font-size:14px;font-weight:700;margin-bottom:10px;">⚡ 능력치</div>
      <div style="background:var(--bg);border-radius:10px;padding:12px;margin-bottom:10px;">
        ${abilityHtml}
      </div>
      <div style="font-size:14px;font-weight:700;margin-bottom:10px;">📊 능력치 그래프</div>
      <canvas id="teacherStudentRadarChart" style="width:100%;max-height:220px;margin-bottom:18px;"></canvas>

      <!-- 최근 카드 내역 -->
      <div style="font-size:14px;font-weight:700;margin-bottom:10px;margin-top:18px;">🃏 최근 카드 내역 (최근 10개)</div>
      <div style="background:var(--bg);border-radius:10px;padding:12px;margin-bottom:18px;">
        ${recentCards.length ? recentCards.map(c => {
          const cType = c.cardType || c.type || 'praise';
          const cPoint = c.cardPoint || c.cost || c.point || 0;
          const isP = cType === 'praise';
          return `
          <div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border);">
            <span style="font-size:16px;">${c.cardEmoji||''}</span>
            <div style="flex:1;">
              <div style="font-size:13px;font-weight:600;color:${isP?'#15803d':'#dc2626'};">
                ${isP?'💓':'⚠️'} ${c.cardTitle}
              </div>
              ${c.memo ? `<div style="font-size:11px;color:var(--text-muted);">${c.memo}</div>` : ''}
            </div>
            <span style="font-size:12px;font-weight:700;color:${isP?'#15803d':'#dc2626'};">
              ${isP?'+':'-'}${cPoint}🪙
            </span>
          </div>`;
        }).join('') :
          '<div style="color:var(--text-muted);font-size:13px;padding:8px 0;">카드 내역이 없어요</div>'}
      </div>

      <!-- 최근 포인트 내역 -->
      <div style="font-size:14px;font-weight:700;margin-bottom:10px;margin-top:18px;">📋 최근 포인트 내역 (최근 10개)</div>
      <div style="background:var(--bg);border-radius:10px;padding:12px;margin-bottom:18px;">
        ${recentHistory.length ? recentHistory.map(h => {
          const isPlus = h.type === 'plus';
          const isRankUp = h.reason?.includes('랭크') || h.reason?.includes('등급');
          return `
          <div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border);">
            <span style="font-size:15px;">${isRankUp ? '⚡' : isPlus ? '💓' : '⚠️'}</span>
            <div style="flex:1;">
              <div style="font-size:13px;font-weight:600;">${h.reason||'-'}</div>
              <div style="font-size:11px;color:var(--text-muted);">${formatTime(h.createdAt)}</div>
            </div>
            <span style="font-size:13px;font-weight:700;color:${isPlus?'#15803d':'#dc2626'};">
              ${isPlus?'+':'-'}${Math.abs(h.delta||0)}🪙
            </span>
          </div>`;
        }).join('') : '<div style="color:var(--text-muted);font-size:13px;padding:8px 0;">내역이 없어요</div>'}
      </div>

      <!-- 프로필 메시지 변경 이력 -->
      <div style="font-size:14px;font-weight:700;margin-bottom:10px;margin-top:18px;">✏️ 프로필 메시지 변경 이력 (최근 10개)</div>
      <div style="background:var(--bg);border-radius:10px;padding:12px;margin-bottom:18px;">
        ${msgLogs.length ? msgLogs.map(l => {
          const d = l.changedAt?.toDate();
          const dateStr = d ? `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}` : '';
          const isDel = l.message === '(삭제)';
          return `<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border);">
            <span style="font-size:15px;">${isDel ? '🗑️' : '💬'}</span>
            <div style="flex:1;">
              <div style="font-size:13px;font-weight:600;color:${isDel?'var(--text-muted)':'var(--text-primary)'};">${l.message}</div>
              <div style="font-size:11px;color:var(--text-muted);">${dateStr}</div>
            </div>
          </div>`;
        }).join('') : '<div style="color:var(--text-muted);font-size:13px;padding:8px 0;">변경 이력이 없어요</div>'}
      </div>

      <!-- 교환 완료 보상 -->
      <div style="font-size:14px;font-weight:700;margin-bottom:10px;">🎁 교환 완료 보상 ${rewards.length ? `(${rewards.length}개)` : ''}</div>
      <div style="background:var(--bg);border-radius:10px;padding:12px;">
        ${rewardHtml}
      </div>`;

    // 디졸브 효과로 모달 표시
    const overlay = document.getElementById('studentDetailModal');
    overlay.style.opacity = '0';
    overlay.classList.remove('hidden');
    requestAnimationFrame(() => {
      overlay.style.transition = 'opacity 0.35s ease';
      overlay.style.opacity = '1';
    });

    // 교사 모달 레이더 차트
    await loadChartJs();
    if (window.Chart) {
      const abKeys = ['성실성','인성','사회성','지력','집중력'];
      const abVals = abKeys.map(k => ab[k] || 0);
      const maxVal = Math.max(...abVals, 1);
      const radarMax = Math.ceil(maxVal / 20) * 20 + 20;
      const canvas = document.getElementById('teacherStudentRadarChart');
      if (canvas) {
        new Chart(canvas, {
          type:'radar',
          data:{ labels:abKeys, datasets:[{
            data:abVals, backgroundColor:'rgba(99,102,241,0.15)',
            borderColor:'#6366f1', borderWidth:2, pointBackgroundColor:'#6366f1', pointRadius:3
          }]},
          options:{ animation:{duration:600}, scales:{ r:{
            min:0, max:radarMax, ticks:{display:false}, grid:{color:'rgba(0,0,0,0.08)'},
            pointLabels:{font:{size:12,weight:'600'}}
          }}, plugins:{legend:{display:false}} }
        });
      }
    }
  } catch(e) {
    document.getElementById('studentDetailContent').innerHTML =
      `<div style="text-align:center;padding:20px;color:#ef4444;">불러오기 실패: ${e.message}</div>`;
    openModal('studentDetailModal');
  }
};
