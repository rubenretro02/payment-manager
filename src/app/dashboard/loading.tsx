import { Loader2 } from "lucide-react";

// Instant feedback while a page loads (Next.js route loading UI), so a
// navigation never looks frozen.
export default function Loading() {
  return (
    <div className="flex min-h-[45vh] items-center justify-center" aria-label="Loading">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );
}
