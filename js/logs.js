// logs.js — 누가기록
import { state } from './state.js?v=20261111c';
import {
  addDoc, collection, db, deleteDoc, doc, getDoc, getDocs, limit, orderBy, query, serverTimestamp,
  setDoc, where
} from './firebase.js?v=20261111c';
import { closeModal, openModal, showToast } from './core.js?v=20261111c';

// ===== 누가기록 시스템 =====
window.openQuickLogModal = function() {
  // 학생 목록 채우기
  const sel = document.getElementById('quickLogStudent');
  sel.innerHTML = '<option value="">학생을 선택하세요</option>' +
    [...state.students].filter(s=>!s.hidden).sort((a,b)=>(a.number||0)-(b.number||0))
    .map(s=>`<option value="${s.id}">${s.number||''}번 ${s.name}</option>`).join('');
  // 카테고리 초기화
  document.querySelectorAll('.log-cat-btn').forEach(b => b.classList.toggle('active', b.dataset.cat === '생활지도'));
  document.getElementById('quickLogContent').value = '';
  // 현재 시각 표시
  const now = new Date();
  document.getElementById('quickLogTimestamp').textContent =
    `📅 ${now.getFullYear()}.${String(now.getMonth()+1).padStart(2,'0')}.${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')} 기준 (저장 시각은 서버가 자동 기록)`;
  openModal('quickLogModal');
};

window.selectLogCat = function(btn) {
  document.querySelectorAll('.log-cat-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
};

window.saveQuickLog = async function() {
  const studentId = document.getElementById('quickLogStudent').value;
  const content = document.getElementById('quickLogContent').value.trim();
  const category = document.querySelector('.log-cat-btn.active')?.dataset.cat || '기타';
  if (!studentId) return showToast('학생을 선택해주세요');
  if (!content) return showToast('기록 내용을 입력해주세요');
  const student = state.students.find(s => s.id === studentId);
  try {
    await addDoc(collection(db, 'studentLogs'), {
      studentId,
      studentName: student?.name || '',
      studentNumber: student?.number || 0,
      category,
      content,
      teacherId: state.currentUser.uid,
      createdAt: serverTimestamp()   // Firebase 서버 시각 — 조작 불가
    });
    showToast(`${student?.name} 학생 기록 저장 완료 ✅`);
    closeModal('quickLogModal');
    // 현재 누가기록 페이지에 있으면 즉시 갱신
    if (document.getElementById('page-studentLogs') && !document.getElementById('page-studentLogs').classList.contains('hidden')) {
      renderStudentLogsPage();
    }
  } catch(e) { showToast('저장 오류: ' + e.message); }
};

window.renderStudentLogsPage = async function renderStudentLogsPage() {
  const container = document.getElementById('studentLogsContainer');
  if (!container) return;
  // 60일 초과 기록 자동 정리 (백그라운드)
  cleanExpiredStudentLogs();
  // 필터 학생 목록 채우기 (최초 1회)
  const filterSel = document.getElementById('logFilterStudent');
  if (filterSel) {
    const prevVal = filterSel.value;
    filterSel.innerHTML = '<option value="">전체 학생</option>' +
      [...state.students].filter(s=>!s.hidden).sort((a,b)=>(a.number||0)-(b.number||0))
      .map(s=>`<option value="${s.id}">${s.number||''}번 ${s.name}</option>`).join('');
    filterSel.value = prevVal; // 이전 선택값 유지
  }
  const filterStudentId = document.getElementById('logFilterStudent')?.value || '';
  const filterCategory  = document.getElementById('logFilterCategory')?.value || '';
  const filterMonth     = document.getElementById('logFilterMonth')?.value || '';
  container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted);">불러오는 중...</div>';
  try {
    let q = query(collection(db, 'studentLogs'), orderBy('createdAt','desc'));
    if (filterStudentId) q = query(collection(db,'studentLogs'), where('studentId','==',filterStudentId));
    const snap = await getDocs(q);
    let logs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    // 클라이언트 정렬 (인덱스 불필요)
    logs.sort((a,b) => (b.createdAt?.seconds||0) - (a.createdAt?.seconds||0));
    if (filterCategory) logs = logs.filter(l => l.category === filterCategory);
    if (filterMonth) {
      const [y, m] = filterMonth.split('-').map(Number);
      logs = logs.filter(l => {
        const d = l.createdAt?.toDate();
        return d && d.getFullYear() === y && d.getMonth()+1 === m;
      });
    }
    if (!logs.length) {
      const studentName = filterStudentId
        ? state.students.find(s=>s.id===filterStudentId)?.name || '해당 학생'
        : null;
      const msg = studentName
        ? `${studentName} 학생의 누가기록이 없어요`
        : '조건에 맞는 기록이 없어요';
      container.innerHTML = `<div class="empty-state"><div class="empty-icon">📝</div><h3>${msg}</h3><p>플로팅 버튼이나 + 기록 추가로 기록을 남겨보세요</p></div>`;
      return;
    }
    // 학생별로 그룹핑
    const groups = {};
    logs.forEach(l => {
      const key = l.studentId;
      if (!groups[key]) groups[key] = { name: l.studentName, number: l.studentNumber, logs: [] };
      groups[key].logs.push(l);
    });
    const sortedGroups = Object.values(groups).sort((a,b) => (a.number||0)-(b.number||0));
    container.innerHTML = sortedGroups.map(g => `
      <div class="card" style="margin-bottom:16px;">
        <div style="font-size:15px;font-weight:700;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center;">
          <span>👤 ${g.number||''}번 ${g.name}</span>
          <span style="font-size:13px;color:var(--text-muted);font-weight:400;">${g.logs.length}건</span>
        </div>
        ${g.logs.map(l => {
          const d = l.createdAt?.toDate();
          const dateStr = d ? `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}` : '날짜 없음';
          return `<div class="log-entry" data-logid="${l.id}">
            <div class="log-entry-header">
              <span class="log-cat-badge ${l.category}">${l.category}</span>
              <div style="display:flex;align-items:center;gap:10px;">
                <span class="log-entry-meta">🕐 ${dateStr}</span>
                <span onclick="deleteStudentLog(this.closest('[data-logid]').dataset.logid)" style="font-size:12px;color:#ef4444;cursor:pointer;">삭제</span>
              </div>
            </div>
            <div class="log-entry-content">${l.content.replace(/</g,'&lt;')}</div>
          </div>`;
        }).join('')}
      </div>
    `).join('');
  } catch(e) { container.innerHTML = `<div style="color:#ef4444;padding:20px;">오류: ${e.message}</div>`; }
}

