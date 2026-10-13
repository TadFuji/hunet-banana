import { test, expect } from '@playwright/test';

test('welcome animation lasts five seconds and repeats on reload without API calls', async ({ page }) => {
  const googleRequests: string[] = [];
  page.on('request', request => {
    if (new URL(request.url()).hostname === 'generativelanguage.googleapis.com') googleRequests.push(request.url());
  });
  const now = new Date('2026-10-13T00:00:00Z');
  await page.clock.install({ time: now });
  await page.clock.pauseAt(now);
  await page.goto('/');
  const loading = page.getByRole('dialog', { name: 'Loading…' });
  await expect(loading).toBeVisible();
  await expect(page.getByRole('button', { name: 'APIキーを設定', exact: true })).toHaveCount(0);
  await expect(page.locator('.startup-character img')).toHaveJSProperty('naturalWidth', 384);
  await page.clock.runFor(4_999);
  await expect(loading).toBeVisible();
  await page.clock.runFor(1);
  await expect(loading).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'APIキーを設定', exact: true })).toBeVisible();
  await page.reload();
  await expect(loading).toBeVisible();
  await page.clock.runFor(5_000);
  await expect(loading).toHaveCount(0);
  expect(googleRequests).toEqual([]);
});

test('reduced motion keeps the welcome window still and opens the editor', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const now = new Date('2026-10-13T00:00:00Z');
  await page.clock.install({ time: now });
  await page.clock.pauseAt(now);
  await page.goto('/');
  await expect(page.getByRole('dialog', { name: 'Loading…' })).toBeVisible();
  expect(await page.locator('.startup-character').evaluate(node => getComputedStyle(node).animationName)).toBe('none');
  await page.clock.runFor(5_000);
  await expect(page.getByRole('button', { name: 'APIキーを設定', exact: true })).toBeVisible();
});
