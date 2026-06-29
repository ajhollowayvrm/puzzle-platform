// Browser Store implementation backed by localStorage, so matches survive page
// reloads — that's what makes "continue a game" real on the static site.
// Implements the SAME @puzzle/core Store interface the Phase 2 DynamoDB store will,
// so the MatchService move pipeline is identical against either backend.
//
// Matches are persisted; users/tokens stay in-memory (no auth UI in the local
// prototype yet — Phase 2 owns accounts).
import {
  HandleTakenError,
  type MatchPatch,
  type MatchRecord,
  type Store,
  type TokenRecord,
  type UserRecord,
} from '@puzzle/core';

const MATCHES_KEY = 'pp.matches.v1';

export class PersistentStore implements Store {
  private users = new Map<string, UserRecord>();
  private usersByHandle = new Map<string, string>();
  private tokens = new Map<string, TokenRecord>();
  private matches = new Map<string, MatchRecord>();

  constructor() {
    this.loadMatches();
  }

  private loadMatches(): void {
    try {
      const raw = globalThis.localStorage?.getItem(MATCHES_KEY);
      if (!raw) return;
      const obj = JSON.parse(raw) as Record<string, MatchRecord>;
      for (const [id, rec] of Object.entries(obj)) this.matches.set(id, rec);
    } catch {
      /* private mode / corrupt data — degrade to in-memory */
    }
  }

  private saveMatches(): void {
    try {
      const obj: Record<string, MatchRecord> = {};
      for (const [id, rec] of this.matches) obj[id] = rec;
      globalThis.localStorage?.setItem(MATCHES_KEY, JSON.stringify(obj));
    } catch {
      /* storage full / unavailable — keep running from memory */
    }
  }

  // --- users (in-memory) ---
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
    const u = id ? this.users.get(id) : undefined;
    return u ? { ...u } : null;
  }

  // --- tokens (in-memory) ---
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

  // --- matches (persisted) ---
  async createMatch(m: MatchRecord): Promise<void> {
    this.matches.set(m.matchId, structuredClone(m));
    this.saveMatches();
  }
  async getMatch(matchId: string): Promise<MatchRecord | null> {
    const m = this.matches.get(matchId);
    return m ? structuredClone(m) : null;
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
    this.saveMatches();
  }

  // Optimistic-locked conditional write (matches InMemoryStore semantics).
  async updateMatch(
    matchId: string,
    expectedVersion: number,
    patch: MatchPatch,
  ): Promise<number | null> {
    const cur = this.matches.get(matchId);
    if (!cur) return null;
    if (cur.version !== expectedVersion) return null;
    const nextVersion = cur.version + 1;
    this.matches.set(matchId, {
      ...cur,
      state: structuredClone(patch.state),
      status: patch.status,
      turn: patch.turn,
      updatedAt: patch.updatedAt,
      version: nextVersion,
    });
    this.saveMatches();
    return nextVersion;
  }
}
