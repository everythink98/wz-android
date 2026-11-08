import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

export function compileTouchTrace(sdk, evidence) {
  const java = (name) => (process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', name) : name);
  const androidJar = path.join(sdk, 'platforms/android-35/android.jar');
  execFileSync(java('javac'), ['-cp', androidJar, '-d', evidence, 'tests/device/TouchTrace.java']);
  execFileSync(java('java'), [
    '-cp',
    path.join(sdk, 'build-tools/36.0.0/lib/d8.jar'),
    'com.android.tools.r8.D8',
    '--lib',
    androidJar,
    '--output',
    path.join(evidence, 'touch.jar'),
    path.join(evidence, 'TouchTrace.class')
  ]);
}

export function touchTraceTimes(delivered, points, driftMessage, countMessage) {
  const timestamps = delivered
    .toString()
    .trim()
    .split(';')
    .filter(Boolean)
    .map((point) => point.split(',').map(Number));
  const actualTimes = timestamps.map(([time]) => time);
  assert.equal(actualTimes.length, points.length, countMessage);
  assert.deepEqual(
    timestamps.map(([, , sampleTime]) => sampleTime),
    points.map(([time]) => time),
    'Injected sample timestamps must preserve the requested trajectory.'
  );
  assert(
    actualTimes.every((time, index) => Math.abs(time - points[index][0]) <= 50),
    driftMessage
  );
  return actualTimes;
}
