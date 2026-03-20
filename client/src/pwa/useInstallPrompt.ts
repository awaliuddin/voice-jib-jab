/**
 * useInstallPrompt
 *
 * Captures the browser's beforeinstallprompt event so the app can
 * show a custom "Install" button instead of relying on the browser's
 * default banner.
 *
 * Usage:
 *   const { canInstall, install, dismiss } = useInstallPrompt();
 *
 * Returns:
 *   canInstall  — true when the browser has a prompt ready (Chrome/Edge/Android)
 *   install     — trigger the prompt; resolves with "accepted" or "dismissed"
 *   dismiss     — discard the prompt without showing it
 *
 * iPhone note: iOS Safari does not fire beforeinstallprompt.
 * The InstallBanner component handles that case separately via UA detection.
 */

import { useState, useEffect, useCallback } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

interface UseInstallPromptResult {
  canInstall: boolean;
  install: () => Promise<"accepted" | "dismissed" | "unavailable">;
  dismiss: () => void;
}

export function useInstallPrompt(): UseInstallPromptResult {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const install = useCallback(async (): Promise<
    "accepted" | "dismissed" | "unavailable"
  > => {
    if (!deferredPrompt) return "unavailable";

    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    return outcome;
  }, [deferredPrompt]);

  const dismiss = useCallback(() => setDeferredPrompt(null), []);

  return {
    canInstall: deferredPrompt !== null,
    install,
    dismiss,
  };
}
