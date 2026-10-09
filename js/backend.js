// Picks the Firebase backend when configured, otherwise a local demo backend.
// Both expose the same API:
//   ensureAnon() → uid             currentUser() → {uid,email,isAnonymous}|null
//   onAuth(cb)                     signInGoogle() / signInEmail(e,p) / createEmail(e,p) / signOut()
//   watchEvent(id, cb) → unsub     cb({ event, participants, ideas, sessions })
//   getEvent(id)                   listMyEvents(uid)
//   set(path, data, merge?)        update(path, patch)   remove(path)   batch(ops)
// Patches may use dotted keys and the DEL / union() sentinels below.
import { firebaseConfig } from './config.js';

export const DEMO = !firebaseConfig?.apiKey;
export const DEL = { __op: 'del' };
export const union = (v) => ({ __op: 'union', v });

let impl;
export async function backend() {
  if (!impl) {
    impl = DEMO ? await import('./backend-local.js') : await import('./backend-firebase.js');
    await impl.init(firebaseConfig);
  }
  return impl;
}
