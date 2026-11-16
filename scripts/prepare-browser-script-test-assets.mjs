import { buildSync } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { runInNewContext } from 'node:vm';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const entry = 'src/features/account/useHiddenBrowserFetchController.ts';
const { values } = parseArgs({ options: { output: { type: 'string' } } });
if (!values.output) throw new Error('Use --output <new directory under .codex-tmp>');
const output = path.resolve(root, values.output);
const scratch = path.join(root, '.codex-tmp');
const inside = (parent, child) => {
  const relative = path.relative(parent, child);
  return relative !== '' && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
};
if (!inside(scratch, output) || existsSync(output)) throw new Error('Output must be a new .codex-tmp directory');
let ancestor = path.dirname(output);
while (!existsSync(ancestor)) ancestor = path.dirname(ancestor);
const realScratch = existsSync(scratch) ? realpathSync(scratch) : path.join(realpathSync(root), '.codex-tmp');
const realOutput = path.resolve(realpathSync(ancestor), path.relative(ancestor, output));
if (!inside(realScratch, realOutput)) throw new Error('Output resolves outside .codex-tmp');
execFileSync('git', ['check-ignore', '--quiet', '--', output], { cwd: root, stdio: 'pipe', windowsHide: true });

const bundle = buildSync({
  absWorkingDir: root,
  stdin: {
    contents: "export { NODESEEK_BROWSER_FETCH_SCRIPT } from './" + entry + "';",
    resolveDir: root,
    sourcefile: 'browser-script-test-export.mjs'
  },
  bundle: true,
  treeShaking: true,
  minify: false,
  write: false,
  metafile: true,
  platform: 'node',
  format: 'cjs',
  alias: { '@': path.join(root, 'src') },
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'silent'
});
// Evaluate the real export, including its imported template interpolation.
const evaluated = { exports: {} };
runInNewContext(
  bundle.outputFiles[0].text,
  {
    module: evaluated,
    exports: evaluated.exports,
    require: createRequire(path.join(root, 'package.json')),
    process,
    Buffer,
    URL,
    URLSearchParams
  },
  { timeout: 5000, filename: 'browser-script-test-export.cjs' }
);
const script = evaluated.exports.NODESEEK_BROWSER_FETCH_SCRIPT;
if (
  typeof script !== 'string' ||
  !script.includes('__NODESEEK_BROWSER_FETCH_ID__') ||
  !script.includes('__NODESEEK_BROWSER_FETCH_OWNER__')
) {
  throw new Error('Production browser-script export is incomplete');
}
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const inputs = Object.keys(bundle.metafile.inputs)
  .filter((file) => !file.endsWith('browser-script-test-export.mjs'))
  .sort()
  .map((file) => ({ file: file.replaceAll('\\', '/'), sha256: sha256(readFileSync(path.resolve(root, file))) }));
if (!inputs.some((input) => input.file === entry)) throw new Error('Production entry absent from bundle inputs');
const scriptSha256 = sha256(script);
const manifest =
  JSON.stringify(
    {
      schemaVersion: 1,
      mode: 'strong-challenge-v1',
      sourceEntry: entry,
      sourceSha256: sha256(readFileSync(path.join(root, entry))),
      scriptFile: 'nodeseek-browser-script/production-script.js',
      scriptSha256,
      inputs,
      deviceEvidence: 'NOT_VERIFIED'
    },
    null,
    2
  ) + '\n';
mkdirSync(path.dirname(output), { recursive: true });
mkdirSync(output);
const assetsDirectory = path.join(output, 'assets');
const assetDirectory = path.join(assetsDirectory, 'nodeseek-browser-script');
mkdirSync(assetDirectory, { recursive: true });
writeFileSync(path.join(assetDirectory, 'production-script.js'), script, 'utf8');
writeFileSync(path.join(assetDirectory, 'manifest.json'), manifest, 'utf8');
console.log(
  JSON.stringify({
    status: 'PREPARED_NOT_DEVICE_VERIFIED',
    assetsDirectory,
    scriptSha256,
    manifestSha256: sha256(manifest),
    inputCount: inputs.length
  })
);
