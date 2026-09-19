"use client";

import { useEffect, useRef, useState } from "react";

/** Animates a number toward `target` (from 0 on first render). Instant with reduced motion. */
export function useCountUp(target: number, ms = 900): number {
  const [value, setValue] = useState(0);
  const current = useRef(0);

  useEffect(() => {
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const from = current.current;
    const start = performance.now();
    let raf = requestAnimationFrame(function tick(now) {
      const t = reduced ? 1 : Math.min(1, (now - start) / ms);
      const v = from + (target - from) * (1 - Math.pow(1 - t, 3)); // ease-out cubic
      current.current = v;
      setValue(v);
      if (t < 1) raf = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);

  return Math.round(value);
}
