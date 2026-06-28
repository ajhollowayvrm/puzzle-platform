// Phase 1 local prototype: runs the generic core in-memory IN THE BROWSER and
// plays Chain Reaction. Renders ONLY redacted views from the service (never raw
// state), so it doubles as a visual proof that hidden answers never reach a client.
import {
  InMemoryStore,
  MatchService,
  register,
  type MatchView,
  type PlayerRef,
} from '@puzzle/core';
import {
  chainReaction,
  DEFAULT_CHAIN_CONFIG,
  type ChainConfig,
  type ChainMove,
  type ChainView,
} from '@puzzle/game-chain-reaction';

register(chainReaction);

const PLAYERS: PlayerRef[] = [
  { playerId: 'p1', handle: 'Player 1' },
  { playerId: 'p2', handle: 'Player 2' },
];
const handleOf = (id: string) => PLAYERS.find((p) => p.playerId === id)?.handle ?? id;

const store = new InMemoryStore();
const svc = new MatchService(store, { clock: () => Date.now() });

let matchId: string | null = null;
let selectedRung: number | null = null;
let mode: 'two' | 'pass' = 'two';
let unsubscribe: (() => void) | null = null;

const app = document.getElementById('app')!;

// ---- shell ----

const KNOBS: Array<{ key: keyof ChainConfig; label: string; min: number; max: number }> = [
  { key: 'startingValue', label: 'Pot start', min: 2, max: 50 },
  { key: 'peekPenalty', label: 'Peek cost', min: 1, max: 10 },
  { key: 'valueFloor', label: 'Floor', min: 1, max: 10 },
  { key: 'middleRungs', label: 'Rungs', min: 2, max: 3 },
  { key: 'roundsPerMatch', label: 'Rounds', min: 1, max: 9 },
];

app.innerHTML = `
  <h1>Chain Reaction <span class="sub">· local prototype</span></h1>
  <p class="sub">Tune the knobs, start a match, and play it to feel the peek/solve economy. Views are redacted server-side — unsolved answers never reach the client.</p>
  <div class="toolbar">
    ${KNOBS.map(
      (k) => `<div class="field"><label for="cfg-${k.key}">${k.label}</label>
        <input id="cfg-${k.key}" type="number" min="${k.min}" max="${k.max}"
          value="${DEFAULT_CHAIN_CONFIG[k.key]}" /></div>`,
    ).join('')}
    <div class="field"><label for="cfg-mode">View</label>
      <select id="cfg-mode">
        <option value="two">Two clients</option>
        <option value="pass">Pass &amp; play</option>
      </select></div>
    <div class="field"><button id="newmatch">New match</button></div>
    <div class="grow"></div>
  </div>
  <div id="status"></div>
  <div class="panels" id="panels"></div>
`;

const statusEl = document.getElementById('status')!;
const panelsEl = document.getElementById('panels')!;

function readConfig(): Partial<ChainConfig> {
  const cfg: Partial<ChainConfig> = {};
  for (const k of KNOBS) {
    const input = document.getElementById(`cfg-${k.key}`) as HTMLInputElement;
    const v = Number(input.value);
    if (Number.isFinite(v)) cfg[k.key] = v;
  }
  return cfg;
}

function setStatus(msg: string, bad = false): void {
  statusEl.textContent = msg;
  statusEl.classList.toggle('bad', bad);
}

// ---- match control ----

async function newMatch(): Promise<void> {
  mode = (document.getElementById('cfg-mode') as HTMLSelectElement).value as 'two' | 'pass';
  unsubscribe?.();
  const created = await svc.createMatch({
    gameId: 'chain-reaction',
    mode: 'versus',
    players: PLAYERS,
    config: readConfig(),
  });
  matchId = created.matchId;
  selectedRung = null;
  unsubscribe = svc.subscribe(matchId, (u) => {
    setStatus(describeEvents(u.events));
    void render();
  });
  setStatus('New match — Player 1 starts.');
  await render();
}

async function act(playerId: string, move: ChainMove): Promise<void> {
  if (!matchId) return;
  const out = await svc.applyMove({ matchId, playerId, move });
  if (!out.ok) {
    setStatus(out.error, true);
    return;
  }
  selectedRung = null;
  // a successful move fires the subscription, which re-renders.
}

// ---- rendering ----

async function render(): Promise<void> {
  if (!matchId) return;
  panelsEl.classList.toggle('pass', mode === 'pass');

  if (mode === 'two') {
    const views = await Promise.all(PLAYERS.map((p) => svc.getMatchView(matchId!, p.playerId)));
    panelsEl.innerHTML = views.map((v, i) => panelHtml(v!, PLAYERS[i]!.playerId)).join('');
  } else {
    // pass & play: show only the player whose turn it is
    const anyView = await svc.getMatchView(matchId, 'p1');
    const cv = anyView!.view as ChainView;
    const current = cv.matchOver ? 'p1' : cv.turn;
    const v = await svc.getMatchView(matchId, current);
    panelsEl.innerHTML = panelHtml(v!, current);
  }
}

