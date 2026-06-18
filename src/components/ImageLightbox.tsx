'use client';

import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';

// Full-screen image viewer built on the same Radix Dialog as every other
// dialog in the app. Using Radix (instead of a hand-rolled portal) means the
// nested-layer handling is automatic: clicking its X / the backdrop / Escape
// closes ONLY this viewer and returns to the dialog underneath, exactly like
// the Details -> Screenshots nesting. A plain <img> renders inline, so the
// screenshot shows large without the download that opening
// /api/screenshot/[fileId] in a new tab would trigger.
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
        className="w-auto max-w-[96vw] border-0 bg-transparent p-0 shadow-none sm:max-w-[96vw] [&>button]:right-2 [&>button]:top-2 [&>button]:z-10 [&>button]:rounded-full [&>button]:bg-black/60 [&>button]:p-2 [&>button]:text-white [&>button]:opacity-100 [&>button>svg]:h-5 [&>button>svg]:w-5"
      >
        <DialogTitle className="sr-only">{alt || 'Screenshot'}</DialogTitle>
        {src && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt={alt || 'Screenshot'}
            className="mx-auto max-h-[90vh] max-w-[96vw] w-auto rounded-lg object-contain"
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
