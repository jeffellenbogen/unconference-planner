import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  getAuth,
  onAuthStateChanged,
  signInAnonymously,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as fbSignOut,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  getFirestore,
  doc,
  collection,
  onSnapshot,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  writeBatch,
  query,
  where,
  deleteField,
  arrayUnion,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

let auth;
let db;

export async function init(config) {
  const app = initializeApp(config);
  auth = getAuth(app);
  db = getFirestore(app);
  if (auth.authStateReady) await auth.authStateReady();
  else await new Promise((res) => { const u = onAuthStateChanged(auth, () => (u(), res())); });
}

const toUser = (u) => (u ? { uid: u.uid, email: u.email, isAnonymous: u.isAnonymous, name: u.displayName } : null);

export function currentUser() {
  return toUser(auth.currentUser);
}
export function onAuth(cb) {
  return onAuthStateChanged(auth, (u) => cb(toUser(u)));
}
export async function ensureAnon() {
  if (!auth.currentUser) await signInAnonymously(auth);
  // Mint the token now so the first Firestore read isn't sent before sign-in lands.
  await auth.currentUser.getIdToken();
  return auth.currentUser.uid;
}
export async function signInGoogle() {
  await signInWithPopup(auth, new GoogleAuthProvider());
}
export async function signInEmail(email, pw) {
  await signInWithEmailAndPassword(auth, email, pw);
}
export async function createEmail(email, pw) {
  await createUserWithEmailAndPassword(auth, email, pw);
}
export async function signOut() {
  await fbSignOut(auth);
}

function convert(patch) {
  const out = {};
  for (const [k, v] of Object.entries(patch)) {
    if (v && v.__op === 'del') out[k] = deleteField();
    else if (v && v.__op === 'union') out[k] = arrayUnion(v.v);
    else out[k] = v;
  }
  return out;
}

const snapDocs = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }));

export function watchEvent(eventId, cb) {
  const state = { event: undefined, participants: [], ideas: [], sessions: [] };
  const ready = { event: false, participants: false, ideas: false, sessions: false };
  const emit = () => Object.values(ready).every(Boolean) && cb({ ...state });
  const onErr = (e) => cb({ ...state, error: e.message });
  const base = `events/${eventId}`;
  const unsubs = [
    onSnapshot(
      doc(db, base),
      (s) => {
        state.event = s.exists() ? { id: s.id, ...s.data() } : null;
        ready.event = true;
        emit();
      },
      onErr
    ),
    ...['participants', 'ideas', 'sessions'].map((col) =>
      onSnapshot(
        collection(db, `${base}/${col}`),
        (s) => {
          state[col] = snapDocs(s);
          ready[col] = true;
          emit();
        },
        onErr
      )
    ),
  ];
  return () => unsubs.forEach((u) => u());
}

export async function getEvent(id) {
  const s = await getDoc(doc(db, `events/${id}`));
  return s.exists() ? { id: s.id, ...s.data() } : null;
}

export async function listMyEvents(uid) {
  return snapDocs(await getDocs(query(collection(db, 'events'), where('adminUids', 'array-contains', uid))));
}

export async function set(path, data, merge = false) {
  await setDoc(doc(db, path), data, { merge });
}
export async function update(path, patch) {
  await updateDoc(doc(db, path), convert(patch));
}
export async function remove(path) {
  await deleteDoc(doc(db, path));
}
export async function batch(ops) {
  // Firestore batches cap at 500 writes.
  for (let i = 0; i < ops.length; i += 450) {
    const b = writeBatch(db);
    for (const o of ops.slice(i, i + 450)) {
      const ref = doc(db, o.path);
      if (o.op === 'set') b.set(ref, o.data, { merge: !!o.merge });
      else if (o.op === 'update') b.update(ref, convert(o.data));
      else if (o.op === 'delete') b.delete(ref);
    }
    await b.commit();
  }
}
