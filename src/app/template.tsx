import type { ReactNode } from "react";

// Remounts on every route change so page swaps play a quick fade instead of
// flashing. Opacity only: a transform here would break position:fixed
// children (bottom nav, sheets) while the animation runs.
export default function Template({ children }: { children: ReactNode }) {
  return <div className="page-in">{children}</div>;
}
