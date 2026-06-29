// Lambda behind a Function URL (payload format 2.0). The single authoritative write
// path is MatchService.applyMove (§5); redaction happens here, server-side, so a
// client never receives hidden state. Auth is a Bearer token (DIY scrypt).
import { MatchService, register } from '@puzzle/core';
import { AccountService, AuthError } from '@puzzle/core/auth';
import { chainReaction } from '@puzzle/game-chain-reaction';
import { DynamoStore } from './dynamo-store.js';

register(chainReaction);

const TABLE = process.env.TABLE_NAME ?? 'puzzle-platform';
const store = new DynamoStore(TABLE);
const accounts = new AccountService(store);
const matches = new MatchService(store);

type Json = Record<string, unknown>;
interface LambdaEvent {
  rawPath?: string;
  body?: string;
  isBase64Encoded?: boolean;
  headers?: Record<string, string | undefined>;
  requestContext?: { http?: { method?: string } };
}

function res(statusCode: number, body: Json) {
  return { statusCode, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}

function parseBody(event: LambdaEvent): Record<string, any> {
  if (!event.body) return {};
  const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
  try {
    return JSON.parse(raw) as Record<string, any>;
  } catch {
    return {};
  }
}

async function authUser(token: string): Promise<{ userId: string; handle: string } | null> {
  const v = await accounts.verifyToken(token);
  if (!v) return null;
  const u = await store.getUser(v.userId);
  return u ? { userId: u.userId, handle: u.handle } : null;
}

export const handler = async (event: LambdaEvent) => {
  const method = event.requestContext?.http?.method ?? 'GET';
  const path = (event.rawPath ?? '/').replace(/\/+$/, '') || '/';

  try {
    if (method === 'OPTIONS') return res(200, {});
    const body = parseBody(event);

    // --- public routes ---
    if (method === 'POST' && path === '/auth/register') {
      const r = await accounts.register(String(body.handle ?? ''), String(body.password ?? ''));
      return res(200, { token: r.token, userId: r.userId, handle: r.handle });
    }
    if (method === 'POST' && path === '/auth/login') {
      const r = await accounts.login(String(body.handle ?? ''), String(body.password ?? ''));
      return res(200, { token: r.token, userId: r.userId, handle: r.handle });
    }

    // --- everything below requires a valid bearer token ---
    const auth = event.headers?.authorization ?? event.headers?.Authorization;
    const token = auth?.startsWith('Bearer ') ? auth.slice(7) : undefined;
    const me = token ? await authUser(token) : null;
    if (!me) return res(401, { error: 'sign in required' });

    if (method === 'GET' && path === '/me') return res(200, me);

    if (method === 'POST' && path === '/matches') {
      const view = await matches.createMatch({
        gameId: String(body.gameId ?? 'chain-reaction'),
        mode: 'versus',
        players: [{ playerId: me.userId, handle: me.handle }],
        config: body.config,
      });
      return res(200, view as unknown as Json);
    }
    if (method === 'POST' && path === '/matches/join') {
      const view = await matches.joinMatch({
        code: String(body.code ?? '').trim().toUpperCase(),
        player: { playerId: me.userId, handle: me.handle },
      });
      return res(200, view as unknown as Json);
    }
    if (method === 'GET' && path === '/matches') {
      return res(200, { matches: await matches.listMatches(me.userId) });
    }

    const byId = path.match(/^\/matches\/([^/]+)$/);
    if (method === 'GET' && byId) {
      const view = await matches.getMatchView(byId[1]!, me.userId);
      if (!view || !view.players.some((p) => p.playerId === me.userId)) {
        return res(404, { error: 'not found' });
      }
      return res(200, view as unknown as Json);
    }

    const move = path.match(/^\/matches\/([^/]+)\/move$/);
    if (method === 'POST' && move) {
      const out = await matches.applyMove({ matchId: move[1]!, playerId: me.userId, move: body.move });
      return out.ok ? res(200, out.view as unknown as Json) : res(400, { error: out.error, code: out.code });
    }

    return res(404, { error: 'no such route', method, path });
  } catch (e) {
    if (e instanceof AuthError) return res(400, { error: e.message, code: e.code });
    return res(400, { error: (e as Error)?.message ?? 'request failed' });
  }
};