window.deleteStudentLog = async function(docId) {
  if (!confirm('이 기록을 삭제할까요?\n삭제 후 복구 버튼으로 되돌릴 수 있어요.')) return;
  try {
    // 원본 문서 읽기
    const fresh = await getDoc(doc(db, 'studentLogs', docId));
    if (!fresh.exists()) return showToast('이미 삭제된 기록이에요');
    const data = fresh.data();
    // studentLogsDeleted로 이동 (원본 createdAt 보존)
    await setDoc(doc(db, 'studentLogsDeleted', docId), {
      ...data,
      deletedAt: serverTimestamp()
    });
    await deleteDoc(doc(db, 'studentLogs', docId));
    showToast('삭제됐어요 (복구 버튼으로 되돌릴 수 있어요)');
    renderStudentLogsPage();
  } catch(e) { showToast('오류: ' + e.message); }
};

window.openLogRestoreModal = async function() {
  openModal('logRestoreModal');
  const listEl = document.getElementById('logRestoreList');
  listEl.innerHTML = '<div style="text-align:center;padding:24px;color:var(--text-muted);">불러오는 중...</div>';
  try {
    const snap = await getDocs(query(
      collection(db, 'studentLogsDeleted'),
      orderBy('deletedAt', 'desc'),
      limit(50)
    ));
    if (snap.empty) {
      listEl.innerHTML = '<div class="empty-state"><div class="empty-icon">🗑️</div><h3>삭제된 기록이 없어요</h3></div>';
      return;
    }
    listEl.innerHTML = snap.docs.map(d => {
      const item = d.data();
      const created = item.createdAt?.toDate();
      const deleted = item.deletedAt?.toDate();
      const createdStr = created ? `${created.getFullYear()}.${String(created.getMonth()+1).padStart(2,'0')}.${String(created.getDate()).padStart(2,'0')} ${String(created.getHours()).padStart(2,'0')}:${String(created.getMinutes()).padStart(2,'0')}` : '';
      const deletedStr = deleted ? `${deleted.getMonth()+1}/${deleted.getDate()} ${String(deleted.getHours()).padStart(2,'0')}:${String(deleted.getMinutes()).padStart(2,'0')} 삭제` : '';
      return `<div style="padding:10px 12px;background:var(--bg);border-radius:10px;border:1px solid var(--border);">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
          <div style="display:flex;align-items:center;gap:8px;">
            <span class="log-cat-badge ${item.category}">${item.category}</span>
            <span style="font-size:13px;font-weight:700;">${item.studentName}</span>
          </div>
          <button onclick="restoreStudentLog('${d.id}')" style="font-size:11px;padding:4px 10px;border-radius:6px;border:1px solid var(--primary);background:transparent;color:var(--primary);cursor:pointer;font-weight:600;font-family:inherit;">복구</button>
        </div>
        <div style="font-size:12px;color:var(--text-muted);margin-bottom:4px;">📅 기록: ${createdStr} · 🗑️ ${deletedStr}</div>
        <div style="font-size:13px;line-height:1.5;color:var(--text-secondary);white-space:pre-wrap;">${item.content?.replace(/</g,'&lt;').slice(0,100)}${item.content?.length>100?'…':''}</div>
      </div>`;
    }).join('');
  } catch(e) { listEl.innerHTML = `<div style="color:#ef4444;padding:16px;">오류: ${e.message}</div>`; }
};

