// DIY token auth (CLAUDE.md §3 decision). SERVER-ONLY — imports node:crypto, so it
// is exposed at the subpath "@puzzle/core/auth" and never pulled into the browser
// bundle. Reused unchanged by the Phase 2 Lambda account handlers.
//
// Guardrails honored: vetted KDF (scrypt from Node's stdlib — no native build pain),
// store only salted hashes, opaque random tokens with expiry, constant-time compare.

import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { newId, newToken } from './ids.js';
import type { Store, UserRecord } from './store.js';

const scrypt = promisify(scryptCb) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
) => Promise<Buffer>;

const KEYLEN = 64;
const SALT_BYTES = 16;
const DEFAULT_TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

export interface AuthResult {
  userId: string;
  handle: string;
  token: string;
  expiresAt: number;
}

export class AuthError extends Error {
  constructor(
    public readonly code: 'handle_taken' | 'invalid_credentials' | 'invalid_input',
    message: string,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

export interface AccountServiceOptions {
  clock?: () => number;
  tokenTtlMs?: number;
}

export class AccountService {
  private readonly store: Store;
  private readonly clock: () => number;
  private readonly tokenTtlMs: number;

  constructor(store: Store, opts: AccountServiceOptions = {}) {
    this.store = store;
    this.clock = opts.clock ?? (() => Date.now());
    this.tokenTtlMs = opts.tokenTtlMs ?? DEFAULT_TOKEN_TTL_MS;
  }

  async register(handle: string, password: string): Promise<AuthResult> {
    const h = handle.trim();
    if (h.length < 2 || h.length > 24) {
      throw new AuthError('invalid_input', 'handle must be 2-24 characters');
    }
    if (password.length < 8) {
      throw new AuthError('invalid_input', 'password must be at least 8 characters');
    }
    const salt = randomBytes(SALT_BYTES).toString('hex');
    const passwordHash = (await scrypt(password, salt, KEYLEN)).toString('hex');
    const user: UserRecord = {
      userId: newId('u_'),
      handle: h,
      handleLower: h.toLowerCase(),
      passwordHash,
      salt,
      createdAt: this.clock(),
    };
    try {
      await this.store.createUser(user);
    } catch {
      throw new AuthError('handle_taken', 'that handle is taken');
    }
    return this.issueToken(user);
  }

  async login(handle: string, password: string): Promise<AuthResult> {
    const user = await this.store.getUserByHandle(handle.trim().toLowerCase());
    // Always run scrypt to keep timing uniform whether or not the user exists.
    const saltForWork = user?.salt ?? 'no-such-user-salt';
    const computed = (await scrypt(password, saltForWork, KEYLEN)).toString('hex');
    if (!user || !constantTimeEqualHex(computed, user.passwordHash)) {
      throw new AuthError('invalid_credentials', 'invalid handle or password');
    }
    return this.issueToken(user);
  }

  // Verify a bearer token (e.g. on WebSocket $connect or each REST call).
  async verifyToken(token: string): Promise<{ userId: string } | null> {
    const rec = await this.store.getToken(token);
    if (!rec) return null;
    if (rec.expiresAt <= this.clock()) {
      await this.store.deleteToken(token);
      return null;
    }
    return { userId: rec.userId };
  }

  async logout(token: string): Promise<void> {
    await this.store.deleteToken(token);
  }

  private async issueToken(user: UserRecord): Promise<AuthResult> {
    const token = newToken();
    const expiresAt = this.clock() + this.tokenTtlMs;
    await this.store.putToken({ token, userId: user.userId, expiresAt });
    return { userId: user.userId, handle: user.handle, token, expiresAt };
  }
}

function constantTimeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}
