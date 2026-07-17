import { Board } from './solver';

// FNV-1a, run twice with different offset bases and concatenated, giving a
// 64-bit-ish fingerprint from two cheap, synchronous 32-bit hashes rather
// than pulling in an async crypto.subtle dependency for a non-adversarial
// dedupe key.
function fnv1a(str: string, offsetBasis: number): number {
  let hash = offsetBasis >>> 0;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

// A stable identifier for a solved board, used to key puzzle documents in
// Firestore. Two independently-generated puzzles with the same solution
// produce the same ID, so duplicate generations collapse onto one doc
// instead of creating a new one.
export function hashSolution(solution: Board): string {
  const flat = solution
    .map((row) => row.map((cell) => cell ?? 0).join(''))
    .join('');
  const a = fnv1a(flat, 0x811c9dc5);
  const b = fnv1a(flat, 0x9e3779b9);
  return a.toString(36) + b.toString(36);
}
