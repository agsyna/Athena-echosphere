/**
 * "Use your own Agora project" — shown to teachers on the join screen.
 *
 * The deployment's shared Agora project is on a free-tier minute quota, and
 * once it runs dry every classroom stops until someone rotates env vars and
 * redeploys. This panel lets a teacher bring their own project instead:
 *
 *   signed in  → the pair is saved to their account (orchestrator DB, the
 *                certificate encrypted at rest) and every lesson they create
 *                uses it automatically, on any device.
 *   anonymous  → there is no account to save against, so the pair is kept in
 *                this browser's localStorage and sent with each lesson they
 *                create. `onChange` hands it up to the join page for that.
 *
 * Both paths fall back to the shared project when nothing is entered, so the
 * panel is never a gate — a teacher who ignores it gets exactly today's
 * behaviour.
 */

'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronUp, KeyRound } from 'lucide-react';
import {
  orchestrator,
  type AgoraCredentialInput,
  type AgoraCredentialStatus,
} from '@/lib/orchestrator';
import { getCurrentTeacher, type SignedInTeacher } from '@/lib/supabase';

const LOCAL_KEY = 'echosphere:agora-credentials';
const HEX32 = /^[0-9a-f]{32}$/;

/** The anonymous path's storage. Exported so the join page can read it on load. */
export function loadLocalAgoraCredentials(): AgoraCredentialInput | null {
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
    return 'App ID should be 32 hex characters — copy it from Agora Console → your project.';
  }
  if (!HEX32.test(cert.trim().toLowerCase())) {
    return 'App Certificate should be 32 hex characters — Agora Console → your project → Security.';
  }
  return null;
}

const mask = (appId: string) => `••••${appId.slice(-4)}`;

interface Props {
  /**
   * Fired with the pair the join page should send when creating a lesson —
   * only ever non-null for an anonymous teacher. A signed-in teacher's saved
   * pair is resolved server-side, so this reports null for them.
   */
  onChange: (creds: AgoraCredentialInput | null) => void;
}

export function AgoraCredentialsPanel({ onChange }: Props) {
  const [teacher, setTeacher] = useState<SignedInTeacher | null>(null);
  const [checked, setChecked] = useState(false);
  const [status, setStatus] = useState<AgoraCredentialStatus | null>(null);
  const [local, setLocal] = useState<AgoraCredentialInput | null>(null);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
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
        try {
          const s = await orchestrator.getAgoraCredentials();
          if (!cancelled) setStatus(s);
        } catch {
          // Orchestrator unreachable or DB-less: the panel still renders, the
          // join page already shows the reachability banner.
        }
        onChange(null);
      } else {
        const stored = loadLocalAgoraCredentials();
        setLocal(stored);
        onChange(stored);
      }
      setChecked(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [onChange]);

  const usingOwn = teacher ? Boolean(status?.appId) : Boolean(local);
  const ownAppId = teacher ? status?.appId ?? null : local?.appId ?? null;
  const sharedAvailable = status?.sharedAvailable ?? true;

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
        setNotice('Saved to your account. Lessons you create now run on your project.');
      } else {
        storeLocalAgoraCredentials(pair);
        setLocal(pair);
        onChange(pair);
        setNotice('Saved in this browser. Lessons you create here run on your project.');
      }
      setAppId('');
      setCert('');
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save credentials');
    } finally {
      setBusy(false);
    }
  }, [appId, cert, teacher, onChange]);

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
        onChange(null);
      }
      setNotice('Back on the shared project.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove credentials');
    } finally {
      setBusy(false);
    }
  }, [teacher, onChange]);

  if (!checked) return null;

  const showForm = editing || !usingOwn;

  return (
    <div
      className="flex flex-col gap-2 rounded-xl border p-3"
      style={{ borderColor: 'var(--eco-rule)', background: 'var(--eco-ink-sunken)' }}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <span className="flex items-center gap-2">
          <KeyRound
            className="h-4 w-4 shrink-0"
            style={{ color: usingOwn ? 'var(--eco-athena)' : 'var(--eco-cream-faint)' }}
            aria-hidden="true"
          />
          <span className="flex flex-col">
            <span className="eco-label-dim">Agora project</span>
            <span className="text-xs text-[var(--eco-cream-faint)]">
              {usingOwn && ownAppId
                ? `Your project ${mask(ownAppId)}`
                : sharedAvailable
                  ? 'Shared demo project — limited free minutes'
                  : 'None configured — add your own to start a lesson'}
            </span>
          </span>
        </span>
        {open ? (
          <ChevronUp className="h-4 w-4 text-[var(--eco-cream-faint)]" aria-hidden="true" />
        ) : (
          <ChevronDown className="h-4 w-4 text-[var(--eco-cream-faint)]" aria-hidden="true" />
        )}
      </button>

      {open && (
        <div className="flex flex-col gap-2 border-t pt-3" style={{ borderColor: 'var(--eco-rule)' }}>
          <p className="text-xs text-[var(--eco-cream-dim)]">
            {teacher
              ? 'Bring your own Agora project so your classes never hit the shared quota. Saved to your account; the certificate is stored encrypted and never shown again.'
              : 'Bring your own Agora project so your classes never hit the shared quota. Kept in this browser only — '}
            {!teacher && (
              <Link href="/login" className="underline text-[var(--eco-athena)]">
                sign in
              </Link>
            )}
            {!teacher && ' to save it to your account instead.'}
          </p>

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
                {busy ? 'Removing…' : 'Use shared project'}
              </button>
            </div>
          )}

          {showForm && (
            <>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-[var(--eco-cream-faint)]">App ID</span>
                <input
                  className="eco-numerals rounded-lg border px-3 py-2 text-sm text-[var(--eco-cream)] outline-none transition-colors focus:border-[var(--eco-glow)]"
                  style={{ borderColor: 'var(--eco-rule)', background: 'var(--eco-ink)' }}
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
                  className="eco-numerals rounded-lg border px-3 py-2 text-sm text-[var(--eco-cream)] outline-none transition-colors focus:border-[var(--eco-glow)]"
                  style={{ borderColor: 'var(--eco-rule)', background: 'var(--eco-ink)' }}
                  value={cert}
                  onChange={(e) => setCert(e.target.value)}
                  placeholder="32 hex characters"
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>
              <p className="text-[11px] text-[var(--eco-cream-faint)]">
                Agora Console → your project → App ID, and Security → App Certificate. The
                project needs RTC + RTM + Conversational AI enabled.
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={busy || !appId.trim() || !cert.trim()}
                  onClick={() => void save()}
                  className="rounded-lg px-3 py-1.5 text-xs font-semibold transition-opacity disabled:opacity-40"
                  style={{ background: 'var(--eco-athena)', color: 'var(--eco-ink)' }}
                >
                  {busy ? 'Saving…' : teacher ? 'Save to my account' : 'Use in this browser'}
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
          {notice && !error && (
            <p className="text-xs text-[var(--eco-athena)]">{notice}</p>
          )}
        </div>
      )}
    </div>
  );
}
