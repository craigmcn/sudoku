import { beforeEach, describe, expect, it, vi } from 'vitest';

class MockGoogleAuthProvider {}

const mocks = vi.hoisted(() => ({
  onAuthStateChanged: vi.fn(() => vi.fn()),
  linkWithPopup: vi.fn(),
  linkWithCredential: vi.fn(),
  signInWithPopup: vi.fn(),
  signInWithCredential: vi.fn(),
  signInWithEmailLink: vi.fn(),
  sendSignInLinkToEmail: vi.fn(() => Promise.resolve()),
  signOut: vi.fn(() => Promise.resolve()),
  isSignInWithEmailLink: vi.fn(),
  credentialFromError: vi.fn(),
  credentialWithLink: vi.fn(() => ({ __credential: true })),
  resetAnonymousAuthCache: vi.fn(),
  auth: { currentUser: null as { isAnonymous: boolean } | null } as
    | { currentUser: { isAnonymous: boolean } | null }
    | undefined,
}));

vi.mock('firebase/auth', () => ({
  GoogleAuthProvider: Object.assign(MockGoogleAuthProvider, {
    credentialFromError: mocks.credentialFromError,
  }),
  EmailAuthProvider: { credentialWithLink: mocks.credentialWithLink },
  isSignInWithEmailLink: mocks.isSignInWithEmailLink,
  linkWithCredential: mocks.linkWithCredential,
  linkWithPopup: mocks.linkWithPopup,
  onAuthStateChanged: mocks.onAuthStateChanged,
  sendSignInLinkToEmail: mocks.sendSignInLinkToEmail,
  signInWithCredential: mocks.signInWithCredential,
  signInWithEmailLink: mocks.signInWithEmailLink,
  signInWithPopup: mocks.signInWithPopup,
  signOut: mocks.signOut,
}));

vi.mock('./firebase', () => ({
  get auth() {
    return mocks.auth;
  },
}));

vi.mock('./stats', () => ({
  resetAnonymousAuthCache: mocks.resetAnonymousAuthCache,
}));

const realUser = { uid: 'real-uid', isAnonymous: false };
const linkedUser = { uid: 'anon-uid', isAnonymous: false };

const credentialAlreadyInUse = { code: 'auth/credential-already-in-use' };

// happy-dom's Window doesn't implement localStorage or prompt() (no
// meaningful DOM equivalent for a modal dialog, and storage needs a backing
// store it doesn't provide out of the box) — stub both so auth.ts's real
// window.localStorage/window.prompt usage has something to run against.
class MemoryStorage implements Storage {
  private store = new Map<string, string>();
  get length(): number {
    return this.store.size;
  }
  clear(): void {
    this.store.clear();
  }
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.auth = { currentUser: null };
  Object.defineProperty(window, 'localStorage', {
    value: new MemoryStorage(),
    writable: true,
    configurable: true,
  });
  window.prompt = vi.fn();
  window.history.replaceState(null, '', '/');
});

describe('onAuthChange', () => {
  it('subscribes via onAuthStateChanged when auth is configured', async () => {
    const { onAuthChange } = await import('./auth');
    const callback = vi.fn();
    onAuthChange(callback);

    expect(mocks.onAuthStateChanged).toHaveBeenCalledWith(mocks.auth, callback);
  });

  it('no-ops without throwing when Firebase Auth is not configured', async () => {
    mocks.auth = undefined;
    const { onAuthChange } = await import('./auth');
    const callback = vi.fn();

    expect(() => onAuthChange(callback)).not.toThrow();
    expect(mocks.onAuthStateChanged).not.toHaveBeenCalled();
    expect(callback).not.toHaveBeenCalled();
  });
});

