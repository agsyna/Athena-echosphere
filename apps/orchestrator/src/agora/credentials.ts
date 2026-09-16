/**
 * Which Agora project a lesson runs on.
 *
 * Agora's free tier is metered per project, and once the deployment's shared
 * project has burned through its minutes every classroom stops working until
 * someone rotates the env vars and redeploys. So a teacher can bring their
 * own project instead: the pair they save here is used for every lesson they
 * create — token minting, the ConvoAI agent join, and the App ID handed to
 * each browser — and the shared NEXT_PUBLIC_AGORA_APP_ID /
 * NEXT_AGORA_APP_CERTIFICATE pair is only the fallback for teachers who have
 * saved nothing.
 *
 * Resolution happens ONCE, when the lesson is created, and the result is
 * pinned to the in-memory `ClassroomSession`. Nothing on the live turn-taking
 * path touches the database, and a teacher editing their credentials mid-class
 * does not yank the project out from under a running agent.
 *
 * The App Certificate is a secret, so at rest it is AES-256-GCM encrypted
 * under CREDENTIALS_ENCRYPTION_KEY. The App ID is not secret — it ships to
 * every browser that joins — and is stored in the clear so "which project is
 * this account on" stays a plain query.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import type * as AgoraToken from 'agora-token';
import { eq } from 'drizzle-orm';
import { config } from '../config.js';
import { getDb } from '../db/client.js';
import { teacherProfiles } from '../db/schema.js';
import type { AuthenticatedTeacher } from '../auth/supabaseAuth.js';

// Same CommonJS workaround as routes/tokens.ts — see the note there.
const requireCjs = createRequire(import.meta.url);
const { RtcRole, RtcTokenBuilder } = requireCjs('agora-token') as typeof AgoraToken;

/**
 * Where a session's credentials came from. Reported to the teacher UI so it can
 * say "this class is on the shared demo project" and point at the fix.
 */
export type AgoraCredentialSource = 'teacher' | 'session' | 'env';

export interface AgoraCredentials {
  appId: string;
  appCertificate: string;
  source: AgoraCredentialSource;
}

/** What the API tells a browser: never the certificate itself. */
export interface AgoraCredentialStatus {
  /** The teacher's saved App ID, or null when they are on the shared project. */
  appId: string | null;
  hasCertificate: boolean;
  updatedAt: number | null;
  /** Whether the deployment has a shared project to fall back on at all. */
  sharedAvailable: boolean;
}

/** Thrown for anything the caller should fix — bad input, missing setup. */
export class AgoraCredentialError extends Error {
  readonly statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = 'AgoraCredentialError';
    this.statusCode = statusCode;
  }
}

// ── Validation ───────────────────────────────────────────────────────────────

/** Both values are 32 lowercase hex characters in every project Agora issues. */
const HEX32 = /^[0-9a-f]{32}$/;

/**
 * Checks a pair is well-formed and that the token builder accepts it.
 *
 * Deliberately offline: minting a token proves the certificate is the right
 * shape for HMAC signing but cannot prove it belongs to the App ID — only Agora
 * knows that, and the one way to ask is to join a channel, which spends the
 * very minutes this feature exists to conserve. A wrong-but-well-formed pair
 * therefore surfaces later, when the agent fails to join; that path tells the
 * teacher where to look (see routes/classroom.ts agent/start).
 */
export function validateCredentialPair(appId: string, appCertificate: string): void {
  const id = appId.trim().toLowerCase();
  const cert = appCertificate.trim().toLowerCase();
  if (!HEX32.test(id)) {
    throw new AgoraCredentialError(
      'App ID should be 32 hex characters — copy it from Agora Console → your project.',
    );
  }
  if (!HEX32.test(cert)) {
    throw new AgoraCredentialError(
      'App Certificate should be 32 hex characters — enable and copy it from Agora Console → your project → Security.',
    );
  }
  try {
    const expireAt = Math.floor(Date.now() / 1000) + 60;
    RtcTokenBuilder.buildTokenWithUid(id, cert, 'credential-check', 1, RtcRole.PUBLISHER, expireAt, expireAt);
  } catch {
    throw new AgoraCredentialError('Agora rejected this App ID / App Certificate pair.');
  }
}

function normalise(appId: string, appCertificate: string): { appId: string; appCertificate: string } {
  return { appId: appId.trim().toLowerCase(), appCertificate: appCertificate.trim().toLowerCase() };
}

// ── Encryption at rest ───────────────────────────────────────────────────────

/** Any operator-chosen string, hashed down to the 32 bytes AES-256 needs. */
function encryptionKey(): Buffer {
  if (!config.credentialsEncryptionKey) {
    throw new AgoraCredentialError(
      'This deployment cannot store Agora credentials yet: CREDENTIALS_ENCRYPTION_KEY is not set on the orchestrator.',
      503,
    );
  }
  return createHash('sha256').update(config.credentialsEncryptionKey).digest();
}

/** `v1.<iv>.<ciphertext>.<tag>`, all base64url — versioned so the scheme can change later. */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), body.toString('base64url'), cipher.getAuthTag().toString('base64url')].join('.');
}

export function decryptSecret(stored: string): string {
  const [version, iv, body, tag] = stored.split('.');
  if (version !== 'v1' || !iv || !body || !tag) {
    throw new AgoraCredentialError('Stored App Certificate is in an unknown format.', 500);
  }
  try {
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8');
  } catch (error) {
    if (error instanceof AgoraCredentialError) throw error;
    // Almost always a rotated CREDENTIALS_ENCRYPTION_KEY. Said plainly, because
    // the raw error is "Unsupported state or unable to authenticate data".
    throw new AgoraCredentialError(
      'Saved App Certificate cannot be decrypted — CREDENTIALS_ENCRYPTION_KEY has changed since it was saved. Re-enter your credentials.',
      500,
    );
  }
}

