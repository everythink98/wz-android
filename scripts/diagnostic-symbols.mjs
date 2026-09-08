import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const hash = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

export function archiveDiagnosticSymbols({ rootDir, androidDir, apkPaths, gitSha, requireMapping = true }) {
  const { buildId } = JSON.parse(readFileSync(path.join(androidDir, 'diagnostic-build.json'), 'utf8'));
  if (!/^[a-f0-9]{32}$/.test(buildId)) throw new Error('Invalid diagnostic build identity.');
  const sourceMap = path.join(androidDir, 'app/build/generated/sourcemaps/react/release/index.android.bundle.map');
  const mapping = path.join(androidDir, 'app/build/outputs/mapping/release/mapping.txt');
  if (!existsSync(sourceMap) || (requireMapping && !existsSync(mapping))) {
    throw new Error('Matching release symbols are missing.');
  }
  const directory = path.join(rootDir, 'diagnostic-symbols', buildId);
  const manifest = {
    buildId,
    gitSha,
    sourceMapSha256: hash(sourceMap),
    mappingSha256: existsSync(mapping) ? hash(mapping) : null,
    apks: apkPaths.map((file) => ({ name: path.basename(file), sha256: hash(file) }))
  };
  const manifestFile = path.join(directory, 'manifest.json');
  if (existsSync(manifestFile) && readFileSync(manifestFile, 'utf8') !== `${JSON.stringify(manifest, null, 2)}\n`) {
    throw new Error('Diagnostic build identity already has different artifacts.');
  }
  mkdirSync(directory, { recursive: true });
  copyFileSync(sourceMap, path.join(directory, 'index.android.bundle.map'));
  if (existsSync(mapping)) copyFileSync(mapping, path.join(directory, 'mapping.txt'));
  writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  return { buildId, directory };
}

export function symbolicateDiagnosticEvent(event, directory) {
  const manifest = JSON.parse(readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
  if (!event.buildId || event.buildId !== manifest.buildId)
    throw new Error('Diagnostic build identity does not match symbols.');
  const sourceMap = path.join(directory, 'index.android.bundle.map');
  if (hash(sourceMap) !== manifest.sourceMapSha256) throw new Error('Diagnostic source map checksum mismatch.');
  if (typeof event.stack !== 'string') throw new Error('Diagnostic event has no stack.');
  const { SourceMapConsumer } = require('source-map');
  const consumer = new SourceMapConsumer(JSON.parse(readFileSync(sourceMap, 'utf8')));
  try {
    return event.stack
      .split('\n')
      .map((frame) => {
        const match = /\((address at )?\[bundle\]:(\d+):(\d+)\)/.exec(frame);
        if (!match) return frame;
        // RN listener coordinates are already parsed; Hermes bytecode offsets are zero-based.
        const column = Number(match[3]) - (event.stackFormat === 'rn-parsed' || match[1] ? 0 : 1);
        const original = consumer.originalPositionFor({ line: Number(match[2]), column: Math.max(0, column) });
        return original.source
          ? `    at ${original.name || '[frame]'} (${original.source}:${original.line}:${original.column})`
          : frame;
      })
      .join('\n');
  } finally {
    consumer.destroy?.();
  }
}

function retraceClasspath(explicitJar) {
  if (explicitJar) {
    if (!existsSync(explicitJar)) throw new Error('Specified R8 Retrace jar does not exist.');
    return path.resolve(explicitJar);
  }
  const candidates = [];
  const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  const tools = sdk && path.join(sdk, 'cmdline-tools');
  if (tools && existsSync(tools)) {
    for (const version of readdirSync(tools).sort((left, right) =>
      left === 'latest' ? -1 : right === 'latest' ? 1 : right.localeCompare(left, undefined, { numeric: true })
    )) {
      candidates.push(path.join(tools, version, 'lib', 'retrace-classpath.jar'));
    }
  }
  for (const bin of (process.env.PATH || '').split(path.delimiter)) {
    candidates.push(path.resolve(bin, '..', 'lib', 'retrace-classpath.jar'));
  }
  const jar = candidates.find((candidate) => existsSync(candidate));
  if (!jar) throw new Error('Android SDK Retrace is unavailable; set ANDROID_HOME or pass --retrace-jar <R8 jar>.');
  return jar;
}

export function retraceNativeDiagnosticEvent(event, directory, options = {}) {
  const manifest = JSON.parse(readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
  if (!event.buildId || event.buildId !== manifest.buildId)
    throw new Error('Diagnostic build identity does not match symbols.');
  const mapping = path.join(directory, 'mapping.txt');
  if (!manifest.mappingSha256 || !existsSync(mapping)) throw new Error('Matching R8 mapping is missing.');
  if (hash(mapping) !== manifest.mappingSha256) throw new Error('Diagnostic R8 mapping checksum mismatch.');
  if (typeof event.stack !== 'string') throw new Error('Diagnostic event has no stack.');
  const java = process.env.JAVA_HOME
    ? path.join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java')
    : 'java';
  // Invoke the SDK's official tool directly, avoiding shell parsing of mapping paths or stack input.
  const result = spawnSync(
    java,
    ['-cp', retraceClasspath(options.retraceJar), 'com.android.tools.r8.retrace.Retrace', '--quiet', mapping],
    {
      input: `${event.stack}\n`,
      encoding: 'utf8',
      timeout: 30000,
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true
    }
  );
  if (result.error) throw new Error('R8 Retrace could not run; check Java 17+ and the Android SDK installation.');
  if (result.status !== 0) throw new Error(`R8 Retrace failed with exit status ${result.status}.`);
  return result.stdout.trimEnd();
}
