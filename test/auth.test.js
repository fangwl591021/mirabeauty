import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession, verifySession } from '../src/auth.js';

test('session can be verified with the same secret', async () => {
  const token = await createSession('usr_abc', 'test-secret', 1_000_000);
  const claims = await verifySession(token, 'test-secret', 1_000_001);
  assert.equal(claims.sub, 'usr_abc');
});

test('session fails when its signature is changed', async () => {
  const token = await createSession('usr_abc', 'test-secret', 1_000_000);
  assert.equal(await verifySession(`${token}x`, 'test-secret', 1_000_001), null);
});

test('session fails after expiry', async () => {
  const token = await createSession('usr_abc', 'test-secret', 1_000_000);
  assert.equal(await verifySession(token, 'test-secret', 1_000_000 + 604_801_000), null);
});
