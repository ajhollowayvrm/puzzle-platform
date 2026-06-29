// Phase 2 shell. Two ways to play:
//   • Account (cloud): sign in, create a match → share its code, opponent joins from
//     their own phone. The Lambda is authoritative; this client only renders the
//     redacted MatchView it returns, and polls for the opponent's moves.
//   • This device (local): the Phase 1 in-memory/localStorage pass-and-play, no account.
// The home/lobby/match shell is game-agnostic; game specifics live in chain-view.ts.
import {
  getModule,
  listModules,
  MatchService,
  register,
  type MatchView,
  type PlayerRef,
} from '@puzzle/core';
import { chainReaction, type ChainMove, type ChainView } from '@puzzle/game-chain-reaction';
import { PersistentStore } from './persistent-store.js';
import { chainReactionUI } from './chain-view.js';
import { ApiError, CloudApi, type Me } from './api.js';

register(chainReaction);

// ---- local (no-account) backend, unchanged from Phase 1 ----
const LOCAL_PLAYERS: PlayerRef[] = [
  { playerId: 'p1', handle: 'Player 1' },
  { playerId: 'p2', handle: 'Player 2' },
];
const localStore = new PersistentStore();
const localSvc = new MatchService(localStore, { clock: () => Date.now() });

// ---- session / app state ----
type Session = { kind: 'cloud'; api: CloudApi; me: Me } | { kind: 'local' };
type Screen = 'auth' | 'home' | 'lobby' | 'match';

let session: Session | null = null;
let screen: Screen = 'auth';
let authTab: 'login' | 'register' = 'login';
let lobbyGameId: string | null = null;
let activeMatchId: string | null = null;
let activeGameId = 'chain-reaction';
let mode: 'two' | 'pass' = 'two'; // local match view only
let selectedRung: number | null = null;
let lastStatus = '';
let pollTimer: ReturnType<typeof setInterval> | null = null;
let lastVersion = -1;

const app = document.getElementById('app')!;
const TOKEN_KEY = 'pp.token';
const ME_KEY = 'pp.me';

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}
function setStatus(msg: string, bad = false): void {
  lastStatus = msg;
  const el = document.getElementById('status');
  if (el) {
    el.textContent = msg;
    el.classList.toggle('bad', bad);
  }
}
function stopPolling(): void {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

// ---- data access (branches on session) ----
async function listMatches(): Promise<MatchView[]> {
  if (session?.kind === 'cloud') return session.api.listMatches();
  return localSvc.listMatches('p1');
}
async function createMatch(gameId: string, config: unknown): Promise<MatchView> {
  if (session?.kind === 'cloud') return session.api.createMatch(gameId, config);
  return localSvc.createMatch({ gameId, mode: 'versus', players: LOCAL_PLAYERS, config });
}
async function getView(matchId: string, forPlayer: string): Promise<MatchView | null> {
  if (session?.kind === 'cloud') return session.api.getMatch(matchId);
  return localSvc.getMatchView(matchId, forPlayer);
}
async function doMove(matchId: string, move: unknown, asPlayer: string): Promise<{ ok: boolean; error?: string }> {
  if (session?.kind === 'cloud') return session.api.move(matchId, move);
  const out = await localSvc.applyMove({ matchId, playerId: asPlayer, move });
  return out.ok ? { ok: true } : { ok: false, error: out.error };
}

const handlesFrom = (mv: MatchView): ((id: string) => string) => {
  const map = new Map(mv.players.map((p) => [p.playerId, p.handle]));
  return (id) => map.get(id) ?? (id === 'p1' ? 'Player 1' : id === 'p2' ? 'Player 2' : id);
};

// ---- session lifecycle ----
function saveSession(token: string, me: Me): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(ME_KEY, JSON.stringify(me));
  } catch {
    /* ignore */
  }
}
function logout(): void {
  stopPolling();
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(ME_KEY);
  } catch {
    /* ignore */
  }
  session = null;
  screen = 'auth';
  void render();
}
async function restoreSession(): Promise<void> {
  let token: string | null = null;
  let me: Me | null = null;
  try {
    token = localStorage.getItem(TOKEN_KEY);
    const raw = localStorage.getItem(ME_KEY);
    if (raw) me = JSON.parse(raw) as Me;
  } catch {
    /* ignore */
  }
  if (token && me) {
    const api = new CloudApi(undefined, token);
    try {
      await api.me(); // validate token still good
      session = { kind: 'cloud', api, me };
      screen = 'home';
    } catch {
      logout();
      return;
    }
  }
}

