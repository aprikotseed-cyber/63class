// exchanges.js — 보상 교환 신청 관리
import { state } from './state.js?v=20261111a';
import {
  addDoc, collection, db, deleteDoc, doc, getDoc, increment, serverTimestamp, setDoc, updateDoc
} from './firebase.js?v=20261111a';
import { showToast } from './core.js?v=20261111a';
import { formatTime } from './level.js?v=20261111a';
import { reloadStudents } from './realtime.js?v=20261111a';
import { renderDashboard } from './dashboard.js?v=20261111a';
import { renderStudentHome } from './home.js?v=20261111a';

// ===== 교환 신청 관리 =====
export function renderExchanges() {
  let filtered = state.exchanges.filter(e => e.status === state.currentExchangeFilter);
  // 승인됨/거절됨은 최근 10개만
  if (state.currentExchangeFilter !== 'pending') {
    filtered = filtered.slice(0, 10);
  }
  const tbody = document.getElementById('exchangeBody');
  tbody.innerHTML = filtered.map(e => `
    <tr>
      <td><strong>${e.studentName}</strong></td>
      <td>${e.rewardEmoji||'🎁'} ${e.rewardName}</td>
      <td><span style="font-size:11px;padding:2px 8px;border-radius:6px;font-weight:600;${
        e.rewardCategory==='frame'||e.type==='frame' ? 'background:#ede9fe;color:#6d28d9;' :
        e.rewardCategory==='avatar'||e.type==='avatar' ? 'background:#fce7f3;color:#be185d;' :
        e.rewardCategory==='snack'||e.type==='snack' ? 'background:#fef9c3;color:#a16207;' :
        e.type==='pet' ? 'background:#d1fae5;color:#065f46;' :
        'background:#dbeafe;color:#1d4ed8;'
      }">${
        e.rewardCategory==='frame'||e.type==='frame' ? '🖼️ 꾸미기' :
        e.rewardCategory==='avatar'||e.type==='avatar' ? '🧑 아바타' :
        e.rewardCategory==='snack'||e.type==='snack' ? '🍬 간식' :
        e.type==='pet' ? '🐾 펫' : '📚 학습'
      }</span></td>
      <td>🪙 ${e.rewardCost||e.cost||0}</td>
      <td style="color:var(--text-muted);font-size:13px">${formatTime(e.createdAt)}</td>
      <td>${e.status === 'pending' ? '<span class="badge badge-warning">대기</span>' : e.status === 'approved' ? '<span class="badge badge-success">승인</span>' : '<span class="badge badge-danger">거절</span>'}</td>
      <td>${e.status === 'pending' ? `
        <div style="display:flex;gap:6px">
          <button class="btn btn-success btn-sm" onclick="processExchange('${e.id}','approved')">승인</button>
          <button class="btn btn-danger btn-sm" onclick="processExchange('${e.id}','rejected')">거절</button>
        </div>` : '-'}</td>
    </tr>
  `).join('') || `<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:30px">해당 내역이 없어요</td></tr>`;
}

window.filterExchanges = function(status, btn) {
  state.currentExchangeFilter = status;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderExchanges();
};

