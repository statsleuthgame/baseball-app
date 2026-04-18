import { useEffect, useState } from "react";

/**
 * Returns true when the viewport matches the given media query (defaults to
 * ≤640px wide, i.e. phones in portrait). Updates on resize/orientation change.
 *
 * @example
 *   const isMobile = useIsMobile();
 *   // or a custom breakpoint:
 *   const isNarrow = useIsMobile("(max-width: 480px)");
 */
export function useIsMobile(query = "(max-width: 640px)") {
  const [matches, setMatches] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia(query).matches : false
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia(query);
    const onChange = (e) => setMatches(e.matches);
    // Sync once in case the query changed between render and effect
    setMatches(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}
