// backup.js — 전체 데이터 백업 (교사 전용, 읽기만 하고 데이터는 바꾸지 않아요)
import { state } from './state.js?v=20261111c';
import { collection, db, getDocs } from './firebase.js?v=20261111c';
import { showToast } from './core.js?v=20261111c';
import { BACKUP_COLLECTIONS, backupFileName, makeBackup } from './backup-format.js?v=20261111c';

const APP_VERSION = new URL(import.meta.url).searchParams.get('v') || 'dev';

window.downloadFullBackup = async function(btn) {
  if (state.currentUser?.role !== 'teacher') return showToast('선생님만 백업할 수 있어요');
  if (!confirm('모든 데이터를 파일로 내려받을까요?\n\n· 데이터는 읽기만 하고 바꾸지 않아요\n· 모든 문서를 한 번씩 읽어서 읽기 사용량이 한 번 크게 늘어요')) return;
  const label = btn?.textContent;
  if (btn) btn.disabled = true;
  const collections = {};
  const errors = {};
  try {
    let i = 0;
    for (const name of BACKUP_COLLECTIONS) {
      i++;
      if (btn) btn.textContent = `💾 백업 중… (${i}/${BACKUP_COLLECTIONS.length})`;
      try {
        const snap = await getDocs(collection(db, name));
        collections[name] = snap.docs.map((d) => ({ id: d.id, data: d.data() }));
      } catch (e) {
        errors[name] = e.code || e.message || String(e);
        collections[name] = [];
      }
    }
    const backup = makeBackup(collections, { version: APP_VERSION, errors });
    const blob = new Blob([JSON.stringify(backup, null, 1)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = backupFileName();
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    const failed = Object.keys(errors);
    if (failed.length) alert(`백업 파일을 저장했어요 (문서 ${backup.totalDocs}개).\n\n다음 항목은 읽지 못했어요:\n${failed.map((n) => `· ${n}: ${errors[n]}`).join('\n')}`);
    else showToast(`💾 백업 완료! 문서 ${backup.totalDocs}개를 저장했어요`);
  } catch (e) {
    alert('백업 중 오류가 났어요: ' + (e.message || e));
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = label; }
  }
};
