"use client";

/**
 * A small button in the Navbar that reminds users keyboard shortcuts exist.
 * Pressing it fires the same `?` key that KeyboardShortcutsProvider listens
 * for, so the modal opens without duplicating state.
 */
export default function ShortcutsHint() {
  function triggerShortcutsModal() {
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "?", bubbles: true })
    );
  }

  return (
    <button
      onClick={triggerShortcutsModal}
      aria-label="Open keyboard shortcuts (press ?)"
      title="Keyboard shortcuts (?)"
      className="text-prism-muted hover:text-prism-strong transition text-sm select-none"
    >
      <kbd className="inline-flex items-center justify-center w-6 h-6 rounded border border-prism-border bg-prism-bg font-mono text-xs">
        ?
      </kbd>
    </button>
  );
}
