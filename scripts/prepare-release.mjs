import { copyFile, writeFile } from 'node:fs/promises';
import { vercelConfig } from '../vercel-config.mjs';

const root = new URL('../', import.meta.url);
await writeFile(new URL('vercel.json', root), JSON.stringify(vercelConfig(), null, 2) + '\n');
await writeFile(new URL('dist/vercel.json', root), JSON.stringify(vercelConfig(true), null, 2) + '\n');
await copyFile(new URL('output/pdf/Banana_Studio_図解取扱説明書.pdf', root), new URL('dist/guide.pdf', root));
console.log('Prepared static release with document/Worker security headers and illustrated guide.');
