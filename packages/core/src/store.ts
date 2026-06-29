// Persistence boundary. Phase 1 ships InMemoryStore; Phase 2 swaps in a DynamoDB
// implementation behind this SAME interface — the move pipeline never changes.
// Mirrors the DynamoDB entities in CLAUDE.md §6.

import type { GameMode, GameModel } from './types.js';

export interface UserRecord {
  userId: string;
  handle: string;
  handleLower: string; // unique key (case-insensitive)
  passwordHash: string;
  salt: string;
  createdAt: number;
}

export interface TokenRecord {
  token: string; // opaque random token
  userId: string;
  expiresAt: number; // epoch ms
}

export type MatchStatus = 'waiting' | 'active' | 'complete';

export interface MatchRecord {
  matchId: string;
  gameId: string;
  mode: GameMode;
  model: GameModel;
  playerIds: string[];
  playerHandles: Record<string, string>; // playerId -> display handle (for the UI)
  inviteCode: string | null; // short code a second player joins with (null for local)
  seed: string;
  config: unknown; // game-defined tuning knobs
  state: unknown; // game-defined state JSON (pre-redaction); null while waiting
  version: number; // optimistic lock
  status: MatchStatus;
  turn: string | null; // nullable (same-seed-compare / waiting has no turn)
  createdAt: number;
  updatedAt: number;
}

// Fields conditionally written after a successful move OR a join. updatedAt is
// always set; everything else is optional so the move pipeline and the join path
// can each write just what they change.
export interface MatchPatch {
  state?: unknown;
  status?: MatchStatus;
  turn?: string | null;
  playerIds?: string[];
  playerHandles?: Record<string, string>;
  updatedAt: number;
}

export interface Store {
  // --- users ---
  createUser(u: UserRecord): Promise<void>; // throws if handle taken
  getUser(userId: string): Promise<UserRecord | null>;
  getUserByHandle(handleLower: string): Promise<UserRecord | null>;

  // --- tokens ---
  putToken(t: TokenRecord): Promise<void>;
  getToken(token: string): Promise<TokenRecord | null>;
  deleteToken(token: string): Promise<void>;

  // --- matches ---
  createMatch(m: MatchRecord): Promise<void>;
  getMatch(matchId: string): Promise<MatchRecord | null>;
  getMatchByCode(inviteCode: string): Promise<MatchRecord | null>;
  listMatchesForUser(userId: string): Promise<MatchRecord[]>;
  deleteMatch(matchId: string): Promise<void>;

  // Optimistic-locked update. Writes patch (and bumps version) ONLY if the
  // current stored version === expectedVersion. Returns the new version on
  // success, or null if the version no longer matches (caller must retry).
  // This is the in-memory analogue of a DynamoDB conditional write.
  updateMatch(
    matchId: string,
    expectedVersion: number,
    patch: MatchPatch,
  ): Promise<number | null>;
}

export class HandleTakenError extends Error {
  constructor(handle: string) {
    super(`handle already taken: ${handle}`);
    this.name = 'HandleTakenError';
  }
}

export class InMemoryStore implements Store {
  private users = new Map<string, UserRecord>();
  private usersByHandle = new Map<string, string>(); // handleLower -> userId
  private tokens = new Map<string, TokenRecord>();
  private matches = new Map<string, MatchRecord>();

  async createUser(u: UserRecord): Promise<void> {
    if (this.usersByHandle.has(u.handleLower)) throw new HandleTakenError(u.handle);
    this.users.set(u.userId, { ...u });
    this.usersByHandle.set(u.handleLower, u.userId);
  }

  async getUser(userId: string): Promise<UserRecord | null> {
    const u = this.users.get(userId);
    return u ? { ...u } : null;
  }

  async getUserByHandle(handleLower: string): Promise<UserRecord | null> {
    const id = this.usersByHandle.get(handleLower);
    if (!id) return null;
    const u = this.users.get(id);
    return u ? { ...u } : null;
  }

  async putToken(t: TokenRecord): Promise<void> {
    this.tokens.set(t.token, { ...t });
  }

  async getToken(token: string): Promise<TokenRecord | null> {
    const t = this.tokens.get(token);
    return t ? { ...t } : null;
  }

  async deleteToken(token: string): Promise<void> {
    this.tokens.delete(token);
  }

  async createMatch(m: MatchRecord): Promise<void> {
    this.matches.set(m.matchId, structuredClone(m));
  }

  async getMatch(matchId: string): Promise<MatchRecord | null> {
    const m = this.matches.get(matchId);
    return m ? structuredClone(m) : null;
  }

  async getMatchByCode(inviteCode: string): Promise<MatchRecord | null> {
    for (const m of this.matches.values()) {
      if (m.inviteCode === inviteCode) return structuredClone(m);
    }
    return null;
  }

  async listMatchesForUser(userId: string): Promise<MatchRecord[]> {
    const out: MatchRecord[] = [];
    for (const m of this.matches.values()) {
      if (m.playerIds.includes(userId)) out.push(structuredClone(m));
    }
    return out.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async deleteMatch(matchId: string): Promise<void> {
    this.matches.delete(matchId);
  }

  async updateMatch(
    matchId: string,
    expectedVersion: number,
    patch: MatchPatch,
  ): Promise<number | null> {
    const cur = this.matches.get(matchId);
    if (!cur) return null;
    if (cur.version !== expectedVersion) return null; // conditional-write failure
    const nextVersion = cur.version + 1;
    this.matches.set(matchId, { ...cur, ...applyPatch(patch), version: nextVersion });
    return nextVersion;
  }
}

// Apply only the fields a MatchPatch actually sets (everything but updatedAt is
// optional). Shared by the in-memory and persistent stores.
export function applyPatch(patch: MatchPatch): Partial<MatchRecord> {
  const out: Partial<MatchRecord> = { updatedAt: patch.updatedAt };
  if ('state' in patch) out.state = structuredClone(patch.state);
  if (patch.status !== undefined) out.status = patch.status;
  if (patch.turn !== undefined) out.turn = patch.turn;
  if (patch.playerIds !== undefined) out.playerIds = [...patch.playerIds];
  if (patch.playerHandles !== undefined) out.playerHandles = { ...patch.playerHandles };
  return out;
}
