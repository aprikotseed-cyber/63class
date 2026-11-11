// dashboard.js — 교사 대시보드
import { state } from './state.js?v=20261111a';

// ===== 대시보드 =====
export function renderDashboard() {
  const totalPts = state.students.reduce((s,st) => s + (st.points||0), 0);
  const pending = state.exchanges.filter(e => e.status === 'pending').length;
  const unread = state.messages.filter(m => !m.readByTeacher && m.senderRole === 'student').length;
  document.getElementById('dashStats').innerHTML = `
    <div class="stat-card"><div class="stat-icon" style="background:#EEF2FF;">👥</div><div class="stat-label">전체 학생</div><div class="stat-value">${state.students.length}명</div></div>
    <div class="stat-card"><div class="stat-icon" style="background:#FFFBEB;">🪙</div><div class="stat-label">총 포인트 합계</div><div class="stat-value">${totalPts.toLocaleString()}</div></div>
    <div class="stat-card"><div class="stat-icon" style="background:#FFF0F0;">🔄</div><div class="stat-label">교환 대기</div><div class="stat-value">${pending}건</div></div>
    <div class="stat-card"><div class="stat-icon" style="background:#F0FDF4;">💌</div><div class="stat-label">안 읽은 쪽지</div><div class="stat-value">${unread}개</div></div>
  `;
  // 리더보드 - 누적 포인트 기준, 공동순위 반영
  const sorted = [...state.students].sort((a,b) => {
    const pd = (b.accumulatedPoints??b.points??0) - (a.accumulatedPoints??a.points??0);
    if (pd !== 0) return pd;
    return (a.number||999) - (b.number||999);
  }).slice(0, 8);
  const lbRanks = [];
  let lbCurRank = 1;
  for (let i = 0; i < sorted.length; i++) {
    const cur = sorted[i].accumulatedPoints??sorted[i].points??0;
    if (i > 0 && cur < (sorted[i-1].accumulatedPoints??sorted[i-1].points??0)) lbCurRank = i + 1;
    lbRanks.push(lbCurRank);
  }
  const lbRankCount = {};
  lbRanks.forEach(r => { lbRankCount[r] = (lbRankCount[r]||0) + 1; });
  document.getElementById('leaderboard').innerHTML = sorted.length ? sorted.map((s,i) => {
    const rank = lbRanks[i];
    const tied = lbRankCount[rank] > 1;
    const medal2 = rank===1?'🥇':rank===2?'🥈':rank===3?'🥉':null;
    const rankLabel = medal2 ? medal2 : (tied ? `공동${rank}위` : `${rank}위`);
    const rankClass = rank <= 3 && !tied ? `rank-${rank}` : 'rank-n';
    const accum = s.accumulatedPoints??s.points??0;
    return `
    <div class="leaderboard-row">
      <div class="rank ${rankClass}">${rankLabel}</div>
      <div class="lb-name">${s.name}</div>
      <div class="lb-points">🪙 ${accum.toLocaleString()}</div>
    </div>`;
  }).join('') : '<div class="empty-state" style="padding:20px"><p>학생 데이터가 없어요</p></div>';
  // 최근 교환
  const rec = state.exchanges.filter(e => e.status === 'pending').slice(0,5);
  document.getElementById('recentExchanges').innerHTML = rec.length ? rec.map(e => `
    <div class="leaderboard-row">
      <div class="lb-name">${e.studentName}</div>
      <div style="font-size:13px;color:var(--text-secondary)">${e.rewardName}</div>
      <span class="badge badge-warning">대기</span>
    </div>
  `).join('') : '<div class="empty-state" style="padding:20px"><p>교환 신청이 없어요</p></div>';
}