describe('signInWithGoogle', () => {
  it('signs in directly when there is no anonymous session to link', async () => {
    mocks.auth = { currentUser: null };
    mocks.signInWithPopup.mockResolvedValue({ user: realUser });

    const { signInWithGoogle } = await import('./auth');
    const user = await signInWithGoogle();

    expect(user).toBe(realUser);
    expect(mocks.signInWithPopup).toHaveBeenCalledTimes(1);
    expect(mocks.linkWithPopup).not.toHaveBeenCalled();
  });

  it('links the anonymous session instead of starting a new account', async () => {
    const anonUser = { uid: 'anon-uid', isAnonymous: true };
    mocks.auth = { currentUser: anonUser };
    mocks.linkWithPopup.mockResolvedValue({ user: linkedUser });

    const { signInWithGoogle } = await import('./auth');
    const user = await signInWithGoogle();

    expect(user).toBe(linkedUser);
    expect(mocks.linkWithPopup).toHaveBeenCalledWith(anonUser, expect.any(MockGoogleAuthProvider));
    expect(mocks.signInWithPopup).not.toHaveBeenCalled();
  });

  it('falls back to signing into the existing account on credential-already-in-use', async () => {
    const anonUser = { uid: 'anon-uid', isAnonymous: true };
    mocks.auth = { currentUser: anonUser };
    mocks.linkWithPopup.mockRejectedValue(credentialAlreadyInUse);
    mocks.credentialFromError.mockReturnValue({ __credential: true });
    mocks.signInWithCredential.mockResolvedValue({ user: realUser });

    const { signInWithGoogle } = await import('./auth');
    const user = await signInWithGoogle();

    expect(user).toBe(realUser);
    expect(mocks.signInWithCredential).toHaveBeenCalledWith(mocks.auth, { __credential: true });
  });

  it('rethrows credential-already-in-use if no credential can be recovered', async () => {
    const anonUser = { uid: 'anon-uid', isAnonymous: true };
    mocks.auth = { currentUser: anonUser };
    mocks.linkWithPopup.mockRejectedValue(credentialAlreadyInUse);
    mocks.credentialFromError.mockReturnValue(null);

    const { signInWithGoogle } = await import('./auth');
    await expect(signInWithGoogle()).rejects.toBe(credentialAlreadyInUse);
    expect(mocks.signInWithCredential).not.toHaveBeenCalled();
  });

  it('rethrows unrelated linking errors without falling back', async () => {
    const anonUser = { uid: 'anon-uid', isAnonymous: true };
    mocks.auth = { currentUser: anonUser };
    const otherError = { code: 'auth/popup-closed-by-user' };
    mocks.linkWithPopup.mockRejectedValue(otherError);

    const { signInWithGoogle } = await import('./auth');
    await expect(signInWithGoogle()).rejects.toBe(otherError);
    expect(mocks.signInWithCredential).not.toHaveBeenCalled();
  });

  it('rejects when Firebase Auth is not configured', async () => {
    mocks.auth = undefined;
    const { signInWithGoogle } = await import('./auth');
    await expect(signInWithGoogle()).rejects.toThrow('Firebase Auth is not configured');
  });
});

describe('sendSignInLink', () => {
  it('sends the link and stores the email for the redirect back', async () => {
    const { sendSignInLink } = await import('./auth');
    await sendSignInLink('player@example.com');

    expect(mocks.sendSignInLinkToEmail).toHaveBeenCalledWith(
      mocks.auth,
      'player@example.com',
      expect.objectContaining({ handleCodeInApp: true }),
    );
    expect(window.localStorage.getItem('sudoku-email-link-address')).toBe('player@example.com');
  });

  it('rejects when Firebase Auth is not configured', async () => {
    mocks.auth = undefined;
    const { sendSignInLink } = await import('./auth');
    await expect(sendSignInLink('player@example.com')).rejects.toThrow(
      'Firebase Auth is not configured',
    );
  });
});

