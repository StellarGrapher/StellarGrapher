"use client";

import { useEffect } from "react";

type ShortcutHandler = () => void;

interface Shortcut {
  /** Key sequence, e.g. "/" or "g c" (space-separated multi-key). */
  keys: string;
  handler: ShortcutHandler;
}

/**
 * Registers a list of keyboard shortcuts on the document.
 *
 * Rules to avoid conflicting with browser defaults:
 *   - Never intercept shortcuts that use Ctrl, Meta, or Alt.
 *   - Don't fire while focus is in an editable element.
 *   - Multi-key sequences (e.g. "g c") must complete within 1 500 ms.
 */
export function useKeyboardShortcuts(shortcuts: Shortcut[]) {
  useEffect(() => {
    // Buffer for multi-key sequences like "g c".
    let pending: string | null = null;
    let pendingTimer: ReturnType<typeof setTimeout> | null = null;

    function clearPending() {
      pending = null;
      if (pendingTimer !== null) {
        clearTimeout(pendingTimer);
        pendingTimer = null;
      }
    }

    function onKeyDown(e: KeyboardEvent) {
      // Ignore modified keys so we never clash with browser shortcuts.
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const target = e.target as HTMLElement;
      const editable =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable;

      const key = e.key;

      for (const { keys, handler } of shortcuts) {
        const parts = keys.split(" ");

        if (parts.length === 1) {
          // Single-key shortcut — block while in an editable, except for Escape.
          if (editable && key !== "Escape") continue;
          if (key === parts[0]) {
            e.preventDefault();
            clearPending();
            handler();
            return;
          }
        } else {
          // Multi-key sequence — never fire in editable elements.
          if (editable) continue;
          if (pending === parts[0] && key === parts[1]) {
            e.preventDefault();
            clearPending();
            handler();
            return;
          }
          if (key === parts[0]) {
            clearPending();
            pending = key;
            pendingTimer = setTimeout(clearPending, 1500);
          }
        }
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      clearPending();
    };
  }, [shortcuts]);
}
