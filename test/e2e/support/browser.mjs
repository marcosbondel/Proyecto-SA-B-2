/**
 * Playwright plumbing shared by every UI-driving suite.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { BASE } from './gateway.mjs';

const SCREENSHOT_DIR = resolve('docs/qa/screenshots');
mkdirSync(SCREENSHOT_DIR, { recursive: true });

export async function launch() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  return { browser, ctx, page };
}

export async function clearSession(ctx, page) {
  try {
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
  } catch {
    // The page hasn't navigated anywhere yet — nothing to clear.
  }
  await ctx.clearCookies();
}

/** Logs in through the real login form, and waits for the redirect away from /login rather than a fixed sleep. */
export async function loginViaUI(ctx, page, email, password) {
  await clearSession(ctx, page);
  await page.goto(`${BASE}/login`);
  await page.waitForLoadState('networkidle');
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button:has-text("Entrar")');
  try {
    await page.waitForURL((url) => !url.toString().includes('/login'), { timeout: 15000 });
  } catch {
    // Either the login failed (an error banner is now on screen, which the
    // caller should assert on) or the redirect was slow. Either way the
    // caller inspects the resulting page state rather than trusting this.
  }
  await page.waitForTimeout(800);
  return page.url();
}

export function shot(page, name) {
  return page.screenshot({ path: join(SCREENSHOT_DIR, `${name}.png`), fullPage: false });
}

/** A 1x1 PNG, good enough for every "a photo was attached" step. */
export const DUMMY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);
