"use client";

import { useEffect, useRef } from "react";
import { useNotificationStore } from "@/store/notificationStore";

const STORAGE_KEY = "9r_last_active_time";
const THROTTLE_MS = 3000; // Throttle user interaction updates to once every 3s
const CHECK_INTERVAL_MS = 5000; // Check elapsed idle time every 5s
const WARNING_WINDOW_MS = 60 * 1000; // Show warning toast 60 seconds before auto-logout

/**
 * Automatically logs the user out when inactive across all open tabs.
 *
 * Activity is tracked via DOM interaction events and synchronized via localStorage,
 * so active work in one tab resets the idle timer for all tabs.
 *
 * When timeout is reached:
 *   1. Calls POST /api/auth/logout to clear server-side session cookies.
 *   2. Redirects to /login?reason=idle.
 */
export function useIdleSessionTimeout() {
  const addNotification = useNotificationStore((state) => state.addNotification);
  const warnedRef = useRef(false);
  const lastRecordedRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    let timerId = null;

    async function initIdleWatch() {
      try {
        const res = await fetch("/api/auth/status", { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const data = await res.json();

        // Only enforce when login is required and timeout is enabled (> 0)
        if (data.requireLogin === false) return;
        const idleMinutes = typeof data.sessionIdleTimeoutMinutes === "number"
          ? data.sessionIdleTimeoutMinutes
          : 30;

        if (idleMinutes <= 0) return; // 0 = disabled

        const timeoutMs = idleMinutes * 60 * 1000;

        // Initialize local storage timestamp if unset or stale
        const stored = Number(localStorage.getItem(STORAGE_KEY));
        const now = Date.now();
        lastRecordedRef.current = now;
        if (!stored || isNaN(stored) || stored > now || now - stored > timeoutMs) {
          localStorage.setItem(STORAGE_KEY, String(now));
        }

        const recordActivity = () => {
          const current = Date.now();
          if (current - lastRecordedRef.current < THROTTLE_MS) return;
          lastRecordedRef.current = current;
          try {
            localStorage.setItem(STORAGE_KEY, String(current));
          } catch {}
          warnedRef.current = false;
        };

        const events = ["mousedown", "keydown", "scroll", "touchstart"];
        events.forEach((evt) => window.addEventListener(evt, recordActivity, { passive: true }));

        const checkIdle = async () => {
          try {
            const current = Date.now();
            const lastActive = Number(localStorage.getItem(STORAGE_KEY) || current);
            const elapsed = current - lastActive;

            // Trigger auto-logout if limit exceeded
            if (elapsed >= timeoutMs) {
              if (timerId) clearInterval(timerId);
              try {
                await fetch("/api/auth/logout", { method: "POST" });
              } catch {}
              try {
                localStorage.removeItem(STORAGE_KEY);
              } catch {}
              window.location.assign("/login?reason=idle");
              return;
            }

            // Warning notification when approaching timeout (within 60s)
            const remaining = timeoutMs - elapsed;
            if (remaining <= WARNING_WINDOW_MS && !warnedRef.current) {
              warnedRef.current = true;
              const secondsLeft = Math.max(1, Math.round(remaining / 1000));
              addNotification({
                type: "warning",
                title: "Session Expiring Soon",
                message: `You will be logged out in ${secondsLeft}s due to inactivity. Move mouse or press any key to stay logged in.`,
                dismissible: true,
              });
            }
          } catch {}
        };

        timerId = setInterval(checkIdle, CHECK_INTERVAL_MS);

        return () => {
          events.forEach((evt) => window.removeEventListener(evt, recordActivity));
          if (timerId) clearInterval(timerId);
        };
      } catch {}
    }

    const cleanupPromise = initIdleWatch();

    return () => {
      cancelled = true;
      cleanupPromise.then((cleanup) => {
        if (typeof cleanup === "function") cleanup();
      });
    };
  }, [addNotification]);
}