// ---- navigation ----
function goHome(): void {
  stopPolling();
  activeMatchId = null;
  screen = 'home';
  void render();
}
function openLobby(gameId: string): void {
  stopPolling();
  lobbyGameId = gameId;
  screen = 'lobby';
  void render();
}
function enterMatch(matchId: string, gameId: string): void {
  stopPolling();
  activeMatchId = matchId;
  activeGameId = gameId;
  selectedRung = null;
  lastVersion = -1;
  screen = 'match';
  if (session?.kind === 'cloud') {
    pollTimer = setInterval(() => void pollCloud(), 2500);
  }
  void render();
}

async function pollCloud(): Promise<void> {
  if (!activeMatchId || session?.kind !== 'cloud') return;
  const mv = await session.api.getMatch(activeMatchId).catch(() => null);
  if (!mv) return;
  if (mv.version !== lastVersion) void render(); // only re-render on real change
  if (mv.status === 'complete') stopPolling();
}

async function startNewMatch(): Promise<void> {
  if (!lobbyGameId) return;
  const config: Record<string, number> = {};
  for (const k of chainReactionUI.knobs) {
    const input = document.getElementById(`cfg-${k.key}`) as HTMLInputElement | null;
    const v = Number(input?.value);
    if (Number.isFinite(v)) config[k.key] = v;
  }
  const modeSel = document.getElementById('cfg-mode') as HTMLSelectElement | null;
  if (modeSel) mode = modeSel.value as 'two' | 'pass';
  try {
    const created = await createMatch(lobbyGameId, config);
    enterMatch(created.matchId, created.gameId);
  } catch (e) {
    setStatus((e as Error).message, true);
  }
}

async function joinByCode(code: string): Promise<void> {
  if (session?.kind !== 'cloud') return;
  try {
    const view = await session.api.joinMatch(code.trim().toUpperCase());
    enterMatch(view.matchId, view.gameId);
  } catch (e) {
    setStatus((e as Error).message, true);
  }
}

async function act(player: string, move: ChainMove): Promise<void> {
  if (!activeMatchId) return;
  const out = await doMove(activeMatchId, move, player);
  if (!out.ok) {
    setStatus(out.error ?? 'illegal move', true);
    return;
  }
  selectedRung = null;
  setStatus('');
  await render();
}

async function submitAuth(): Promise<void> {
  const handle = (document.getElementById('au-handle') as HTMLInputElement).value.trim();
  const password = (document.getElementById('au-pass') as HTMLInputElement).value;
  if (!handle || !password) {
    setStatus('Enter a handle and password.', true);
    return;
  }
  const api = new CloudApi();
  try {
    const r = authTab === 'login' ? await api.login(handle, password) : await api.register(handle, password);
    saveSession(r.token, { userId: r.userId, handle: r.handle });
    session = { kind: 'cloud', api, me: { userId: r.userId, handle: r.handle } };
    screen = 'home';
    await render();
  } catch (e) {
    const msg = e instanceof ApiError ? e.message : 'Could not reach the server.';
    setStatus(msg, true);
  }
}

// ---- rendering ----
async function render(): Promise<void> {
  if (!session) screen = 'auth';
  if (screen === 'auth') app.innerHTML = renderAuth();
  else if (screen === 'home') app.innerHTML = await renderHome();
  else if (screen === 'lobby') app.innerHTML = await renderLobby();
  else app.innerHTML = await renderMatch();
}

function brand(sub = ''): string {
  return `<header class="brand"><h1>Puzzle Platform</h1><p class="sub">${sub}</p></header>`;
}

