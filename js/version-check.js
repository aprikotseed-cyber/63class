// version-check.js — 새 버전이 올라오면 켜져 있는 화면도 알아서 새로고침
//
// 홈페이지를 켜 둔 채로 두면 옛날 코드가 계속 돌아요. 그래서 5분마다, 그리고 화면을 다시 볼 때(탭 전환·화면 켜기)
// version.json 을 확인해서 버전이 바뀌었으면 새로고침해요.
// 단, 글을 입력하는 중이거나 창(모달)이 열려 있으면 기다렸다가 다음에 해요.
const LOADED = new URL(import.meta.url).searchParams.get('v') || 'dev';
const EVERY_MS = 5 * 60 * 1000;

function busy() {
  const a = document.activeElement;
  if (a && (a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && !['button', 'checkbox', 'radio'].includes(a.type)))) return true;
  return !!document.querySelector('.modal-overlay:not(.hidden)');
}

async function check() {
  if (LOADED === 'dev' || document.hidden) return;
  try {
    const res = await fetch(`version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return;
    const { version } = await res.json();
    if (version && version !== LOADED && !busy()) location.reload();
  } catch (e) { /* 인터넷이 잠깐 끊긴 경우 등: 다음에 다시 확인 */ }
}

export function startVersionCheck() {
  setInterval(check, EVERY_MS);
  document.addEventListener('visibilitychange', () => { if (!document.visibilityState || document.visibilityState === 'visible') check(); });
}
