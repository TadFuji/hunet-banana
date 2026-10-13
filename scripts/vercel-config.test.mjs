import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { vercelConfig } from '../vercel-config.mjs';
import { securityHeaders } from '../security-headers.mjs';

describe('Vercel security routes', () => {
  it('applies exactly one correct CSP to document, assets and Worker paths', () => {
    const routes = vercelConfig().routes.filter(route => route.headers);
    for (const [path, worker] of [
      ['/', false], ['/index.html', false], ['/guide.pdf', false],
      ['/assets/index-hash.js', false], ['/assets/security.worker-hash.js', true],
      ['/assets/security.worker-hash.js/extra', false], ['/security.worker-hash.js', false],
    ]) {
      const matches = routes.filter(route => new RegExp(`^${route.src}$`).test(path));
      expect(matches).toHaveLength(1);
      expect(matches[0].headers).toMatchObject(securityHeaders(worker));
    }
  });
  it('keeps the committed configuration synchronized and exposes no API proxy', () => {
    expect(JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'))).toEqual(vercelConfig());
    expect(vercelConfig().routes.find(route => route.methods).status).toBe(405);
    expect(vercelConfig().routes.at(-1).status).toBe(404);
    expect(vercelConfig(true)).toMatchObject({ framework: null, buildCommand: '', installCommand: '', outputDirectory: '.' });
  });
});
