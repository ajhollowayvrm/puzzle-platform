// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';

async function tick(n = 8): Promise<void> {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
}

describe('web shell navigation (local mode)', () => {
  it('auth → play local → lobby → start match renders the board', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    localStorage.clear();

    await import('../src/main.ts'); // top-level await runs restoreSession() + render()
    const app = document.getElementById('app')!;
    await tick();

    // lands on the auth screen
    expect(app.innerHTML).toContain('Log in');
    expect(app.querySelector('[data-action="play-local"]')).toBeTruthy();

    // play without an account
    (app.querySelector('[data-action="play-local"]') as HTMLElement).click();
    await tick();
    expect(app.innerHTML).toContain('Start a game');
    expect(app.innerHTML).toContain('Chain Reaction');

    // open lobby → start a match
    (app.querySelector('[data-action="open-game"]') as HTMLElement).click();
    await tick();
    expect(app.innerHTML).toContain('New game');
    (app.querySelector('[data-action="new-game"]') as HTMLElement).click();
    await tick();

    expect(app.querySelector('.spine')).toBeTruthy();
    expect(app.innerHTML).not.toContain('"answer"'); // no redaction leak
  });

  it('persists the local match so it survives a reload', async () => {
    const raw = localStorage.getItem('pp.matches.v1');
    expect(raw).toBeTruthy();
    expect(raw).toContain('chain-reaction');
  });
});
