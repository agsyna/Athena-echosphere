/**
 * Digital Library Catalog and Search Service for Athena.
 *
 * Provides curated NCERT curriculum chapters with per-page text indexing
 * and search capabilities for Athena's tool calls and citation pipeline.
 */

import type {
  LibraryBook,
  LibraryPage,
  LibraryPublicState,
  LibrarySearchResult,
} from '@echosphere/shared-types';

export const NCERT_CLASS7_CH2_BOOK: LibraryBook = {
  id: 'ncert-7-ch2',
  title: 'Adding unlike fractions',
  subtitle: 'NCERT · CLASS 7 · CHAPTER 2',
  curriculum: 'NCERT Mathematics',
  chapterNumber: 2,
  pages: [
    {
      pageNumber: 1,
      isCover: true,
      crest: '∑',
      title: 'Mathematics',
      subtitle: 'CLASS 7 · CHAPTER 2',
      rawText: 'Mathematics Class 7 Chapter 2 Fractions and Decimals. Adding unlike fractions.',
    },
    {
      pageNumber: 2,
      sectionColor: 'gold',
      sectionId: '2.1',
      sectionTitle: '2.1 Introduction',
      heading: 'Unlike fractions',
      body: [
        'Two fractions are unlike when their denominators differ. They cannot be added directly, because the parts they count are not the same size.',
        'Before adding, both fractions must be rewritten so they share one denominator.',
      ],
      rawText:
        '2.1 Introduction Unlike fractions. Two fractions are unlike when their denominators differ. They cannot be added directly, because the parts they count are not the same size. Before adding, both fractions must be rewritten so they share one denominator.',
    },
    {
      pageNumber: 3,
      sectionColor: 'teal',
      sectionId: '2.2',
      sectionTitle: '2.2 Method',
      heading: 'Finding a common denominator',
      body: [
        'Take the lowest common multiple of the two denominators, rewrite each fraction with it, then add the numerators.',
      ],
      work: '1/4 + 1/6\nLCM(4, 6) = 12\n3/12 + 2/12 = 5/12',
      rawText:
        '2.2 Method Finding a common denominator. Take the lowest common multiple of the two denominators, rewrite each fraction with it, then add the numerators. Example: 1/4 + 1/6, LCM of 4 and 6 is 12, 3/12 + 2/12 = 5/12.',
    },
    {
      pageNumber: 4,
      sectionColor: 'teal',
      sectionId: '2.3',
      sectionTitle: '2.3 Worked example',
      heading: 'Step by step',
      body: [
        'Multiply the numerator by the same factor used on the denominator. This is the step students most often miss.',
      ],
      work: '2/3 + 1/5\nLCM(3, 5) = 15\n2/3 = 10/15\n1/5 =  3/15\nSum   = 13/15',
      rawText:
        '2.3 Worked example Step by step. Multiply the numerator by the same factor used on the denominator. This is the step students most often miss. 2/3 + 1/5, LCM of 3 and 5 is 15. 2/3 becomes 10/15, 1/5 becomes 3/15. Sum = 13/15.',
    },
    {
      pageNumber: 5,
      sectionColor: 'coral',
      sectionId: '2.4',
      sectionTitle: '2.4 Common error',
      heading: 'Adding the denominators',
      body: [
        'A frequent mistake is to add the denominators as well as the numerators.',
      ],
      work: 'WRONG   1/4 + 1/6 = 2/10\nRIGHT   1/4 + 1/6 = 5/12',
      rawText:
        '2.4 Common error Adding the denominators. A frequent mistake is to add the denominators as well as the numerators. WRONG: 1/4 + 1/6 = 2/10. RIGHT: 1/4 + 1/6 = 5/12.',
    },
    {
      pageNumber: 6,
      sectionColor: 'violet',
      sectionId: '2.5',
      sectionTitle: '2.5 Worked example',
      heading: 'Subtracting unlike fractions',
      body: [
        'The same common denominator applies — only the operation on the numerators changes.',
      ],
      work: '3/4 − 1/6\nLCM(4, 6) = 12\n9/12 − 2/12 = 7/12',
      rawText:
        '2.5 Worked example Subtracting unlike fractions. The same common denominator applies — only the operation on the numerators changes. Example: 3/4 minus 1/6. LCM of 4 and 6 is 12. 9/12 minus 2/12 = 7/12.',
    },
    {
      pageNumber: 7,
      sectionColor: 'violet',
      sectionId: '2.6',
      sectionTitle: '2.6 Practice',
      heading: 'Try these',
      drill: [
        '1.   1/2 + 1/3',
        '2.   2/5 + 1/4',
        '3.   5/6 − 1/3',
        '4.   3/8 + 1/6',
      ],
      rawText:
        '2.6 Practice Try these problems: 1. 1/2 + 1/3. 2. 2/5 + 1/4. 3. 5/6 minus 1/3. 4. 3/8 + 1/6.',
    },
    {
      pageNumber: 8,
      isCover: true,
      isEndCover: true,
      crest: '✓',
      title: 'End of chapter',
      subtitle: 'ATHENA CAN CITE ANY PAGE',
      rawText: 'End of chapter. Athena can cite any page in the curriculum.',
    },
  ],
};

