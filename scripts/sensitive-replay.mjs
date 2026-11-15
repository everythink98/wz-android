import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const sensitiveNames = new Set(['account-readonly.ad', 'more-readonly.ad', 'nodeseek-session.ad']);
const safeCodes = new Set([
  'ELEMENT_NOT_FOUND',
  'COMMAND_FAILED',
  'INVALID_ARGS',
  'SESSION_NOT_FOUND',
  'DEVICE_NOT_FOUND',
  'APP_NOT_RUNNING',
  'AMBIGUOUS_SELECTOR',
  'STALE_REF',
  'CANCELED',
  'PERMISSION_DENIED',
  'TIMEOUT'
]);

export const isSensitiveReplay = (file) => sensitiveNames.has(path.basename(file));
const failure = (code, step) => Object.assign(new Error(`Sensitive Replay step ${step}: ${code}`), { code, step });

function selector(value, step) {
  let parsed;
  try {
    parsed = value.startsWith('"') ? JSON.parse(value) : value;
  } catch {
    throw failure('INVALID_SCRIPT', step);
  }
  if (typeof parsed !== 'string' || !/^(?:id|text|label)=/.test(parsed) || /[\r\n\u0000]/.test(parsed))
    throw failure('INVALID_SCRIPT', step);
  return parsed;
}

