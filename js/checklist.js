// checklist.js — 체크표 시스템
import { state } from './state.js?v=20261111c';
import {
  addDoc, collection, db, deleteDoc, doc, getDocFromServer, getDocs, increment, limit, orderBy,
  query, serverTimestamp, updateDoc, where
} from './firebase.js?v=20261111c';
import { closeModal, openModal, showToast } from './core.js?v=20261111c';
import { checkAndGrantRankUp } from './level.js?v=20261111c';
import { reloadStudents } from './realtime.js?v=20261111c';
import { renderDashboard } from './dashboard.js?v=20261111c';
import { praiseCards, reloadPraiseCards } from './cards.js?v=20261111c';

// 초기 config 설정 확인

// ===== ☑️ 체크표 시스템 =====
let _checkTableId = null;
let _checkTableData = {};
let _checkTableCols = [];
let _checkColTypePending = 'check';
let _checkColActionId = null;
let _checkCardGrantColId = null;

window.openCheckTableModal = async function() {
  openModal('checkTableModal');
  const wrap = document.getElementById('checkTableWrap');
  wrap.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text-muted);">불러오는 중...</div>';

  // 날짜 무관하게 가장 최근 표 1개 재사용 (영구 유지)
  const q = await getDocs(query(collection(db,'checkTables'), orderBy('createdAt','desc'), limit(1)));
  if (q.empty) {
    const ref = await addDoc(collection(db,'checkTables'), { columns:[], createdAt:serverTimestamp() });
    _checkTableId = ref.id; _checkTableCols = [];
  } else {
    _checkTableId = q.docs[0].id; _checkTableCols = q.docs[0].data().columns || [];
  }
  const rowSnap = await getDocs(query(collection(db,'checkTableRows'), where('tableId','==',_checkTableId)));
  _checkTableData = {};
  rowSnap.docs.forEach(d => { const {colId,studentId,value}=d.data(); _checkTableData[`${colId}_${studentId}`]=value; });
  _renderCheckTable();
};

function _renderCheckTable() {
  const wrap = document.getElementById('checkTableWrap');
  if (!wrap) return;
  const vs = state.students.filter(s=>!s.hidden).sort((a,b)=>(a.number||0)-(b.number||0));
  if (!_checkTableCols.length) {
    wrap.innerHTML=`<div style="text-align:center;padding:40px;color:var(--text-muted);"><div style="font-size:40px;margin-bottom:12px;">☑️</div><div style="font-size:15px;font-weight:600;margin-bottom:8px;">아직 열이 없어요</div><div style="font-size:13px;">오른쪽 상단 "+ 열 추가" 버튼으로 열을 추가해 보세요</div></div>`;
    return;
  }
  const headerCols = _checkTableCols.map(col=>`
    <th draggable="true" data-col-id="${col.id}"
      onclick="openCheckColAction('${col.id}','${col.title.replace(/'/g,"\\'")}','${col.type}')"
      ondragstart="checkColDragStart(event,'${col.id}')"
      ondragover="checkColDragOver(event)"
      ondrop="checkColDrop(event,'${col.id}')"
      ondragend="checkColDragEnd(event)"
      style="cursor:grab;">
      ${col.title}
    </th>`).join('');
  const rows = vs.map(s=>{
    const cells = _checkTableCols.map(col=>{
      const key=`${col.id}_${s.id}`; const val=_checkTableData[key];
      if (col.type==='check') {
        const checked=val===true||val==='true';
        return `<td><input type="checkbox" ${checked?'checked':''} onchange="saveCheckCell('${col.id}','${s.id}',this.checked)"></td>`;
      } else {
        return `<td><input type="text" value="${(val||'').replace(/"/g,'&quot;')}" oninput="saveCheckCell('${col.id}','${s.id}',this.value)" style="min-width:80px;"></td>`;
      }
    }).join('');
    return `<tr><td style="min-width:36px;">${s.number||''}</td><td style="min-width:64px;">${s.name}</td>${cells}</tr>`;
  }).join('');
  wrap.innerHTML=`<table class="check-table"><thead><tr><th style="min-width:36px;">번호</th><th style="min-width:64px;">이름</th>${headerCols}</tr></thead><tbody>${rows}</tbody></table>`;
}

