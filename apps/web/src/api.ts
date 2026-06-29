// Thin client for the cloud backend (Lambda Function URL). The server is
// authoritative and returns redacted MatchViews; this client never sees raw state.
import type { MatchView } from '@puzzle/core';
import { API_URL } from './config.js';

export interface Me {
  userId: string;
  handle: string;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class CloudApi {
  constructor(
    private readonly base = API_URL,
    public token: string | null = null,
  ) {}

  private async req(method: string, path: string, body?: unknown): Promise<any> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    const init: RequestInit = { method, headers };
    if (body !== undefined) init.body = JSON.stringify(body);
    const r = await fetch(this.base + path, init);
    const text = await r.text();
    let data: any = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      /* non-JSON error body */
    }
    if (!r.ok) throw new ApiError(r.status, data.error ?? r.statusText, data.code);
    return data;
  }

  async register(handle: string, password: string): Promise<Me & { token: string }> {
    const d = await this.req('POST', '/auth/register', { handle, password });
    this.token = d.token;
    return d;
  }
  async login(handle: string, password: string): Promise<Me & { token: string }> {
    const d = await this.req('POST', '/auth/login', { handle, password });
    this.token = d.token;
    return d;
  }
  async me(): Promise<Me> {
    return this.req('GET', '/me');
  }
  async createMatch(gameId: string, config: unknown): Promise<MatchView> {
    return this.req('POST', '/matches', { gameId, config });
  }
  async joinMatch(code: string): Promise<MatchView> {
    return this.req('POST', '/matches/join', { code });
  }
  async listMatches(): Promise<MatchView[]> {
    return (await this.req('GET', '/matches')).matches;
  }
  async getMatch(id: string): Promise<MatchView | null> {
    try {
      return await this.req('GET', `/matches/${id}`);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return null;
      throw e;
    }
  }
  async move(id: string, move: unknown): Promise<{ ok: boolean; view?: MatchView; error?: string }> {
    try {
      const view = await this.req('POST', `/matches/${id}/move`, { move });
      return { ok: true, view };
    } catch (e) {
      if (e instanceof ApiError) return { ok: false, error: e.message };
      throw e;
    }
  }
}
