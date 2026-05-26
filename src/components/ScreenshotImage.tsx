'use client';

import { useState } from 'react';
import { ImageOff } from 'lucide-react';
import { getScreenshotSrc } from '@/lib/screenshots';

interface ScreenshotImageProps {
  url: string | null | undefined;
  fileId: string | null | undefined;
  alt: string;
  className?: string;
}

// Renders a payment screenshot, preferring the permanent file_id proxy
// over the legacy direct Telegram URL. Shows a placeholder when the image
// fails to load — most commonly because the legacy URL's file_path has
// already expired on Telegram's side and there's no file_id to recover from.
export function ScreenshotImage({ url, fileId, alt, className }: ScreenshotImageProps) {
  const [failed, setFailed] = useState(false);
  const src = getScreenshotSrc(url, fileId);

  if (!src || failed) {
    return (
      <div className={`flex flex-col items-center justify-center gap-2 bg-muted text-muted-foreground p-6 ${className ?? ''}`}>
        <ImageOff className="h-8 w-8" />
        <p className="text-xs text-center">Screenshot no longer available</p>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      onError={() => setFailed(true)}
    />
  );
}