window.processExchange = async function(id, status) {
  const ex = state.exchanges.find(e => e.id === id);
  if (!ex) return;
  // 펫 구매 신청은 별도 처리
  if (ex.type === 'pet') {
    if (status === 'approved') {
      await approveExchange(id);
    } else {
      // 거절: 포인트 환급 후 상태 변경
      await updateDoc(doc(db, 'exchanges', id), { status: 'rejected', rejectedAt: serverTimestamp() });
      const refundAmt = parseInt(ex.cost||ex.rewardCost)||0;
      if (refundAmt > 0) {
        await updateDoc(doc(db,'students',ex.studentId), { points: increment(refundAmt) });
      }
      showToast('거절됐어요');
      await reloadStudents();
      renderExchanges();
    }
    return;
  }
  // 더블클릭 방지
  event?.target?.closest('button') && (event.target.closest('button').disabled = true);
  // 이미 처리된 건 중복 처리 방지 - Firestore에서 최신 상태 재확인
  try {
    const freshDoc = await getDoc(doc(db, 'exchanges', id));
    if (!freshDoc.exists()) return showToast('이미 처리된 신청이에요');
    const freshStatus = freshDoc.data().status;
    if (freshStatus !== 'pending') return showToast('이미 처리된 신청이에요 (' + (freshStatus === 'approved' ? '승인됨' : '거절됨') + ')');
    // pending 확인 후 즉시 상태 변경 (중복 클릭 방지)
    await updateDoc(doc(db, 'exchanges', id), { status });
    if (status === 'approved') {
      // 펫 구매 신청이면 petInventory에 저장
      if (ex.type === 'pet') {
        await setDoc(doc(db, 'petInventory', `${ex.studentId}_${ex.rewardId}`), {
          studentId: ex.studentId, petId: ex.rewardId, petName: ex.rewardName,
          obtainedAt: serverTimestamp()
        });
      }
      // 프레임 교환 신청이면 frameInventory에 저장
      if (ex.rewardCategory === 'frame' && ex.frameData) {
        window._cachedFrameInventory = null; // 캐시 무효화
      await setDoc(doc(db, 'frameInventory', `${ex.studentId}_${ex.rewardId}`), {
          studentId: ex.studentId, frameId: ex.rewardId, frameName: ex.rewardName,
          frameCss: ex.frameData.css || '', frameGrade: ex.frameData.grade || 'normal',
          frameNeonTxt: ex.frameData.neonTxt || '', imgUrl: ex.frameData.imgUrl || '',
          emojiPattern: ex.frameData.emojiPattern || null,
          boughtAt: serverTimestamp()
        });
      }
      // 아바타 구매 신청이면 avatarInventory에 저장
      if (ex.rewardCategory === 'avatar' && ex.avatarData) {
        const { category, itemId, name, ext } = ex.avatarData;
        const docId = `${ex.studentId}_${category}_${itemId}`;
        await setDoc(doc(db, 'avatarInventory', docId), {
          studentId: ex.studentId, category, itemId, name,
          ...(ext ? { ext } : {}),
          acquiredAt: serverTimestamp()
        }, { merge: true });
      }
      // 승인 내역 추가
      await addDoc(collection(db, 'history'), {
        studentId: ex.studentId, studentName: ex.studentName,
        delta: 0, reason: `${ex.rewardName} 구매 승인`, type: 'plus',
        source: 'exchange_approved', createdAt: serverTimestamp()
      });
    } else if (status === 'rejected') {
      // 거절: 포인트 환급 + 재고 복구 (rewardCost가 0이면 환급 안 함)
      const refundAmt = parseInt(ex.rewardCost||ex.cost) || 0;
      if (refundAmt > 0) {
        await updateDoc(doc(db, 'students', ex.studentId), { points: increment(refundAmt) });
      }
      if (refundAmt > 0) {
        await addDoc(collection(db, 'history'), {
          studentId: ex.studentId, studentName: ex.studentName,
          delta: refundAmt, reason: ex.rewardName, type: 'plus',
          source: 'exchange_rejected', createdAt: serverTimestamp()
        });
      }
      // 재고 복구 (stock 필드가 있는 경우만)
      if (ex.rewardId) {
        const rDoc = await getDoc(doc(db, 'rewards', ex.rewardId));
        if (rDoc.exists() && rDoc.data().stock !== null && rDoc.data().stock !== undefined) {
          await updateDoc(doc(db, 'rewards', ex.rewardId), { stock: increment(1), tagSoldOut: false });
        }
      }
    }
    showToast(status === 'approved' ? '승인됐어요 ✅' : '거절됐어요');
    await reloadStudents();
    renderExchanges();
    renderDashboard();
  } catch(e) { showToast('오류: ' + e.message); }
};