describe('completeEmailLinkSignInIfPresent', () => {
  it('resolves null and does nothing when the URL is not a sign-in link', async () => {
    mocks.isSignInWithEmailLink.mockReturnValue(false);

    const { completeEmailLinkSignInIfPresent } = await import('./auth');
    const user = await completeEmailLinkSignInIfPresent();

    expect(user).toBeNull();
    expect(mocks.linkWithCredential).not.toHaveBeenCalled();
    expect(mocks.signInWithEmailLink).not.toHaveBeenCalled();
  });

  it('links the anonymous session using the stored email', async () => {
    window.localStorage.setItem('sudoku-email-link-address', 'player@example.com');
    const anonUser = { uid: 'anon-uid', isAnonymous: true };
    mocks.auth = { currentUser: anonUser };
    mocks.isSignInWithEmailLink.mockReturnValue(true);
    mocks.linkWithCredential.mockResolvedValue({ user: linkedUser });

    const { completeEmailLinkSignInIfPresent } = await import('./auth');
    const user = await completeEmailLinkSignInIfPresent();

    expect(user).toBe(linkedUser);
    expect(mocks.credentialWithLink).toHaveBeenCalledWith(
      'player@example.com',
      expect.any(String),
    );
    expect(mocks.linkWithCredential).toHaveBeenCalledWith(anonUser, { __credential: true });
    expect(window.localStorage.getItem('sudoku-email-link-address')).toBeNull();
  });

  it('prompts for the email when none was stored', async () => {
    mocks.isSignInWithEmailLink.mockReturnValue(true);
    mocks.signInWithEmailLink.mockResolvedValue({ user: realUser });
    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('typed@example.com');

    const { completeEmailLinkSignInIfPresent } = await import('./auth');
    const user = await completeEmailLinkSignInIfPresent();

    expect(promptSpy).toHaveBeenCalled();
    expect(user).toBe(realUser);
    expect(mocks.signInWithEmailLink).toHaveBeenCalledWith(
      mocks.auth,
      'typed@example.com',
      expect.any(String),
    );
  });

  it('resolves null without signing in when the prompt is cancelled', async () => {
    mocks.isSignInWithEmailLink.mockReturnValue(true);
    vi.spyOn(window, 'prompt').mockReturnValue(null);

    const { completeEmailLinkSignInIfPresent } = await import('./auth');
    const user = await completeEmailLinkSignInIfPresent();

    expect(user).toBeNull();
    expect(mocks.signInWithEmailLink).not.toHaveBeenCalled();
    expect(mocks.linkWithCredential).not.toHaveBeenCalled();
  });

  it('signs in directly when there is no anonymous session to link', async () => {
    window.localStorage.setItem('sudoku-email-link-address', 'player@example.com');
    mocks.auth = { currentUser: null };
    mocks.isSignInWithEmailLink.mockReturnValue(true);
    mocks.signInWithEmailLink.mockResolvedValue({ user: realUser });

    const { completeEmailLinkSignInIfPresent } = await import('./auth');
    const user = await completeEmailLinkSignInIfPresent();

    expect(user).toBe(realUser);
    expect(mocks.linkWithCredential).not.toHaveBeenCalled();
  });

  it('falls back to signing into the existing account on credential-already-in-use', async () => {
    window.localStorage.setItem('sudoku-email-link-address', 'player@example.com');
    const anonUser = { uid: 'anon-uid', isAnonymous: true };
    mocks.auth = { currentUser: anonUser };
    mocks.isSignInWithEmailLink.mockReturnValue(true);
    mocks.linkWithCredential.mockRejectedValue(credentialAlreadyInUse);
    mocks.signInWithCredential.mockResolvedValue({ user: realUser });

    const { completeEmailLinkSignInIfPresent } = await import('./auth');
    const user = await completeEmailLinkSignInIfPresent();

    expect(user).toBe(realUser);
    expect(mocks.signInWithCredential).toHaveBeenCalledWith(mocks.auth, { __credential: true });
  });

  it('clears the stored email and the URL after completing sign-in', async () => {
    window.localStorage.setItem('sudoku-email-link-address', 'player@example.com');
    mocks.auth = { currentUser: null };
    mocks.isSignInWithEmailLink.mockReturnValue(true);
    mocks.signInWithEmailLink.mockResolvedValue({ user: realUser });
    const replaceStateSpy = vi.spyOn(window.history, 'replaceState');

    const { completeEmailLinkSignInIfPresent } = await import('./auth');
    await completeEmailLinkSignInIfPresent();

    expect(window.localStorage.getItem('sudoku-email-link-address')).toBeNull();
    expect(replaceStateSpy).toHaveBeenCalled();
  });

  it('rejects when Firebase Auth is not configured', async () => {
    mocks.auth = undefined;
    const { completeEmailLinkSignInIfPresent } = await import('./auth');
    await expect(completeEmailLinkSignInIfPresent()).rejects.toThrow(
      'Firebase Auth is not configured',
    );
  });
});

describe('signOutUser', () => {
  it('signs out and resets the cached anonymous-auth promise', async () => {
    const { signOutUser } = await import('./auth');
    await signOutUser();

    expect(mocks.signOut).toHaveBeenCalledWith(mocks.auth);
    expect(mocks.resetAnonymousAuthCache).toHaveBeenCalledTimes(1);
  });

  it('rejects when Firebase Auth is not configured', async () => {
    mocks.auth = undefined;
    const { signOutUser } = await import('./auth');
    await expect(signOutUser()).rejects.toThrow('Firebase Auth is not configured');
    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(mocks.resetAnonymousAuthCache).not.toHaveBeenCalled();
  });
});
