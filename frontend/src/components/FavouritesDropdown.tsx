"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { readBookmarks, removeBookmark, type Bookmark } from "@/lib/bookmarks";

export default function FavouritesDropdown() {
  const pathname = usePathname();
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setBookmarks(readBookmarks());
  }, [pathname]);

  function toggleOpen() {
    setBookmarks(readBookmarks());
    setOpen((current) => !current);
  }

  function deleteBookmark(id: string) {
    setBookmarks(removeBookmark(id));
  }

  return (
    <div className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={toggleOpen}
        className="hover:text-prism-strong transition"
      >
        Favourites{bookmarks.length > 0 ? ` (${bookmarks.length})` : ""}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-72 rounded-lg border border-prism-border bg-prism-surface p-2 shadow-lg">
          {bookmarks.length === 0 ? (
            <p className="px-2 py-3 text-xs text-prism-muted">No saved contracts yet.</p>
          ) : (
            <ul className="space-y-1">
              {bookmarks.map((bookmark) => (
                <li key={bookmark.id} className="flex items-center gap-2">
                  <Link
                    href={`/contract/${encodeURIComponent(bookmark.id)}`}
                    onClick={() => setOpen(false)}
                    className="min-w-0 flex-1 truncate rounded px-2 py-2 font-mono text-xs hover:bg-prism-bg"
                    title={bookmark.label}
                  >
                    {bookmark.label}
                  </Link>
                  <button
                    type="button"
                    aria-label={`Remove ${bookmark.label} from favourites`}
                    onClick={() => deleteBookmark(bookmark.id)}
                    className="rounded px-2 py-1 text-xs text-prism-muted hover:text-prism-red"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
