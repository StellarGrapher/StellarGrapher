"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import ShortcutsModal from "./ShortcutsModal";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";

/**
 * Mounts global keyboard shortcuts for the app.
 *
 * The search-focus shortcut (/) is handled inside SearchBar itself so it can
 * access the input ref directly. This provider handles everything else:
 *   ?       → open shortcuts help modal
 *   g c     → navigate to /explorer
 *   g x     → navigate to /xdr
 *   g d     → navigate to /docs
 */
export default function KeyboardShortcutsProvider() {
  const [modalOpen, setModalOpen] = useState(false);
  const router = useRouter();

  const openModal = useCallback(() => setModalOpen(true), []);
  const closeModal = useCallback(() => setModalOpen(false), []);

  const shortcuts = useMemo(
    () => [
      { keys: "?",   handler: openModal },
      { keys: "g c", handler: () => router.push("/explorer") },
      { keys: "g x", handler: () => router.push("/xdr") },
      { keys: "g d", handler: () => router.push("/docs") },
    ],
    [openModal, router]
  );

  useKeyboardShortcuts(shortcuts);

  return <ShortcutsModal open={modalOpen} onClose={closeModal} />;
}
