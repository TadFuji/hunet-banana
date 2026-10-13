import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

// All screenshots use an isolated profile, a clearly fake key, and local mocked
// API responses. Never connect to Google or inspect the user's browser profile.
const root = path.resolve(import.meta.dirname, 'images');
await mkdir(root, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 1080 }, deviceScaleFactor: 1.5 });
let responseImage = '';
await context.route('https://generativelanguage.googleapis.com/**', route => route.fulfill({
  contentType: 'application/json', body: JSON.stringify({ candidates: [{ content: { parts: [
    { inlineData: { mimeType: 'image/png', data: responseImage }, thoughtSignature: 'MANUAL_DEMO_ONLY' },
    { text: '操作説明用のサンプル画像です。Google APIによる生成結果ではありません。' },
  ] } }] }),
}));
const page = await context.newPage();
await page.goto('http://127.0.0.1:4173/');
await page.getByLabel('編集中の画像', { exact: true }).waitFor();
await page.waitForFunction(() => document.querySelector('.image-canvas')?.width === 1280);
const metadata = {};
const targets = { key: '.key-pill', toolbar: '.tool-rail', prompt: '.prompt-section', settings: '.settings-section', right: '.right-panel', canvas: '.canvas-stage', history: '.bottom-strip', actions: '.top-actions', zoom: '.canvas-toolbar-right' };
async function shot(name, selector = null) {
  await page.mouse.move(1580, 1060);
  await page.evaluate(() => document.fonts.ready);
  // UI handlers commit synchronously; allow decoding and rendering to finish.
  await page.waitForTimeout(180);
  if (selector) await page.locator(selector).screenshot({ path: path.join(root, name + '.png') });
  else await page.screenshot({ path: path.join(root, name + '.png') });
  metadata[name] = {};
  for (const [key, sel] of Object.entries(targets)) {
    const loc = page.locator(sel).first();
    if (await loc.count()) metadata[name][key] = await loc.boundingBox();
  }
}
await shot('overview');
await shot('tool-rail', '.tool-rail');
await shot('top-actions', '.top-actions');
await page.getByRole('button', { name: 'APIキーを設定', exact: true }).click();
await shot('key-dialog', '.key-modal');
await page.getByLabel('Gemini APIキー', { exact: true }).fill('MANUAL_DEMO_NOT_A_REAL_API_KEY_2026');
await page.getByRole('button', { name: 'このタブに設定する', exact: true }).click();
await page.getByRole('button', { name: 'キー接続中', exact: true }).click();
await shot('key-connected', '.key-modal');
await page.getByRole('button', { name: '閉じる', exact: true }).click();
await page.getByRole('tab', { name: '新規生成', exact: true }).click();
await page.getByLabel('プロンプト', { exact: true }).fill('クリーム色の香水ボトルの商品写真。背景は深い緑。柔らかな自然光、余白を多く、文字やロゴは入れない。');
await page.getByLabel('解像度', { exact: true }).selectOption('1K');
await page.getByLabel('アスペクト比', { exact: true }).selectOption('4:3');
await page.getByLabel('思考レベル', { exact: true }).selectOption('minimal');
await shot('generate-panel', '.right-panel');
responseImage = await page.getByLabel('編集中の画像', { exact: true }).evaluate(c => c.toDataURL('image/png').split(',')[1]);
await page.getByRole('button', { name: '画像を生成', exact: true }).click();
await page.getByRole('dialog', { name: '生成結果の確認', exact: true }).waitFor();
await shot('candidate', '.candidate-modal');
await page.getByRole('button', { name: '破棄', exact: true }).click();
await page.getByRole('tab', { name: '全体編集', exact: true }).click();
await page.getByLabel('プロンプト', { exact: true }).fill('背景を明るいベージュのスタジオに変更。ボトルの形と位置、ラベルの文字はできるだけ保ってください。');
await shot('whole-edit', '.right-panel');
await page.getByRole('button', { name: '矩形選択', exact: true }).click();
const canvasBox = await page.getByLabel('編集キャンバス', { exact: true }).boundingBox();
await page.mouse.move(canvasBox.x + canvasBox.width * .34, canvasBox.y + canvasBox.height * .36);
await page.mouse.down();
await page.mouse.move(canvasBox.x + canvasBox.width * .65, canvasBox.y + canvasBox.height * .62, { steps: 12 });
await page.mouse.up();
await page.getByLabel('プロンプト', { exact: true }).fill('選択したラベルだけを白い無地のラベルに変更。ボトルの形と背景は保ってください。');
await shot('mask');
await shot('mask-canvas', '.canvas-stage');
await shot('mask-panel', '.right-panel');
// A local drawing serves only as an illustration of the compositing workflow.
responseImage = await page.getByLabel('編集中の画像', { exact: true }).evaluate(c => {
  const d = document.createElement('canvas'); d.width = 1280; d.height = 854;
  const x = d.getContext('2d'); x.drawImage(c, 0, 27);
  x.save(); x.translate(650, 427); x.rotate(-.19); x.fillStyle = '#f2efe6'; x.fillRect(-161, -49, 322, 148); x.restore();
  return d.toDataURL('image/png').split(',')[1];
});
await page.getByRole('button', { name: '画像を生成', exact: true }).click();
await page.getByRole('button', { name: 'キャンバスに採用', exact: true }).click();
await page.getByRole('dialog', { name: '生成結果の確認' }).waitFor({ state: 'hidden' });
await shot('mask-result', '.canvas-stage');
await page.getByRole('button', { name: '元に戻す', exact: true }).click();
await page.locator('details').filter({ has: page.locator('summary', { hasText: '選択範囲' }) }).locator('summary').click();
await page.getByRole('button', { name: '選択を解除', exact: true }).click();
await page.locator('summary', { hasText: '選択範囲' }).click();
await page.getByRole('button', { name: 'スケッチ', exact: true }).click();
await page.getByLabel('ブラシサイズ', { exact: true }).fill('10');
const sb = await page.getByLabel('編集キャンバス', { exact: true }).boundingBox();
const points = [[.12,.73],[.14,.57],[.23,.54],[.25,.74],[.12,.73]];
await page.mouse.move(sb.x+sb.width*points[0][0],sb.y+sb.height*points[0][1]); await page.mouse.down();
for (const [x,y] of points.slice(1)) await page.mouse.move(sb.x+sb.width*x,sb.y+sb.height*y,{steps:12});
await page.mouse.up();
await page.getByLabel('プロンプト', { exact: true }).fill('手描きの線の位置に、小さな観葉植物を置いてください。オレンジ色の線は完成画像に残さないでください。');
await shot('sketch');
await shot('sketch-canvas', '.canvas-stage');
await page.getByRole('button', { name: '文字', exact: true }).click();
page.once('dialog', dialog => dialog.accept('NEW COLLECTION'));
await page.mouse.click(sb.x+sb.width*.08,sb.y+sb.height*.12);
await page.getByRole('tab', { name: 'レイヤー', exact: true }).click();
await page.locator('.layer-row').filter({ hasText: '文字' }).click();
await shot('layers', '.right-panel');
await shot('layers-full');
await page.getByRole('tab', { name: '履歴', exact: true }).click();
await shot('history', '.right-panel');
await page.getByRole('tab', { name: 'AI生成', exact: true }).click();
await page.getByRole('tab', { name: '新規生成', exact: true }).click();
await page.getByLabel('解像度', { exact: true }).selectOption('2K');
await page.getByLabel('アスペクト比', { exact: true }).selectOption('16:9');
const refData = await page.getByLabel('編集中の画像', { exact: true }).evaluate(c=>c.toDataURL('image/png').split(',')[1]);
await page.locator('input[multiple]').setInputFiles({name:'参考パッケージ.png',mimeType:'image/png',buffer:Buffer.from(refData,'base64')});
await shot('references', '.right-panel');
await page.locator('summary', {hasText:'ファイル'}).click();
await shot('file-menu', 'details[open] .menu-pop');
await page.locator('summary', {hasText:'ファイル'}).click();
await page.getByRole('button', { name: 'Batch生成', exact: true }).click();
await page.getByLabel('Batch生成の指示', { exact: true }).fill('淡い緑の森を背景にした商品写真\n白いスタジオを背景にした商品写真\n夕暮れのテラスを背景にした商品写真');
await page.locator('.batch-section').scrollIntoViewIfNeeded();
await shot('batch', '.batch-section');
await page.getByRole('button', { name: 'キー接続中', exact: true }).click();
await page.getByRole('button', { name: 'キーを破棄して切断', exact: true }).click();
await writeFile(path.join(root,'bounds.json'), JSON.stringify(metadata,null,2));
await browser.close();
console.log('Captured ' + Object.keys(metadata).length + ' manual screenshots; all Google requests were mocked.');
