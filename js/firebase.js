// firebase.js — Firebase 연결 (앱·인증·DB) + 읽기 횟수 추적

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, initializeAuth, inMemoryPersistence, EmailAuthProvider, reauthenticateWithCredential, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged, browserSessionPersistence, setPersistence, updatePassword } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc as _getDoc, getDocs as _getDocs, addDoc, updateDoc, deleteDoc, collection, query, where, orderBy, onSnapshot as _onSnapshot, serverTimestamp, increment, limit, startAfter, arrayUnion, getDocFromServer, writeBatch, deleteField } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDkj-vid-uxIz0oTNrRdUP-XiGpCp-aNdI",
  authDomain: "home-73dec.firebaseapp.com",
  projectId: "home-73dec",
  storageBucket: "home-73dec.firebasestorage.app",
  messagingSenderId: "204206460638",
  appId: "1:204206460638:web:d9768a3f1dede01b037c4f"
};

// ===== 읽기 추적 =====
// Firestore 요금은 "읽은 문서 수"로 매겨져요. 브라우저 콘솔에서 rsum() 을 치면
// 이 화면을 연 뒤로 어디서 문서를 몇 개 읽었는지 많은 순서로 보여줘요.
//   · getDoc: 1개   · getDocs: 받은 문서 수 (0개여도 1개로 계산)
//   · onSnapshot(실시간 구독): 처음 받은 문서 수 + 바뀔 때마다 바뀐 문서 수
window._rc = 0;  // 읽은 문서 수 (요금 기준)
window._rl = {}; // 경로별 읽은 문서 수
const _pathOf = (r) => r?._query?.path?.segments?.join('/') || r?._path?.segments?.join('/') || r?.path || '?';
function _count(path, n) { window._rc += n; window._rl[path] = (window._rl[path] || 0) + n; }
export function getDoc(ref, ...rest) {
  return _getDoc(ref, ...rest).then((snap) => { _count(_pathOf(ref), 1); return snap; });
}
export function getDocs(q, ...rest) {
  return _getDocs(q, ...rest).then((snap) => { _count(_pathOf(q), Math.max(1, snap.size)); return snap; });
}
export function onSnapshot(ref, ...rest) {
  const path = _pathOf(ref);
  const i = rest.findIndex((x) => typeof x === 'function');
  if (i >= 0) {
    const cb = rest[i];
    let first = true;
    rest[i] = (snap) => {
      if (!snap.metadata?.fromCache) {
        const isQuery = typeof snap.docChanges === 'function';
        const n = isQuery ? snap.docChanges().length : 1;
        _count(path + ' (실시간)', first ? Math.max(1, n) : n);
        first = false;
      }
      return cb(snap);
    };
  }
  return _onSnapshot(ref, ...rest);
}
window.rsum = () => {
  console.group(`읽은 문서 총 ${window._rc}개`);
  Object.entries(window._rl).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`${v}개  ${k}`));
  console.groupEnd();
};
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// ===== 보조 로그인 창구 =====
// 선생님이 학생 계정을 만들거나 학생 비밀번호를 바꿀 때 쓰는 두 번째 로그인 창구예요.
// 여기서 학생으로 로그인해도 선생님의 로그인(auth)은 그대로 유지돼요.
// (예전에는 선생님 로그인이 학생으로 바뀌었다가 config에 저장한 선생님 비밀번호로 다시 로그인했어요)
let _helperAuth = null;
export function getHelperAuth() {
  if (!_helperAuth) {
    const helperApp = initializeApp(firebaseConfig, 'helper');
    _helperAuth = initializeAuth(helperApp, { persistence: inMemoryPersistence });
    window.__onHelperAuth?.(_helperAuth); // 시험(에뮬레이터) 연결용, 평소엔 아무 일도 안 함
  }
  return _helperAuth;
}

// 다른 파일에서 쓰는 Firebase 함수들을 내보냄
export {
  addDoc,
  arrayUnion,
  browserSessionPersistence,
  collection,
  EmailAuthProvider,
  createUserWithEmailAndPassword,
  deleteField,
  deleteDoc,
  doc,
  getDocFromServer,
  increment,
  limit,
  onAuthStateChanged,
  orderBy,
  query,
  reauthenticateWithCredential,
  serverTimestamp,
  setDoc,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
  updateDoc,
  updatePassword,
  where,
  writeBatch,
};
