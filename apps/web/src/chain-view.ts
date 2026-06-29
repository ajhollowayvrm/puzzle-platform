// Chain Reaction's UI adapter (rendering only — all game rules live in the module).
// Renders strictly from the redacted ChainView: unsolved answers never appear here.
import type { MatchView } from '@puzzle/core';
import { DEFAULT_CHAIN_CONFIG, type ChainView } from '@puzzle/game-chain-reaction';
import type { GameUI, RenderCtx } from './game-ui.js';

const KNOBS: GameUI['knobs'] = [
  { key: 'startingValue', label: 'Pot start', min: 2, max: 99, default: DEFAULT_CHAIN_CONFIG.startingValue },
  { key: 'peekPenalty', label: 'Peek cost', min: 1, max: 20, default: DEFAULT_CHAIN_CONFIG.peekPenalty },
  { key: 'valueFloor', label: 'Min pot', min: 0, max: 20, default: DEFAULT_CHAIN_CONFIG.valueFloor },
  { key: 'middleRungs', label: 'Rungs', min: 1, max: 99, default: DEFAULT_CHAIN_CONFIG.middleRungs },
  { key: 'roundsPerMatch', label: 'Rounds', min: 1, max: 99, default: DEFAULT_CHAIN_CONFIG.roundsPerMatch },
];

function winnerText(mv: MatchView, handleOf: (id: string) => string): string {
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

export const chainReactionUI: GameUI = {
  knobs: KNOBS,

  renderPanel(mv: MatchView, playerId: string, ctx: RenderCtx): string {
    const v = mv.view as ChainView;
    const interactive = !v.matchOver && v.turn === playerId;
    const pClass = playerId === 'p1' ? 'p1' : 'p2';
    const me = ctx.handleOf(playerId);
    const tally = v.order.map((id) => `${ctx.handleOf(id)} ${v.roundWins[id] ?? 0}`).join(' — ');

    const rows = v.rungs
      .map((r, i) => {
        const solvedClass = r.solvedBy ? `solved ${r.solvedBy === 'p1' ? 'p1' : 'p2'}` : '';
        const sel = ctx.selectedRung === i && interactive ? 'selected' : '';
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
      ? `<div class="over">${winnerText(mv, ctx.handleOf)}</div>`
      : `<div class="actions">
          <button class="peek" data-action="peek" data-player="${playerId}" ${interactive && ctx.selectedRung !== null ? '' : 'disabled'}>Peek</button>
          <input type="text" id="guess-${playerId}" placeholder="guess selected rung" ${interactive ? '' : 'disabled'} autocomplete="off" />
          <button class="solve secondary" data-action="solve" data-player="${playerId}" ${interactive && ctx.selectedRung !== null ? '' : 'disabled'}>Solve</button>
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
  },

  summary(mv: MatchView, handleOf: (id: string) => string): string {
    const v = mv.view as ChainView;
    if (mv.status === 'complete') {
      const ids = mv.result.winnerIds;
      const who = ids.length === 1 ? `${handleOf(ids[0]!)} won` : ids.length > 1 ? 'tie' : 'finished';
      return `Complete · ${who}`;
    }
    return `Round ${v.round + 1}/${v.roundsPerMatch} · ${handleOf(v.turn)}'s turn`;
  },

  describeEvents(events: unknown[], handleOf: (id: string) => string): string {
    const parts: string[] = [];
    for (const e of events as CrEvent[]) {
      const who = e.by ? handleOf(e.by) : '';
      const rung = (e.rung ?? 0) + 1;
      if (e.type === 'peek') parts.push(`${who} peeked rung ${rung}`);
      else if (e.type === 'solved') parts.push(`${who} solved rung ${rung} for ${e.value}!`);
      else if (e.type === 'wrong') parts.push(`${who} missed rung ${rung}`);
      else if (e.type === 'roundOver')
        parts.push(`Round done — ${e.winner ? `${handleOf(e.winner)} takes it` : 'tie'} (${(e.chain ?? []).join(' → ')})`);
      else if (e.type === 'matchOver') parts.push('Match over!');
    }
    return parts.join(' · ');
  },
};