// 열 드래그 앤 드롭
let _checkDragSrcId = null;
window.checkColDragStart = function(e, colId) {
  _checkDragSrcId = colId;
  e.currentTarget.style.opacity = '0.4';
  e.dataTransfer.effectAllowed = 'move';
};
window.checkColDragOver = function(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
};
window.checkColDrop = async function(e, targetColId) {
  e.preventDefault();
  if (_checkDragSrcId === targetColId) return;
  const fromIdx = _checkTableCols.findIndex(c=>c.id===_checkDragSrcId);
  const toIdx = _checkTableCols.findIndex(c=>c.id===targetColId);
  if (fromIdx<0||toIdx<0) return;
  const [moved] = _checkTableCols.splice(fromIdx,1);
  _checkTableCols.splice(toIdx,0,moved);
  await updateDoc(doc(db,'checkTables',_checkTableId),{columns:_checkTableCols});
  _renderCheckTable();
};
window.checkColDragEnd = function(e) {
  e.currentTarget.style.opacity = '';
  _checkDragSrcId = null;
};

const _checkSaveTimers = {};
window.saveCheckCell = function(colId, studentId, value) {
  const key=`${colId}_${studentId}`; _checkTableData[key]=value;
  clearTimeout(_checkSaveTimers[key]);
  _checkSaveTimers[key]=setTimeout(async()=>{
    const q=await getDocs(query(collection(db,'checkTableRows'),where('tableId','==',_checkTableId),where('colId','==',colId),where('studentId','==',studentId)));
    if (q.empty) await addDoc(collection(db,'checkTableRows'),{tableId:_checkTableId,colId,studentId,value,updatedAt:serverTimestamp()});
    else await updateDoc(doc(db,'checkTableRows',q.docs[0].id),{value,updatedAt:serverTimestamp()});
  },600);
};

window.addCheckColumn = function() {
  _checkColTypePending='check';
  document.getElementById('checkColTitleInput').value='';
  document.getElementById('colTypeCheck').className='btn btn-primary';
  document.getElementById('colTypeMemo').className='btn btn-secondary';
  openModal('checkColTypeModal');
};

window.selectColType = function(type) {
  _checkColTypePending=type;
  document.getElementById('colTypeCheck').className=type==='check'?'btn btn-primary':'btn btn-secondary';
  document.getElementById('colTypeMemo').className=type==='memo'?'btn btn-primary':'btn btn-secondary';
};

window.confirmAddCheckCol = async function() {
  const title=document.getElementById('checkColTitleInput').value.trim();
  if (!title) return showToast('열 제목을 입력하세요');
  const newCol={id:`col_${Date.now()}`,title,type:_checkColTypePending};
  _checkTableCols.push(newCol);
  await updateDoc(doc(db,'checkTables',_checkTableId),{columns:_checkTableCols});
  closeModal('checkColTypeModal'); _renderCheckTable();
};

window.openRenameCheckCol = function() {
  const col = _checkTableCols.find(c=>c.id===_checkColActionId);
  if (!col) return;
  document.getElementById('checkColRenameInput').value = col.title;
  closeModal('checkColActionModal');
  openModal('checkColRenameModal');
};

window.confirmRenameCheckCol = async function() {
  const newTitle = document.getElementById('checkColRenameInput').value.trim();
  if (!newTitle) return showToast('제목을 입력하세요');
  const col = _checkTableCols.find(c=>c.id===_checkColActionId);
  if (!col) return;
  col.title = newTitle;
  await updateDoc(doc(db,'checkTables',_checkTableId),{columns:_checkTableCols});
  closeModal('checkColRenameModal');
  _renderCheckTable();
  showToast('열 제목이 수정됐어요 ✅');
};

window.openCheckColAction = function(colId, colTitle, colType) {
  _checkColActionId=colId;
  document.getElementById('checkColActionTitle').textContent=`"${colTitle}" 옵션`;
  // 텍스트 열이면 카드 부여 버튼 숨김
  const grantBtn = document.getElementById('checkColGrantBtn');
  if (grantBtn) grantBtn.style.display = (colType==='check') ? '' : 'none';
  openModal('checkColActionModal');
};

