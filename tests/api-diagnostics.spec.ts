import { test, expect, type Page } from '@playwright/test';

const KEY = 'DUMMY_DIAGNOSTICS_KEY_DO_NOT_USE_2026';
const MODEL = 'models/gemini-nano-banana-2.1';
const GOOGLE = 'https://generativelanguage.googleapis.com';
const metadata = { name: MODEL, supportedGenerationMethods: ['generateContent'], description: KEY };
async function connect(page: Page) {
  await page.getByRole('button', { name: 'APIキーを設定', exact: true }).click();
  await page.getByLabel('Gemini APIキー', { exact: true }).fill(KEY);
  await page.getByRole('button', { name: 'このタブに設定する' }).click();
  await expect(page.getByRole('button', { name: 'キー接続中' })).toBeVisible();
}
async function generate(page: Page) {
  await page.getByRole('tab', { name: '新規生成', exact: true }).click();
  await page.getByRole('button', { name: '画像を生成', exact: true }).click();
}

test('model diagnostics make only fixed Google GET requests and expose no raw metadata or key', async ({ page, context }) => {
  const calls: { url: string; method: string; body: string | null; headers: Record<string, string> }[] = [];
  const logs: string[] = []; page.on('console', m => logs.push(m.text()));
  await context.route(`${GOOGLE}/**`, async route => {
    const r = route.request(); calls.push({ url: r.url(), method: r.method(), body: r.postData(), headers: await r.allHeaders() });
    await route.fulfill({ status: r.url().includes('/v1/') ? 404 : 200, contentType: 'application/json', body: JSON.stringify(metadata) });
  });
  await page.goto('/'); await connect(page); await page.getByRole('button', { name: 'キー接続中' }).click();
  await page.getByRole('button', { name: 'モデル接続を確認（生成なし）' }).click();
  await expect(page.getByRole('status')).toContainText('v1 対象モデルを取得できません（404） ／ v1beta モデル情報と生成メソッド対応を確認');
  expect(calls.map(c => [c.method, c.url, c.body])).toEqual([
    ['GET', `${GOOGLE}/v1/${MODEL}`, null], ['GET', `${GOOGLE}/v1beta/${MODEL}`, null]
  ]);
  for (const c of calls) { expect(c.headers['x-goog-api-key']).toBe(KEY); expect(c.headers.cookie).toBeUndefined(); }
  expect(await page.evaluate(() => JSON.stringify([document.documentElement.outerHTML, localStorage, sessionStorage]))).not.toContain(KEY);
  expect(logs.join(' ')).not.toContain(KEY);
});

test('only a 404 with confirmed same-model beta support retries once and keeps the identical request', async ({ page, context }) => {
  await page.goto('/');
  const image = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = c.height = 64; return c.toDataURL('image/png').split(',')[1]; });
  const calls: { url: string; method: string; body: string | null }[] = [];
  await context.route(`${GOOGLE}/**`, async route => {
    const r = route.request(); calls.push({ url: r.url(), method: r.method(), body: r.postData() });
    await route.fulfill({ status: r.url().includes('/v1/') ? 404 : 200, contentType: 'application/json', body: JSON.stringify(r.method() === 'GET' ? metadata : { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: image } }] } }] }) });
  });
  await connect(page); await generate(page); await expect(page.getByRole('dialog', { name: '生成結果の確認' })).toBeVisible();
  expect(calls.map(c => [c.method, c.url])).toEqual([
    ['POST', `${GOOGLE}/v1/${MODEL}:generateContent`], ['GET', `${GOOGLE}/v1beta/${MODEL}`], ['POST', `${GOOGLE}/v1beta/${MODEL}:generateContent`]
  ]);
  expect(calls[0].body).toBe(calls[2].body); expect(calls[2].body).not.toContain(KEY);
  await page.getByRole('button', { name: '破棄', exact: true }).click(); await generate(page);
  await expect(page.getByRole('dialog', { name: '生成結果の確認' })).toBeVisible();
  expect(calls).toHaveLength(4); expect(calls[3].url).toBe(`${GOOGLE}/v1beta/${MODEL}:generateContent`);
});

for (const status of [400, 401, 403, 429, 500]) {
  test(`generation ${status} does not trigger metadata probes or a generation retry`, async ({ page, context }) => {
    let count = 0;
    await context.route(`${GOOGLE}/**`, route => { count++; return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ error: { message: `private ${KEY}` } }) }); });
    await page.goto('/'); await connect(page); await generate(page);
    await expect(page.getByRole('alert')).toBeVisible(); expect(count).toBe(1);
    await expect(page.getByRole('alert')).not.toContainText(KEY);
  });
}

for (const betaModelVisible of [false, true]) {
  test(`unavailable generation reports a safe actionable message (beta metadata ${betaModelVisible})`, async ({ page, context }) => {
    const calls: string[] = [];
    await context.route(`${GOOGLE}/**`, route => {
      const r = route.request(); calls.push(r.method());
      return route.fulfill({ status: betaModelVisible && r.method() === 'GET' ? 200 : 404, contentType: 'application/json', body: JSON.stringify(metadata) });
    });
    await page.goto('/'); await connect(page); await generate(page);
    await expect(page.getByRole('alert')).toContainText('モデル接続を確認（生成なし）');
    expect(calls).toEqual(betaModelVisible ? ['POST', 'GET', 'POST'] : ['POST', 'GET']);
    await expect(page.getByRole('alert')).not.toContainText(KEY);
  });
}

for (const status of [403, 429, 500]) {
  test(`beta metadata ${status} keeps its cause and never submits beta generation`, async ({ page, context }) => {
    const methods: string[] = [];
    await context.route(`${GOOGLE}/**`, route => {
      const method = route.request().method(); methods.push(method);
      return route.fulfill({ status: method === 'POST' ? 404 : status, contentType: 'application/json', body: '{}' });
    });
    await page.goto('/'); await connect(page); await generate(page);
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByRole('alert')).not.toContainText('指定モデル');
    expect(methods).toEqual(['POST', 'GET']);
  });
}

test('metadata for a different model cannot authorize a generation retry', async ({ page, context }) => {
  const methods: string[] = [];
  await context.route(`${GOOGLE}/**`, route => {
    const method = route.request().method(); methods.push(method);
    return route.fulfill({ status: method === 'POST' ? 404 : 200, contentType: 'application/json', body: JSON.stringify({ ...metadata, name: 'models/another-model' }) });
  });
  await page.goto('/'); await connect(page); await generate(page);
  await expect(page.getByRole('alert')).toContainText('モデル接続を確認（生成なし）');
  expect(methods).toEqual(['POST', 'GET']);
});

test('disconnect during beta preflight aborts the chain without submitting another generation', async ({ page, context }) => {
  const calls: string[] = []; let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await context.route(`${GOOGLE}/**`, async route => {
    calls.push(route.request().method());
    if (route.request().method() === 'GET') { await gate; try { await route.fulfill({ contentType: 'application/json', body: JSON.stringify(metadata) }); } catch {} }
    else await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
  });
  await page.goto('/'); await connect(page); await generate(page);
  await expect.poll(() => calls.length).toBe(2);
  await page.getByRole('button', { name: 'キー接続中' }).click(); await page.getByRole('button', { name: 'キーを破棄して切断' }).click(); release();
  await expect(page.getByRole('button', { name: 'APIキーを設定', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '画像を生成', exact: true })).toHaveCount(0);
  expect(calls).toEqual(['POST', 'GET']);
});
