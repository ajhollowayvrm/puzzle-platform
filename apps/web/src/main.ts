// Phase 1 local prototype shell. Runs the generic core in-memory IN THE BROWSER
// (localStorage-backed so games survive reloads) and presents a game-agnostic
// home → lobby → match flow. Game-specific rendering lives in per-game adapters
// (see game-ui.ts); the shell only knows the registry + the redacted MatchView.
import {
  getModule,
  listModules,
  MatchService,
  register,
  type MatchView,
  type PlayerRef,
} from '@puzzle/core';
import { chainReaction } from '@puzzle/game-chain-reaction';
import { PersistentStore } from './persistent-store.js';
import { chainReactionUI } from './chain-view.js';
import type { ChainMove } from '@puzzle/game-chain-reaction';
import type { GameUI } from './game-ui.js';

register(chainReaction);

// per-game UI adapters, keyed by gameId (a game with no entry shows as "coming soon")
const GAME_UI: Record<string, GameUI> = {
  'chain-reaction': chainReactionUI,
};

const PLAYERS: PlayerRef[] = [
  { playerId: 'p1', handle: 'Player 1' },
  { playerId: 'p2', handle: 'Player 2' },
];
const LOCAL_ID = 'p1'; // all local matches include p1; used to list "my games"
const handleOf = (id: string) => PLAYERS.find((p) => p.playerId === id)?.handle ?? id;

const store = new PersistentStore();
const svc = new MatchService(store, { clock: () => Date.now() });

// ---- app state ----
type Screen = 'home' | 'lobby' | 'match';
let screen: Screen = 'home';
let lobbyGameId: string | null = null;
let activeMatchId: string | null = null;
let mode: 'two' | 'pass' = 'two';
let selectedRung: number | null = null;
let lastStatus = '';
let unsubscribe: (() => void) | null = null;

const app = document.getElementById('app')!;

// ---- helpers ----
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

// ---- navigation ----
function goHome(): void {
  unsubscribe?.();
  unsubscribe = null;
  activeMatchId = null;
  screen = 'home';
  void render();
}
function openLobby(gameId: string): void {
  unsubscribe?.();
  unsubscribe = null;
  lobbyGameId = gameId;
  screen = 'lobby';
  void render();
}
function enterMatch(matchId: string): void {
  unsubscribe?.();
  activeMatchId = matchId;
  selectedRung = null;
  screen = 'match';
  unsubscribe = svc.subscribe(matchId, (u) => {
    const ui = GAME_UI[getMatchGameId(u.viewsByPlayer)];
    setStatus(ui ? ui.describeEvents(u.events, handleOf) : '');
    void render();
  });
  void render();
}
function getMatchGameId(views: Record<string, MatchView>): string {
  return Object.values(views)[0]?.gameId ?? '';
}

async function startNewMatch(): Promise<void> {
  if (!lobbyGameId) return;
  const ui = GAME_UI[lobbyGameId];
  const config: Record<string, number> = {};
  if (ui) {
    for (const k of ui.knobs) {
      const input = document.getElementById(`cfg-${k.key}`) as HTMLInputElement | null;
      const v = Number(input?.value);
      if (Number.isFinite(v)) config[k.key] = v;
    }
  }
  const modeSel = document.getElementById('cfg-mode') as HTMLSelectElement | null;
  if (modeSel) mode = modeSel.value as 'two' | 'pass';

  const created = await svc.createMatch({
    gameId: lobbyGameId,
    mode: 'versus',
    players: PLAYERS,
    config,
  });
  setStatus('New match — Player 1 starts.');
  enterMatch(created.matchId);
}

async function deleteMatch(matchId: string): Promise<void> {
  await store.deleteMatch(matchId);
  void render();
}

async function act(playerId: string, move: ChainMove): Promise<void> {
  if (!activeMatchId) return;
  const out = await svc.applyMove({ matchId: activeMatchId, playerId, move });
  if (!out.ok) {
    setStatus(out.error, true);
    return;
  }
  selectedRung = null;
  // success fires the subscription, which re-renders.
}

