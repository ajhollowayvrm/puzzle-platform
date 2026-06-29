// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';

// pump the microtask/macrotask queue so async render()s settle
async function tick(n = 8): Promise<void> {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
}

describe('web shell navigation', () => {
  it('home → lobby → start match renders the board without crashing', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    localStorage.clear();

    await import('../src/main.ts'); // top-level render() fires on import
    const app = document.getElementById('app')!;
    await tick();

    // home / game picker
    expect(app.innerHTML).toContain('Choose a game');
    expect(app.innerHTML).toContain('Chain Reaction');

    // open the lobby for the game
    (app.querySelector('[data-action="open-game"]') as HTMLElement).click();
    await tick();
    expect(app.innerHTML).toContain('New game');
    expect(app.querySelector('[data-action="new-game"]')).toBeTruthy();

    // start a new match → match screen with the chain spine
    (app.querySelector('[data-action="new-game"]') as HTMLElement).click();
    await tick();
    expect(app.querySelector('.panels')).toBeTruthy();
    expect(app.querySelector('.spine')).toBeTruthy();

    // redaction sanity: no raw server-state field leaked into the rendered DOM
    expect(app.innerHTML).not.toContain('"answer"');
  });

  it('persists the started match so it survives a reload (continue-a-game)', async () => {
    const raw = localStorage.getItem('pp.matches.v1');
    expect(raw).toBeTruthy();
    expect(raw).toContain('chain-reaction');
  });
});
