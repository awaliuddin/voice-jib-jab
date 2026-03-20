/**
 * InstallBanner
 *
 * Shows a sticky bottom banner prompting the user to install the PWA.
 *
 * - Chrome / Edge / Android:  uses the beforeinstallprompt API (native dialog)
 * - iPhone / iPad (iOS Safari): shows manual "Add to Home Screen" instructions
 *   because iOS does not support beforeinstallprompt
 *
 * The banner is dismissed permanently (localStorage) once the user acts or
 * closes it.
 */

import React, { useState, useEffect } from "react";
import { useInstallPrompt } from "./useInstallPrompt.js";

const DISMISSED_KEY = "vjj-install-dismissed";

function isIos(): boolean {
  return (
    typeof navigator !== "undefined" &&
    /iphone|ipad|ipod/i.test(navigator.userAgent) &&
    !(window as unknown as { MSStream?: unknown }).MSStream
  );
}

function isInStandaloneMode(): boolean {
  return (
    "standalone" in window.navigator &&
    (window.navigator as { standalone?: boolean }).standalone === true
  );
}

export function InstallBanner(): React.ReactElement | null {
  const { canInstall, install, dismiss } = useInstallPrompt();
  const [visible, setVisible] = useState(false);
  const ios = isIos();

  useEffect(() => {
    if (localStorage.getItem(DISMISSED_KEY)) return;
    if (isInStandaloneMode()) return; // already installed

    // Show for iOS immediately; for others wait for prompt to be ready
    if (ios || canInstall) setVisible(true);
  }, [canInstall, ios]);

  if (!visible) return null;

  function handleDismiss() {
    localStorage.setItem(DISMISSED_KEY, "1");
    dismiss();
    setVisible(false);
  }

  async function handleInstall() {
    const outcome = await install();
    if (outcome !== "unavailable") {
      localStorage.setItem(DISMISSED_KEY, "1");
      setVisible(false);
    }
  }

  return (
    <div
      role="banner"
      aria-label="Install Voice Jib-Jab"
      style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 9999,
        background: "#111118",
        borderTop: "1px solid #1e1e2e",
        padding: "1rem 1.25rem",
        display: "flex",
        alignItems: "flex-start",
        gap: "0.75rem",
      }}
    >
      {/* Icon */}
      <img
        src="/icons/icon-192.png"
        alt=""
        width={40}
        height={40}
        style={{ borderRadius: 8, flexShrink: 0 }}
      />

      {/* Text */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{ fontWeight: 600, fontSize: "0.9rem", color: "#fff", marginBottom: "0.2rem" }}
        >
          Install Voice Jib-Jab
        </div>

        {ios ? (
          <div style={{ fontSize: "0.8rem", color: "#888", lineHeight: 1.5 }}>
            Tap{" "}
            <span style={{ color: "#3b82f6" }}>
              Share&nbsp;
              <svg
                style={{ display: "inline", verticalAlign: "middle" }}
                width="14" height="14" viewBox="0 0 24 24"
                fill="none" stroke="currentColor" strokeWidth="2"
                strokeLinecap="round" strokeLinejoin="round"
              >
                <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                <polyline points="16 6 12 2 8 6" />
                <line x1="12" y1="2" x2="12" y2="15" />
              </svg>
            </span>
            {" "}then <span style={{ color: "#3b82f6" }}>Add to Home Screen</span>
          </div>
        ) : (
          <div style={{ fontSize: "0.8rem", color: "#888" }}>
            Add to your home screen for the best experience
          </div>
        )}
      </div>

      {/* Actions */}
      <div style={{ display: "flex", gap: "0.5rem", flexShrink: 0, alignItems: "center" }}>
        {!ios && (
          <button
            onClick={handleInstall}
            style={{
              background: "#3b82f6",
              color: "#fff",
              border: "none",
              borderRadius: 6,
              padding: "0.4rem 0.9rem",
              fontSize: "0.82rem",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Install
          </button>
        )}
        <button
          onClick={handleDismiss}
          aria-label="Dismiss install banner"
          style={{
            background: "transparent",
            color: "#555",
            border: "1px solid #1e1e2e",
            borderRadius: 6,
            padding: "0.4rem 0.75rem",
            fontSize: "0.82rem",
            cursor: "pointer",
          }}
        >
          ✕
        </button>
      </div>
    </div>
  );
}
