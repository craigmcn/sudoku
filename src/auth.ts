import {
  EmailAuthProvider,
  GoogleAuthProvider,
  isSignInWithEmailLink,
  linkWithCredential,
  linkWithPopup,
  onAuthStateChanged,
  sendSignInLinkToEmail,
  signInWithCredential,
  signInWithEmailLink,
  signInWithPopup,
  signOut,
  type Auth,
  type AuthError,
  type User,
} from 'firebase/auth';
import { auth } from './firebase';
import { resetAnonymousAuthCache } from './stats';

const EMAIL_LINK_STORAGE_KEY = 'sudoku-email-link-address';

// `auth` is undefined when Firebase failed to initialize (see
// src/firebase.ts) — narrows the type so callers don't need non-null
// assertions, matching src/puzzleDoc.ts's requireDb().
function requireAuthConfigured(): Auth {
  if (!auth) throw new Error('Firebase Auth is not configured');
  return auth;
}

function isCredentialAlreadyInUse(err: unknown): err is AuthError {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as AuthError).code === 'auth/credential-already-in-use'
  );
}

// Live subscription for UI purposes (signed-in display, sign-out button) —
// distinct from stats.ts's ensureAnonymousAuth, which is a one-shot "give
// me a uid" promise, not a live subscription. Unlike ensureAnonymousAuth,
// this is called unconditionally at page boot (not from a user action), so
// it no-ops instead of throwing when Firebase isn't configured — matching
// firebase.ts's own "degrade gracefully" behavior rather than crashing init.
export function onAuthChange(
  callback: (user: User | null) => void,
): () => void {
  if (!auth) return () => {};
  return onAuthStateChanged(auth, callback);
}

// Signs in with Google. If the current session is anonymous (see #17), this
// links the Google credential to that same uid rather than starting a new
// one, so the player's existing play stats carry over into the real
// account instead of being orphaned under the old anonymous uid.
export async function signInWithGoogle(): Promise<User> {
  const instance = requireAuthConfigured();
  const provider = new GoogleAuthProvider();
  const current = instance.currentUser;

  if (!current?.isAnonymous) {
    const result = await signInWithPopup(instance, provider);
    return result.user;
  }

  try {
    const result = await linkWithPopup(current, provider);
    return result.user;
  } catch (err) {
    if (!isCredentialAlreadyInUse(err)) throw err;
    // This Google account is already tied to a different Firebase user
    // (e.g. signed in on another device). Fall back to signing into that
    // existing account — this abandons the current anonymous session's
    // stats rather than merging them; documented tradeoff, see issue #25.
    const credential = GoogleAuthProvider.credentialFromError(err);
    if (!credential) throw err;
    const result = await signInWithCredential(instance, credential);
    return result.user;
  }
}

// Sends a passwordless sign-in link to `email`. The email is stashed in
// localStorage (not just an in-memory variable) because the link is opened
// in a fresh page load — possibly a new tab — after the browser's own
// email client redirects back, so nothing in JS memory survives to that
// point except what was persisted first.
export async function sendSignInLink(email: string): Promise<void> {
  const instance = requireAuthConfigured();
  await sendSignInLinkToEmail(instance, email, {
    url: window.location.href,
    handleCodeInApp: true,
  });
  window.localStorage.setItem(EMAIL_LINK_STORAGE_KEY, email);
}

// Lightweight, Auth-instance-free check mirroring what Firebase's own
// isSignInWithEmailLink() looks for (a mode=signIn redirect with an
// oobCode). isSignInWithEmailLink() itself requires an Auth instance, so it
// can't be called at all when Firebase isn't configured — this lets
// completeEmailLinkSignInIfPresent() below tell "definitely not a sign-in
// link" apart from "Firebase isn't configured" without ever touching
// Firebase for the overwhelming majority of page loads that are neither.
export function looksLikeEmailSignInLink(url: string): boolean {
  const params = new URL(url).searchParams;
  return params.get('mode') === 'signIn' && !!params.get('oobCode');
}

// Called on page load. Resolves null (no-op) if the current URL isn't a
// sign-in link — checked before requiring Firebase to be configured (see
// looksLikeEmailSignInLink above), so this never warns on an ordinary page
// load just because Firebase isn't set up; issue flagged by Copilot on
// PR #28. Same anonymous-linking behavior as signInWithGoogle above.
export async function completeEmailLinkSignInIfPresent(): Promise<User | null> {
  if (!looksLikeEmailSignInLink(window.location.href)) return null;

  const instance = requireAuthConfigured();
  if (!isSignInWithEmailLink(instance, window.location.href)) return null;

  const email =
    window.localStorage.getItem(EMAIL_LINK_STORAGE_KEY) ??
    window.prompt('Confirm your email to finish signing in:');
  if (!email) return null;

  const current = instance.currentUser;

  try {
    if (current?.isAnonymous) {
      const credential = EmailAuthProvider.credentialWithLink(
        email,
        window.location.href,
      );
      const result = await linkWithCredential(current, credential);
      return result.user;
    }
    const result = await signInWithEmailLink(
      instance,
      email,
      window.location.href,
    );
    return result.user;
  } catch (err) {
    if (!isCredentialAlreadyInUse(err)) throw err;
    // Same fallback as signInWithGoogle: this email is already tied to a
    // different Firebase user, so sign into that account instead of
    // merging — the current anonymous session's stats are abandoned.
    const credential = EmailAuthProvider.credentialWithLink(
      email,
      window.location.href,
    );
    const result = await signInWithCredential(instance, credential);
    return result.user;
  } finally {
    window.localStorage.removeItem(EMAIL_LINK_STORAGE_KEY);
    // Clean the sign-in params out of the URL so a refresh doesn't retry.
    window.history.replaceState(null, '', window.location.pathname);
  }
}

export async function signOutUser(): Promise<void> {
  const instance = requireAuthConfigured();
  await signOut(instance);
  resetAnonymousAuthCache();
}
