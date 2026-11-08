"use client";

import { Moon, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";

export type Theme = "dark" | "light";
const KEY = "strata-theme";

/**
 * Runs before first paint (inline, nonce'd) so a stored light preference never flashes dark.
 * Dark is the default; we only switch when the visitor chose light here.
 */
export const THEME_BOOT_SCRIPT = `try{var t=localStorage.getItem("${KEY}");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

function read(): Theme {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

function subscribe(cb: () => void) {
  const obs = new MutationObserver(cb);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => obs.disconnect();
}

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, read, () => "dark" as Theme);
  const next: Theme = theme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      onClick={() => {
        document.documentElement.dataset.theme = next;
        try {
          localStorage.setItem(KEY, next);
        } catch {
          // Storage can be blocked; the toggle still works for this page view.
        }
      }}
      aria-label={`Switch to ${next} theme`}
      className="inline-flex size-9 items-center justify-center rounded-sm text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
    >
      {theme === "dark" ? <Sun className="size-4" aria-hidden /> : <Moon className="size-4" aria-hidden />}
    </button>
  );
}
