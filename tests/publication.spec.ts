import { test, expect } from '@playwright/test';
import { securityHeaders } from '../security-headers.mjs';

test('served document and Worker headers are exact, including queries and HEAD', async ({ request }) => {
  const root = await request.get('/');
  const html = await root.text();
  const script = html.match(/src="([^"]+\.js)"/)![1];
  const bundle = await (await request.get(script)).text();
  const worker = bundle.match(/\/assets\/security\.worker-[\w-]+\.js/)![0];
  for (const [path, isWorker] of [
    ['/', false], ['/?foo=/assets/security.worker-fake.js', false],
    [worker, true], [worker + '?release=1', true], [script, false], ['/guide.pdf', false],
  ] as const) {
    for (const method of ['GET', 'HEAD']) {
      const response = await request.fetch(path, { method });
      expect(response.status(), `${method} ${path}`).toBe(200);
      for (const [name, value] of Object.entries(securityHeaders(isWorker))) {
        expect(response.headers()[name.toLowerCase()], `${method} ${path} ${name}`).toBe(value);
      }
      if (process.env.PLAYWRIGHT_BASE_URL) expect(response.headers()['strict-transport-security']).toContain('max-age=');
    }
  }
});

test('help serves the illustrated PDF from this origin with no third-party scripts', async ({ page, request, baseURL }) => {
  const requests: string[] = [];
  page.on('request', request => requests.push(request.url()));
  await page.goto('/');
  await page.getByText('ヘルプ', { exact: true }).click();
  const guide = page.getByRole('link', { name: '図解取扱説明書・料金表 ↗' });
  await expect(guide).toHaveAttribute('href', '/guide.pdf');
  await expect(guide).toHaveAttribute('rel', 'noopener noreferrer');
  expect(await page.locator('script[src]').evaluateAll(nodes => nodes.map(node => new URL((node as HTMLScriptElement).src).origin))).toEqual([new URL(baseURL!).origin]);
  expect(requests.every(url => url.startsWith(new URL(baseURL!).origin + '/') || url.startsWith('data:'))).toBe(true);
  const pdf = await request.get('/guide.pdf');
  expect(pdf.status()).toBe(200);
  expect((await pdf.body()).subarray(0, 5).toString()).toBe('%PDF-');
  expect(pdf.headers()['content-security-policy']).toContain("connect-src 'none'");
  if (process.env.PLAYWRIGHT_BASE_URL) {
    expect(pdf.headers()['content-type']).toContain('application/pdf');
    expect((await request.get('/not-found-should-stay-404')).status()).toBe(404);
    expect((await request.get('/api/key')).status()).toBe(404);
  }
});
