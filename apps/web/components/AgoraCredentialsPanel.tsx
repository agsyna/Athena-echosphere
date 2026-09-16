/**
 * "Agora project" — required of every teacher on the join screen.
 *
 * The deployment's shared Agora project is on a free-tier minute quota, and
 * once it runs dry every classroom stops until someone rotates env vars and
 * redeploys. So a teacher supplies their own project before they can create
 * or join a lesson (the join page disables those buttons until `ready`):
 *
 *   signed in  → the pair is saved to their account (orchestrator DB, the
 *                certificate encrypted at rest) and every lesson they create
 *                uses it automatically, on any device.
 *   anonymous  → there is no account to save against, so the pair is kept in
 *                this browser's localStorage and sent with each lesson they
 *                create. `onState` hands it up to the join page for that.
 *
 * The orchestrator still falls back to the shared project if a request
 * arrives without one; the requirement is enforced here, in the UI, so
 * students and already-running lessons are never affected.
 */

'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronUp, CircleHelp, KeyRound, X } from 'lucide-react';
import {
  orchestrator,
  type AgoraCredentialInput,
  type AgoraCredentialStatus,
} from '@/lib/orchestrator';
import { getCurrentTeacher, type SignedInTeacher } from '@/lib/supabase';

const LOCAL_KEY = 'echosphere:agora-credentials';
const HEX32 = /^[0-9a-f]{32}$/;

/** The anonymous path's storage. */
function loadLocalAgoraCredentials(): AgoraCredentialInput | null {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AgoraCredentialInput>;
    if (typeof parsed.appId !== 'string' || typeof parsed.appCertificate !== 'string') return null;
    return { appId: parsed.appId, appCertificate: parsed.appCertificate };
  } catch {
    return null;
  }
}

function storeLocalAgoraCredentials(creds: AgoraCredentialInput | null): void {
  try {
    if (creds) localStorage.setItem(LOCAL_KEY, JSON.stringify(creds));
    else localStorage.removeItem(LOCAL_KEY);
  } catch {
    // Private-mode browsers reject storage; the pair still applies to this page load.
  }
}

/** Same offline check the orchestrator runs, so an obvious typo fails before a round trip. */
function clientValidate(appId: string, cert: string): string | null {
  if (!HEX32.test(appId.trim().toLowerCase())) {
    return 'App ID should be 32 hex characters.';
  }
  if (!HEX32.test(cert.trim().toLowerCase())) {
    return 'App Certificate should be 32 hex characters.';
  }
  return null;
}

const mask = (appId: string) => `••••${appId.slice(-4)}`;

/** Where the two values come from. Kept factual — see the repo README and the Agora CLI docs. */
const HELP_STEPS = [
  'Sign in at console.agora.io (a free account works).',
  'Project Management → create a project, or open the one you want to use.',
  'Copy its App ID from the project list.',
  'Edit the project → App Certificate: enable the primary certificate and copy it.',
  'Make sure Conversational AI and RTM are enabled on the project (Agora CLI: agora project feature enable convoai).',
];

export interface AgoraPanelState {
  /** True once this teacher has a project on file — the join page gates on it. */
  ready: boolean;
  /**
   * The pair to send when creating a lesson. Only non-null for an anonymous
   * teacher; a signed-in teacher's saved pair is resolved server-side.
   */
  override: AgoraCredentialInput | null;
}

interface Props {
  onState: (state: AgoraPanelState) => void;
}

const inputClass =
  'eco-numerals w-full rounded-lg border px-3 py-2 text-sm outline-none transition-colors ' +
  'placeholder:text-[var(--eco-cream-faint)] focus:border-[var(--eco-glow)]';
// A light tint over the panel's dark surface rather than --eco-ink, which the
// join page does not pin and so flips to near-white in light mode — leaving
// white text on a white field.
const inputStyle = {
  borderColor: 'var(--eco-rule)',
  background: 'color-mix(in srgb, var(--eco-cream) 8%, transparent)',
  color: 'var(--eco-cream)',
} as const;

