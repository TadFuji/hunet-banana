import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { checkLinks } from './check-docs.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = fileURLToPath(new URL('../README.md', import.meta.url));

describe('documentation file links', () => {
  it('accepts local files, fragments and encoded Japanese file names', () => {
    expect(checkLinks('[security](docs/security.md#boundary)\n![screen](docs/screenshots/editor-desktop.png)\n[pdf](output/pdf/Banana_Studio_%E5%9B%B3%E8%A7%A3%E5%8F%96%E6%89%B1%E8%AA%AC%E6%98%8E%E6%9B%B8.pdf)', source, root)).toEqual([]);
  });
  it('rejects missing files, malformed paths and links outside the repository', () => {
    expect(checkLinks('[missing](docs/not-a-document.md)\n[bad](%ZZ.md)\n[outside](../private.md)', source, root)).toHaveLength(3);
  });
  it('does not access web links or interpret same-document fragments as files', () => {
    expect(checkLinks('[web](https://example.invalid/)\n[mail](mailto:example@example.invalid)\n[section](#section)', source, root)).toEqual([]);
  });
});