function renderAuth(): string {
  return `${brand('Sign in to play across two phones — or play locally on this device.')}
    <div class="card authcard">
      <div class="tabs">
        <button data-action="auth-tab" data-tab="login" class="${authTab === 'login' ? 'on' : ''}">Log in</button>
        <button data-action="auth-tab" data-tab="register" class="${authTab === 'register' ? 'on' : ''}">Create account</button>
      </div>
      <div class="field"><label for="au-handle">Handle</label>
        <input id="au-handle" autocomplete="username" maxlength="24" /></div>
      <div class="field"><label for="au-pass">Password</label>
        <input id="au-pass" type="password" autocomplete="${authTab === 'login' ? 'current-password' : 'new-password'}" /></div>
      <button data-action="auth-submit">${authTab === 'login' ? 'Log in' : 'Create account'}</button>
      <div id="status">${esc(lastStatus)}</div>
    </div>
    <p class="orline">or</p>
    <button class="secondary wide" data-action="play-local">Play on this device (no account)</button>`;
}

function accountBar(): string {
  if (session?.kind === 'cloud') {
    return `<div class="acct">Signed in as <b>${esc(session.me.handle)}</b> · <button class="link" data-action="logout">Log out</button></div>`;
  }
  return `<div class="acct">Playing on this device · <button class="link" data-action="logout">Use an account</button></div>`;
}

async function renderHome(): Promise<string> {
  const all = await listMatches().catch(() => [] as MatchView[]);
  const active = all.filter((m) => m.status !== 'complete');

  const continueCard =
    active.length > 0
      ? (() => {
          const m = active[0]!;
          const name = getModule(m.gameId).meta.name;
          const sub = m.status === 'waiting' ? `Waiting · code ${m.inviteCode ?? ''}` : chainReactionUI.summary(m, handlesFrom(m));
          return `<button class="continue" data-action="resume" data-match="${m.matchId}" data-game="${m.gameId}">
            <span class="continue-k">Continue</span><span class="continue-name">${esc(name)}</span>
            <span class="continue-sub">${esc(sub)}</span></button>`;
        })()
      : '';

  const joinCard =
    session?.kind === 'cloud'
      ? `<div class="card joincard">
          <h2 class="section">Join a game</h2>
          <div class="joinrow">
            <input id="join-code" placeholder="ENTER CODE" maxlength="6" autocapitalize="characters" autocomplete="off" />
            <button data-action="join-code">Join</button>
          </div>
        </div>`
      : '';

  const cards = listModules()
    .map((mod) => {
      const meta = mod.meta;
      const inProgress = active.filter((m) => m.gameId === meta.id).length;
      const badge = inProgress > 0 ? `<span class="pill">${inProgress} in progress</span>` : '';
      const tag = `${meta.model === 'shared-turn' ? 'Turn-based' : 'Same-seed'} · ${meta.minPlayers}–${meta.maxPlayers}p`;
      return `<button class="gamecard" data-action="open-game" data-game="${meta.id}">
        <span class="gc-name">${esc(meta.name)}</span><span class="gc-tag">${esc(tag)}</span>${badge}</button>`;
    })
    .join('');

  return `${brand('')}${accountBar()}
    ${continueCard}
    ${joinCard}
    <h2 class="section">Start a game</h2>
    <div class="grid">${cards}</div>`;
}

