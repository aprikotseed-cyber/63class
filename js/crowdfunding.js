// crowdfunding.js — 크라우드펀딩
import { state } from './state.js?v=20261111c';
import {
  addDoc, collection, db, deleteDoc, doc, getDoc, getDocFromServer, getDocs, increment, orderBy,
  query, serverTimestamp, updateDoc, where
} from './firebase.js?v=20261111c';
import { closeModal, openModal, showToast } from './core.js?v=20261111c';
import { reloadStudents } from './realtime.js?v=20261111c';

// ===== 💰 크라우드펀딩 =====
let _cfEditingId = null;
let _cfInvestingId = null;
let _cfTimers = {};

export async function renderCrowdfunding() {
  const wrap = document.getElementById('crowdfundingList');
  if (!wrap) return;
  clearCfTimers();
  const isTeacher = state.currentUser?.role === 'teacher';
  let snap;
  try {
    snap = await getDocs(query(collection(db, 'crowdfunding'), orderBy('createdAt', 'desc')));
  } catch(e) { snap = await getDocs(collection(db, 'crowdfunding')); }
  if (!snap.docs.length) {
    wrap.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:30px;color:var(--text-muted);font-size:13px;">${isTeacher ? '💰 펀딩 추가 버튼으로 첫 크라우드펀딩을 만들어보세요!' : '진행 중인 펀딩이 없어요'}</div>`;
    return;
  }
  wrap.innerHTML = snap.docs.map(d => {
    const cf = { id: d.id, ...d.data() };
    const total = cf.totalAmount || 0;
    const goal = cf.goalAmount || 1;
    const pct = Math.min(100, Math.round(total / goal * 100));
    const isAchieved = cf.status === 'achieved';
    const isClosed = cf.status === 'closed';
    const statusLabel = isAchieved
      ? '<span style="background:#dcfce7;color:#16a34a;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700;">✅ 달성 완료</span>'
      : isClosed
      ? '<span style="background:#f3f4f6;color:#6b7280;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700;">🔒 마감</span>'
      : '<span style="background:#dbeafe;color:#2563eb;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700;">🔥 진행 중</span>';
    const deadlineHtml = (cf.deadline && cf.status === 'active')
      ? `<div class="cf-deadline" id="cfTimer-${cf.id}">⏱ 계산 중...</div>` : '';
    const teacherBtns = isTeacher ? `
      <div style="display:flex;gap:6px;">
        ${!isAchieved && !isClosed ? `<button onclick="cfSetStatus('${cf.id}','achieved')" class="btn btn-sm" style="background:#d1fae5;color:#065f46;border:1px solid #6ee7b7;">달성</button>` : ''}
        ${!isClosed ? `<button onclick="cfClose('${cf.id}')" class="btn btn-sm" style="background:#fef2f2;color:#b91c1c;border:1px solid #fca5a5;">마감</button>` : ''}
        <button onclick="openEditCfModal('${cf.id}')" class="btn btn-secondary btn-sm">수정</button>
        <button onclick="cfDelete('${cf.id}')" class="btn btn-danger btn-sm">삭제</button>
      </div>` : '';
    const investBtn = !isTeacher && !isClosed
      ? `<button onclick="openCfInvestModal('${cf.id}')" class="btn btn-primary btn-sm" style="${isAchieved?'background:#6b7280;cursor:default;':''}" ${isAchieved?'disabled':''}>
          ${isAchieved ? '✅ 달성됨' : '💰 투자하기'}
        </button>` : '';
    return `<div class="cf-card ${isAchieved?'cf-achieved':''} ${isClosed?'cf-closed':''}" style="min-height:140px;">
      ${deadlineHtml}
      <div style="display:flex;align-items:flex-start;gap:12px;">
        <div style="font-size:36px;line-height:1;">${cf.emoji||'💰'}</div>
        <div style="flex:1;min-width:0;">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px;">
            <div style="font-size:15px;font-weight:800;">${cf.name}</div>${statusLabel}
          </div>
          ${cf.description?`<div style="font-size:12px;color:var(--text-muted);margin-bottom:6px;">${cf.description}</div>`:''}
          <div style="font-size:12px;color:var(--text-secondary);">목표 <strong>🪙${goal.toLocaleString()}</strong> · 최소 투자 <strong>🪙${(cf.minAmount||100).toLocaleString()}</strong></div>
          <div class="cf-progress-bar"><div class="cf-progress-fill ${isAchieved?'achieved':''}" style="width:${pct}%;"></div></div>
          <div style="display:flex;justify-content:space-between;font-size:12px;font-weight:700;">
            <span style="color:${isAchieved?'#16a34a':'var(--primary)'};">🪙${total.toLocaleString()} 모금</span>
            <span style="color:${pct>=100?'#16a34a':'var(--text-secondary)'};">${pct}%</span>
          </div>
          <div style="margin-top:8px;display:flex;flex-direction:column;gap:6px;">
            <div>
              <button onclick="openCfDetail('${cf.id}')" class="btn btn-secondary btn-sm">📋 투자 내역</button>
              ${investBtn}
            </div>
            ${teacherBtns}
          </div>
        </div>
      </div>
    </div>`;
  }).join('');
  snap.docs.forEach(d => {
    const cf = { id: d.id, ...d.data() };
    if (cf.deadline && cf.status === 'active') startCfTimer(cf.id, cf.deadline);
  });
}

