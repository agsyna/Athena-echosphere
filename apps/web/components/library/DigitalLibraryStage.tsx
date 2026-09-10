'use client';

import React, { useState, useEffect, useCallback } from 'react';
import type {
  LibraryBook,
  LibraryPublicState,
  PublicParticipant,
  Role,
} from '@echosphere/shared-types';
import { FlipBook } from './FlipBook';

export interface DigitalLibraryStageProps {
  sessionId: string;
  participantId: string;
  role: Role;
  library: LibraryPublicState | null;
  book: LibraryBook;
  participants: PublicParticipant[];
  onTurnPage: (page: number) => Promise<void>;
  onToggleLock: (locked: boolean) => Promise<void>;
  onCitePage: (page: number, citationText?: string) => Promise<void>;
  onCloseStage?: () => void;
}

interface RtmLogEntry {
  id: string;
  label: string;
  payload: string;
  kind?: 'athena' | 'sys' | 'teacher';
}

export function DigitalLibraryStage({
  sessionId,
  participantId,
  role,
  library,
  book,
  participants,
  onTurnPage,
  onToggleLock,
  onCitePage,
  onCloseStage,
}: DigitalLibraryStageProps) {
  const isTeacher = role === 'teacher';
  const isLocked = library?.isLocked ?? true;
  const teacherPage = library?.currentPage ?? 0;

  // Local student browsing page if unlocked, otherwise synced to teacher
  const [localPage, setLocalPage] = useState(teacherPage);
  const [rtmLogs, setRtmLogs] = useState<RtmLogEntry[]>([
    {
      id: 'init',
      label: 'channel joined',
      payload: `library:${book.id} · ${participants.length} students · 1 agent`,
      kind: 'sys',
    },
  ]);
  const [seatPings, setSeatPings] = useState<Record<string, number>>({});

  // Sync to teacher's page whenever locked or when teacher changes page
  useEffect(() => {
    if (isLocked || isTeacher) {
      setLocalPage(teacherPage);
    }
  }, [teacherPage, isLocked, isTeacher]);

  const addLog = useCallback((label: string, payload: string, kind?: 'athena' | 'sys' | 'teacher') => {
    setRtmLogs((prev) => [
      { id: `${Date.now()}-${Math.random()}`, label, payload, kind },
      ...prev.slice(0, 5),
    ]);
  }, []);

  const handlePageChange = useCallback(
    (newPageIndex: number) => {
      setLocalPage(newPageIndex);
      if (isTeacher || !isLocked) {
        addLog(
          isTeacher ? 'teacher → channel' : 'student → channel',
          JSON.stringify({ type: 'library:page', page: newPageIndex + 1 }),
          isTeacher ? 'teacher' : undefined,
        );
        void onTurnPage(newPageIndex);
      }
    },
    [isTeacher, isLocked, onTurnPage, addLog],
  );

  const handleNext = () => {
    if (localPage < book.pages.length - 1) {
      handlePageChange(localPage + (localPage === 0 ? 1 : 2));
    }
  };

  const handlePrev = () => {
    if (localPage > 0) {
      handlePageChange(localPage <= 2 ? 0 : localPage - 2);
    }
  };

  const handleAthenaCite = async () => {
    // Stage Athena citing page 6 (index 5)
    addLog(
      'athena → tool call',
      `library.openPage(book:"${book.id}", page:6)`,
      'athena',
    );
    await onCitePage(5, "That's the worked example on page 6.");
    setTimeout(() => {
      addLog(
        'athena → voice',
        '"That\'s the worked example on page 6."',
        'athena',
      );
    }, 950);
  };

  const handleToggleLock = async () => {
    const nextLocked = !isLocked;
    addLog(
      'teacher → channel',
      JSON.stringify({ type: 'library:lock', locked: nextLocked }),
      'teacher',
    );
    await onToggleLock(nextLocked);
  };

  // Ping seats when pages turn
  useEffect(() => {
    const pings: Record<string, number> = {};
    participants.forEach((p, idx) => {
      pings[p.participantId] = Date.now() + idx * 85;
    });
    setSeatPings(pings);
  }, [teacherPage, participants]);

  const spreadsCount = Math.ceil(book.pages.length / 2) + 1;
  const currentSpreadIdx =
    localPage === 0 ? 0 : Math.min(spreadsCount - 1, Math.floor((localPage + 1) / 2));
  const progressPercent = Math.max(10, ((localPage + 1) / book.pages.length) * 100);

  const isStudentDesynced = !isTeacher && !isLocked && localPage !== teacherPage;

  return (
    <div className="eco-library-root flex h-full min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-[var(--eco-rule)] bg-[var(--eco-ink)] text-[var(--eco-cream)]">
      {/* Top Chapter / Lesson Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--eco-rule)] bg-gradient-to-r from-[rgba(255,176,32,0.12)] via-[rgba(167,139,250,0.08)] to-transparent px-5 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 flex-none items-center justify-center rounded-xl bg-gradient-to-br from-[#FFD37A] to-[var(--eco-amber)] font-bold text-[#3A2500]">
            ∑
          </div>
          <div>
            <div className="font-semibold leading-tight text-[var(--eco-cream)]">{book.title}</div>
            <div className="font-mono text-xs text-[var(--eco-cream-faint)]">{book.subtitle}</div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Progress bar */}
          <div className="h-1.5 w-32 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[var(--eco-amber)] to-[#FF6B6B] transition-all duration-300"
              style={{ width: `${progressPercent}%` }}
            />
          </div>

          {onCloseStage && isTeacher && (
            <button
              type="button"
              onClick={onCloseStage}
              className="rounded-lg border border-[var(--eco-rule)] bg-[var(--eco-ink-sunken)] px-3 py-1 text-xs font-medium text-[var(--eco-cream-dim)] hover:bg-white/10"
            >
              Close stage
            </button>
          )}
        </div>
      </div>

      {/* Main Grid: Chapter Nav (Left), Flipbook Stage (Center), HUD Aside (Right) */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto p-4 md:grid-cols-[180px_minmax(0,1fr)_280px]">
        {/* Left Chapter Navigator */}
        <nav className="hidden rounded-xl border border-[var(--eco-rule)] bg-white/[0.02] p-3 md:block">
          <h4 className="mb-2.5 font-mono text-[10px] font-bold uppercase tracking-wider text-[var(--eco-cream-faint)]">
            Chapter
          </h4>
          <div className="flex flex-col gap-1.5">
            {book.pages.map((p, idx) => {
              if (p.isCover) return null;
              const isCurrent = localPage > 0 && (idx === localPage || idx === localPage + 1);
              return (
                <button
                  key={idx}
                  type="button"
                  onClick={() => handlePageChange(idx)}
                  className={`chip ${isCurrent ? 'on' : ''}`}
                  data-c={p.sectionColor || 'gold'}
                >
                  <span className="sw" />
                  <span className="n truncate">{p.heading || p.sectionTitle}</span>
                  <span className="p font-mono text-[10px]">{p.pageNumber}</span>
                </button>
              );
            })}
          </div>
        </nav>

        {/* Center: FlipBook Stage */}
        <div className="stage relative flex flex-col justify-between rounded-2xl border border-[var(--eco-rule)] bg-gradient-to-b from-white/[0.04] to-transparent p-4">
          <div className="flex min-h-[460px] flex-1 items-center justify-center overflow-hidden">
            <FlipBook
              book={book}
              currentPage={localPage}
              glowPage={library?.glowPage}
              onPageFlip={handlePageChange}
              canFlip={isTeacher || !isLocked}
            />
          </div>

          {/* Desync Catch-up Banner */}
          {isStudentDesynced && (
            <div className="my-2 flex items-center justify-between rounded-xl border border-[var(--eco-amber)] bg-[rgba(255,176,32,0.15)] px-4 py-2 text-xs">
              <span className="text-[var(--eco-amber)]">
                You are on page {localPage + 1} (Teacher is on page {teacherPage + 1})
              </span>
              <button
                type="button"
                onClick={() => setLocalPage(teacherPage)}
                className="rounded-md bg-[var(--eco-amber)] px-2.5 py-1 font-semibold text-[#3A2100] shadow-sm hover:brightness-110"
              >
                Jump to Teacher's Page
              </button>
            </div>
          )}

          {/* Spread Dots Indicator */}
          <div className="dots mt-3 flex justify-center gap-1.5">
            {Array.from({ length: spreadsCount }).map((_, i) => (
              <div
                key={i}
                className={`dot ${i === currentSpreadIdx ? 'on' : ''}`}
                onClick={() => handlePageChange(i === 0 ? 0 : i * 2 - 1)}
              />
            ))}
          </div>

          {/* Control Bar */}
          <div className="bar mt-3 flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              onClick={handlePrev}
              disabled={localPage === 0 || (!isTeacher && isLocked)}
              className="rounded-full border border-[var(--eco-rule)] bg-white/5 px-4 py-1.5 text-xs font-medium text-[var(--eco-cream)] hover:bg-white/10 disabled:opacity-40"
            >
              ← Previous
            </button>
            <button
              type="button"
              onClick={handleNext}
              disabled={localPage >= book.pages.length - 1 || (!isTeacher && isLocked)}
              className="rounded-full border border-[var(--eco-rule)] bg-white/5 px-4 py-1.5 text-xs font-medium text-[var(--eco-cream)] hover:bg-white/10 disabled:opacity-40"
            >
              Next →
            </button>

            <button
              type="button"
              onClick={handleAthenaCite}
              className="hero rounded-full bg-gradient-to-r from-[#FFD469] to-[var(--eco-amber)] px-5 py-1.5 text-xs font-bold text-[#3A2100] shadow-md transition hover:scale-105"
            >
              Athena cites page 6
            </button>

            {isTeacher && (
              <button
                type="button"
                onClick={handleToggleLock}
                className="ghost rounded-full border border-[var(--eco-glow)] bg-[var(--eco-glow-dim)] px-4 py-1.5 text-xs font-medium text-[var(--eco-glow-bright)] hover:bg-[var(--eco-glow)] hover:text-[var(--eco-ink)]"
              >
                {isLocked ? 'Unlock student paging' : 'Lock to teacher'}
              </button>
            )}
          </div>
        </div>

        {/* Right Aside HUD */}
        <aside className="flex flex-col gap-3">
          {/* Room Sync Card */}
          <div className="card room rounded-xl border border-[rgba(45,212,191,0.25)] bg-gradient-to-b from-[rgba(45,212,191,0.12)] to-transparent p-3.5">
            <h4 className="mb-2 font-mono text-[10px] font-bold uppercase tracking-wider text-[var(--eco-glow-bright)]">
              In the room
            </h4>
            <div className="seats flex flex-col gap-2">
              {participants.map((p, idx) => {
                const isPing = seatPings[p.participantId] !== undefined;
                const avColors = ['a', 'b', 'c'];
                const avClass = avColors[idx % avColors.length];
                return (
                  <div
                    key={p.participantId}
                    className={`seat flex items-center gap-2.5 rounded-lg border border-transparent bg-white/5 p-2 text-xs transition duration-300 ${
                      isPing ? 'border-[var(--eco-glow)] bg-[rgba(45,212,191,0.2)]' : ''
                    }`}
                  >
                    <span className={`av ${avClass} flex h-6 w-6 items-center justify-center rounded-full font-bold text-[#161022]`}>
                      {p.displayName.charAt(0).toUpperCase()}
                    </span>
                    <span className="nm flex-1 text-[var(--eco-cream)]">{p.displayName}</span>
                    <em className="font-mono text-[11px] text-[var(--eco-glow-bright)]">
                      p. <b className="pg font-bold">{localPage + 1}</b>
                    </em>
                  </div>
                );
              })}
            </div>
            <div className="lockrow mt-3 flex items-center gap-2 font-mono text-[11px] text-[var(--eco-cream-faint)]">
              {isLocked ? '🔒 Teacher controls the page' : '🔓 Students may read ahead'}
            </div>
          </div>

          {/* RTM Log Card */}
          <div className="card rtm rounded-xl border border-[rgba(167,139,250,0.25)] bg-gradient-to-b from-[rgba(167,139,250,0.12)] to-transparent p-3.5">
            <h4 className="mb-2 font-mono text-[10px] font-bold uppercase tracking-wider text-[#CFC0FF]">
              RTM channel
            </h4>
            <div className="log flex max-h-44 flex-col gap-2 overflow-hidden text-xs">
              {rtmLogs.map((log) => (
                <div
                  key={log.id}
                  className={`entry rounded border-l-2 bg-white/[0.02] p-1.5 pl-2.5 font-mono text-[11px] leading-tight text-[var(--eco-cream-dim)] ${
                    log.kind === 'athena'
                      ? 'border-l-[var(--eco-glow-bright)]'
                      : log.kind === 'teacher'
                      ? 'border-l-[var(--eco-amber)]'
                      : 'border-l-[#38BDF8]'
                  }`}
                >
                  <i className="block font-sans text-xs font-semibold text-[var(--eco-cream)]">
                    {log.label}
                  </i>
                  <span>{log.payload}</span>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
