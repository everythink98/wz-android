import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const projectRoot = path.resolve(import.meta.dirname, '..', '..');

function read(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');
}

function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(target);
    return /\.[cm]?[jt]sx?$/.test(entry.name) ? [target] : [];
  });
}

test('keeps the visual gallery outside the production import graph', () => {
  const productionFiles = [
    path.join(projectRoot, 'App.tsx'),
    path.join(projectRoot, 'index.ts'),
    ...sourceFiles(path.join(projectRoot, 'src'))
  ];
  for (const file of productionFiles) {
    const source = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /dev\/visual-gallery|tests\/ui\/visual/);
  }
  assert.match(read('dev/visual-gallery/index.ts'), /registerRootComponent\(VisualGalleryApp\)/);
  assert.equal(JSON.parse(read('package.json')).scripts['visual:gallery'], 'node scripts/start-visual-gallery.mjs');
});

function assertVisualSources(scenarioRoot) {
  const sources = sourceFiles(scenarioRoot).filter((file) => !/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file));
  assert.ok(sources.length > 0);
  for (const file of sources) {
    const source = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /\b(?:fetch|XMLHttpRequest|WebSocket)\s*\(/);
    assert.doesNotMatch(source, /\b(?:Linking\.openURL|WebBrowser\.openBrowserAsync)\s*\(/);
    assert.doesNotMatch(source, /import[^;\n]*\bSavedCredential\b|\b(?:password|token)\s*:/i);
    for (const match of source.matchAll(/https?:\/\/[^'"\s<]+/g)) {
      assert.match(new URL(match[0]).hostname, /\.invalid$/);
    }
  }
}

test('keeps visual scenarios deterministic and free of credentials or direct I/O', () => {
  assertVisualSources(path.join(projectRoot, 'tests', 'ui', 'visual'));
});

test('rejects direct I/O hidden in a visual helper', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wz-visual-guard-'));
  try {
    fs.writeFileSync(path.join(directory, 'manifest.tsx'), 'export const scenario = {};');
    fs.writeFileSync(
      path.join(directory, 'helper.ts'),
      "export const load = () => fetch('https://visual.invalid/data');"
    );
    assert.throws(() => assertVisualSources(directory), /fetch/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
