"use client";

import { useEffect } from "react";

export function PwaRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) {
      return;
    }

    let reloadedByControllerChange = false;
    const onControllerChange = () => {
      if (reloadedByControllerChange) {
        return;
      }
      reloadedByControllerChange = true;
      window.location.reload();
    };

    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    void (async () => {
      try {
        const registration = await navigator.serviceWorker.register("/sw.js?v=4", {
          updateViaCache: "none",
        });

        await registration.update();

        if (registration.waiting) {
          registration.waiting.postMessage({ type: "SKIP_WAITING" });
        }

        if (registration.installing) {
          registration.installing.addEventListener("statechange", () => {
            if (registration.waiting) {
              registration.waiting.postMessage({ type: "SKIP_WAITING" });
            }
          });
        }
      } catch {
        // Non-fatal: app works without offline cache.
      }
    })();

    return () => {
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
    };
  }, []);

  return null;
}
