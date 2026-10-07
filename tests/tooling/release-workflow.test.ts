import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { RELEASE_REQUIRED_TRACKED_INPUTS, RELEASE_SIGNING_ENV_NAMES } from '../../scripts/release-environment.mjs';

const root = path.resolve(__dirname, '../..');
const signer = 'a'.repeat(64);
const revision = 'b'.repeat(40);
const packageText = '{"name":"release-fixture","scripts":{}}\n';
const apkBytes = Buffer.from('synthetic release APK');
const lockBytes = Buffer.from('synthetic package lock');

type Command = { command: string; args: string[]; env: Record<string, string> };
type Failure =
  | 'node'
  | 'checkout'
  | 'tracked-input'
  | 'keystore'
  | 'java'
  | 'baseline'
  | 'verify'
  | 'prebuild'
  | 'compile'
  | 'assemble'
  | 'release-signer'
  | 'built-smoke-signer'
  | 'smoke-signer'
  | 'smoke';

// Execute the production entry and helpers. All files, processes and archive I/O stay inside this fixture.
function release(options: { args?: string[]; failure?: Failure; platform?: string } = {}) {
  const files = new Map<string, Buffer>();
  const put = (name: string, value: string | Buffer) => files.set(path.resolve(root, name), Buffer.from(value));
  put(
    'app.json',
    JSON.stringify({
      expo: {
        version: '1.2.3',
        android: { package: 'fixture.reader', versionCode: 42 },
        extra: { releaseSignerSha256: signer }
      }
    })
  );
  put('package.json', packageText);
  put('package-lock.json', lockBytes);
  put('fixture-release.keystore', 'synthetic keystore');
  put('android/app/debug.keystore', 'synthetic debug keystore');
  put('fixture-sdk/build-tools/36.0.0/lib/apksigner.jar', 'synthetic signer');
  put(
    'android/gradle/wrapper/gradle-wrapper.properties',
    'distributionUrl=https://example.invalid/gradle-9.1.0-bin.zip'
  );
  put(
    '.env.release.local',
    [
      `WZ_ANDROID_KEYSTORE_PATH=${options.failure === 'keystore' ? 'missing.keystore' : 'fixture-release.keystore'}`,
      'WZ_ANDROID_KEYSTORE_PASSWORD=fixture-store-password',
      'WZ_ANDROID_KEY_ALIAS=fixture-release',
      'WZ_ANDROID_KEY_PASSWORD=fixture-key-password',
      'WZ_ANDROID_SMOKE_DEVICE=fixture-device',
      'WZ_ANDROID_SMOKE_ABI=x86_64'
    ].join('\n')
  );
  const commands: Command[] = [];
  const events: string[] = [];
  const output: string[] = [];
  const exitListeners = new Set<() => void>();
  let exitCode = 0;
  const stopped = new Error('fixture process exited');
  const fs = {
    readFileSync(name: string, encoding?: string) {
      const data = files.get(name);
      if (!data) throw new Error(`Unexpected fixture read: ${name}`);
      return encoding ? data.toString('utf8') : data;
    },
    writeFileSync(name: string, value: string) {
      files.set(name, Buffer.from(value));
      if (name.endsWith('release-manifest.json')) events.push('manifest');
    },
    existsSync: (name: string) => files.has(name) || name === path.join(root, 'fixture-sdk/build-tools'),
    statSync: (name: string) => ({ isFile: () => files.has(name) }),
    readdirSync: () => [{ name: '36.0.0', isDirectory: () => true }]
  };
  const spawnSync = (command: string, argv: string[], config: { env: Record<string, string> }) => {
    const args = [...argv];
    if (/^(npm|npx)-cli\.js$/.test(path.basename(args[0] || ''))) {
      command = path.basename(args.shift()!).split('-')[0]!;
    }
    commands.push({ command, args, env: config.env });
    let stage = '';
    let stdout = '';
    if (command === 'git') {
      stdout =
        args[0] === 'ls-files'
          ? options.failure === 'tracked-input'
            ? ''
            : RELEASE_REQUIRED_TRACKED_INPUTS.join('\n')
          : args[0] === 'rev-parse'
            ? revision
            : options.failure === 'checkout'
              ? ' M package.json'
              : '';
    } else if (args.includes('--require-previous-release')) stage = 'baseline';
    else if (command === 'npm' && args[0] === '--version') stdout = '10.9.3';
    else if (command === 'java' && args[0] === '-version')
      stdout =
        options.failure === 'java'
          ? 'Picked up JAVA_TOOL_OPTIONS: fixture'
          : 'Picked up JAVA_TOOL_OPTIONS: fixture\nopenjdk version "17.0.12"';
    else if (args.includes('verify') && command === 'npm') stage = 'verify';
    else if (args.includes('prebuild')) {
      stage = 'prebuild';
      put('package.json', '{"name":"release-fixture","scripts":{"ios":"expo run:ios"}}');
    } else if (args.includes(':app:compileReleaseKotlin')) stage = 'compile';
    else if (args.includes(':app:assembleRelease')) {
      stage = 'assemble';
      for (const abi of ['arm64-v8a', 'x86_64'])
        put(`android/app/build/outputs/apk/release/app-${abi}-release.apk`, apkBytes);
    } else if (args.includes('sign')) {
      stage = 'sign-smoke';
      fs.writeFileSync(args[args.indexOf('--out') + 1]!, 'synthetic smoke APK');
    } else if (args.includes('--print-certs')) {
      const smoke = args.at(-1)!.endsWith('smoke-dev.apk');
      stage = smoke
        ? 'smoke-signer'
        : args.at(-1)!.endsWith('app-arm64-v8a-release.apk')
          ? 'release-signer'
          : 'built-smoke-signer';
      const digest = options.failure === stage ? (smoke ? signer : 'c'.repeat(64)) : smoke ? 'd'.repeat(64) : signer;
      stdout = `Signer #1 certificate SHA-256 digest: ${digest}`;
    } else if (args.includes('smoke:android')) stage = 'smoke';
    else throw new Error(`Unexpected fixture command: ${command} ${args.join(' ')}`);
    if (stage) events.push(stage);
    return { status: options.failure === stage && !stage.endsWith('signer') ? 1 : 0, stdout, stderr: '' };
  };
  const modules = new Map<string, { exports: unknown }>();
  const load = (filename: string): unknown => {
    const cached = modules.get(filename);
    if (cached) return cached.exports;
    const module = { exports: {} };
    modules.set(filename, module);
    const source = readFileSync(filename, 'utf8').replaceAll(
      'import.meta.url',
      JSON.stringify(pathToFileURL(filename).href)
    );
    const code = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
    }).outputText;
    runInNewContext(code, {
      module,
      exports: module.exports,
      console: { log: (value: string) => output.push(value), error: (value: string) => output.push(value) },
      process: {
        platform: options.platform || 'win32',
        execPath: path.join(root, 'fixture-node/node.exe'),
        versions: { node: options.failure === 'node' ? '25.2.1' : '22.23.2' },
        env: { ANDROID_HOME: path.join(root, 'fixture-sdk'), WZ_ANDROID_KEY_PASSWORD: 'inherited-fixture-password' },
        once: (_event: string, listener: () => void) => exitListeners.add(listener),
        removeListener: (_event: string, listener: () => void) => exitListeners.delete(listener),
        exit: (code: number) => {
          exitCode = code;
          throw stopped;
        },
        stdout: { write: (value: string) => output.push(value) },
        stderr: { write: (value: string) => output.push(value) }
      },
      require(name: string) {
        if (name === 'node:fs') return fs;
        if (name === 'node:child_process') return { spawnSync };
        if (name === 'node:util')
          return {
            ...require('node:util'),
            parseArgs: (config: Parameters<typeof parseArgs>[0]) => parseArgs({ ...config, args: options.args || [] })
          };
        if (['node:path', 'node:url', 'node:crypto'].includes(name)) return require(name);
        if (name === './diagnostic-symbols.mjs') return { archiveDiagnosticSymbols: () => events.push('archive') };
        if (['./release-environment.mjs', './apk-signing.cjs'].includes(name))
          return load(path.resolve(path.dirname(filename), name));
        throw new Error(`Unexpected fixture import: ${name}`);
      }
    });
    return module.exports;
  };
  try {
    load(path.join(root, 'scripts/release-android.mjs'));
  } catch (error) {
    if (error !== stopped) throw error;
  } finally {
    exitListeners.forEach((listener) => listener());
  }
  const manifestPath = path.join(root, 'android/app/build/outputs/apk/release/release-manifest.json');
  const manifest: unknown = files.has(manifestPath) ? JSON.parse(files.get(manifestPath)!.toString()) : undefined;
  return {
    commands,
    events,
    output,
    exitCode,
    packageText: files.get(path.join(root, 'package.json'))!.toString(),
    manifest
  };
}

