import { Board } from './solver';

// FNV-1a-style hash, parameterized by both offset basis and multiplier —
// run twice below with different constants for each and concatenated,
// giving a 64-bit-ish fingerprint from two cheap, synchronous 32-bit hashes
// rather than pulling in an async crypto.subtle dependency for a
// non-adversarial dedupe key.
function fnv1a(str: string, offsetBasis: number, prime: number): number {
  let hash = offsetBasis >>> 0;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, prime);
  }
  return hash >>> 0;
}

// A stable identifier for a solved board, used to key puzzle documents in
// Firestore. Two independently-generated puzzles with the same solution
// produce the same ID, so duplicate generations collapse onto one doc
// instead of creating a new one.
//
// The two passes use different multipliers (not just different offset
// bases) so they're genuinely independent hashes rather than the same
// function reseeded — issue #20: sharing a multiplier means the two passes
// are correlated, which weakens the combined fingerprint's collision
// resistance below what two truly independent ~32-bit hashes would give,
// and a collision here would silently merge two distinct puzzles' stats in
// Firestore. `0x01000193` is the standard FNV-1a 32-bit prime; `0x5bd1e995`
// is MurmurHash2's multiplier, chosen as a second well-established constant
// with good avalanche behavior rather than an arbitrary number.
export function hashSolution(solution: Board): string {
  const flat = solution
    .map((row) => row.map((cell) => cell ?? 0).join(''))
    .join('');
  const a = fnv1a(flat, 0x811c9dc5, 0x01000193);
  const b = fnv1a(flat, 0x9e3779b9, 0x5bd1e995);
  return a.toString(36) + b.toString(36);
}
