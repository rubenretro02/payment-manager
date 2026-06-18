'use client';

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

// Full-screen image viewer. Uses a plain <img>, which the browser always
// renders INLINE — so screenshots show large without triggering the download
// that happens when /api/screenshot/[fileId] is opened in a new browser tab.
//
// It's portaled to <body>, which is OUTSIDE any open Radix dialog. Radix
// dialogs close on "interaction outside", so without care, clicking the
// lightbox's X (or backdrop, or Escape) would ALSO close the dialog behind it,
// dumping the user back to the list. To prevent that we stop pointer/click/key
// events on the lightbox's own node via native listeners, so they never bubble
// to the document where Radix is listening. Result: closing the lightbox
// returns to the dialog instead of dismissing it.
export function ImageLightbox({
  src,
  alt,
  onClose,
}: {
  src: string | null;
  alt?: string;
  onClose: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!src) return;
    const node = rootRef.current;

    const stop = (e: Event) => e.stopPropagation();
    const onClickNative = (e: MouseEvent) => {
      e.stopPropagation();
      // Close on backdrop / X click, but not when clicking the image itself.
      const target = e.target as Element | null;
      if (!target || !target.closest('[data-lightbox-img]')) onClose();
    };
    node?.addEventListener('pointerdown', stop);
    node?.addEventListener('mousedown', stop);
    node?.addEventListener('click', onClickNative);

    // Escape closes only the lightbox. Capture phase + stopPropagation so the
    // underlying Radix dialog never sees the keypress.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey, true);

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      node?.removeEventListener('pointerdown', stop);
      node?.removeEventListener('mousedown', stop);
      node?.removeEventListener('click', onClickNative);
      document.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = prevOverflow;
    };
  }, [src, onClose]);

  if (!src || typeof document === 'undefined') return null;

  return createPortal(
    <div
      ref={rootRef}
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
    >
      <button
        type="button"
        className="absolute right-4 top-4 rounded-full bg-white/15 p-2 text-white transition-colors hover:bg-white/30"
        aria-label="Close"
      >
        <X className="h-5 w-5" />
      </button>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        data-lightbox-img
        src={src}
        alt={alt || 'Screenshot'}
        className="max-h-[92vh] max-w-[95vw] rounded-lg object-contain shadow-2xl"
      />
    </div>,
    document.body
  );
}
