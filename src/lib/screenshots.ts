// Resolve the right <img src> for a payment screenshot.
//
// Telegram's direct file URLs (https://api.telegram.org/file/bot…/<file_path>)
// are temporary — the file_path expires after a few hours/days. We store the
// permanent file_id on new payments and proxy through /api/screenshot/[fileId],
// which calls getFile fresh on each request. Legacy rows without a file_id
// keep using the stored URL (which may already be dead).
export function getScreenshotSrc(
  url: string | null | undefined,
  fileId: string | null | undefined
): string | null {
  if (fileId) return `/api/screenshot/${encodeURIComponent(fileId)}`;
  if (url) return url;
  return null;
}