export function AgoraCredentialsPanel({ onState }: Props) {
  const [teacher, setTeacher] = useState<SignedInTeacher | null>(null);
  const [checked, setChecked] = useState(false);
  const [status, setStatus] = useState<AgoraCredentialStatus | null>(null);
  const [local, setLocal] = useState<AgoraCredentialInput | null>(null);
  const [open, setOpen] = useState(true);
  const [editing, setEditing] = useState(false);
  const [help, setHelp] = useState(false);
  const [appId, setAppId] = useState('');
  const [cert, setCert] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Who is this, and what do they already have on file?
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const current = await getCurrentTeacher();
      if (cancelled) return;
      setTeacher(current);
      if (current) {
        let s: AgoraCredentialStatus | null = null;
        try {
          s = await orchestrator.getAgoraCredentials();
        } catch {
          // Orchestrator unreachable or DB-less: the join page already shows
          // the reachability banner; the teacher can still enter a pair.
        }
        if (cancelled) return;
        setStatus(s);
        const ready = Boolean(s?.appId);
        setOpen(!ready);
        onState({ ready, override: null });
      } else {
        const stored = loadLocalAgoraCredentials();
        setLocal(stored);
        setOpen(!stored);
        onState({ ready: Boolean(stored), override: stored });
      }
      setChecked(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [onState]);

  const usingOwn = teacher ? Boolean(status?.appId) : Boolean(local);
  const ownAppId = teacher ? status?.appId ?? null : local?.appId ?? null;

  const save = useCallback(async () => {
    const problem = clientValidate(appId, cert);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    const pair = { appId: appId.trim().toLowerCase(), appCertificate: cert.trim().toLowerCase() };
    try {
      if (teacher) {
        setStatus(await orchestrator.saveAgoraCredentials(pair));
        onState({ ready: true, override: null });
        setNotice('Saved to your account.');
      } else {
        storeLocalAgoraCredentials(pair);
        setLocal(pair);
        onState({ ready: true, override: pair });
        setNotice('Saved in this browser.');
      }
      setAppId('');
      setCert('');
      setEditing(false);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save credentials');
    } finally {
      setBusy(false);
    }
  }, [appId, cert, teacher, onState]);

  const remove = useCallback(async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (teacher) {
        setStatus(await orchestrator.clearAgoraCredentials());
      } else {
        storeLocalAgoraCredentials(null);
        setLocal(null);
      }
      onState({ ready: false, override: null });
      setOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove credentials');
    } finally {
      setBusy(false);
    }
  }, [teacher, onState]);

  if (!checked) return null;

  const showForm = editing || !usingOwn;

  return (
    <div
      className="relative flex flex-col gap-2 rounded-xl border p-3"
      style={{ borderColor: 'var(--eco-rule)', background: 'var(--eco-ink-sunken)' }}
    >
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <KeyRound
            className="h-4 w-4 shrink-0"
            style={{ color: usingOwn ? 'var(--eco-athena)' : 'var(--eco-cream-faint)' }}
            aria-hidden="true"
          />
          <span className="flex min-w-0 flex-col">
            <span className="eco-label-dim">Agora project</span>
            <span className="truncate text-xs text-[var(--eco-cream-faint)]">
              {usingOwn && ownAppId ? `Your project ${mask(ownAppId)}` : 'Required to start a lesson'}
            </span>
          </span>
        </button>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            aria-label="How to get an App ID and App Certificate"
            aria-expanded={help}
            onClick={() => setHelp((h) => !h)}
            className="inline-flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-white/10"
            style={{ color: help ? 'var(--eco-athena)' : 'var(--eco-cream-faint)' }}
          >
            <CircleHelp className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label={open ? 'Collapse' : 'Expand'}
            onClick={() => setOpen((o) => !o)}
            className="inline-flex h-7 w-7 items-center justify-center rounded-full text-[var(--eco-cream-faint)] transition-colors hover:bg-white/10"
          >
            {open ? (
              <ChevronUp className="h-4 w-4" aria-hidden="true" />
            ) : (
              <ChevronDown className="h-4 w-4" aria-hidden="true" />
            )}
          </button>
        </div>
      </div>

      {help && (
        <aside
          className="eco-glass absolute right-2 top-12 z-20 flex w-[min(22rem,calc(100vw-4rem))] flex-col gap-2 p-4 text-left shadow-2xl"
          aria-label="How to get Agora credentials"
          style={{
            background: 'color-mix(in srgb, var(--eco-ink-raised) 92%, transparent)',
            backdropFilter: 'blur(20px)',
          }}
        >
          <div className="flex items-start justify-between gap-3">
            <p className="eco-label text-[var(--eco-athena)]">Where to find these</p>
            <button
              type="button"
              aria-label="Close help"
              onClick={() => setHelp(false)}
              className="inline-flex h-6 w-6 items-center justify-center rounded-full text-[var(--eco-cream-dim)] transition-colors hover:bg-white/10"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
          <ol className="flex list-decimal flex-col gap-1.5 pl-4 text-xs text-[var(--eco-cream-dim)]">
            {HELP_STEPS.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <p className="text-[11px] text-[var(--eco-cream-faint)]">
            {teacher
              ? 'Saved to your account; the certificate is stored encrypted and never shown again.'
              : 'Kept in this browser only. '}
            {!teacher && (
              <Link href="/login" className="underline text-[var(--eco-athena)]">
                Sign in
              </Link>
            )}
            {!teacher && ' to save it to your account.'}
          </p>
        </aside>
      )}

      {open && (
        <div className="flex flex-col gap-2 border-t pt-3" style={{ borderColor: 'var(--eco-rule)' }}>
          {!showForm && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => setEditing(true)}
                className="rounded-lg border px-3 py-1.5 text-xs text-[var(--eco-cream)] disabled:opacity-40"
                style={{ borderColor: 'var(--eco-rule)' }}
              >
                Replace
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void remove()}
                className="rounded-lg border px-3 py-1.5 text-xs text-[var(--eco-cream-dim)] disabled:opacity-40"
                style={{ borderColor: 'var(--eco-rule)' }}
              >
                {busy ? 'Removing…' : 'Remove'}
              </button>
            </div>
          )}

          {showForm && (
            <>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-[var(--eco-cream-faint)]">App ID</span>
                <input
                  className={inputClass}
                  style={inputStyle}
                  value={appId}
                  onChange={(e) => setAppId(e.target.value)}
                  placeholder="32 hex characters"
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-[var(--eco-cream-faint)]">App Certificate</span>
                <input
                  type="password"
                  className={inputClass}
                  style={inputStyle}
                  value={cert}
                  onChange={(e) => setCert(e.target.value)}
                  placeholder="32 hex characters"
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={busy || !appId.trim() || !cert.trim()}
                  onClick={() => void save()}
                  className="rounded-lg px-3 py-1.5 text-xs font-semibold transition-opacity disabled:opacity-40"
                  style={{ background: 'var(--eco-athena)', color: 'var(--eco-ink)' }}
                >
                  {busy ? 'Saving…' : 'Save'}
                </button>
                {editing && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setEditing(false);
                      setError(null);
                      setAppId('');
                      setCert('');
                    }}
                    className="rounded-lg border px-3 py-1.5 text-xs text-[var(--eco-cream-dim)]"
                    style={{ borderColor: 'var(--eco-rule)' }}
                  >
                    Cancel
                  </button>
                )}
              </div>
            </>
          )}

          {error && (
            <p className="text-xs" style={{ color: 'var(--eco-red)' }}>
              {error}
            </p>
          )}
          {notice && !error && <p className="text-xs text-[var(--eco-athena)]">{notice}</p>}
        </div>
      )}
    </div>
  );
}
