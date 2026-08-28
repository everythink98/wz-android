import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assertCleanReleaseCheckout,
  assertReleaseNode22,
  parseJavaVersionOutput,
  releaseEnvironment,
  restorePackageJsonAfterPrebuild,
  runReleaseBuildStages,
  signingReleaseChildEnv,
  unsignedReleaseChildEnv
} from '../../scripts/release-environment.mjs';

const signing = {
  WZ_ANDROID_KEYSTORE_PATH: 'signing/release.jks',
  WZ_ANDROID_KEYSTORE_PASSWORD: 'store-secret',
  WZ_ANDROID_KEY_ALIAS: 'release-key',
  WZ_ANDROID_KEY_PASSWORD: 'key-secret'
};

describe('Java version provenance', () => {
  it.each([
    [
      'OpenJDK',
      'Picked up JAVA_TOOL_OPTIONS: -DwzReviewMarker=manifest-probe\nopenjdk version "17.0.12" 2024-07-16 LTS\nOpenJDK Runtime Environment',
      'openjdk version "17.0.12" 2024-07-16 LTS'
    ],
    [
      'Oracle',
      'JDK_JAVA_OPTIONS: -DwzReviewMarker=manifest-probe\njava version "21.0.4" 2024-07-16 LTS\nPicked up JAVA_TOOL_OPTIONS: -Dafter=true',
      'java version "21.0.4" 2024-07-16 LTS'
    ]
  ])('accepts one complete %s version line regardless of surrounding output', (_name, output, expected) => {
    expect(parseJavaVersionOutput(output)).toBe(expected);
  });

  it.each([
    'Picked up JAVA_TOOL_OPTIONS: -DwzReviewMarker=manifest-probe',
    'openjdk version "17.0.12" 2024-07-16 LTS\njava version "21.0.4" 2024-07-16 LTS\nwzReviewMarker=manifest-probe'
  ])('rejects zero or conflicting matches without echoing raw output', (output) => {
    let message = '';
    try {
      parseJavaVersionOutput(output);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toBe('无法读取可信的 Java 版本。');
    expect(message).not.toContain('wzReviewMarker');
    expect(message).not.toContain('manifest-probe');
  });
});

describe('release environment boundary', () => {
  it('loads only release allowlist values without mutating the inherited environment', () => {
    const inherited = {
      PATH: 'tools',
      ...signing,
      WZ_ANDROID_SMOKE_DEVICE: 'emulator-5554',
      UNRELATED_SECRET: 'must-not-load'
    };
    const file = [
      'WZ_ANDROID_KEYSTORE_PASSWORD=file-store-secret',
      'WZ_ANDROID_SMOKE_ABI=x86_64',
      'PATH=malicious-tools',
      'AWS_SECRET_ACCESS_KEY=must-not-load'
    ].join('\n');

    expect(releaseEnvironment(inherited, file)).toEqual({
      ...signing,
      WZ_ANDROID_KEYSTORE_PASSWORD: 'file-store-secret',
      WZ_ANDROID_SMOKE_DEVICE: 'emulator-5554',
      WZ_ANDROID_SMOKE_ABI: 'x86_64'
    });
    expect(inherited.PATH).toBe('tools');
    expect(inherited.WZ_ANDROID_KEYSTORE_PASSWORD).toBe('store-secret');
  });

  it('removes signing values from ordinary children and restores them only for signing', () => {
    const inherited = {
      PATH: 'tools',
      ...signing,
      WZ_ANDROID_SMOKE_DEVICE: 'emulator-5554'
    };
    const configured = releaseEnvironment(inherited, '');
    const ordinary = unsignedReleaseChildEnv(inherited, configured);
    const signingChild = signingReleaseChildEnv(ordinary, configured);

    expect(ordinary).toMatchObject({
      PATH: 'tools',
      WZ_ANDROID_SMOKE_DEVICE: 'emulator-5554'
    });
    for (const name of Object.keys(signing)) {
      expect(ordinary).not.toHaveProperty(name);
      expect(signingChild[name]).toBe(signing[name as keyof typeof signing]);
    }
  });

  it('removes mixed-case signing names from ordinary Windows child environments', () => {
    const ordinary = unsignedReleaseChildEnv(
      {
        PATH: 'tools',
        Wz_Android_KeyStore_Path: 'signing/release.jks',
        wz_android_keystore_password: 'store-secret',
        WZ_ANDROID_KEY_ALIAS: 'release-key',
        wZ_aNdRoId_KeY_pAsSwOrD: 'key-secret'
      },
      {}
    );

    const ordinaryNames = Object.keys(ordinary).map((name) => name.toUpperCase());
    for (const name of Object.keys(signing)) {
      expect(ordinaryNames).not.toContain(name);
    }
  });

  it('restores the exact package text after Expo adds only its default ios script', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'wz-release-package-'));
    const packageJsonPath = path.join(directory, 'package.json');
    const original = '{\r\n  "scripts": {\r\n    "android": "expo run:android"\r\n  }\r\n}\r\n';
    writeFileSync(
      packageJsonPath,
      JSON.stringify(
        {
          scripts: {
            android: 'expo run:android',
            ios: 'expo run:ios'
          }
        },
        null,
        2
      )
    );

    try {
      restorePackageJsonAfterPrebuild(packageJsonPath, original);
      expect(readFileSync(packageJsonPath, 'utf8')).toBe(original);
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it('restores package.json and fails closed on any other prebuild change', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'wz-release-package-'));
    const packageJsonPath = path.join(directory, 'package.json');
    const original = '{"scripts":{"android":"expo run:android"}}\n';
    writeFileSync(
      packageJsonPath,
      JSON.stringify({
        scripts: {
          android: 'expo run:android',
          ios: 'custom ios command'
        }
      })
    );

    try {
      expect(() => restorePackageJsonAfterPrebuild(packageJsonPath, original)).toThrow('package.json');
      expect(readFileSync(packageJsonPath, 'utf8')).toBe(original);
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it('treats an existing ios script as part of the exact original package', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'wz-release-package-'));
    const packageJsonPath = path.join(directory, 'package.json');
    const original = '{"scripts":{"ios":"custom ios command"}}\n';
    writeFileSync(packageJsonPath, original);

    try {
      restorePackageJsonAfterPrebuild(packageJsonPath, original);
      expect(readFileSync(packageJsonPath, 'utf8')).toBe(original);

      writeFileSync(packageJsonPath, '{"scripts":{"ios":"expo run:ios"}}\n');
      expect(() => restorePackageJsonAfterPrebuild(packageJsonPath, original)).toThrow('package.json');
      expect(readFileSync(packageJsonPath, 'utf8')).toBe(original);
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it('requires Node 22 and a clean checkout before release work', () => {
    expect(() => assertReleaseNode22('22.18.0')).not.toThrow();
    expect(() => assertReleaseNode22('25.2.1')).toThrow('Node 22');
    expect(() => assertCleanReleaseCheckout('')).not.toThrow();
    expect(() => assertCleanReleaseCheckout(' M scripts/release-android.mjs')).toThrow('未提交改动');
  });

  it('runs unsigned native validation before the only signed build', () => {
    const ordinary = unsignedReleaseChildEnv({ PATH: 'tools', ...signing }, {});
    const calls: { command: string; args: string[]; options: { cwd: string; env: Record<string, string> } }[] = [];

    runReleaseBuildStages({
      androidDir: 'android',
      builtAbis: ['arm64-v8a', 'x86_64'],
      ordinaryEnv: ordinary,
      releaseEnv: signing,
      run: (command: string, args: string[], options: { cwd: string; env: Record<string, string> }) =>
        calls.push({ command, args, options })
    });

    expect(calls).toHaveLength(2);
    expect(calls[0]?.args).toEqual(expect.arrayContaining([':app:testReleaseUnitTest', ':app:compileReleaseKotlin']));
    expect(calls[0]?.args).not.toContain(':app:assembleRelease');
    expect(calls[1]?.args).toContain(':app:assembleRelease');
    for (const name of Object.keys(signing)) {
      expect(calls[0]?.options.env).not.toHaveProperty(name);
      expect(calls[1]?.options.env[name]).toBe(signing[name as keyof typeof signing]);
    }
  });
});
