import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { chromium, type Browser, type Page } from "@playwright/test";
import { extractErrorMessage } from "@checkstack/common";
import {
  ADMIN,
  BASE_URL,
  DEVICE_SCALE_FACTOR,
  LOW_POWER_STORAGE_KEY,
  OUT_DIR,
  THEME_STORAGE_KEY,
  VIEWPORT,
} from "../config.ts";
import { buildShots, type Shot } from "./manifest.ts";
import type { SeedRefs } from "../seed/types.ts";

/**
 * Drive a headless Chromium over the seeded instance and write one PNG per
 * manifest entry into the staging output dir.
 *
 * We drive `chromium` directly rather than the Playwright test-runner: there is
 * one long-lived booted instance and a flat list of bespoke shots (each with
 * its own route, pre-actions, and clip), which a single scripted context
 * expresses far more directly than the runner's project/worker machinery.
 *
 * Every shot renders in forced dark theme at a retina desktop viewport for a
 * consistent, premium marketing look.
 */
export async function captureAll({
  refs,
}: {
  refs: SeedRefs;
}): Promise<{ captured: string[]; failed: string[] }> {
  // Start from a clean output dir so shots dropped/renamed between runs never
  // linger as stale files that could be copied into a repo by mistake.
  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });
  const shots = buildShots(refs);
  const browser = await chromium.launch();
  try {
    const page = await openAuthenticatedPage(browser);
    const captured: string[] = [];
    const failed: string[] = [];
    for (const shot of shots) {
      try {
        await captureShot({ page, shot });
        captured.push(shot.name);
         
        console.log(`  captured ${shot.name}`);
      } catch (error) {
        failed.push(shot.name);
         
        console.warn(`  FAILED ${shot.name}: ${extractErrorMessage(error)}`);
      }
    }
    return { captured, failed };
  } finally {
    await browser.close();
  }
}

/**
 * Open a dark-themed, retina-viewport context, force the UI theme to dark
 * before any app code runs, and log the seeded admin in through the real login
 * form so every subsequent shot is authenticated as a named user.
 */
async function openAuthenticatedPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: DEVICE_SCALE_FACTOR,
    colorScheme: "dark",
    // Keep the full-power aesthetic (blurs, ambient background, animations); do
    // not let the app fall back to reduced motion.
    reducedMotion: "no-preference",
    baseURL: BASE_URL,
  });
  // Seed UI preferences before any app code runs:
  //  - dark theme (the ThemeProvider reads this key), and
  //  - force the HIGH-power performance tier. Headless Chromium has no GPU, so
  //    the app's FPS probe would otherwise auto-enable low-power mode - which
  //    both fires a toast and strips the premium blurs/animations we want in a
  //    marketing shot. Pre-seeding "false" pins high power and skips the probe.
  await context.addInitScript(
    ([themeKey, lowPowerKey]) => {
      globalThis.localStorage.setItem(themeKey, "dark");
      globalThis.localStorage.setItem(lowPowerKey, "false");
    },
    [THEME_STORAGE_KEY, LOW_POWER_STORAGE_KEY] as const,
  );

  const page = await context.newPage();
  await page.goto("/auth/login");
  await page.locator("#email").fill(ADMIN.email);
  await page.locator("#password").fill(ADMIN.password);
  await page.locator("button[type=submit]").first().click();
  // Onboarding/login lands on the app shell; wait until we've left auth routes.
  await page.waitForURL((url) => !url.pathname.startsWith("/auth/"), {
    timeout: 30_000,
  });
  return page;
}

async function captureShot({
  page,
  shot,
}: {
  page: Page;
  shot: Shot;
}): Promise<void> {
  await page.goto(shot.route);
  await page.waitForLoadState("networkidle");
  if (shot.preActions) {
    await shot.preActions(page);
  }
  // Let entry animations, charts, and layout settle before the frame.
  await page.waitForTimeout(shot.settleMs ?? 900);

  // Hide the "Preview instance" strip the namespaced backend renders (the
  // namespace only isolates shared redis; it must never appear in a shot).
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('[role="status"]')) {
      if (el.textContent?.includes("Preview instance:")) {
        el.setAttribute("style", "display: none");
      }
    }
  });

  const filePath = path.join(OUT_DIR, `${shot.name}.png`);
  if (shot.clipSelector) {
    const element = page.locator(shot.clipSelector).first();
    await element.screenshot({ path: filePath });
    return;
  }
  await page.screenshot({ path: filePath, fullPage: shot.fullPage ?? false });
}
