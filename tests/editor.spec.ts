import { test, expect } from '@playwright/test';
const KEY='DUMMY_ONLY_TEST_KEY_DO_NOT_USE_2026';
async function connect(page:any){await page.getByRole('button',{name:'APIキーを設定',exact:true}).click();await page.getByLabel('Gemini APIキー',{exact:true}).fill(KEY);await page.getByRole('button',{name:'このタブに設定する'}).click();await expect(page.getByRole('button',{name:'キー接続中'})).toBeVisible();}
async function png(page:any,color='red'){return page.evaluate((color:string)=>{const c=document.createElement('canvas');c.width=64;c.height=64;const ctx=c.getContext('2d')!;ctx.fillStyle=color;ctx.fillRect(0,0,64,64);return c.toDataURL('image/png').split(',')[1];},color);}
test('Photoshop layout, local drawing undo, and safe project save/export',async({page})=>{
  await page.goto('/');await expect(page.getByRole('tab',{name:'レイヤー',exact:true})).toBeVisible({timeout:7000});await expect(page.getByRole('button',{name:'選択ブラシ',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'矩形選択',exact:true}).click();const box=await page.getByLabel('編集キャンバス',{exact:true}).boundingBox();expect(box).toBeTruthy();await page.mouse.move(box!.x+60,box!.y+60);await page.mouse.down();await page.mouse.move(box!.x+200,box!.y+160);await page.mouse.up();
  await expect(page.getByRole('button',{name:'元に戻す',exact:true})).toBeEnabled();await page.getByRole('button',{name:'元に戻す',exact:true}).click();await expect(page.getByRole('button',{name:'やり直す',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'保存',exact:true}).click();await expect(page.getByText('このブラウザに保存しました',{exact:true})).toBeVisible();
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'プロジェクトを書き出す',exact:true}).click();const result=await download;expect(result.suggestedFilename()).toMatch(/\.json$/);
  const stored=await page.evaluate(async()=>{return await new Promise<any>(resolve=>{const r=indexedDB.open('nano-banana-projects',1);r.onsuccess=()=>{const q=r.result.transaction('projects').objectStore('projects').get('current');q.onsuccess=()=>{resolve(q.result);r.result.close();};};});});expect(stored.layers.length).toBe(1);expect(JSON.stringify(stored)).not.toContain(KEY);
  await page.screenshot({path:'docs/screenshots/editor-desktop.png',fullPage:true});
});
test('BYOK goes only in a Google header, clears DOM/storage, redacts echoed keys',async({page,context,baseURL})=>{
  const logs:string[]=[];page.on('console',m=>logs.push(m.text()));const requests:any[]=[];await page.goto('/');const image=await png(page);
  await context.route('https://generativelanguage.googleapis.com/**',async route=>{const r=route.request();requests.push({url:r.url(),headers:await r.allHeaders(),body:r.postData()});await route.fulfill({contentType:'application/json',body:JSON.stringify({candidates:[{content:{parts:[{inlineData:{mimeType:'image/png',data:image},thoughtSignature:'signature'},{text:`Result ${KEY}`} ]}}]})});});
  await connect(page);expect(await page.locator('#gemini-key').count()).toBe(0);await page.getByRole('tab',{name:'新規生成',exact:true}).click();await page.getByRole('button',{name:'画像を生成',exact:true}).click();await expect(page.getByRole('dialog',{name:'生成結果の確認'})).toBeVisible();await expect(page.getByText('Result [redacted]',{exact:true})).toBeVisible();
  expect(requests).toHaveLength(1);expect(requests[0].headers['x-goog-api-key']).toBe(KEY);expect(requests[0].url).not.toContain(KEY);expect(requests[0].body).not.toContain(KEY);expect(requests[0].headers.cookie).toBeUndefined();expect(requests[0].headers.referer).toBe(new URL(baseURL!).origin+'/');
  const state=await page.evaluate(()=>({local:JSON.stringify(localStorage),session:JSON.stringify(sessionStorage),html:document.documentElement.outerHTML}));expect(JSON.stringify(state)).not.toContain(KEY);expect(logs.join(' ')).not.toContain(KEY);
  await page.getByRole('button',{name:'キャンバスに採用'}).click();await page.getByRole('button',{name:'キー接続中'}).click();await page.getByRole('button',{name:'キーを破棄して切断'}).click();await expect(page.getByRole('button',{name:'APIキーを設定',exact:true})).toBeVisible();
  await page.reload();await expect(page.getByRole('button',{name:'APIキーを設定',exact:true})).toBeVisible({timeout:7000});
});
test('production CSP protects both document and worker, and raw Google errors stay private',async({page,context,request})=>{
  const response=await request.get('/');expect(response.headers()['content-security-policy']).toContain("connect-src 'none'");const html=await response.text();const script=html.match(/src="([^"]+\.js)"/)![1];const js=await (await request.get(script)).text();const worker=js.match(/\/assets\/security\.worker-[\w-]+\.js/)![0];expect((await request.get(worker)).headers()['content-security-policy']).toContain('connect-src https://generativelanguage.googleapis.com');expect((await request.get('/?foo=/security.worker-x')).headers()['content-security-policy']).toContain("connect-src 'none'");expect((await request.post('/')).status()).toBe(405);
  await page.goto('/');await context.route('https://generativelanguage.googleapis.com/**',route=>route.fulfill({status:403,contentType:'application/json',body:JSON.stringify({error:{message:`secret ${KEY} <script>bad()</script>`}})}));await connect(page);await page.getByRole('tab',{name:'新規生成',exact:true}).click();await page.getByRole('button',{name:'画像を生成',exact:true}).click();await expect(page.getByRole('alert')).toContainText('APIキーの権限');await expect(page.getByRole('alert')).not.toContainText(KEY);
  const blocked=await page.evaluate(async()=>{try{await fetch('https://generativelanguage.googleapis.com/test');return false;}catch{return true;}});expect(blocked).toBe(true);
});
test('idle lock destroys the session key without saving it',async({page})=>{await page.goto('/');await expect(page.getByRole('dialog',{name:'Loading…'})).toHaveCount(0,{timeout:7000});await page.clock.install();await connect(page);await page.clock.fastForward(15*60*1000+1000);await expect(page.getByRole('button',{name:'APIキーを設定',exact:true})).toBeVisible();});