function clearCfTimers() { Object.values(_cfTimers).forEach(t=>clearInterval(t)); _cfTimers={}; }

function startCfTimer(cfId, deadline) {
  const getEl = () => document.getElementById('cfTimer-'+cfId);
  function tick() {
    const el = getEl(); if (!el) { clearInterval(_cfTimers[cfId]); return; }
    const now = new Date();
    const end = deadline?.toDate ? deadline.toDate() : new Date(deadline);
    const diff = end - now;
    if (diff <= 0) { el.textContent = '⏱ 기한 만료'; clearInterval(_cfTimers[cfId]); return; }
    const days = Math.floor(diff/86400000);
    const h = Math.floor((diff%86400000)/3600000);
    const m = Math.floor((diff%3600000)/60000);
    const s = Math.floor((diff%60000)/1000);
    el.textContent = `⏱ ${days>0?days+'일 ':''}${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  }
  tick(); _cfTimers[cfId] = setInterval(tick, 1000);
}

window.openAddCrowdfundingModal = function() {
  _cfEditingId = null;
  document.getElementById('crowdfundingModalTitle').textContent = '💰 펀딩 추가';
  ['cfName','cfDesc','cfEmoji','cfDeadline'].forEach(id => { const el=document.getElementById(id); if(el) el.value=''; });
  document.getElementById('cfGoal').value = '';
  document.getElementById('cfMinAmount').value = '100';
  openModal('crowdfundingModal');
};

window.openEditCfModal = async function(cfId) {
  _cfEditingId = cfId;
  document.getElementById('crowdfundingModalTitle').textContent = '💰 펀딩 수정';
  const d = await getDoc(doc(db,'crowdfunding',cfId));
  if (!d.exists()) return;
  const cf = d.data();
  document.getElementById('cfName').value = cf.name||'';
  document.getElementById('cfDesc').value = cf.description||'';
  document.getElementById('cfEmoji').value = cf.emoji||'';
  document.getElementById('cfGoal').value = cf.goalAmount||'';
  document.getElementById('cfMinAmount').value = cf.minAmount||100;
  if (cf.deadline) {
    const dt = cf.deadline?.toDate ? cf.deadline.toDate() : new Date(cf.deadline);
    document.getElementById('cfDeadline').value = dt.toISOString().slice(0,16);
  } else { document.getElementById('cfDeadline').value = ''; }
  openModal('crowdfundingModal');
};

window.saveCrowdfunding = async function() {
  const name = document.getElementById('cfName').value.trim();
  const goal = parseInt(document.getElementById('cfGoal').value);
  const minAmount = parseInt(document.getElementById('cfMinAmount').value)||100;
  const desc = document.getElementById('cfDesc').value.trim();
  const emoji = document.getElementById('cfEmoji').value.trim()||'💰';
  const deadlineStr = document.getElementById('cfDeadline').value;
  if (!name) return showToast('펀딩 이름을 입력하세요');
  if (!goal||goal<1) return showToast('목표 금액을 입력하세요');
  const data = { name, goalAmount:goal, minAmount, description:desc, emoji,
    deadline: deadlineStr ? new Date(deadlineStr) : null, updatedAt:serverTimestamp() };
  if (_cfEditingId) {
    await updateDoc(doc(db,'crowdfunding',_cfEditingId), data);
    showToast('수정됐어요 ✅');
  } else {
    data.status='active'; data.totalAmount=0; data.createdAt=serverTimestamp();
    await addDoc(collection(db,'crowdfunding'), data);
    showToast('펀딩이 추가됐어요 ✅');
  }
  closeModal('crowdfundingModal');
  renderCrowdfunding();
};

window.openCfInvestModal = async function(cfId) {
  _cfInvestingId = cfId;
  const d = await getDocFromServer(doc(db,'crowdfunding',cfId));
  if (!d.exists()) return;
  const cf = d.data();
  if (cf.status !== 'active') return showToast('진행 중인 펀딩이 아니에요');
  const me = state.students.find(s=>s.id===state.currentUser.uid)||{};
  const remaining = cf.goalAmount - (cf.totalAmount||0);
  document.getElementById('cfInvestTitle').textContent = `${cf.emoji||'💰'} ${cf.name}`;
  document.getElementById('cfInvestSubtitle').textContent = cf.description||'';
  document.getElementById('cfInvestMin').textContent = (cf.minAmount||100).toLocaleString();
  document.getElementById('cfInvestMyPts').textContent = (me.points||0).toLocaleString();
  const defaultAmount = Math.min(cf.minAmount||100, remaining);
  document.getElementById('cfInvestAmount').value = defaultAmount;
  document.getElementById('cfInvestAmount').min = cf.minAmount||1;
  document.getElementById('cfInvestAmount').max = remaining;
  // 잔여 금액 안내
  const label = document.getElementById('cfInvestLabel');
  if (label) label.textContent = `투자 금액 🪙 (달성까지 🪙${remaining.toLocaleString()} 남음)`;
  openModal('cfInvestModal');
};

window.submitCfInvest = async function() {
  const cfId = _cfInvestingId;
  const inputAmount = parseInt(document.getElementById('cfInvestAmount').value);
  if (!cfId||!inputAmount||inputAmount<1) return showToast('금액을 입력하세요');

  // 최신 Firestore 상태 확인
  const cfDoc = await getDocFromServer(doc(db,'crowdfunding',cfId));
  if (!cfDoc.exists()) return showToast('펀딩을 찾을 수 없어요');
  const cf = cfDoc.data();

  // 달성/마감 상태이면 차단
  if (cf.status !== 'active') return showToast('이미 달성 또는 마감된 펀딩이에요 🔒');

  // 잔여 금액 계산 - 초과 시 자동 조정
  const remaining = cf.goalAmount - (cf.totalAmount||0);
  if (remaining <= 0) {
    await updateDoc(doc(db,'crowdfunding',cfId), { status:'achieved', achievedAt:serverTimestamp() });
    renderCrowdfunding();
    return showToast('이미 목표 금액이 달성됐어요 🎉');
  }

  // 투자 금액이 잔여보다 크면 잔여 금액으로 자동 조정
  let amount = inputAmount;
  let adjusted = false;
  if (amount > remaining) {
    amount = remaining;
    adjusted = true;
  }

  if (amount < (cf.minAmount||1)) return showToast(`최소 투자 금액은 🪙${cf.minAmount}이에요`);
  const me = state.students.find(s=>s.id===state.currentUser.uid)||{};
  if ((me.points||0) < amount) return showToast(`포인트가 부족해요 (필요: 🪙${amount.toLocaleString()})`);

  const confirmMsg = adjusted
    ? `목표까지 🪙${remaining.toLocaleString()} 남았어요.\n🪙${amount.toLocaleString()}만 투자할까요? (자동 조정됨)`
    : `🪙${amount.toLocaleString()}을 투자할까요?`;
  if (!confirm(confirmMsg)) return;

  try {
    await updateDoc(doc(db,'students',state.currentUser.uid), { points: increment(-amount) });
    await addDoc(collection(db,'crowdfundingLogs'), {
      cfId, studentId:state.currentUser.uid, studentName:state.currentUser.name,
      studentNumber: me.number||'', amount, createdAt:serverTimestamp()
    });
    const newTotal = (cf.totalAmount||0) + amount;
    const update = { totalAmount: increment(amount) };
    // 달성 확인
    if (newTotal >= cf.goalAmount) {
      update.status = 'achieved';
      update.achievedAt = serverTimestamp();
    }
    await updateDoc(doc(db,'crowdfunding',cfId), update);
    closeModal('cfInvestModal');
    await reloadStudents();
    renderCrowdfunding();
    if (update.status === 'achieved') {
      showToast(`🎉 목표 달성! 🪙${amount.toLocaleString()} 투자 완료!`);
    } else {
      showToast(`🪙${amount.toLocaleString()} 투자 완료!`);
    }
  } catch(e) { showToast('오류: '+e.message); }
};

window.openCfDetail = async function(cfId) {
  const [cfDoc, logsSnap] = await Promise.all([
    getDoc(doc(db,'crowdfunding',cfId)),
    getDocs(query(collection(db,'crowdfundingLogs'), where('cfId','==',cfId)))
  ]);
  if (!cfDoc.exists()) return;
  const cf = cfDoc.data();
  const logs = logsSnap.docs.map(d=>d.data())
    .sort((a,b) => (b.createdAt?.seconds||0) - (a.createdAt?.seconds||0));
  const total = cf.totalAmount||0; const goal = cf.goalAmount||1;
  const byStudent = {};
  logs.forEach(l => {
    if (!byStudent[l.studentId]) byStudent[l.studentId]={name:l.studentName,number:l.studentNumber||'',total:0,count:0};
    byStudent[l.studentId].total += l.amount;
    byStudent[l.studentId].count += 1;
  });
  const sorted = Object.entries(byStudent).sort((a,b)=>b[1].total-a[1].total);
  document.getElementById('cfDetailTitle').textContent = `${cf.emoji||'💰'} ${cf.name} — 투자 내역`;
  document.getElementById('cfDetailSubtitle').textContent = `총 🪙${total.toLocaleString()} / 목표 🪙${goal.toLocaleString()} (${Math.min(100,Math.round(total/goal*100))}%)`;

  // 미투자 학생 목록
  const investedIds = new Set(Object.keys(byStudent));
  const notInvested = state.students.filter(s => !s.hidden && !investedIds.has(s.id))
    .sort((a,b) => (a.number||0) - (b.number||0));

  document.getElementById('cfDetailContent').innerHTML = sorted.length ? `
    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      <thead><tr style="background:var(--bg);">
        <th style="padding:8px;text-align:left;border-bottom:1px solid var(--border);">학생</th>
        <th style="padding:8px;text-align:right;border-bottom:1px solid var(--border);">횟수</th>
        <th style="padding:8px;text-align:right;border-bottom:1px solid var(--border);">합계 🪙</th>
        <th style="padding:8px;text-align:right;border-bottom:1px solid var(--border);">비중</th>
      </tr></thead>
      <tbody>${sorted.map(([,s])=>{
        const pct=total>0?Math.round(s.total/total*100):0;
        return `<tr style="border-bottom:1px solid var(--border);">
          <td style="padding:8px;">${s.number?s.number+'번 ':''}${s.name}</td>
          <td style="padding:8px;text-align:right;color:var(--text-muted);">${s.count}회</td>
          <td style="padding:8px;text-align:right;font-weight:700;">🪙${s.total.toLocaleString()}</td>
          <td style="padding:8px;text-align:right;">
            <div style="display:flex;align-items:center;gap:6px;justify-content:flex-end;">
              <div style="width:60px;height:6px;background:var(--border);border-radius:3px;overflow:hidden;">
                <div style="width:${pct}%;height:100%;background:#6366f1;border-radius:3px;"></div>
              </div>
              <span style="font-size:12px;color:var(--text-secondary);">${pct}%</span>
            </div>
          </td>
        </tr>`;
      }).join('')}</tbody>
    </table>
    <div style="margin-top:12px;font-size:12px;color:var(--text-muted);">참여 학생 ${sorted.length}명 · 총 ${logs.length}회 투자</div>`
  : '<div style="text-align:center;padding:20px;color:var(--text-muted);">아직 투자한 학생이 없어요</div>';

  // 미투자 학생 명단
  if (notInvested.length) {
    document.getElementById('cfDetailContent').innerHTML += `
    <div style="margin-top:20px;padding:14px;background:#fef2f2;border-radius:10px;border:1px solid #fca5a5;">
      <div style="font-size:13px;font-weight:700;color:#b91c1c;margin-bottom:8px;">🙈 미투자 학생 (${notInvested.length}명)</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;">
        ${notInvested.map(s=>`<span style="background:#fff;border:1px solid #fca5a5;color:#b91c1c;border-radius:20px;padding:2px 10px;font-size:12px;font-weight:600;">${s.number||''}번 ${s.name}</span>`).join('')}
      </div>
    </div>`
  }
  openModal('cfDetailModal');
};

window.cfSetStatus = async function(cfId, status) {
  if (status==='closed') {
    if (!confirm('펀딩을 마감하고 투자 포인트를 전액 환불할까요?\n이 작업은 되돌릴 수 없어요.')) return;
    try {
      const logs = await getDocs(query(collection(db,'crowdfundingLogs'),where('cfId','==',cfId)));
      const refundMap = {};
      logs.docs.forEach(d=>{ const l=d.data(); refundMap[l.studentId]=(refundMap[l.studentId]||0)+l.amount; });
      for (const [sid,amt] of Object.entries(refundMap)) {
        await updateDoc(doc(db,'students',sid),{points:increment(amt)});
        await addDoc(collection(db,'history'),{
          studentId:sid, studentName:state.students.find(s=>s.id===sid)?.name||'',
          delta:amt, reason:'크라우드펀딩 마감 환불', type:'plus', source:'cfRefund', createdAt:serverTimestamp()
        });
      }
      await updateDoc(doc(db,'crowdfunding',cfId),{status:'closed',closedAt:serverTimestamp()});
      await reloadStudents();
      showToast(`마감 완료! ${Object.keys(refundMap).length}명에게 환불됐어요 ✅`);
    } catch(e) { showToast('오류: '+e.message); return; }
  } else if (status==='achieved') {
    await updateDoc(doc(db,'crowdfunding',cfId),{status:'achieved',achievedAt:serverTimestamp()});
    showToast('달성 완료 처리됐어요 🎉');
  }
  renderCrowdfunding();
};

window.cfClose = function(cfId) { cfSetStatus(cfId,'closed'); };

window.cfDelete = async function(cfId) {
  if (!confirm('이 펀딩을 삭제할까요? 투자 내역도 모두 삭제돼요.')) return;
  const logs = await getDocs(query(collection(db,'crowdfundingLogs'),where('cfId','==',cfId)));
  await Promise.all([...logs.docs.map(d=>deleteDoc(doc(db,'crowdfundingLogs',d.id))), deleteDoc(doc(db,'crowdfunding',cfId))]);
  renderCrowdfunding(); showToast('삭제됐어요');
};
