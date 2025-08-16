/**
 * Fast FNV-1a hash function for 32-bit integers
 * This is a fast, non-cryptographic hash function with excellent distribution
 */
export function fnv1a(hash: number, value: number): number {
  // Convert number to bytes and hash each byte
  const bytes = new Uint8Array(new Float64Array([value]).buffer);
  let result = hash;
  for (let i = 0; i < 8; i++) {
    result ^= bytes[i];
    result = (result * 0x01000193) >>> 0; // FNV prime, ensure 32-bit
  }
  return result;
}

/**
 * Initialize a new FNV-1a hash
 */
export function initHash(): number {
  return 0x811c9dc5; // FNV-1a hash offset basis
}

/**
 * Finalize a hash to ensure it's a positive 32-bit integer
 */
export function finalizeHash(hash: number): number {
  return hash >>> 0;
}
