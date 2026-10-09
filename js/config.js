// Firebase web app config (Firebase console → Project settings → Your apps).
// These values are public by design — access is enforced by firestore.rules.
// Clear apiKey to run in DEMO MODE (data stays in this browser). See README.md.
export const firebaseConfig = {
  apiKey: 'AIzaSyC2WhTJ2YKViUTjzjPEGYlZPgz8YUw6XvU',
  authDomain: 'unconference-planner-7ba39.firebaseapp.com',
  projectId: 'unconference-planner-7ba39',
  storageBucket: 'unconference-planner-7ba39.firebasestorage.app',
  messagingSenderId: '984347673030',
  appId: '1:984347673030:web:74623e1c6d00becfac32c7',
};

// Accounts allowed to create events (enforced by firestore.rules; this copy just
// hides the "New event" button for everyone else). Empty = any Google account.
export const ORGANIZER_EMAILS = ['jellenbogen@dawsonschool.org'];
