/** Shared helpers for the chapter-18 search specs. */
import { Page } from '@playwright/test';

export const W2 = '/tmp/kairo-w2search/ws';

/** openIde pinned to an arbitrary workspace root (URL fragment binding). */
export async function openIdeAt(page: Page, root: string): Promise<void> {
  await page.goto(`/#${encodeURI(root)}`, { waitUntil: 'domcontentloaded' });
  const trust = page.getByRole('button', { name: /Yes, I trust|是，我信任|trust the authors$/i }).first();
  try { await trust.click({ timeout: 15_000 }); } catch { /* none */ }
  await page.waitForSelector('#theia-app-shell', { timeout: 120_000 });
}
