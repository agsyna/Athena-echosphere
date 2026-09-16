/**
 * Tests for per-teacher Agora credentials (src/agora/credentials.ts).
 *
 * Covers the parts that fail silently in production if wrong: the offline
 * validation that gates a save, the at-rest encryption round trip, and the
 * resolution order a new lesson follows. No database and no Agora call — the
 * DB-backed functions are exercised through the HTTP routes by hand.
 *
 * Run with: node --import tsx scripts/credentials.test.ts
 */

import assert from 'node:assert/strict';

process.env.CREDENTIALS_ENCRYPTION_KEY = 'test-key-not-for-production';
process.env.NEXT_PUBLIC_AGORA_APP_ID = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
process.env.NEXT_AGORA_APP_CERTIFICATE = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

const {
  AgoraCredentialError,
  assertUsable,
  decryptSecret,
  encryptSecret,
  resolveCredentialsForLesson,
  validateCredentialPair,
} = await import('../src/agora/credentials.ts');

let pass = 0;
const test = async (name: string, fn: () => void | Promise<void>) => {
  try { await fn(); pass += 1; console.log(`  ok  ${name}`); }
  catch (e) { console.log(`  FAIL ${name}: ${(e as Error).message}`); process.exitCode = 1; }
};

const APP_ID = '0123456789abcdef0123456789abcdef';
const CERT = 'fedcba9876543210fedcba9876543210';

await test('a well-formed pair validates', () => {
  validateCredentialPair(APP_ID, CERT);
});

await test('surrounding whitespace and upper-case hex are tolerated', () => {
  validateCredentialPair(`  ${APP_ID.toUpperCase()} `, ` ${CERT} `);
});

await test('a short App ID is rejected with a fixable message', () => {
  assert.throws(
    () => validateCredentialPair('abc', CERT),
    (e: unknown) => e instanceof AgoraCredentialError && /App ID/.test(e.message),
  );
});

await test('a non-hex App Certificate is rejected', () => {
  assert.throws(
    () => validateCredentialPair(APP_ID, 'zz'.repeat(16)),
    (e: unknown) => e instanceof AgoraCredentialError && /App Certificate/.test(e.message),
  );
});

await test('encrypt → decrypt round-trips and never stores the plaintext', () => {
  const stored = encryptSecret(CERT);
  assert.ok(stored.startsWith('v1.'));
  assert.ok(!stored.includes(CERT));
  assert.equal(decryptSecret(stored), CERT);
});

await test('two encryptions of the same secret differ (fresh IV each time)', () => {
  assert.notEqual(encryptSecret(CERT), encryptSecret(CERT));
});

await test('a tampered ciphertext is refused, not decrypted to garbage', () => {
  const stored = encryptSecret(CERT);
  const parts = stored.split('.');
  parts[2] = parts[2].slice(0, -2) + (parts[2].endsWith('AA') ? 'BB' : 'AA');
  assert.throws(() => decryptSecret(parts.join('.')), AgoraCredentialError);
});

await test('a per-lesson override wins and is reported as "session"', async () => {
  const creds = await resolveCredentialsForLesson(null, { appId: APP_ID, appCertificate: CERT });
  assert.deepEqual(creds, { appId: APP_ID, appCertificate: CERT, source: 'session' });
});

await test('a malformed override is refused rather than silently falling back', async () => {
  await assert.rejects(
    resolveCredentialsForLesson(null, { appId: 'nope', appCertificate: CERT }),
    AgoraCredentialError,
  );
});

await test('no override and no account falls back to the shared env project', async () => {
  const creds = await resolveCredentialsForLesson(null, undefined);
  assert.equal(creds.source, 'env');
  assert.equal(creds.appId, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
});

await test('a signed-in teacher with no DATABASE_URL also falls back to env', async () => {
  const creds = await resolveCredentialsForLesson(
    { userId: 'u1', email: 't@example.com', displayName: null },
    undefined,
  );
  assert.equal(creds.source, 'env');
});

await test('assertUsable refuses an empty pair with a message naming the fix', () => {
  assert.throws(
    () => assertUsable({ appId: '', appCertificate: '', source: 'env' }),
    (e: unknown) => e instanceof AgoraCredentialError && /App ID and App Certificate/.test(e.message),
  );
});

console.log(`\n${pass} passing`);
