import { useEffect, useState } from "react";

// Subscribes to the current time, refreshing every `intervalMs`, so
// components can render "X minutes ago" labels without calling the
// impure Date.now() directly during render.
export function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(null);

  useEffect(() => {
    const tick = () => setNow(Date.now());
    const timeout = setTimeout(tick, 0);
    const interval = setInterval(tick, intervalMs);
    return () => {
      clearTimeout(timeout);
      clearInterval(interval);
    };
  }, [intervalMs]);

  return now;
}