window.resetCheckColumn = async function() {
  if (!confirm('이 열의 모든 내용과 카드 부여 기록을 초기화할까요?')) return;
  const colId=_checkColActionId;
  const [rowSnap, logSnap] = await Promise.all([
    getDocs(query(collection(db,'checkTableRows'), where('tableId','==',_checkTableId), where('colId','==',colId))),
    getDocs(query(collection(db,'checkTableCardLog'), where('tableId','==',_checkTableId), where('colId','==',colId)))
  ]);
  for (const d of rowSnap.docs) await deleteDoc(doc(db,'checkTableRows',d.id));
  for (const d of logSnap.docs) await deleteDoc(doc(db,'checkTableCardLog',d.id));
  Object.keys(_checkTableData).forEach(k => { if(k.startsWith(`${colId}_`)) delete _checkTableData[k]; });
  closeModal('checkColActionModal'); _renderCheckTable(); showToast('초기화됐어요');
};

window.deleteCheckColumn = async function() {
  if (!confirm('이 열을 삭제할까요? 모든 데이터가 지워져요.')) return;
  const colId=_checkColActionId;
  _checkTableCols=_checkTableCols.filter(c=>c.id!==colId);
  await updateDoc(doc(db,'checkTables',_checkTableId),{columns:_checkTableCols});
  const q=await getDocs(query(collection(db,'checkTableRows'),where('tableId','==',_checkTableId),where('colId','==',colId)));
  for (const d of q.docs) await deleteDoc(doc(db,'checkTableRows',d.id));
  Object.keys(_checkTableData).forEach(k=>{if(k.startsWith(`${colId}_`))delete _checkTableData[k];});
  closeModal('checkColActionModal'); _renderCheckTable(); showToast('열이 삭제됐어요');
};

window.grantCardToChecked = async function() {
  const colId=_checkColActionId;
  const checked=state.students.filter(s=>!s.hidden&&(_checkTableData[`${colId}_${s.id}`]===true||_checkTableData[`${colId}_${s.id}`]==='true'));
  if (!checked.length) { showToast('체크된 학생이 없어요'); return; }
  const grantedSnap=await getDocs(query(collection(db,'checkTableCardLog'),where('tableId','==',_checkTableId),where('colId','==',colId)));
  const alreadyGranted=new Map();
  grantedSnap.docs.forEach(d=>{const data=d.data();alreadyGranted.set(data.studentId,data.grantedAt?.toDate());});
  const newStudents=checked.filter(s=>!alreadyGranted.has(s.id));
  const oldCount=checked.filter(s=>alreadyGranted.has(s.id)).length;
  _checkCardGrantColId=colId;
  // 카드 로드
  if (!praiseCards.length) await reloadPraiseCards();
  let infoHtml='';
  if (oldCount>0) {
    const oldGrantedAt=[...alreadyGranted.values()][0];
    const d=oldGrantedAt;
    const dateStr=d?`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}, ${d.toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'})} 부여함`:'';
    infoHtml=`기존에 카드를 부여받은 학생은 <strong>${oldCount}명</strong>입니다.<br>부여받지 않은 <strong>${newStudents.length}명</strong>에게 카드를 부여하시겠어요?<div style="font-size:11px;color:var(--text-muted);margin-top:6px;">(${dateStr})</div>`;
  } else {
    infoHtml=`체크된 <strong>${checked.length}명</strong>에게 카드를 부여해요.`;
  }
  document.getElementById('checkCardGrantInfo').innerHTML=infoHtml;
  window._checkCardSelected = null;
  switchCheckCardTab('praise');
  closeModal('checkColActionModal');
  openModal('checkCardGrantModal');
};

window.switchCheckCardTab = function(type) {
  document.getElementById('checkCardTabPraise').className = type==='praise' ? 'btn btn-primary' : 'btn btn-secondary';
  document.getElementById('checkCardTabPenalty').className = type==='penalty' ? 'btn btn-primary' : 'btn btn-secondary';
  window._checkCardSelected = null;
  const filtered = praiseCards.filter(c => c.type === type).sort((a,b)=>(a.order||0)-(b.order||0));
  const listEl = document.getElementById('checkCardList');
  if (!filtered.length) {
    listEl.innerHTML = `<div style="text-align:center;padding:20px;color:var(--text-muted);font-size:13px;">${type==='praise'?'칭찬':'벌점'} 카드가 없어요</div>`;
    return;
  }
  listEl.innerHTML = filtered.map(c => `
    <div onclick="selectCheckCard('${c.id}',this)" data-card-id="${c.id}"
      style="display:flex;align-items:center;gap:10px;padding:10px 14px;border-radius:8px;
      border:1.5px solid var(--border);cursor:pointer;transition:all 0.15s;">
      <span style="font-size:22px;">${c.emoji||'💓'}</span>
      <div style="flex:1;">
        <div style="font-size:13px;font-weight:700;">${c.title}</div>
        <div style="font-size:12px;color:var(--text-muted);">${c.type==='praise'?'+':'−'}${c.point}🪙</div>
      </div>
    </div>`).join('');
};