describe('release entry execution', () => {
  it.each([
    ['node', 'Node 22'],
    ['checkout', 'clean Git checkout'],
    ['tracked-input', '缺少已跟踪输入'],
    ['keystore', 'keystore 不是普通文件'],
    ['java', '无法读取可信的 Java 版本']
  ] satisfies [Failure, string][])('rejects invalid %s before verification or build work', (failure, message) => {
    const result = release({ failure });
    expect(result.exitCode).toBe(1);
    expect(result.events).toEqual([]);
    expect(result.output.join('\n')).toContain(message);
    expect(result.manifest).toBeUndefined();
  });

  it.each(['win32', 'linux'])(
    'isolates signing credentials and writes verified provenance after Smoke on %s',
    (platform) => {
      const result = release({ platform });
      expect(result.exitCode).toBe(0);
      expect(result.events).toEqual([
        'baseline',
        'verify',
        'prebuild',
        'compile',
        'assemble',
        'release-signer',
        'built-smoke-signer',
        'sign-smoke',
        'smoke-signer',
        'smoke',
        'archive',
        'manifest'
      ]);
      expect(result.packageText).toBe(packageText);
      const assembly = result.commands.filter((command) => command.args.includes(':app:assembleRelease'));
      expect(assembly).toHaveLength(1);
      expect(assembly[0]!.args).toContain('-PreleaseApkAbis=arm64-v8a,x86_64');
      expect(assembly[0]!.env.WZ_ANDROID_KEYSTORE_PATH).toBe(path.join(root, 'fixture-release.keystore'));
      for (const command of result.commands) {
        for (const key of RELEASE_SIGNING_ENV_NAMES) {
          if (command === assembly[0]) expect(command.env[key]).toBeTruthy();
          else expect(command.env).not.toHaveProperty(key);
        }
      }
      expect(result.manifest).toEqual({
        apkName: 'app-arm64-v8a-release.apk',
        sha256: createHash('sha256').update(apkBytes).digest('hex'),
        packageName: 'fixture.reader',
        versionName: '1.2.3',
        versionCode: 42,
        signerSha256: signer,
        gitSha: revision,
        packageLockSha256: createHash('sha256').update(lockBytes).digest('hex'),
        nodeVersion: '22.23.2',
        npmVersion: '10.9.3',
        javaVersion: 'openjdk version "17.0.12"',
        gradleVersion: '9.1.0',
        builtAbis: ['arm64-v8a', 'x86_64'],
        verificationScope: 'full'
      });
      expect(result.output.join('\n')).not.toContain('certificate SHA-256 digest');
    }
  );

  it.each<Failure>([
    'baseline',
    'verify',
    'prebuild',
    'compile',
    'assemble',
    'release-signer',
    'built-smoke-signer',
    'smoke-signer',
    'smoke'
  ])('stops at failed %s without publishing a manifest', (failure) => {
    const result = release({ failure });
    expect(result.exitCode).toBe(1);
    expect(result.events.at(-1)).toBe(failure);
    expect(result.manifest).toBeUndefined();
    expect(result.packageText).toBe(packageText);
  });

  it('forwards a targeted Replay directory and records the explicitly reduced verification scope', () => {
    const result = release({ args: ['--skip-verify', '--replay-directory', 'fixture-replays'] });
    expect(result.exitCode).toBe(0);
    expect(result.events).not.toContain('verify');
    expect(result.events).toContain('baseline');
    expect(result.manifest).toMatchObject({ verificationScope: 'targeted' });
    expect(result.commands.find((command) => command.args.includes('smoke:android'))?.args).toEqual([
      'run',
      'smoke:android',
      '--',
      path.join(root, 'android/app/build/outputs/apk/release/app-x86_64-smoke-dev.apk'),
      '--replay-directory',
      'fixture-replays'
    ]);
  });
});

function readProjectFile(...parts: string[]) {
  return readFileSync(path.join(root, ...parts), 'utf8');
}

describe('release workflow trust gates', () => {
  it('fetches the release history and tags in CI', () => {
    const ciWorkflow = readProjectFile('.github', 'workflows', 'ci.yml');
    expect(ciWorkflow).toMatch(/uses: actions\/checkout@v4\s+with:\s+fetch-depth: 0/);
  });

  it('pins React Doctor while retaining the permissions used by its configured review features', () => {
    const workflow = readProjectFile('.github', 'workflows', 'react-doctor.yml');

    expect(workflow).toContain('uses: millionco/react-doctor@01820bb4fd4d0a4aebcd8df2b2a143a098649cb2');
    expect(workflow).not.toContain('millionco/react-doctor@v2');
    expect(workflow).toContain('pull-requests: write');
    expect(workflow).toContain('issues: write');
    expect(workflow).toContain('statuses: write');
  });
});
