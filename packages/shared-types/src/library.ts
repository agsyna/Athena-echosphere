/**
 * Types for the Athena Digital Library — synced textbook with page-flip,
 * floor control, NCERT curriculum content, and Athena voice citations.
 */

export type SectionColor = 'gold' | 'teal' | 'coral' | 'violet';

export interface LibraryPage {
  pageNumber: number; // 1-indexed for display
  sectionId?: string;
  sectionTitle?: string;
  sectionColor?: SectionColor;
  heading?: string;
  body?: string[];
  work?: string;
  drill?: string[];
  isCover?: boolean;
  isEndCover?: boolean;
  crest?: string;
  title?: string;
  subtitle?: string;
  rawText: string;
}

export interface LibraryBook {
  id: string;
  title: string;
  subtitle: string;
  curriculum: string;
  chapterNumber: number;
  pages: LibraryPage[];
}

export interface LibraryPublicState {
  activeBookId: string;
  currentPage: number; // 0-indexed spread / page index
  isLocked: boolean;   // true = teacher controls paging; false = students can read ahead
  isPresenting: boolean; // true = textbook is active on the main stage
  presenterId: string | null;
  lastSequence: number;
  glowPage?: number | null;
}

export interface LibraryPageTurnPayload {
  bookId: string;
  page: number;
  seq: number;
  source: 'teacher' | 'agent' | 'student';
  glow?: boolean;
}

export interface LibraryLockPayload {
  locked: boolean;
}

export interface LibraryPresentPayload {
  presenting: boolean;
  presenterId: string | null;
}

export interface LibrarySearchResult {
  bookId: string;
  page: number;
  snippet: string;
  confidence: number;
  sectionTitle?: string;
}
