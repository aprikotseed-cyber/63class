// firebase.js — Firebase 연결 (앱·인증·DB) + 읽기 횟수 추적

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged, browserSessionPersistence, setPersistence, updatePassword } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc as _getDoc, getDocs as _getDocs, addDoc, updateDoc, deleteDoc, collection, query, where, orderBy, onSnapshot, serverTimestamp, increment, limit, startAfter, arrayUnion, getDocFromServer } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDkj-vid-uxIz0oTNrRdUP-XiGpCp-aNdI",
  authDomain: "home-73dec.firebaseapp.com",
  projectId: "home-73dec",
  storageBucket: "home-73dec.firebasestorage.app",
  messagingSenderId: "204206460638",
  appId: "1:204206460638:web:d9768a3f1dede01b037c4f"
};

// ===== 읽기 추적 =====
window._rc = 0; window._rl = {};
export function getDoc(...a) {
  const p = a[0]?._path?.segments?.join('/') || a[0]?.path || '?';
  window._rc++; window._rl[p] = (window._rl[p]||0)+1;
  return _getDoc(...a);
}
export function getDocs(...a) {
  const p = a[0]?._query?.path?.segments?.join('/')||a[0]?._path?.segments?.join('/')||'?';
  window._rc++; window._rl[p] = (window._rl[p]||0)+1;
  return _getDocs(...a);
}
window.rsum = ()=>{ console.group(`총 ${window._rc}건`); Object.entries(window._rl).sort((a,b)=>b[1]-a[1]).forEach(([k,v])=>console.log(`${v}건 ${k}`)); console.groupEnd(); };
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// 다른 파일에서 쓰는 Firebase 함수들을 내보냄
export {
  addDoc,
  arrayUnion,
  browserSessionPersistence,
  collection,
  createUserWithEmailAndPassword,
  deleteDoc,
  doc,
  getDocFromServer,
  increment,
  limit,
  onAuthStateChanged,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
  updateDoc,
  updatePassword,
  where,
};
