// Demo backend: everything lives in this browser's localStorage and syncs
// across tabs. Each tab is a different "participant" (id kept in sessionStorage).
const KEY = 'unconf:demo-db';
const listeners = new Set();
let channel;

function load() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || {};
  } catch {
    return {};
  }
}
function save(db) {
  localStorage.setItem(KEY, JSON.stringify(db));
  notify();
  channel?.postMessage('changed');
}
function notify() {
  listeners.forEach((fn) => fn());
}

export async function init() {
  if ('BroadcastChannel' in window) {
    channel = new BroadcastChannel('unconf-demo');
    channel.onmessage = notify;
  }
  window.addEventListener('storage', (e) => e.key === KEY && notify());
}

// ---- auth ----
let authCbs = new Set();
function readUser() {
  try {
    return JSON.parse(sessionStorage.getItem('unconf:demo-user'));
  } catch {
    return null;
  }
}
function writeUser(u) {
  if (u) sessionStorage.setItem('unconf:demo-user', JSON.stringify(u));
  else sessionStorage.removeItem('unconf:demo-user');
  authCbs.forEach((cb) => cb(u));
}
export function currentUser() {
  return readUser();
}
export function onAuth(cb) {
  authCbs.add(cb);
  cb(readUser());
  return () => authCbs.delete(cb);
}
export async function ensureAnon() {
  let u = readUser();
  if (!u) {
    u = { uid: 'demo-' + Math.random().toString(36).slice(2, 10), isAnonymous: true, email: null };
    writeUser(u);
  }
  return u.uid;
}
export async function signInGoogle() {
  writeUser({ uid: 'demo-admin', isAnonymous: false, email: 'organizer@demo', name: 'Demo Organizer' });
}
export const signInEmail = signInGoogle;
export const createEmail = signInGoogle;
export async function signOut() {
  writeUser(null);
}

// ---- data ----
const clone = (x) => JSON.parse(JSON.stringify(x));

function docsIn(db, colPath) {
  const prefix = colPath + '/';
  return Object.entries(db)
    .filter(([p]) => p.startsWith(prefix) && !p.slice(prefix.length).includes('/'))
    .map(([p, d]) => ({ id: p.slice(prefix.length), ...clone(d) }));
}

export function watchEvent(eventId, cb) {
  const base = `events/${eventId}`;
  const fire = () => {
    const db = load();
    cb({
      event: db[base] ? { id: eventId, ...clone(db[base]) } : null,
      participants: docsIn(db, `${base}/participants`),
      ideas: docsIn(db, `${base}/ideas`),
      sessions: docsIn(db, `${base}/sessions`),
    });
  };
  listeners.add(fire);
  setTimeout(fire, 0);
  return () => listeners.delete(fire);
}

export async function getEvent(id) {
  const d = load()[`events/${id}`];
  return d ? { id, ...clone(d) } : null;
}

export async function listMyEvents(uid) {
  return docsIn(load(), 'events').filter((e) => (e.adminUids || []).includes(uid));
}

function applyPatch(target, patch) {
  for (const [k, v] of Object.entries(patch)) {
    const parts = k.split('.');
    let obj = target;
    for (const part of parts.slice(0, -1)) {
      if (typeof obj[part] !== 'object' || obj[part] === null) obj[part] = {};
      obj = obj[part];
    }
    const last = parts.at(-1);
    if (v && v.__op === 'del') delete obj[last];
    else if (v && v.__op === 'union') {
      const arr = Array.isArray(obj[last]) ? obj[last] : [];
      if (!arr.some((x) => JSON.stringify(x) === JSON.stringify(v.v))) arr.push(clone(v.v));
      obj[last] = arr;
    } else obj[last] = clone(v);
  }
}

function deepMerge(a, b) {
  for (const [k, v] of Object.entries(b)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && a[k] && typeof a[k] === 'object' && !Array.isArray(a[k])) deepMerge(a[k], v);
    else a[k] = clone(v);
  }
  return a;
}

function applyOp(db, o) {
  if (o.op === 'set') db[o.path] = o.merge && db[o.path] ? deepMerge(db[o.path], o.data) : clone(o.data);
  else if (o.op === 'update') {
    if (!db[o.path]) throw new Error(`No document to update: ${o.path}`);
    applyPatch(db[o.path], o.data);
  } else if (o.op === 'delete') {
    delete db[o.path];
    // Deleting an event also clears its subcollections (Firestore wouldn't, but it keeps demo tidy).
    if (/^events\/[^/]+$/.test(o.path)) for (const p of Object.keys(db)) if (p.startsWith(o.path + '/')) delete db[p];
  }
}

export async function set(path, data, merge = false) {
  return batch([{ op: 'set', path, data, merge }]);
}
export async function update(path, patch) {
  return batch([{ op: 'update', path, data: patch }]);
}
export async function remove(path) {
  return batch([{ op: 'delete', path }]);
}
export async function batch(ops) {
  const db = load();
  ops.forEach((o) => applyOp(db, o));
  save(db);
}