window.selectCheckCard = function(cardId, el) {
  window._checkCardSelected = cardId;
  document.querySelectorAll('#checkCardList > div').forEach(d => {
    d.style.borderColor = 'var(--border)';
    d.style.background = 'transparent';
  });
  el.style.borderColor = 'var(--primary)';
  el.style.background = 'var(--primary-light)';
};

window.confirmCheckCardGrant = async function() {
  const colId=_checkCardGrantColId;
  const cardId=window._checkCardSelected;
  if (!cardId) return showToast('카드를 선택하세요');
  const card=praiseCards.find(c=>c.id===cardId);
  if (!card) return showToast('카드를 찾을 수 없어요');
  const grantedSnap=await getDocs(query(collection(db,'checkTableCardLog'),where('tableId','==',_checkTableId),where('colId','==',colId)));
  const alreadyGrantedIds=new Set(grantedSnap.docs.map(d=>d.data().studentId));
  const checked=state.students.filter(s=>!s.hidden&&(_checkTableData[`${colId}_${s.id}`]===true||_checkTableData[`${colId}_${s.id}`]==='true'));
  const targets=checked.filter(s=>!alreadyGrantedIds.has(s.id));
  if (!targets.length) { closeModal('checkCardGrantModal'); showToast('부여할 학생이 없어요'); return; }
  const delta=card.type==='praise'?(card.point||0):-(card.point||0);
  for (const s of targets) {
    const checkUpdateData = {points:increment(delta),...(delta>0?{accumulatedPoints:increment(delta)}:{})};
    const checkAbUpdate = {};
    if (card.abilities) {
      for (const [k,v] of Object.entries(card.abilities)) {
        if (v>0) { const abAmt=card.type==='praise'?v:-v; checkUpdateData[`abilities.${k}`]=increment(abAmt); if(abAmt>0) checkAbUpdate[k]=abAmt; }
      }
    }
    await updateDoc(doc(db,'students',s.id),checkUpdateData);
    if (Object.keys(checkAbUpdate).length>0) {
      const freshSnap=await getDocFromServer(doc(db,'students',s.id));
      if (freshSnap.exists()) {
        const fd=freshSnap.data(); const prevAb={};
        for (const k of Object.keys(checkAbUpdate)) prevAb[k]=(fd.abilities?.[k]||0)-checkAbUpdate[k];
        await checkAndGrantRankUp(s.id,prevAb,checkAbUpdate,fd.abilityRankGranted||{});
      }
    }
    await addDoc(collection(db,'givenCards'),{studentId:s.id,studentName:s.name,cardId,cardTitle:card.title,cardEmoji:card.emoji||'',type:card.type,cardType:card.type,cost:card.point||0,delta:card.type==='praise'?(card.point||0):-(card.point||0),source:'checkTable',createdAt:serverTimestamp(),givenAt:serverTimestamp()});
    await addDoc(collection(db,'history'),{studentId:s.id,studentName:s.name,delta,reason:`체크표 카드 부여: ${card.emoji||''} ${card.title}`,type:card.type==='praise'?'plus':'minus',source:'checkTable',createdAt:serverTimestamp()});
    await addDoc(collection(db,'checkTableCardLog'),{tableId:_checkTableId,colId,studentId:s.id,cardId,grantedAt:serverTimestamp()});
  }
  closeModal('checkCardGrantModal');
  showToast(`${targets.length}명에게 '${card.emoji||''} ${card.title}' 부여 완료 ✅`);
  await reloadStudents(); renderDashboard();
};

export function updateFloatingCheckBtn() {
  const btn=document.getElementById('floatingCheckBtn');
  if (!btn) return;
  btn.style.display=state.currentUser?.role==='teacher'?'flex':'none';
  btn.style.alignItems='center'; btn.style.justifyContent='center';
}