test('API redirects cannot forward the key to a different origin', async ({ page, context }) => {
  await page.goto('/'); let forwarded = 0;
  await context.route('https://untrusted.invalid/**', route => { forwarded++; return route.abort(); });
  await context.route('https://generativelanguage.googleapis.com/**', route => route.fulfill({ status: 302, headers: { location: 'https://untrusted.invalid/collect' } }));
  await connect(page); await page.getByRole('tab', { name: '新規生成', exact: true }).click(); await page.getByRole('button', { name: '画像を生成', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('通信が中断'); expect(forwarded).toBe(0);
});

test('partial edit preserves every unselected displayed pixel even when AI redraws the whole image', async ({ page, context }) => {
  await page.goto('/');
  const blue = await png(page, 'blue'); const red = await png(page, 'red');
  const project = { version: 1, name: 'Mask proof', width: 64, height: 64, layers: [{ id: 'base', name: 'Original', visible: true, opacity: 1, dataUrl: `data:image/png;base64,${blue}` }] };
  await page.locator('input[accept=".json,application/json"]').setInputFiles({ name: 'proof.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) });
  await expect(page.getByText('プロジェクトを読み込みました', { exact: true })).toBeVisible();
  await expect.poll(() => page.getByLabel('編集中の画像', { exact: true }).evaluate((c: HTMLCanvasElement) => c.width)).toBe(64);
  const before = await page.getByLabel('編集中の画像', { exact: true }).evaluate((c: HTMLCanvasElement) => Array.from(c.getContext('2d')!.getImageData(0, 0, 64, 64).data));
  await page.getByRole('button', { name: '矩形選択', exact: true }).click();
  const box = (await page.getByLabel('編集キャンバス', { exact: true }).boundingBox())!;
  await page.mouse.move(box.x + box.width * .25, box.y + box.height * .25); await page.mouse.down();
  await page.mouse.move(box.x + box.width * .65, box.y + box.height * .65); await page.mouse.up();
  const mask = await page.locator('.mask-canvas').evaluate((c: HTMLCanvasElement) => Array.from(c.getContext('2d')!.getImageData(0, 0, 64, 64).data));
  await context.route('https://generativelanguage.googleapis.com/**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: red }, thoughtSignature: 'mask-signature' }] } }] }) }));
  await connect(page); await page.getByRole('button', { name: '画像を生成', exact: true }).click();
  await page.getByRole('button', { name: 'キャンバスに採用' }).click();
  await expect(page.getByRole('dialog', { name: '生成結果の確認' })).toHaveCount(0);
  await expect.poll(() => page.getByLabel('編集中の画像', { exact: true }).evaluate((c: HTMLCanvasElement) => c.getContext('2d')!.getImageData(30, 30, 1, 1).data[0])).toBe(255);
  const after = await page.getByLabel('編集中の画像', { exact: true }).evaluate((c: HTMLCanvasElement) => Array.from(c.getContext('2d')!.getImageData(0, 0, 64, 64).data));
  let protectedPixels = 0, selectedPixels = 0;
  for (let i = 0; i < mask.length; i += 4) {
    if (mask[i + 3] === 0) { expect(after.slice(i, i + 4)).toEqual(before.slice(i, i + 4)); protectedPixels++; }
    if (mask[i + 3] === 255) { expect(after.slice(i, i + 4)).toEqual([255, 0, 0, 255]); selectedPixels++; }
  }
  expect(protectedPixels).toBeGreaterThan(2000); expect(selectedPixels).toBeGreaterThan(100);
});

test('Google search HTML is sandboxed and cannot execute scripts or load trackers', async ({ page, context }) => {
  await page.goto('/'); const image = await png(page); let externalRequests = 0;
  await context.route('https://tracker.invalid/**', route => { externalRequests++; return route.abort(); });
  await context.route('https://generativelanguage.googleapis.com/**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: image } }] }, groundingMetadata: { groundingChunks: [{image: {sourceUri: 'https://example.com/image-source', imageUri: 'https://example.com/image.png', title: 'Image attribution'}}], imageSearchQueries: ['red apple'], searchEntryPoint: { renderedContent: '<script>parent.__unsafeSearch=true</script><img src="https://tracker.invalid/pixel"><p>Search proof</p>' } } }] }) }));
  await connect(page); await page.getByRole('tab', { name: '新規生成', exact: true }).click(); await page.getByRole('button', { name: '画像を生成', exact: true }).click();
  await expect(page.frameLocator('iframe[title="Google検索の提案"]').getByText('Search proof')).toBeVisible();
  await expect(page.getByRole('link', {name: 'Image attribution', exact: true})).toHaveAttribute('href', 'https://example.com/image-source');
  await expect(page.getByRole('link', {name: 'red apple', exact: true})).toHaveAttribute('href', 'https://www.google.com/search?q=red%20apple&udm=2');
  expect(await page.evaluate(() => (window as any).__unsafeSearch)).toBeUndefined(); expect(externalRequests).toBe(0);
});

test('Batch create, restore, poll, and cancel use official fixed Google endpoints without persisting the key', async ({ page, context }) => {
  await page.goto('/'); const image = await png(page); const calls: { url: string; body: any }[] = [];
  await context.route('https://generativelanguage.googleapis.com/**', async route => {
    const request = route.request(); calls.push({ url: request.url(), body: request.postDataJSON() });
    const raw = request.url().endsWith(':cancel') ? {} : { name: 'batches/mock-job', metadata: { state: 'BATCH_STATE_PENDING' } };
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(raw) });
  });
  await connect(page); await page.getByRole('button', { name: 'Batch生成', exact: true }).click();
  await page.getByLabel('Batch生成の指示', { exact: true }).fill('test one\ntest two'); await page.getByRole('button', { name: 'Batchを開始', exact: true }).click();
  await expect(page.getByLabel('Batch ID', { exact: true })).toHaveValue('batches/mock-job');
  expect(calls[0].url).toContain('/v1beta/models/gemini-nano-banana-2.1:batchGenerateContent');
  expect(calls[0].body.batch.inputConfig.requests.requests).toHaveLength(2);
  expect(calls[0].body.batch.inputConfig.requests.requests[0].request.tools).toBeUndefined();
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(KEY);
  await page.reload(); await connect(page); await page.getByRole('button', { name: 'Batch生成', exact: true }).click();
  await expect(page.getByLabel('Batch ID', { exact: true })).toHaveValue('batches/mock-job');
  await page.getByRole('button', { name: '中止', exact: true }).click();
  await expect.poll(() => calls.some(c => c.url.endsWith('/v1beta/batches/mock-job:cancel'))).toBe(true);
  await expect.poll(() => calls.some(c => c.url.endsWith('/v1beta/batches/mock-job') && c.body === null)).toBe(true);
  await context.unroute('https://generativelanguage.googleapis.com/**');
  await context.route('https://generativelanguage.googleapis.com/**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ name: 'batches/mock-job', done: true, response: { inlinedResponses: { inlinedResponses: [{ response: { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: image } }] } }] } }, {response: {candidates: [{finishReason: 'NO_IMAGE', content: {parts: [{text: 'No image'}]}}]}}] } } }) }));
  await page.getByRole('button', { name: '更新', exact: true }).click();
  await expect(page.getByRole('button', { name: '中止', exact: true })).toBeDisabled(); await expect(page.getByAltText('Batch結果 1')).toBeVisible();
  await expect(page.locator('.batch-result')).toContainText('1枚 · エラー 1');
});

test('PSD export and import preserve layers, blend modes, and canvas pixels', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('tab', { name: 'レイヤー', exact: true })).toBeVisible({ timeout: 7000 });
  const white = await png(page, '#ffffff');
  const halfRed = await png(page, '#ff8080');
  const project = {
    version: 1,
    name: 'PSD Blend Test',
    width: 64,
    height: 64,
    layers: [
      { id: 'l1', name: 'Base White', visible: true, opacity: 1, dataUrl: `data:image/png;base64,${white}` },
      { id: 'l2', name: 'Top Multiply', visible: true, opacity: 1, dataUrl: `data:image/png;base64,${halfRed}` },
    ],
  };
  await page.locator('input[accept=".json,application/json"]').setInputFiles({ name: 'blend.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) });
  await expect(page.getByText('プロジェクトを読み込みました', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'レイヤー', exact: true }).click();
  await page.locator('.layer-row').filter({ hasText: 'Top Multiply' }).click();
  await page.getByLabel('描画モード', { exact: true }).selectOption('multiply');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'PSD', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('PSD Blend Test.psd');
  const psdPath = await download.path();
  expect(psdPath).toBeTruthy();

  // Switch to a blank 1-layer project, then re-import the exported PSD
  await page.locator('input[accept=".json,application/json"]').setInputFiles({
    name: 'reset.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ version: 1, name: 'Reset', width: 64, height: 64, layers: [{ id: 'r', name: 'Reset', visible: true, opacity: 1, dataUrl: `data:image/png;base64,${white}` }] })),
  });
  await page.locator('input[accept=".psd,image/vnd.adobe.photoshop,application/x-photoshop"]').setInputFiles(psdPath!);
  await expect(page.getByText('PSDファイルを読み込みました', { exact: true })).toBeVisible();
  await expect(page.getByLabel('描画モード', { exact: true })).toHaveValue('multiply');
  const pixel = await page.getByLabel('編集中の画像', { exact: true }).evaluate((c: HTMLCanvasElement) => Array.from(c.getContext('2d')!.getImageData(10, 10, 1, 1).data));
  expect(pixel).toEqual([255, 128, 128, 255]);
});

test('Google Files API uploads media, refreshes state, sends fileData, and deletes remote file', async ({ page, context }) => {
  await page.goto('/');
  await expect(page.getByRole('tab', { name: 'レイヤー', exact: true })).toBeVisible({ timeout: 7000 });
  const image = await png(page);
  const calls: { method: string; url: string; body: string | null }[] = [];
  let getCount = 0;
  await context.route('https://generativelanguage.googleapis.com/**', async route => {
    const req = route.request();
    calls.push({ method: req.method(), url: req.url(), body: req.postData() });
    if (req.url().includes('/upload/v1beta/files')) {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ file: { name: 'files/clip123', uri: 'https://generativelanguage.googleapis.com/v1beta/files/clip123', mimeType: 'video/mp4', state: 'PROCESSING', sizeBytes: '4096' } }) });
    } else if (req.url().endsWith('/v1beta/files/clip123') && req.method() === 'GET') {
      getCount += 1;
      const state = getCount >= 4 ? 'ACTIVE' : 'PROCESSING';
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ file: { name: 'files/clip123', uri: 'https://generativelanguage.googleapis.com/v1beta/files/clip123', mimeType: 'video/mp4', state, sizeBytes: '4096' } }) });
    } else if (req.url().endsWith('/v1beta/files/clip123') && req.method() === 'DELETE') {
      await route.fulfill({ contentType: 'application/json', body: '{}' });
    } else {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: image } }] } }] }) });
    }
  });
  await connect(page);
  await page.locator('input[type="file"]').nth(5).setInputFiles({ name: 'demo.mp4', mimeType: 'video/mp4', buffer: Buffer.from('fake-video-bytes') });
  await expect(page.getByText('1件をFiles APIへアップロードしました', { exact: true })).toBeVisible();
  await expect(page.locator('.file-api-badge')).toContainText('処理中');
  await page.getByRole('button', { name: '参照1の状態を更新', exact: true }).click();
  await expect(page.locator('.file-api-badge')).toContainText('Files API');
  await page.getByRole('tab', { name: '新規生成', exact: true }).click();
  await page.getByLabel('プロンプト').fill('summarize video');
  await page.getByRole('button', { name: '画像を生成', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '生成結果の確認' })).toBeVisible();
  const genCall = calls.find(c => c.url.includes(':generateContent'));
  expect(genCall).toBeTruthy();
  expect(genCall!.url).toContain('/v1beta/models/');
  expect(JSON.parse(genCall!.body!).contents[0].parts[1]).toEqual({ fileData: { mimeType: 'video/mp4', fileUri: 'https://generativelanguage.googleapis.com/v1beta/files/clip123' } });
  await page.getByRole('button', { name: '破棄' }).click();
  await page.getByRole('button', { name: '参照1を削除', exact: true }).click();
  await expect.poll(() => calls.some(c => c.method === 'DELETE' && c.url.endsWith('/v1beta/files/clip123'))).toBe(true);
});

