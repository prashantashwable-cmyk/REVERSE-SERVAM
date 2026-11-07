// Bundles the demo into docs/demo/ (served by GitHub Pages from /docs).
import { build } from 'esbuild';
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', '..', 'docs', 'demo');
mkdirSync(out, { recursive: true });
await build({
  entryPoints: [join(here, 'src', 'main.tsx')],
  bundle: true,
  minify: true,
  format: 'esm',
  target: 'es2020',
  outfile: join(out, 'app.js'),
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  legalComments: 'none',
});
copyFileSync(join(here, 'src', 'index.html'), join(out, 'index.html'));
copyFileSync(join(here, 'src', 'styles.css'), join(out, 'styles.css'));
console.log('demo built ->', out);