// ── Persistence ──────────────────────────────────────────────────────────────

function requireDb() {
  const db = getDb();
  if (!db) {
    throw new AgoraCredentialError(
      'This deployment cannot store Agora credentials: DATABASE_URL is not set on the orchestrator.',
      503,
    );
  }
  return db;
}

export async function loadTeacherCredentials(userId: string): Promise<AgoraCredentials | null> {
  const db = getDb();
  if (!db) return null;
  const [row] = await db
    .select({
      appId: teacherProfiles.agoraAppId,
      certEnc: teacherProfiles.agoraAppCertificateEnc,
    })
    .from(teacherProfiles)
    .where(eq(teacherProfiles.userId, userId))
    .limit(1);
  if (!row?.appId || !row.certEnc) return null;
  return { appId: row.appId, appCertificate: decryptSecret(row.certEnc), source: 'teacher' };
}

export async function teacherCredentialStatus(userId: string): Promise<AgoraCredentialStatus> {
  const shared = { sharedAvailable: sharedConfigured() };
  const db = getDb();
  if (!db) return { appId: null, hasCertificate: false, updatedAt: null, ...shared };
  const [row] = await db
    .select({
      appId: teacherProfiles.agoraAppId,
      certEnc: teacherProfiles.agoraAppCertificateEnc,
      updatedAt: teacherProfiles.agoraUpdatedAt,
    })
    .from(teacherProfiles)
    .where(eq(teacherProfiles.userId, userId))
    .limit(1);
  return {
    appId: row?.appId ?? null,
    hasCertificate: Boolean(row?.certEnc),
    updatedAt: row?.updatedAt ? row.updatedAt.getTime() : null,
    ...shared,
  };
}

/**
 * Saves a validated pair against the teacher's account.
 *
 * Upserts the profile row rather than assuming it exists: `persist.ts` only
 * writes it when a lesson ENDS, and a teacher who has just signed up and gone
 * straight to their settings has never ended one.
 */
export async function saveTeacherCredentials(
  teacher: AuthenticatedTeacher,
  input: { appId: string; appCertificate: string },
): Promise<AgoraCredentialStatus> {
  validateCredentialPair(input.appId, input.appCertificate);
  const { appId, appCertificate } = normalise(input.appId, input.appCertificate);
  // Encrypt before touching the database so a missing key fails with nothing
  // half-written.
  const certEnc = encryptSecret(appCertificate);
  const db = requireDb();
  const now = new Date();
  await db
    .insert(teacherProfiles)
    .values({
      userId: teacher.userId,
      email: teacher.email,
      displayName: teacher.displayName,
      firstSeenAt: now,
      lastSeenAt: now,
      agoraAppId: appId,
      agoraAppCertificateEnc: certEnc,
      agoraUpdatedAt: now,
    })
    .onConflictDoUpdate({
      target: teacherProfiles.userId,
      set: {
        lastSeenAt: now,
        agoraAppId: appId,
        agoraAppCertificateEnc: certEnc,
        agoraUpdatedAt: now,
      },
    });
  return { appId, hasCertificate: true, updatedAt: now.getTime(), sharedAvailable: sharedConfigured() };
}

export async function clearTeacherCredentials(userId: string): Promise<void> {
  const db = getDb();
  if (!db) return;
  await db
    .update(teacherProfiles)
    .set({ agoraAppId: null, agoraAppCertificateEnc: null, agoraUpdatedAt: new Date() })
    .where(eq(teacherProfiles.userId, userId));
}

// ── Resolution ───────────────────────────────────────────────────────────────

export function sharedConfigured(): boolean {
  return Boolean(config.agoraAppId && config.agoraAppCertificate);
}

/** The deployment's shared project. May be empty — check with `assertUsable`. */
export function envCredentials(): AgoraCredentials {
  return { appId: config.agoraAppId, appCertificate: config.agoraAppCertificate, source: 'env' };
}

/**
 * Picks the project a new lesson runs on, most specific first:
 *
 *   1. a pair sent with the create request (an anonymous teacher, who has no
 *      account to save against, using their own project for this one lesson)
 *   2. the pair saved on the signed-in teacher's account
 *   3. the deployment's shared project
 *
 * Throws when it lands on (3) and there is no shared project, since a lesson
 * with no project cannot mint a single token.
 */
export async function resolveCredentialsForLesson(
  owner: AuthenticatedTeacher | null,
  override: { appId: string; appCertificate: string } | undefined,
): Promise<AgoraCredentials> {
  if (override) {
    validateCredentialPair(override.appId, override.appCertificate);
    return { ...normalise(override.appId, override.appCertificate), source: 'session' };
  }
  if (owner) {
    const saved = await loadTeacherCredentials(owner.userId);
    if (saved) return saved;
  }
  const shared = envCredentials();
  assertUsable(shared);
  return shared;
}

export function assertUsable(creds: AgoraCredentials): void {
  if (creds.appId && creds.appCertificate) return;
  throw new AgoraCredentialError(
    'No Agora project is configured for this lesson. Add your own App ID and App Certificate ' +
      'on the join screen (or sign in and save them to your account).',
    503,
  );
}