// ── 캐시 로드
export function renderStudentPendingExchanges() {
  const el = document.getElementById('studentPendingExchanges');
  if (!el || state.currentUser?.role !== 'student') return;
  const pending = state.exchanges.filter(e =>
    e.studentId === state.currentUser.uid && e.status === 'pending'
  );
  if (!pending.length) {
    if (el.style.display !== 'none') {
      el.style.transition = 'opacity 0.4s';
      el.style.opacity = '0';
      setTimeout(() => { el.style.display = 'none'; el.style.opacity = ''; }, 400);
    }
    return;
  }
  el.style.display = 'block';
  el.innerHTML = `
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-lg);padding:14px 16px;">
      <div style="font-size:14px;font-weight:700;margin-bottom:10px;color:var(--text-primary);">🔄 교환 신청 현황</div>
      <div style="display:flex;flex-direction:column;gap:6px;">
        ${pending.map(e => `
          <div style="display:flex;align-items:center;justify-content:space-between;padding:7px 10px;background:var(--bg);border-radius:8px;font-size:13px;">
            <span style="font-weight:600;">${e.rewardName || e.name || '교환 신청'}</span>
            <div style="display:flex;align-items:center;gap:8px;white-space:nowrap;">
              <span style="font-size:11px;color:#f59e0b;font-weight:600;">⏳ 승인 대기 중</span>
              <button onclick="cancelExchange('${e.id}')" style="font-size:11px;padding:3px 8px;border-radius:6px;border:1px solid #ef4444;background:transparent;color:#ef4444;cursor:pointer;font-weight:600;font-family:inherit;">교환 취소</button>
            </div>
          </div>
        `).join('')}
      </div>
    </div>`;
  // fadeIn
  el.style.opacity = '0';
  el.style.transition = 'opacity 0.4s';
  requestAnimationFrame(() => requestAnimationFrame(() => { el.style.opacity = '1'; }));
}

window.cancelExchange = async function(id) {
  if (!confirm('교환 신청을 취소할까요?\n지불한 골드가 다시 돌아옵니다.')) return;
  const ex = state.exchanges.find(e => e.id === id);
  if (!ex) return showToast('신청 내역을 찾을 수 없어요');
  try {
    // Firestore에서 최신 상태 재확인 (이미 처리된 건지 체크)
    const freshDoc = await getDoc(doc(db, 'exchanges', id));
    if (!freshDoc.exists()) return showToast('이미 처리된 신청이에요');
    if (freshDoc.data().status !== 'pending') return showToast('이미 처리된 신청이에요');
    // 골드 환급 (rewardCost 또는 cost 폴백)
    const refundAmt = parseInt(ex.rewardCost||ex.cost) || 0;
    if (refundAmt > 0) {
      await updateDoc(doc(db, 'students', ex.studentId), { points: increment(refundAmt) });
      await addDoc(collection(db, 'history'), {
        studentId: ex.studentId, studentName: ex.studentName,
        delta: refundAmt, reason: `${ex.rewardName} 교환 취소`, type: 'plus',
        source: 'exchange_cancelled', createdAt: serverTimestamp()
      });
    }
    // 재고 복구 (stock 필드가 있는 경우만)
    if (ex.rewardId) {
      const rDoc = await getDoc(doc(db, 'rewards', ex.rewardId));
      if (rDoc.exists() && rDoc.data().stock !== null && rDoc.data().stock !== undefined) {
        await updateDoc(doc(db, 'rewards', ex.rewardId), { stock: increment(1), tagSoldOut: false });
      }
    }
    // 교환 신청 문서 삭제
    await deleteDoc(doc(db, 'exchanges', id));
    showToast('교환 취소 완료! 골드가 돌아왔어요 💰');
    await reloadStudents();
    renderStudentPendingExchanges();
    if (document.getElementById('page-studentHome') && !document.getElementById('page-studentHome').classList.contains('hidden')) {
      renderStudentHome();
    }
  } catch(e) { showToast('오류: ' + e.message); }
};