window.restoreStudentLog = async function(docId) {
  try {
    const fresh = await getDoc(doc(db, 'studentLogsDeleted', docId));
    if (!fresh.exists()) return showToast('복구할 기록을 찾을 수 없어요');
    const data = fresh.data();
    // deletedAt 제거하고 원본 데이터 그대로 복원 (createdAt 보존)
    const { deletedAt, ...original } = data;
    await setDoc(doc(db, 'studentLogs', docId), original);
    await deleteDoc(doc(db, 'studentLogsDeleted', docId));
    showToast(`${data.studentName} 학생 기록이 복구됐어요 ✅`);
    openLogRestoreModal(); // 목록 새로고침
    if (!document.getElementById('page-studentLogs').classList.contains('hidden')) {
      renderStudentLogsPage();
    }
  } catch(e) { showToast('오류: ' + e.message); }
};

// 60일 초과 누가기록 자동 정리 (누가기록 페이지 진입 시 실행)
async function cleanExpiredStudentLogs() {
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 60);
    const cutoffTs = cutoff;
    const snap = await getDocs(query(
      collection(db, 'studentLogs'),
      where('createdAt', '<', cutoffTs),
      limit(50)
    ));
    if (snap.empty) return;
    for (const d of snap.docs) {
      await deleteDoc(d.ref);
    }
    console.log(`60일 초과 누가기록 ${snap.size}건 자동 정리됨`);
  } catch(e) { console.warn('누가기록 자동 정리 오류:', e.message); }
}

window.exportStudentLogs = async function() {
  const filterStudentId = document.getElementById('logFilterStudent')?.value || '';
  const filterMonth     = document.getElementById('logFilterMonth')?.value || '';
  let q = query(collection(db, 'studentLogs'), orderBy('createdAt','asc'));
  if (filterStudentId) q = query(collection(db,'studentLogs'), where('studentId','==',filterStudentId), orderBy('createdAt','asc'));
  const snap = await getDocs(q);
  let logs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  if (filterMonth) {
    const [y, m] = filterMonth.split('-').map(Number);
    logs = logs.filter(l => { const d = l.createdAt?.toDate(); return d && d.getFullYear()===y && d.getMonth()+1===m; });
  }
  if (!logs.length) return showToast('내보낼 기록이 없어요');
  const lines = ['[누가기록 내보내기]', `생성일시: ${new Date().toLocaleString('ko-KR')}`, ''];
  let lastStudent = '';
  logs.forEach(l => {
    if (l.studentName !== lastStudent) {
      lines.push(`\n▶ ${l.studentNumber||''}번 ${l.studentName}`);
      lastStudent = l.studentName;
    }
    const d = l.createdAt?.toDate();
    const dateStr = d ? `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}` : '';
    lines.push(`  [${l.category}] ${dateStr}`);
    lines.push(`  ${l.content}`);
    lines.push('');
  });
  const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = `누가기록_${filterMonth||'전체'}.txt`; a.click();
};
