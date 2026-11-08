/**
 * Runs `start` once, on the visitor's first interaction or after `timeoutMs` (if given),
 * whichever comes first. Heavy enhancements (WebGL, scroll libraries) wait for this so they
 * never compete with hydration and the first paint for the main thread.
 */
const EVENTS = ["pointermove", "pointerdown", "keydown", "wheel", "touchstart", "scroll"] as const;

export function onFirstInteraction(start: () => void, timeoutMs?: number): () => void {
  let done = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const fire = () => {
    if (done) return;
    done = true;
    cleanup();
    start();
  };
  const cleanup = () => {
    EVENTS.forEach((e) => window.removeEventListener(e, fire));
    if (timer !== undefined) clearTimeout(timer);
  };
  EVENTS.forEach((e) => window.addEventListener(e, fire, { passive: true, once: true }));
  if (timeoutMs !== undefined) timer = setTimeout(fire, timeoutMs);
  return () => {
    done = true;
    cleanup();
  };
}