// Deliberately only the syntax used by the three sensitive journeys, not a second replay engine.
export function sensitiveReplayPlan(source, appPackage) {
  const headers = new Map();
  const steps = [];
  for (const original of source.split(/\r?\n/)) {
    const line = original.trim();
    if (!line || line.startsWith('#')) continue;
    const header = /^(context|env) ([A-Za-z_]+)=(\S+)$/.exec(line);
    if (header) {
      const [, kind, key, value] = header;
      if (
        steps.length ||
        headers.has(key) ||
        !['platform', 'timeout', 'retries', 'APP_ID'].includes(key) ||
        (kind === 'env') !== (key === 'APP_ID')
      )
        throw failure('INVALID_SCRIPT', 0);
      headers.set(key, value);
      continue;
    }
    const step = steps.length + 1;
    const value = line.replaceAll('${APP_ID}', appPackage);
    if (/\$\{|\$[A-Za-z_]/.test(value)) throw failure('INVALID_SCRIPT', step);
    if (value === `open ${appPackage} --relaunch`) steps.push(['open', appPackage, '--relaunch']);
    else if (value === 'back --system') steps.push(['back', '--system']);
    else if (/^scroll (?:top|bottom|down 0\.3)$/.test(value)) steps.push(value.split(' '));
    else if (/^wait stable (?:500 10000|1500 15000)$/.test(value)) steps.push(value.split(' '));
    else if (value.startsWith('press ')) steps.push(['press', selector(value.slice(6), step)]);
    else {
      const wait = /^wait (.+) (10000|60000)$/.exec(value);
      const find = /^find (.+) click$/.exec(value);
      if (wait) steps.push(['wait', selector(wait[1], step), wait[2]]);
      else if (find) steps.push(['find', selector(find[1], step), 'click']);
      else throw failure('INVALID_SCRIPT', step);
    }
  }
  const timeout = Number(headers.get('timeout'));
  if (
    headers.get('platform') !== 'android' ||
    headers.get('retries') !== '0' ||
    headers.get('APP_ID') !== appPackage ||
    ![180000, 240000].includes(timeout) ||
    steps[0]?.[0] !== 'open'
  )
    throw failure('INVALID_SCRIPT', 0);
  return { steps, timeout };
}

export function sensitiveReplayErrorCode(error) {
  try {
    const code = JSON.parse(typeof error?.stdout === 'string' ? error.stdout : '').error?.code;
    if (safeCodes.has(code)) return code;
  } catch {
    // A backend's message, details and output are never evidence for a sensitive journey.
  }
  return 'COMMAND_FAILED';
}

export function runSensitiveReplay({
  replayFile,
  replaySession,
  deviceName,
  appPackage,
  artifactsDir,
  junitPath,
  runAgentDevice,
  cwd
}) {
  const started = performance.now();
  const cases = [];
  const configPath = path.join(artifactsDir, 'atomic-config.json');
  writeFileSync(configPath, '{}\n');
  // Preserve only connection identity; inherited capture/debug/output defaults are not allowed.
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) =>
        !key.startsWith('AGENT_DEVICE_') ||
        ['AGENT_DEVICE_DAEMON_BASE_URL', 'AGENT_DEVICE_DAEMON_AUTH_TOKEN'].includes(key)
    )
  );
  const options = { cwd, capture: true, echoCapture: false, env };
  const flags = [
    '--session',
    replaySession,
    '--device',
    deviceName,
    '--platform',
    'android',
    '--no-record',
    '--json',
    '--level',
    'digest',
    '--config',
    configPath
  ];
  let plan;
  let error;
  let cleanupError;
  let attemptedOpen = false;
  let sourceHash;
  try {
    const source = readFileSync(replayFile, 'utf8');
    sourceHash = createHash('sha256').update(source).digest('hex');
    plan = sensitiveReplayPlan(source, appPackage);
    for (const [index, args] of plan.steps.entries()) {
      const before = performance.now();
      const remaining = Math.floor(plan.timeout - (before - started));
      let code;
      if (remaining <= 0) code = 'TIMEOUT';
      else {
        if (args[0] === 'open') attemptedOpen = true;
        try {
          const command =
            args[0] === 'wait' ? [...args.slice(0, -1), String(Math.min(Number(args.at(-1)), remaining))] : args;
          const result = JSON.parse(runAgentDevice([...command, ...flags], { ...options, timeout: remaining }));
          if (result.success !== true) code = safeCodes.has(result.error?.code) ? result.error.code : 'COMMAND_FAILED';
        } catch (cause) {
          code = sensitiveReplayErrorCode(cause);
        }
      }
      cases.push({ step: index + 1, command: args[0], code, seconds: (performance.now() - before) / 1000 });
      if (code) {
        error = failure(code, index + 1);
        break;
      }
    }
  } catch {
    error = failure('INVALID_SCRIPT', 0);
    cases.push({ step: 0, command: 'preflight', code: 'INVALID_SCRIPT', seconds: 0 });
  } finally {
    if (attemptedOpen) {
      try {
        const result = JSON.parse(runAgentDevice(['close', ...flags], { ...options, timeout: 15000 }));
        if (result.success !== true && result.error?.code !== 'SESSION_NOT_FOUND')
          cleanupError = failure('CLEANUP_FAILED', 0);
      } catch (cause) {
        if (sensitiveReplayErrorCode(cause) !== 'SESSION_NOT_FOUND') cleanupError = failure('CLEANUP_FAILED', 0);
      }
    }
  }
  if (cleanupError) cases.push({ step: 0, command: 'cleanup', code: 'CLEANUP_FAILED', seconds: 0 });
  const completedSteps = cases.filter(({ step }) => step > 0).length;
  const skipped = plan ? plan.steps.length - completedSteps : 0;
  const failures = cases.filter(({ code }) => code).length;
  const xml = [
    `<testsuite name="sensitive-replay" tests="${cases.length + skipped}" failures="${failures}" skipped="${skipped}">`,
    ...cases.map(
      ({ step, command, code, seconds }) =>
        `<testcase name="step ${step} ${command}" time="${seconds.toFixed(3)}">${code ? `<failure message="${code}"/>` : ''}</testcase>`
    ),
    ...Array.from(
      { length: skipped },
      (_, index) => `<testcase name="unreached step ${completedSteps + index + 1}"><skipped/></testcase>`
    ),
    '</testsuite>'
  ].join('\n');
  writeFileSync(junitPath, `${xml}\n`);
  writeFileSync(
    path.join(artifactsDir, 'result.json'),
    `${JSON.stringify(
      {
        mode: 'sensitive-atomic',
        sourceHash,
        status: error || cleanupError ? 'failed' : 'passed',
        totalSteps: plan?.steps.length,
        timeoutMs: plan?.timeout,
        retries: 0,
        steps: cases
      },
      null,
      2
    )}\n`
  );
  return { error, cleanupError };
}