// ---- rendering ----
async function render(): Promise<void> {
  if (screen === 'home') app.innerHTML = await renderHome();
  else if (screen === 'lobby') app.innerHTML = await renderLobby();
  else app.innerHTML = await renderMatch();
}

function brand(): string {
  return `<header class="brand">
    <h1>Puzzle Platform</h1>
    <p class="sub">Two-player puzzle games. The board is server-authoritative and redacted per player — you only ever see what you're allowed to.</p>
  </header>`;
}

async function renderHome(): Promise<string> {
  const all = await svc.listMatches(LOCAL_ID);
  const active = all.filter((m) => m.status === 'active');

  const continueCard =
    active.length > 0
      ? (() => {
          const m = active[0]!;
          const ui = GAME_UI[m.gameId];
          const name = getModule(m.gameId).meta.name;
          const sub = ui ? ui.summary(m, handleOf) : '';
          return `<button class="continue" data-action="resume" data-match="${m.matchId}">
            <span class="continue-k">Continue</span>
            <span class="continue-name">${esc(name)}</span>
            <span class="continue-sub">${esc(sub)}</span>
          </button>`;
        })()
      : '';

  const cards = listModules()
    .map((mod) => {
      const meta = mod.meta;
      const playable = !!GAME_UI[meta.id];
      const inProgress = active.filter((m) => m.gameId === meta.id).length;
      const badge = inProgress > 0 ? `<span class="pill">${inProgress} in progress</span>` : '';
      const tag = `${meta.model === 'shared-turn' ? 'Turn-based' : 'Same-seed'} · ${meta.minPlayers}–${meta.maxPlayers}p`;
      return `<button class="gamecard" data-action="open-game" data-game="${meta.id}" ${playable ? '' : 'disabled'}>
        <span class="gc-name">${esc(meta.name)}</span>
        <span class="gc-tag">${esc(tag)}</span>
        ${playable ? badge : '<span class="pill muted">coming soon</span>'}
      </button>`;
    })
    .join('');

  return `${brand()}
    ${continueCard}
    <h2 class="section">Choose a game</h2>
    <div class="grid">${cards}</div>`;
}

async function renderLobby(): Promise<string> {
  const gameId = lobbyGameId!;
  const meta = getModule(gameId).meta;
  const ui = GAME_UI[gameId];
  const mine = (await svc.listMatches(LOCAL_ID)).filter((m) => m.gameId === gameId);

  const knobs = ui
    ? ui.knobs
        .map(
          (k) => `<div class="field"><label for="cfg-${k.key}">${esc(k.label)}</label>
            <input id="cfg-${k.key}" type="number" min="${k.min}" max="${k.max}" value="${k.default}" /></div>`,
        )
        .join('')
    : '';

  const games = mine.length
    ? mine
        .map((m) => {
          const sub = ui ? ui.summary(m, handleOf) : '';
          const cls = m.status === 'complete' ? 'done' : 'live';
          return `<div class="matchrow ${cls}">
            <button class="mr-main" data-action="resume" data-match="${m.matchId}">
              <span class="mr-sub">${esc(sub)}</span>
            </button>
            <button class="mr-del secondary" data-action="delete-match" data-match="${m.matchId}" aria-label="Delete game">✕</button>
          </div>`;
        })
        .join('')
    : `<p class="empty">No games yet — start one above.</p>`;

  return `<div class="topbar">
      <button class="secondary" data-action="home">← Games</button>
      <strong>${esc(meta.name)}</strong>
      <span></span>
    </div>
    <section class="card">
      <h2 class="section">New game</h2>
      <div class="toolbar">
        ${knobs}
        <div class="field"><label for="cfg-mode">View</label>
          <select id="cfg-mode">
            <option value="two"${mode === 'two' ? ' selected' : ''}>Two clients</option>
            <option value="pass"${mode === 'pass' ? ' selected' : ''}>Pass &amp; play</option>
          </select></div>
        <div class="field"><button data-action="new-game">Start</button></div>
      </div>
    </section>
    <section class="card">
      <h2 class="section">Your games</h2>
      <div class="matchlist">${games}</div>
    </section>`;
}

