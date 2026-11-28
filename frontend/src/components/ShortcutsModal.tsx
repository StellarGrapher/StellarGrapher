"use client";

import { useEffect, useCallback } from "react";

interface ShortcutsModalProps {
  open: boolean;
  onClose: () => void;
}

const SHORTCUTS = [
  { keys: "/",   description: "Focus search bar" },
  { keys: "?",   description: "Open this shortcuts reference" },
  { keys: "g c", description: "Go to contract explorer" },
  { keys: "g x", description: "Go to XDR decoder" },
  { keys: "g d", description: "Go to API docs" },
  { keys: "Esc", description: "Dismiss modal / clear focus" },
] as const;

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex items-center justify-center min-w-[1.75rem] h-7 px-1.5 rounded border border-prism-border bg-prism-surface font-mono text-xs text-prism-strong">
      {children}
    </kbd>
  );
}

function ShortcutRow({ keys, description }: { keys: string; description: string }) {
  const parts = keys.split(" ");
  return (
    <tr className="border-b border-prism-border/40 last:border-0">
      <td className="py-2.5 pr-6">
        <span className="flex items-center gap-1">
          {parts.map((k, i) => (
            <span key={i} className="flex items-center gap-1">
              {i > 0 && <span className="text-prism-muted text-xs">then</span>}
              <Kbd>{k}</Kbd>
            </span>
          ))}
        </span>
      </td>
      <td className="py-2.5 text-sm text-prism-muted">{description}</td>
    </tr>
  );
}

export default function ShortcutsModal({ open, onClose }: ShortcutsModalProps) {
  const handleBackdrop = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose]
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    if (open) document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={handleBackdrop}
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
    >
      <div className="relative w-full max-w-md mx-4 rounded-xl border border-prism-border bg-prism-surface shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-prism-border">
          <h2 className="text-base font-semibold text-prism-strong">Keyboard shortcuts</h2>
          <button
            onClick={onClose}
            aria-label="Close shortcuts modal"
            className="text-prism-muted hover:text-prism-strong transition"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-4">
          <table className="w-full">
            <tbody>
              {SHORTCUTS.map((s) => (
                <ShortcutRow key={s.keys} keys={s.keys} description={s.description} />
              ))}
            </tbody>
          </table>
        </div>

        {/* Footer hint */}
        <div className="px-6 py-3 border-t border-prism-border/40 text-xs text-prism-muted">
          Shortcuts are disabled while typing in input fields.
        </div>
      </div>
    </div>
  );
}
