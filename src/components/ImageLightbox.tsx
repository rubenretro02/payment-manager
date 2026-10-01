'use client';

import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';

// Full-screen image viewer built on the same Radix Dialog as every other
// dialog in the app. Using Radix (instead of a hand-rolled portal) means the
// nested-layer handling is automatic: clicking its X / the backdrop / Escape
// closes ONLY this viewer and returns to the dialog underneath, exactly like
// the Details -> Screenshots nesting. A plain <img> renders inline, so the
// screenshot shows large without the download that opening
// /api/screenshot/[fileId] in a new tab would trigger.
//
// The close button sits at the BOTTOM, centred: inside the Telegram mini-app
// the top edge is covered by Telegram's own fixed buttons, so a top-right X
// was unreachable there. Bottom offset respects the phone's safe area.
export function ImageLightbox({
  src,
  alt,
  onClose,
}: {
  src: string | null;
  alt?: string;
  onClose: () => void;
}) {
  return (
    <Dialog open={!!src} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        aria-describedby={undefined}
        className="w-auto max-w-[96vw] border-0 bg-transparent p-0 pb-20 shadow-none sm:max-w-[96vw] [&>button]:top-auto [&>button]:right-auto [&>button]:left-1/2 [&>button]:-translate-x-1/2 [&>button]:bottom-[calc(env(safe-area-inset-bottom)+1.25rem)] [&>button]:z-10 [&>button]:rounded-full [&>button]:bg-black/75 [&>button]:p-3.5 [&>button]:text-white [&>button]:opacity-100 [&>button]:ring-2 [&>button]:ring-white/40 [&>button>svg]:h-6 [&>button>svg]:w-6"
      >
        <DialogTitle className="sr-only">{alt || 'Screenshot'}</DialogTitle>
        {src && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt={alt || 'Screenshot'}
            className="mx-auto max-h-[82vh] max-w-[96vw] w-auto rounded-lg object-contain"
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
