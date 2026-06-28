import { describe, expect, it } from 'vitest';
import { InMemoryStore } from '@puzzle/core';
import { AccountService, AuthError } from '@puzzle/core/auth';

describe('AccountService (DIY scrypt auth)', () => {
  it('registers, then logs in and verifies the token', async () => {
    const store = new InMemoryStore();
    const auth = new AccountService(store, { clock: () => 1000 });

    const reg = await auth.register('Alice', 'correct horse');
    expect(reg.handle).toBe('Alice');
    expect(reg.token).toMatch(/^[0-9a-f]{64}$/);

    const verified = await auth.verifyToken(reg.token);
    expect(verified?.userId).toBe(reg.userId);

    const login = await auth.login('alice', 'correct horse'); // case-insensitive handle
    expect(login.userId).toBe(reg.userId);
  });

  it('never stores the plaintext password', async () => {
    const store = new InMemoryStore();
    const auth = new AccountService(store);
    await auth.register('Bob', 'hunter2hunter2');
    const user = await store.getUserByHandle('bob');
    expect(user?.passwordHash).toBeTruthy();
    expect(user?.passwordHash).not.toContain('hunter2');
  });

  it('rejects a wrong password and a duplicate handle', async () => {
    const store = new InMemoryStore();
    const auth = new AccountService(store);
    await auth.register('Carol', 'password123');

    await expect(auth.login('Carol', 'wrongpass')).rejects.toBeInstanceOf(AuthError);
    await expect(auth.register('carol', 'password123')).rejects.toMatchObject({
      code: 'handle_taken',
    });
  });

  it('rejects expired tokens', async () => {
    const store = new InMemoryStore();
    let now = 1000;
    const auth = new AccountService(store, { clock: () => now, tokenTtlMs: 100 });
    const reg = await auth.register('Dave', 'password123');
    now = 1000 + 101;
    expect(await auth.verifyToken(reg.token)).toBeNull();
  });
});