async function renderMatch(): Promise<string> {
  const matchId = activeMatchId!;
  const ui = GAME_UI[getModule(activeMatchGameId(matchId)).meta.id];

  let panels = '';
  if (mode === 'two') {
    const views = await Promise.all(PLAYERS.map((p) => svc.getMatchView(matchId, p.playerId)));
    panels = views
      .map((v, i) => (v && ui ? ui.renderPanel(v, PLAYERS[i]!.playerId, { handleOf, selectedRung }) : ''))
      .join('');
  } else {
    const anyView = await svc.getMatchView(matchId, 'p1');
    if (anyView && ui) {
      const v = anyView.view as { matchOver?: boolean; turn?: string };
      const current = v.matchOver ? 'p1' : (v.turn ?? 'p1');
      const cv = await svc.getMatchView(matchId, current);
      if (cv) panels = ui.renderPanel(cv, current, { handleOf, selectedRung });
    }
  }

  const name = getModule(activeMatchGameId(matchId)).meta.name;
  return `<div class="topbar">
      <button class="secondary" data-action="lobby">← ${esc(name)}</button>
      <strong>${esc(name)}</strong>
      <button class="secondary" data-action="toggle-mode">${mode === 'two' ? 'Two clients' : 'Pass & play'}</button>
    </div>
    <div id="status">${esc(lastStatus)}</div>
    <div class="panels ${mode === 'pass' ? 'pass' : ''}">${panels}</div>`;
}

// cache-free lookup of a loaded match's gameId (we always have it via the view)
let activeGameIdCache: Record<string, string> = {};
function activeMatchGameId(matchId: string): string {
  return activeGameIdCache[matchId] ?? lobbyGameId ?? 'chain-reaction';
}

// ---- events (delegated once on the persistent #app root) ----
app.addEventListener('click', (ev) => {
  const t = ev.target as HTMLElement;
  const actionEl = t.closest('[data-action]') as HTMLElement | null;

  // rung selection (only when enabled)
  const rungEl = t.closest('.rung') as HTMLElement | null;
  if (rungEl && rungEl.getAttribute('aria-disabled') !== 'true' && !actionEl?.dataset.action) {
    selectedRung = Number(rungEl.dataset.rung);
    void render();
    return;
  }
  if (!actionEl) return;
  const action = actionEl.dataset.action;
  const player = actionEl.dataset.player;

  switch (action) {
    case 'home':
      goHome();
      break;
    case 'open-game':
      openLobby(actionEl.dataset.game!);
      break;
    case 'lobby':
      if (lobbyGameId) openLobby(lobbyGameId);
      else goHome();
      break;
    case 'new-game':
      void startNewMatch();
      break;
    case 'resume':
      void resumeMatch(actionEl.dataset.match!);
      break;
    case 'delete-match':
      void deleteMatch(actionEl.dataset.match!);
      break;
    case 'toggle-mode':
      mode = mode === 'two' ? 'pass' : 'two';
      selectedRung = null;
      void render();
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
  if (ev.key === 'Enter' && t instanceof HTMLInputElement && t.id.startsWith('guess-') && selectedRung !== null) {
    const playerId = t.id.replace('guess-', '');
    void act(playerId, { kind: 'solve', rung: selectedRung, guess: t.value });
  }
});

async function resumeMatch(matchId: string): Promise<void> {
  // remember the gameId so the match screen can render before any view loads
  const mv = await svc.getMatchView(matchId, LOCAL_ID);
  if (!mv) {
    setStatus('That game no longer exists.', true);
    goHome();
    return;
  }
  activeGameIdCache[matchId] = mv.gameId;
  setStatus('Resumed.');
  enterMatch(matchId);
}

void render();
