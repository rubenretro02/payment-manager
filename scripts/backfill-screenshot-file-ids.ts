/**
 * Backfill permanent Telegram file_ids for legacy payment screenshots.
 *
 * WHY
 *   Old payments stored only a direct Telegram file URL
 *   (https://api.telegram.org/file/bot<TOKEN>/<file_path>). Telegram's
 *   file_path expires after a few hours/days, so those URLs go dead and the
 *   screenshots stop displaying. New payments store the PERMANENT file_id and
 *   serve through /api/screenshot/[fileId], which never expires.
 *
 * WHAT THIS DOES
 *   For every payment that has a screenshot URL but no file_id, it tries to
 *   download the image from the legacy URL. If the URL is still alive, it
 *   re-uploads the bytes to the Telegram storage chat (sendDocument, so the
 *   already-compressed screenshot isn't recompressed again), obtains a fresh
 *   PERMANENT file_id, and writes it back to the row.
 *
 * LIMITATION
 *   A legacy URL whose file_path has ALREADY expired cannot be recovered —
 *   there is no file_id and no message_id stored to fetch it from Telegram.
 *   Those rows are reported as "dead (unrecoverable)" and skipped.
 *
 * USAGE
 *   Requires these env vars (loaded automatically by `bun run` from .env):
 *     NEXT_PUBLIC_SUPABASE_URL
 *     SUPABASE_SERVICE_ROLE_KEY
 *     TELEGRAM_BOT_TOKEN
 *     TELEGRAM_STORAGE_CHAT_ID
 *
 *     bun run scripts/backfill-screenshot-file-ids.ts             # dry run (default)
 *     bun run scripts/backfill-screenshot-file-ids.ts --apply     # actually write changes
 *     bun run scripts/backfill-screenshot-file-ids.ts --apply --limit 20
 */

import { createClient } from '@supabase/supabase-js';

// ---- Config -----------------------------------------------------------------

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const STORAGE_CHAT_ID = process.env.TELEGRAM_STORAGE_CHAT_ID;

const APPLY = process.argv.includes('--apply');
const limitArg = process.argv.find((a) => a.startsWith('--limit'));
const LIMIT = limitArg ? Number(limitArg.split('=')[1] ?? process.argv[process.argv.indexOf(limitArg) + 1]) : undefined;

// Be gentle with Telegram's rate limits (bots: ~20 messages/min to one chat).
const THROTTLE_MS = 1500;

// The two screenshot "slots" on a payment row.
const SLOTS = [
  { urlField: 'company_screenshot_url', idField: 'company_screenshot_file_id' },
  { urlField: 'payment_screenshot_url', idField: 'payment_screenshot_file_id' },
] as const;

type PaymentRow = {
  id: string;
  company_screenshot_url: string | null;
  company_screenshot_file_id: string | null;
  payment_screenshot_url: string | null;
  payment_screenshot_file_id: string | null;
};

// ---- Helpers ----------------------------------------------------------------

