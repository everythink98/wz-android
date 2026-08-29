import assert from 'node:assert/strict';
import fs from 'node:fs';
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

test('keeps visual scenarios deterministic and free of credentials or direct I/O', () => {
  const scenarioRoot = path.join(projectRoot, 'tests', 'ui', 'visual', 'scenarios');
  const manifests = sourceFiles(scenarioRoot).filter((file) => path.basename(file) === 'manifest.tsx');
  assert.ok(manifests.length > 0);
  for (const file of manifests) {
    const source = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /\b(?:fetch|XMLHttpRequest|WebSocket)\s*\(/);
    assert.doesNotMatch(source, /\b(?:Linking\.openURL|WebBrowser\.openBrowserAsync)\s*\(/);
    assert.doesNotMatch(source, /import[^;\n]*\bSavedCredential\b|\b(?:password|token)\s*:/i);
    for (const match of source.matchAll(/https?:\/\/[^'"\s<]+/g)) {
      assert.match(new URL(match[0]).hostname, /\.invalid$/);
    }
  }
});

test('classifies every App capability in the visual manifests', () => {
  const productMap = read('docs/product-map.md');
  const expected = Array.from(productMap.matchAll(/`([A-Z]+-\d{2})`/g), (match) => match[1])
    .filter((id) => !id.startsWith('RELEASE-'))
    .filter((id, index, ids) => ids.indexOf(id) === index)
    .sort();
  const scenarioRoot = path.join(projectRoot, 'tests', 'ui', 'visual', 'scenarios');
  const manifests = sourceFiles(scenarioRoot).filter((file) => path.basename(file) === 'manifest.tsx');
  const actual = Array.from(
    new Set(manifests.flatMap((file) => fs.readFileSync(file, 'utf8').match(/\b[A-Z]+-\d{2}\b/g) || []))
  ).sort();

  assert.equal(expected.length, 42);
  assert.deepEqual(actual, expected);
});
