"use client";

import { useEffect, useState } from "react";
import { readBookmarks, removeBookmark, saveBookmark } from "@/lib/bookmarks";

export default function BookmarkButton({ contractId }: { contractId: string }) {
  const [saved, setSaved] = useState(false);
  const [limitReached, setLimitReached] = useState(false);

  useEffect(() => {
    setSaved(readBookmarks().some((bookmark) => bookmark.id === contractId));
    setLimitReached(false);
  }, [contractId]);

  function toggleBookmark() {
    if (saved) {
      removeBookmark(contractId);
      setSaved(false);
      setLimitReached(false);
      return;
    }

    const bookmarks = saveBookmark(contractId, contractId);
    setLimitReached(bookmarks === null);
    if (bookmarks) setSaved(true);
  }

  return (
    <button
      type="button"
      aria-pressed={saved}
      aria-label={saved ? "Remove contract bookmark" : "Bookmark contract"}
      onClick={toggleBookmark}
      className="shrink-0 rounded border border-prism-border px-2 py-1 text-xs text-prism-muted hover:text-prism-strong"
      title={limitReached ? "Remove a saved contract before adding another" : undefined}
    >
      {saved ? "★ Saved" : "☆ Save"}
    </button>
  );
}
