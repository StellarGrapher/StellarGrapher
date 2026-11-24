/**
 * Contract bookmarks are a purely client-side convenience: they live in
 * localStorage so the feature works without any backend changes. The shape is
 * versioned by key name so a future format change can't corrupt old entries.
 */
export const BOOKMARKS_STORAGE_KEY = "prism:bookmarks";
export const MAX_BOOKMARKS = 20;

export interface Bookmark {
  id: string;
  label: string;
  addedAt: number;
}

function isBookmark(value: unknown): value is Bookmark {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.label === "string" &&
    typeof candidate.addedAt === "number"
  );
}

export function readBookmarks(): Bookmark[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(BOOKMARKS_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isBookmark).slice(0, MAX_BOOKMARKS);
  } catch {
    return [];
  }
}

function writeBookmarks(bookmarks: Bookmark[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(BOOKMARKS_STORAGE_KEY, JSON.stringify(bookmarks));
  } catch {
    // Storage can be full or disabled; bookmarks are best-effort only.
  }
}

/**
 * Adds or updates a bookmark. Returns the resulting list, or null when the
 * limit is reached and the contract is not already saved.
 */
export function saveBookmark(id: string, label: string): Bookmark[] | null {
  const bookmarks = readBookmarks();
  const existing = bookmarks.find((bookmark) => bookmark.id === id);
  if (existing) {
    const updated = bookmarks.map((bookmark) =>
      bookmark.id === id ? { ...bookmark, label } : bookmark,
    );
    writeBookmarks(updated);
    return updated;
  }
  if (bookmarks.length >= MAX_BOOKMARKS) return null;
  const updated = [...bookmarks, { id, label, addedAt: Date.now() }];
  writeBookmarks(updated);
  return updated;
}

export function removeBookmark(id: string): Bookmark[] {
  const updated = readBookmarks().filter((bookmark) => bookmark.id !== id);
  writeBookmarks(updated);
  return updated;
}
