import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';

// Config values are read from Vite env vars (VITE_FIREBASE_*, set in
// .env.local locally and in Netlify's environment variables for deploys).
// These are not secrets — Firebase's web config is meant to be public;
// access is enforced by Firestore security rules, not by hiding this object.
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export let auth: Auth | undefined;
export let db: Firestore | undefined;

// Environments without VITE_FIREBASE_* set (CI, a fresh checkout with no
// .env.local) leave firebaseConfig full of undefined values. getAuth() then
// throws synchronously ("auth/invalid-api-key"), which — left uncaught —
// crashes this module and every module that imports it (main.ts included),
// leaving the whole game unplayable. Puzzle stats are optional; the game
// itself is not, so a missing/invalid config degrades to "stats disabled"
// rather than a blank page.
try {
  // Guards against "Firebase App named '[DEFAULT]' already exists" if this
  // module is ever evaluated more than once in the same JS context (multiple
  // Vitest test files importing it, HMR edge cases, etc.).
  const app: FirebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
} catch (err) {
  console.warn('Firebase failed to initialize; puzzle stats will not be recorded.', err);
}
