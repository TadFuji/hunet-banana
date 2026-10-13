import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const excluded = new Set(['.git', 'node_modules', 'dist', 'tmp', 'test-results', 'playwright-report']);

// Check inline Markdown file links. Web URLs and same-document fragments are
// deliberately excluded: this check is deterministic and never contacts a site.
export function checkLinks(markdown, sourceFile, repositoryRoot = root) {
  const problems = [];
  const links = /!?\[[^\]\n]*\]\((<[^>\n]+>|[^\s)]+)(?:\s+["'][^)]*["'])?\)/g;
  for (const match of markdown.matchAll(links)) {
    const href = match[1].replace(/^<|>$/g, '');
    if (/^[a-z][a-z\d+.-]*:/i.test(href) || href.startsWith('#')) continue;
    let target;
    try {
      target = resolve(dirname(sourceFile), decodeURIComponent(href.split(/[?#]/)[0]));
    } catch {
      problems.push(`Invalid encoded path: ${href}`);
      continue;
    }
    const fromRoot = relative(repositoryRoot, target);
    if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`)) {
      problems.push(`Link leaves the repository: ${href}`);
    } else if (!existsSync(target)) {
      problems.push(`Missing file: ${href}`);
    }
  }
  return problems;
}

function markdownFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return excluded.has(entry.name) ? [] : markdownFiles(path);
    return entry.isFile() && entry.name.endsWith('.md') ? [path] : [];
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const files = markdownFiles(root);
  const problems = files.flatMap(file => checkLinks(readFileSync(file, 'utf8'), file)
    .map(problem => `${relative(root, file)}: ${problem}`));
  if (problems.length) {
    console.error(problems.join('\n'));
    process.exitCode = 1;
  } else {
    console.log(`Checked local file links in ${files.length} Markdown documents (no network requests).`);
  }
}