test('Batch supports canvas mask editing, search grounding, and pixel-preserving adoption', async ({ page, context }) => {
  await page.goto('/');
  await expect(page.getByRole('tab', { name: 'レイヤー', exact: true })).toBeVisible({ timeout: 7000 });
  const blue = await png(page, 'blue');
  const green = await png(page, 'lime');
  const project = { version: 1, name: 'Batch Mask', width: 64, height: 64, layers: [{ id: 'base', name: 'Original', visible: true, opacity: 1, dataUrl: `data:image/png;base64,${blue}` }] };
  await page.locator('input[accept=".json,application/json"]').setInputFiles({ name: 'batch-mask.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) });
  await expect.poll(() => page.getByLabel('編集中の画像', { exact: true }).evaluate((c: HTMLCanvasElement) => c.width)).toBe(64);
  await page.getByRole('button', { name: '矩形選択', exact: true }).click();
  const box = (await page.getByLabel('編集キャンバス', { exact: true }).boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.25); await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.65, box.y + box.height * 0.65); await page.mouse.up();
  await page.getByRole('checkbox', { name: 'Web検索' }).check();

  let batchReqBody: any = null;
  await context.route('https://generativelanguage.googleapis.com/**', async route => {
    const req = route.request();
    if (req.url().includes(':batchGenerateContent')) batchReqBody = req.postDataJSON();
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        name: 'batches/mask-batch',
        done: true,
        response: {
          inlinedResponses: {
            inlinedResponses: [{
              response: {
                candidates: [{
                  content: { parts: [{ inlineData: { mimeType: 'image/png', data: green } }] },
                  groundingMetadata: { groundingChunks: [{ web: { uri: 'https://example.com/batch-ref', title: 'Batch Citation' } }] },
                }],
              },
            }],
          },
        },
      }),
    });
  });

  await connect(page);
  await page.getByRole('button', { name: 'Batch生成', exact: true }).click();
  await page.getByRole('checkbox', { name: /Batchでキャンバスの画像を編集/ }).check();
  await page.getByLabel('Batch生成の指示', { exact: true }).fill('make center green');
  await page.getByRole('button', { name: 'Batchを開始', exact: true }).click();
  await expect(page.getByAltText('Batch結果 1')).toBeVisible();
  expect(batchReqBody.batch.inputConfig.requests.requests[0].request.tools).toEqual([{ google_search: { searchTypes: { webSearch: {} } } }]);
  expect(batchReqBody.batch.inputConfig.requests.requests[0].request.contents[0].parts.filter((p: any) => p.inlineData)).toHaveLength(2);
  await expect(page.getByRole('link', { name: 'Batch Citation', exact: true })).toHaveAttribute('href', 'https://example.com/batch-ref');
  await page.getByAltText('Batch結果 1').click();
  await expect.poll(() => page.getByLabel('編集中の画像', { exact: true }).evaluate((c: HTMLCanvasElement) => Array.from(c.getContext('2d')!.getImageData(30, 30, 1, 1).data))).toEqual([0, 255, 0, 255]);
  const cornerPixel = await page.getByLabel('編集中の画像', { exact: true }).evaluate((c: HTMLCanvasElement) => Array.from(c.getContext('2d')!.getImageData(2, 2, 1, 1).data));
  expect(cornerPixel).toEqual([0, 0, 255, 255]);
});
