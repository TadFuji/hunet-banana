import { test, expect } from '@playwright/test';

const menu = (page:any, name:string) => page.locator('.menu-bar details').filter({ has: page.locator('summary', { hasText: name }) });
const summary = (page:any, name:string) => page.locator('.menu-bar summary').filter({ hasText: name });

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('tab', { name: 'レイヤー', exact: true })).toBeVisible({ timeout: 7000 });
});

test('menu closes when clicking outside it', async ({ page }) => {
  await summary(page, 'ファイル').click();
  await expect(menu(page, 'ファイル')).toHaveAttribute('open', '');
  await page.getByText('AI画像生成・編集', { exact: true }).click();
  await expect(menu(page, 'ファイル')).not.toHaveAttribute('open', '');
});

test('menu closes when clicking its title again or one of its items', async ({ page }) => {
  await summary(page, 'ファイル').click();
  await summary(page, 'ファイル').click();
  await expect(menu(page, 'ファイル')).not.toHaveAttribute('open', '');
  await summary(page, '表示').click();
  await menu(page, '表示').getByRole('button', { name: '拡大', exact: true }).click();
  await expect(menu(page, '表示')).not.toHaveAttribute('open', '');
});

test('opening another menu closes the previous one, and Escape closes the open menu', async ({ page }) => {
  await summary(page, 'ファイル').click();
  await summary(page, '編集').click();
  await expect(menu(page, 'ファイル')).not.toHaveAttribute('open', '');
  await expect(menu(page, '編集')).toHaveAttribute('open', '');
  await page.keyboard.press('Escape');
  await expect(menu(page, '編集')).not.toHaveAttribute('open', '');
});

test('opening a menu with the keyboard closes the previous one', async ({ page }) => {
  await summary(page, 'ファイル').focus();
  await page.keyboard.press('Enter');
  await expect(menu(page, 'ファイル')).toHaveAttribute('open', '');
  await summary(page, '編集').focus();
  await page.keyboard.press('Enter');
  await expect(menu(page, '編集')).toHaveAttribute('open', '');
  await expect(menu(page, 'ファイル')).not.toHaveAttribute('open', '');
});
