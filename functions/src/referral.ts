// Unambiguous alphabet: no 0/O, 1/I/L.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** A 6-character invitation code. Not a secret — redemption is guarded by caps. */
export const newCode = (rand: () => number = Math.random): string =>
  Array.from({ length: 6 }, () => ALPHABET[Math.floor(rand() * ALPHABET.length)]).join('');

export const normalizeCode = (raw: unknown): string => String(raw ?? '').trim().toUpperCase();