const BOOKS: Map<string, LibraryBook> = new Map([
  [NCERT_CLASS7_CH2_BOOK.id, NCERT_CLASS7_CH2_BOOK],
]);

export function getLibraryBook(bookId: string): LibraryBook | undefined {
  return BOOKS.get(bookId);
}

export function getAllBooks(): LibraryBook[] {
  return Array.from(BOOKS.values());
}

export function createInitialLibraryState(bookId = NCERT_CLASS7_CH2_BOOK.id): LibraryPublicState {
  return {
    activeBookId: bookId,
    currentPage: 0,
    isLocked: true,
    isPresenting: false,
    presenterId: null,
    lastSequence: 0,
    glowPage: null,
  };
}

/**
 * Searches across pages in a book for keywords or concept queries.
 * Returns the best matching page with confidence score and text snippet.
 */
export function findPageInBook(bookId: string, query: string): LibrarySearchResult | null {
  const book = BOOKS.get(bookId);
  if (!book || !query || query.trim().length === 0) return null;

  const terms = query
    .toLowerCase()
    .replace(/[^\w\s/]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1);

  if (terms.length === 0) return null;

  interface MatchCandidate {
    pageIndex: number;
    score: number;
    snippet: string;
    sectionTitle?: string;
  }

  let bestMatch: MatchCandidate | null = null;

  for (let idx = 0; idx < book.pages.length; idx++) {
    const page = book.pages[idx]!;
    let score = 0;
    const lowerText = page.rawText.toLowerCase();
    const lowerHeading = (page.heading ?? '').toLowerCase();
    const lowerSec = (page.sectionTitle ?? '').toLowerCase();

    for (const term of terms) {
      if (lowerSec.includes(term)) score += 5;
      if (lowerHeading.includes(term)) score += 4;
      if (page.work && page.work.toLowerCase().includes(term)) score += 3;
      if (lowerText.includes(term)) score += 1;
    }

    // Direct page number match: e.g. "page 6" or "p. 6" or "6"
    if (terms.includes(String(page.pageNumber)) || query.includes(`page ${page.pageNumber}`)) {
      score += 10;
    }

    if (!bestMatch || score > bestMatch.score) {
      bestMatch = {
        pageIndex: idx,
        score,
        snippet: page.heading || page.sectionTitle || page.rawText.slice(0, 100),
        sectionTitle: page.sectionTitle,
      };
    }
  }

  const found = bestMatch as MatchCandidate | null;
  if (!found || found.score < 2) {
    return null;
  }

  return {
    bookId,
    page: found.pageIndex, // 0-indexed for StPageFlip
    snippet: found.snippet,
    confidence: Math.min(1.0, found.score / 10),
    sectionTitle: found.sectionTitle,
  };
}

