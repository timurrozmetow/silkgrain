import { useEffect, useState } from 'react';

/**
 * `scrollY * factor`, for the hero's photograph.
 *
 * Read through `requestAnimationFrame` rather than on every scroll event: the listener fires
 * far more often than the screen refreshes, and setting state each time is how a parallax turns
 * into a stutter. The listener is passive for the same reason - a non-passive scroll handler
 * blocks the browser from starting the scroll until it returns.
 *
 * Returns 0 forever under `prefers-reduced-motion`, and does not attach a listener at all: for
 * a visitor who gets motion sick, an effect that moves with the page is the whole problem.
 */
export function useParallax(factor: number): number {
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    /**
     * The flag is set before the frame is requested, and it is a boolean rather than the frame
     * id `requestAnimationFrame` returns.
     *
     * Holding the id looks equivalent and is not: if the callback ever runs before the
     * assignment completes, it clears a variable that is then immediately overwritten with the
     * id, and every later scroll takes the early return forever. That is exactly what happens
     * the moment anything runs frames synchronously - a test harness, or a browser that flushes
     * a pending frame on becoming visible - and it fails silently, as a parallax that simply
     * stops.
     */
    let pending = false;
    let frame = 0;

    function onScroll() {
      if (pending) return;
      pending = true;
      frame = window.requestAnimationFrame(() => {
        pending = false;
        setOffset(window.scrollY * factor);
      });
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.cancelAnimationFrame(frame);
    };
  }, [factor]);

  return offset;
}