async function renderLobby(): Promise<string> {
  const gameId = lobbyGameId!;
  const meta = getModule(gameId).meta;
  const mine = (await listMatches().catch(() => [] as MatchView[])).filter((m) => m.gameId === gameId);

  const knobs = chainReactionUI.knobs
    .map(
      (k) => `<div class="field"><label for="cfg-${k.key}">${esc(k.label)}</label>
        <input id="cfg-${k.key}" type="number" min="${k.min}" max="${k.max}" value="${k.default}" /></div>`,
    )
    .join('');

  const modeField =
    session?.kind === 'local'
      ? `<div class="field"><label for="cfg-mode">View</label>
          <select id="cfg-mode">
            <option value="two"${mode === 'two' ? ' selected' : ''}>Two clients</option>
            <option value="pass"${mode === 'pass' ? ' selected' : ''}>Pass &amp; play</option>
          </select></div>`
      : '';

  const startHint = session?.kind === 'cloud' ? '<p class="hint">You\'ll get a code to share with your opponent.</p>' : '';

  const games = mine.length
    ? mine
        .map((m) => {
          const sub = m.status === 'waiting' ? `Waiting for opponent · code ${m.inviteCode ?? ''}` : chainReactionUI.summary(m, handlesFrom(m));
          const cls = m.status === 'complete' ? 'done' : 'live';
          const del = session?.kind === 'local' ? `<button class="mr-del secondary" data-action="delete-match" data-match="${m.matchId}" aria-label="Delete">✕</button>` : '';
          return `<div class="matchrow ${cls}">
            <button class="mr-main" data-action="resume" data-match="${m.matchId}" data-game="${m.gameId}"><span class="mr-sub">${esc(sub)}</span></button>
            ${del}</div>`;
        })
        .join('')
    : `<p class="empty">No games yet — start one above.</p>`;

  return `<div class="topbar"><button class="secondary" data-action="home">← Games</button><strong>${esc(meta.name)}</strong><span></span></div>
    <div id="status">${esc(lastStatus)}</div>
    <section class="card"><h2 class="section">New game</h2>
      <div class="toolbar">${knobs}${modeField}<div class="field"><button data-action="new-game">Start</button></div></div>
      ${startHint}
    </section>
    <section class="card"><h2 class="section">Your games</h2><div class="matchlist">${games}</div></section>`;
}

async function renderMatch(): Promise<string> {
  return session?.kind === 'cloud' ? renderCloudMatch() : renderLocalMatch();
}

async function renderCloudMatch(): Promise<string> {
  const matchId = activeMatchId!;
  const me = (session as { kind: 'cloud'; me: Me }).me;
  const mv = await (session as { api: CloudApi }).api.getMatch(matchId).catch(() => null);
  const name = getModule(activeGameId).meta.name;
  const top = `<div class="topbar"><button class="secondary" data-action="home">← Home</button><strong>${esc(name)}</strong><span></span></div>`;

  if (!mv) return `${top}<p class="empty">Couldn't load this game.</p>`;
  lastVersion = mv.version;

  if (mv.status === 'waiting' || mv.view === null) {
    return `${top}
      <section class="card waiting">
        <h2 class="section">Waiting for your opponent</h2>
        <p>Share this code so they can join from their phone:</p>
        <div class="codebig" id="codebig">${esc(mv.inviteCode ?? '——')}</div>
        <button class="secondary" data-action="copy-code" data-code="${esc(mv.inviteCode ?? '')}">Copy code</button>
        <p class="hint">This page checks for them automatically.</p>
      </section>`;
  }

  const v = mv.view as ChainView;
  const handleOf = handlesFrom(mv);
  const opp = mv.players.find((p) => p.playerId !== me.userId);
  const turnLine = v.matchOver
    ? winnerLine(mv, handleOf)
    : v.turn === me.userId
      ? '<span class="turn-you">Your turn</span>'
      : `Waiting for ${esc(opp ? handleOf(opp.playerId) : 'opponent')}…`;

  const panel = chainReactionUI.renderPanel(mv, me.userId, { handleOf, selectedRung });
  return `${top}
    <div class="turnline">${turnLine}${opp ? ` · vs ${esc(handleOf(opp.playerId))}` : ''}</div>
    <div id="status">${esc(lastStatus)}</div>
    <div class="panels">${panel}</div>`;
}

function winnerLine(mv: MatchView, handleOf: (id: string) => string): string {
  const ids = mv.result.winnerIds;
  if (ids.length === 1) return `<span class="turn-you">${esc(handleOf(ids[0]!))} won 🎉</span>`;
  if (ids.length > 1) return 'Tie game';
  return 'Match over';
}

