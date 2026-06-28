// Opaque id/seed/token generation. Uses the Web Crypto API present in both modern
// browsers and Node (globalThis.crypto), so this stays browser-safe — no node:crypto.

export function newId(prefix = ''): string {
  return prefix + globalThis.crypto.randomUUID();
}

export function newSeed(): string {
  return globalThis.crypto.randomUUID();
}

// 256 bits of opaque randomness, hex-encoded. For bearer tokens.
export function newToken(): string {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}
