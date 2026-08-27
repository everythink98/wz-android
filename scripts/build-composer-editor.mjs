import { build } from 'esbuild';
import { gzipSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = path.join(root, 'src', 'ui', 'composer', 'generated');
const result = await build({
  absWorkingDir: root,
  entryPoints: ['src/ui/composer/editorRuntime.tsx'],
  outfile: 'editor.js',
  bundle: true,
  minify: true,
  write: false,
  platform: 'browser',
  format: 'iife',
  target: ['chrome110'],
  jsx: 'automatic',
  alias: { '@': path.join(root, 'src') },
  define: { 'process.env.NODE_ENV': '"production"' },
  legalComments: 'none'
});

const javascript = result.outputFiles.find((file) => file.path.endsWith('editor.js'))?.text;
const stylesheet = result.outputFiles.find((file) => file.path.endsWith('editor.css'))?.text;
if (!javascript || !stylesheet) throw new Error('Composer editor bundle output is incomplete');

const nonce = 'wz-composer-runtime';
const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; img-src https: data: blob:; connect-src 'none'; media-src 'none'; font-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
<style nonce="${nonce}">${stylesheet.replaceAll('</style', '<\\/style')}</style>
</head>
<body><div id="root"></div><script nonce="${nonce}">${javascript.replaceAll('</script', '<\\/script')}</script></body>
</html>`;
const compressedBytes = gzipSync(html).byteLength;
if (compressedBytes > 1.5 * 1024 * 1024) {
  throw new Error(`Composer editor bundle exceeds 1.5MiB compressed: ${compressedBytes} bytes`);
}
mkdirSync(outputDirectory, { recursive: true });
writeFileSync(
  path.join(outputDirectory, 'editorDocument.json'),
  `${JSON.stringify({ html, compressedBytes })}\n`,
  'utf8'
);
console.log(`Composer editor: ${compressedBytes} compressed bytes`);