function panelHtml(mv: MatchView, playerId: string): string {
  const v = mv.view as ChainView;
  const interactive = !v.matchOver && v.turn === playerId;
  const pClass = playerId === 'p1' ? 'p1' : 'p2';
  const me = handleOf(playerId);

  const tally = v.order
    .map((id) => `${handleOf(id)} ${v.roundWins[id] ?? 0}`)
    .join(' — ');

  const rows = v.rungs
    .map((r, i) => {
      const solvedClass = r.solvedBy ? `solved ${r.solvedBy === 'p1' ? 'p1' : 'p2'}` : '';
      const sel = selectedRung === i && interactive ? 'selected' : '';
      const slots = Array.from({ length: r.length }, (_, j) => {
        const ch = j < r.shown.length ? r.shown[j] : '';
        return `<span class="slot ${ch ? 'filled' : ''}">${ch ?? ''}</span>`;
      }).join('');
      const disabled = !interactive || r.solvedBy ? 'aria-disabled="true"' : '';
      return `<div class="rung ${solvedClass} ${sel}" data-rung="${i}" ${disabled}
        role="button" tabindex="${interactive && !r.solvedBy ? 0 : -1}">
        <div class="slots">${slots}</div>
        <div class="pot">pot <b>${r.value}</b></div>
      </div>`;
    })
    .join('');

  const controls = v.matchOver
    ? `<div class="over">${winnerText(mv)}</div>`
    : `<div class="actions">
        <button class="peek" data-player="${playerId}" ${interactive && selectedRung !== null ? '' : 'disabled'}>Peek</button>
        <input type="text" id="guess-${playerId}" placeholder="guess selected rung" ${interactive ? '' : 'disabled'} autocomplete="off" />
        <button class="solve secondary" data-player="${playerId}" ${interactive && selectedRung !== null ? '' : 'disabled'}>Solve</button>
      </div>`;

  return `<section class="panel ${interactive ? 'active' : ''}">
    <div class="phead">
      <span class="who"><span class="dot ${pClass}"></span>${me}</span>
      <span>${interactive ? '<span class="turnbadge">your turn</span> ' : ''}<span class="score">round: ${v.scores[playerId] ?? 0}</span></span>
    </div>
    <div class="tally">Round ${v.round + 1} of ${v.roundsPerMatch} · match tally: ${tally}</div>
    <div class="spine">
      <div class="cap">${v.start}</div>
      ${rows}
      <div class="cap">${v.end}</div>
    </div>
    ${controls}
  </section>`;
}

function winnerText(mv: MatchView): string {
  const ids = mv.result.winnerIds;
  if (ids.length === 0) return 'Match over.';
  if (ids.length > 1) return `Match over — tie between ${ids.map(handleOf).join(' & ')}.`;
  return `Match over — ${handleOf(ids[0]!)} wins! 🎉`;
}

interface CrEvent {
  type: string;
  rung?: number;
  by?: string;
  value?: number;
  winner?: string | null;
  chain?: string[];
}
function describeEvents(events: unknown[]): string {
  const parts: string[] = [];
  for (const e of events as CrEvent[]) {
    const who = e.by ? handleOf(e.by) : '';
    const rung = (e.rung ?? 0) + 1;
    if (e.type === 'peek') parts.push(`${who} peeked rung ${rung}`);
    else if (e.type === 'solved') parts.push(`${who} solved rung ${rung} for ${e.value}!`);
    else if (e.type === 'wrong') parts.push(`${who} missed rung ${rung}`);
    else if (e.type === 'roundOver')
      parts.push(
        `Round done — ${e.winner ? `${handleOf(e.winner)} takes it` : 'tie'} (${(e.chain ?? []).join(' → ')})`,
      );
    else if (e.type === 'matchOver') parts.push('Match over!');
  }
  return parts.join(' · ');
}

// ---- events ----

document.getElementById('newmatch')!.addEventListener('click', () => void newMatch());

panelsEl.addEventListener('click', (ev) => {
  const t = ev.target as HTMLElement;
  const rungEl = t.closest('.rung') as HTMLElement | null;
  if (rungEl && rungEl.getAttribute('aria-disabled') !== 'true') {
    selectedRung = Number(rungEl.dataset.rung);
    void render();
    return;
  }
  if (t.classList.contains('peek') && selectedRung !== null) {
    void act(t.dataset.player!, { kind: 'peek', rung: selectedRung });
  }
  if (t.classList.contains('solve') && selectedRung !== null) {
    const input = document.getElementById(`guess-${t.dataset.player}`) as HTMLInputElement | null;
    const guess = input?.value ?? '';
    void act(t.dataset.player!, { kind: 'solve', rung: selectedRung, guess });
  }
});

// keyboard: Enter in a guess field solves the selected rung
panelsEl.addEventListener('keydown', (ev) => {
  const t = ev.target as HTMLElement;
  if (ev.key === 'Enter' && t instanceof HTMLInputElement && t.id.startsWith('guess-') && selectedRung !== null) {
    const playerId = t.id.replace('guess-', '');
    void act(playerId, { kind: 'solve', rung: selectedRung, guess: t.value });
  }
});

void newMatch();
