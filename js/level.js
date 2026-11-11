// level.js — 레벨·랭크 계산, 랭크업 체크
import {
  addDoc, collection, db, doc, increment, serverTimestamp, updateDoc
} from './firebase.js?v=20261111c';
import { RANK_NAMES, getRankIdx } from './core.js?v=20261111c';

// ===== 레벨 시스템 =====
export function calcLevel(accum) {
  // 구간별 레벨당 필요 포인트
  // Lv.1~10: 300pt, Lv.11~20: 600pt, Lv.21~30: 900pt, Lv.31~40: 1200pt, Lv.41+: 1500pt
  const thresholds = [
    { maxLv: 10, perLv: 300,  base: 0 },
    { maxLv: 20, perLv: 600,  base: 3000 },
    { maxLv: 30, perLv: 900,  base: 9000 },
    { maxLv: 40, perLv: 1200, base: 18000 },
    { maxLv: Infinity, perLv: 1500, base: 30000 },
  ];
  let pts = Math.max(0, accum);
  let lv = 0;
  for (const t of thresholds) {
    const maxPts = t.maxLv === Infinity ? Infinity : (t.maxLv - lv) * t.perLv;
    if (pts < maxPts || t.maxLv === Infinity) {
      lv += Math.floor(pts / t.perLv);
    return lv + 1;
    }
    pts -= maxPts;
    lv = t.maxLv;
  }
  return lv;
}

export function formatLoginTime(ts) {
  if (!ts) return '-';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  const yy = String(d.getFullYear()).slice(2);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  let hours = d.getHours();
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  const hh = String(hours).padStart(2, '0');
  return `${yy}-${mm}-${dd}, ${hh}:${minutes} ${ampm}`;
}

export function formatTime(ts) {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  const now = new Date();
  const diff = now - d;
  if (diff < 60000) return '방금 전';
  if (diff < 3600000) return Math.floor(diff/60000) + '분 전';
  if (diff < 86400000) return Math.floor(diff/3600000) + '시간 전';
  // 24시간 이상: 월/일, hh:mm AM/PM
  const month = d.getMonth() + 1;
  const day = d.getDate();
  let hours = d.getHours();
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  return `${month}/${day}, ${hours}:${minutes} ${ampm}`;
}

export function nameToEmail(name) { return encodeURIComponent(name) + '@ourclass.kr'; }
// 4자리 비밀번호도 허용: Firebase 최소 6자 제한 우회
export function makePw(pw) { return pw.length < 6 ? pw + '!!' : pw; }

// ===== 능력치 랭크 계산 (전역) =====
export function getAbilityRank(val) {
  if (val >= 500) return { rank:'신화', color:'#d97706', cls:'rank-myth' };
  if (val >= 140) return { rank:'LEGEND', color:'#a855f7' };
  if (val >= 120) return { rank:'SSS',    color:'#f59e0b' };
  if (val >= 100) return { rank:'SS',     color:'#d946ef' };
  if (val >= 80)  return { rank:'S',      color:'#a855f7' };
  if (val >= 60)  return { rank:'A',      color:'#f97316' };
  if (val >= 40)  return { rank:'B',      color:'#3b82f6' };
  if (val >= 20)  return { rank:'C',      color:'#22c55e' };
  return                  { rank:'D',     color:'#94a3b8' };
}

// ===== 공통 랭크업 체크 함수 =====
// 능력치가 올라갈 때 랭크업 여부 확인 후 보상 지급
// prevAbilities: 이전 능력치, abUpdate: {능력치명: 증가량}, rankGranted: abilityRankGranted
export async function checkAndGrantRankUp(studentId, prevAbilities, abUpdate, rankGranted) {
  let rankBonus = 0;
  const rankGrantedUpdate = {};
  const rankUpNames = [];
  for (const [k, v] of Object.entries(abUpdate)) {
    if (v <= 0) continue; // 차감은 스킵
    const prev = prevAbilities[k] || 0;
    const next = prev + v;
    const prevRankIdx = getRankIdx(prev);
    const nextRankIdx = getRankIdx(next);
    const grantedSoFar = rankGranted[k] !== undefined ? rankGranted[k] : 0;
    const fromRank = Math.max(prevRankIdx, grantedSoFar);
    if (nextRankIdx > fromRank) {
      rankBonus += 500 * (nextRankIdx - fromRank);
      rankGrantedUpdate[`abilityRankGranted.${k}`] = nextRankIdx;
      rankUpNames.push(`${k} ${RANK_NAMES[nextRankIdx]}`);
    }
  }
  if (rankBonus > 0) {
    await updateDoc(doc(db, 'students', studentId), {
      points: increment(rankBonus),
      accumulatedPoints: increment(rankBonus),
      ...rankGrantedUpdate
    });
    await addDoc(collection(db, 'notifications'), {
      studentId, type: 'rankUp',
      rankUpDetails: rankUpNames.map(n => ({ rank: n })),
      bonus: rankBonus, createdAt: serverTimestamp(), read: false
    });
  }
  return { rankBonus, rankUpNames };
}