function requireEnv(): void {
  const missing = Object.entries({
    NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    TELEGRAM_BOT_TOKEN: BOT_TOKEN,
    TELEGRAM_STORAGE_CHAT_ID: STORAGE_CHAT_ID,
  })
    .filter(([, v]) => !v)
    .map(([k]) => k);

  if (missing.length) {
    console.error(`Missing required env vars: ${missing.join(', ')}`);
    process.exit(1);
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function extFromContentType(contentType: string): string {
  if (contentType.includes('png')) return 'png';
  if (contentType.includes('webp')) return 'webp';
  if (contentType.includes('gif')) return 'gif';
  return 'jpg';
}

/**
 * Download the legacy image. Returns null if the URL is dead (expired file_path
 * → Telegram answers 404/410), which means the screenshot is unrecoverable.
 */
async function downloadLegacy(url: string): Promise<{ bytes: ArrayBuffer; contentType: string } | null> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch (err) {
    console.warn(`    download error: ${(err as Error).message}`);
    return null;
  }
  if (!res.ok) return null;

  const contentType = res.headers.get('content-type') || 'image/jpeg';
  // A dead Telegram link sometimes returns 200 with a JSON error body.
  if (contentType.includes('application/json')) return null;

  const bytes = await res.arrayBuffer();
  if (bytes.byteLength === 0) return null;
  return { bytes, contentType };
}

/**
 * Re-upload the bytes to the storage chat and return the new PERMANENT file_id.
 * Uses sendDocument to avoid Telegram recompressing an already-compressed image.
 */
async function reuploadToTelegram(bytes: ArrayBuffer, contentType: string): Promise<string> {
  const form = new FormData();
  form.append('chat_id', STORAGE_CHAT_ID!);
  form.append('caption', 'backfill: recovered screenshot');
  form.append(
    'document',
    new Blob([bytes], { type: contentType }),
    `screenshot.${extFromContentType(contentType)}`
  );

  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendDocument`, {
    method: 'POST',
    body: form,
  });
  const data = await res.json();

  if (!data.ok) {
    throw new Error(`Telegram sendDocument failed: ${data.description ?? res.status}`);
  }

  const fileId: string | undefined = data.result?.document?.file_id;
  if (!fileId) {
    throw new Error('Telegram response missing document.file_id');
  }
  return fileId;
}

// ---- Main -------------------------------------------------------------------

async function main(): Promise<void> {
  requireEnv();

  console.log(`Mode: ${APPLY ? 'APPLY (writing changes)' : 'DRY RUN (no writes)'}`);
  if (LIMIT) console.log(`Limit: ${LIMIT} rows`);

  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

  // Rows that have at least one URL missing its file_id.
  let query = supabase
    .from('payments')
    .select(
      'id, company_screenshot_url, company_screenshot_file_id, payment_screenshot_url, payment_screenshot_file_id'
    )
    .or(
      'and(company_screenshot_url.not.is.null,company_screenshot_file_id.is.null),' +
        'and(payment_screenshot_url.not.is.null,payment_screenshot_file_id.is.null)'
    )
    .order('created_at', { ascending: false });

  if (LIMIT) query = query.limit(LIMIT);

  const { data, error } = await query;
  if (error) {
    console.error('Query failed:', error.message);
    process.exit(1);
  }

  const rows = (data ?? []) as PaymentRow[];
  console.log(`Found ${rows.length} payment row(s) with a URL but no file_id.\n`);

  const stats = { recovered: 0, dead: 0, errors: 0, slots: 0 };

  for (const row of rows) {
    for (const slot of SLOTS) {
      const url = row[slot.urlField];
      const existingId = row[slot.idField];
      if (!url || existingId) continue;

      stats.slots++;
      console.log(`payment ${row.id} · ${slot.idField}`);

      try {
        const downloaded = await downloadLegacy(url);
        if (!downloaded) {
          stats.dead++;
          console.log('    ✗ dead (unrecoverable) — legacy URL expired');
          continue;
        }

        if (!APPLY) {
          stats.recovered++;
          console.log(`    ✓ alive (${downloaded.bytes.byteLength} bytes) — would recover [dry run]`);
          continue;
        }

        const fileId = await reuploadToTelegram(downloaded.bytes, downloaded.contentType);
        const { error: updateError } = await supabase
          .from('payments')
          .update({ [slot.idField]: fileId })
          .eq('id', row.id);

        if (updateError) {
          stats.errors++;
          console.log(`    ! db update failed: ${updateError.message}`);
          continue;
        }

        stats.recovered++;
        console.log(`    ✓ recovered → ${fileId}`);
        await sleep(THROTTLE_MS);
      } catch (err) {
        stats.errors++;
        console.log(`    ! error: ${(err as Error).message}`);
      }
    }
  }

  console.log('\n--- Summary ---');
  console.log(`Screenshots needing backfill: ${stats.slots}`);
  console.log(`${APPLY ? 'Recovered' : 'Recoverable'}:                 ${stats.recovered}`);
  console.log(`Dead (unrecoverable):          ${stats.dead}`);
  console.log(`Errors:                        ${stats.errors}`);
  if (!APPLY && stats.recovered > 0) {
    console.log('\nRe-run with --apply to write the recovered file_ids.');
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