async function renderLocalMatch(): Promise<string> {
  const matchId = activeMatchId!;
  const name = getModule(activeGameId).meta.name;
  let panels = '';
  if (mode === 'two') {
    const views = await Promise.all(LOCAL_PLAYERS.map((p) => getView(matchId, p.playerId)));
    panels = views
      .map((mv, i) =>
        mv ? chainReactionUI.renderPanel(mv, LOCAL_PLAYERS[i]!.playerId, { handleOf: handlesFrom(mv), selectedRung }) : '',
      )
      .join('');
  } else {
    const probe = await getView(matchId, 'p1');
    if (probe) {
      const cv = probe.view as ChainView | null;
      const current = !cv || cv.matchOver ? 'p1' : cv.turn;
      const mv = await getView(matchId, current);
      if (mv) panels = chainReactionUI.renderPanel(mv, current, { handleOf: handlesFrom(mv), selectedRung });
    }
  }
  return `<div class="topbar">
      <button class="secondary" data-action="home">← Home</button><strong>${esc(name)}</strong>
      <button class="secondary" data-action="toggle-mode">${mode === 'two' ? 'Two clients' : 'Pass & play'}</button>
    </div>
    <div id="status">${esc(lastStatus)}</div>
    <div class="panels ${mode === 'pass' ? 'pass' : ''}">${panels}</div>`;
}

// ---- events (delegated once on the persistent #app root) ----
app.addEventListener('click', (ev) => {
  const t = ev.target as HTMLElement;
  const actionEl = t.closest('[data-action]') as HTMLElement | null;

  const rungEl = t.closest('.rung') as HTMLElement | null;
  if (rungEl && rungEl.getAttribute('aria-disabled') !== 'true' && !actionEl?.dataset.action) {
    selectedRung = Number(rungEl.dataset.rung);
    void render();
    return;
  }
  if (!actionEl) return;
  const a = actionEl.dataset.action;
  const player = actionEl.dataset.player;

  switch (a) {
    case 'auth-tab':
      authTab = actionEl.dataset.tab as 'login' | 'register';
      lastStatus = '';
      void render();
      break;
    case 'auth-submit':
      void submitAuth();
      break;
    case 'play-local':
      session = { kind: 'local' };
      screen = 'home';
      void render();
      break;
    case 'logout':
      logout();
      break;
    case 'home':
      goHome();
      break;
    case 'open-game':
      openLobby(actionEl.dataset.game!);
      break;
    case 'new-game':
      void startNewMatch();
      break;
    case 'join-code': {
      const input = document.getElementById('join-code') as HTMLInputElement | null;
      if (input?.value.trim()) void joinByCode(input.value);
      break;
    }
    case 'resume':
      enterMatch(actionEl.dataset.match!, actionEl.dataset.game ?? 'chain-reaction');
      break;
    case 'delete-match':
      void (async () => {
        await localStore.deleteMatch(actionEl.dataset.match!);
        void render();
      })();
      break;
    case 'toggle-mode':
      mode = mode === 'two' ? 'pass' : 'two';
      selectedRung = null;
      void render();
      break;
    case 'copy-code':
      void navigator.clipboard?.writeText(actionEl.dataset.code ?? '').then(() => setStatus('Code copied.'));
      break;
    case 'peek':
      if (player && selectedRung !== null) void act(player, { kind: 'peek', rung: selectedRung });
      break;
    case 'solve':
      if (player && selectedRung !== null) {
        const input = document.getElementById(`guess-${player}`) as HTMLInputElement | null;
        void act(player, { kind: 'solve', rung: selectedRung, guess: input?.value ?? '' });
      }
      break;
  }
});

app.addEventListener('keydown', (ev) => {
  const t = ev.target as HTMLElement;
  if (ev.key !== 'Enter' || !(t instanceof HTMLInputElement)) return;
  if (t.id.startsWith('guess-') && selectedRung !== null) {
    void act(t.id.replace('guess-', ''), { kind: 'solve', rung: selectedRung, guess: t.value });
  } else if (t.id === 'join-code' && t.value.trim()) {
    void joinByCode(t.value);
  } else if ((t.id === 'au-handle' || t.id === 'au-pass') && screen === 'auth') {
    void submitAuth();
  }
});

void (async () => {
  await restoreSession();
  await render();
})();
