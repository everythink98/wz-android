import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { retraceNativeDiagnosticEvent, symbolicateDiagnosticEvent } from './diagnostic-symbols.mjs';

const { values } = parseArgs({
  options: { log: { type: 'string' }, symbols: { type: 'string' }, 'retrace-jar': { type: 'string' } }
});
if (!values.log || !values.symbols)
  throw new Error(
    'Usage: node scripts/symbolicate-diagnostic.mjs --log <export> --symbols <matching-symbol-directory> [--retrace-jar <R8 jar>]'
  );
const { buildId } = JSON.parse(readFileSync(path.join(values.symbols, 'manifest.json'), 'utf8'));
if (!/^[a-f0-9]{32}$/.test(buildId)) throw new Error('Invalid diagnostic symbol build identity.');
const events = readFileSync(values.log, 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((line) => JSON.parse(line))
  .filter(
    (event) =>
      ['js-error', 'unhandled-rejection', 'native-crash'].includes(event.operation) && typeof event.stack === 'string'
  );
const skippedBuilds = new Map();
let symbolicated = 0;
for (const event of events) {
  if (event.buildId !== buildId) {
    const skippedBuild = /^[a-f0-9]{32}$/.test(event.buildId) ? event.buildId : 'unknown';
    skippedBuilds.set(skippedBuild, (skippedBuilds.get(skippedBuild) || 0) + 1);
    continue;
  }
  const stack =
    event.operation === 'native-crash'
      ? retraceNativeDiagnosticEvent(event, values.symbols, { retraceJar: values['retrace-jar'] })
      : symbolicateDiagnosticEvent(event, values.symbols);
  process.stdout.write(
    `${JSON.stringify({
      time: event.time,
      operation: event.operation,
      buildId,
      processSessionId: event.processSessionId || event.appSessionId,
      traceId: event.traceId
    })}\n${stack}\n`
  );
  symbolicated += 1;
}
process.stderr.write(
  `${JSON.stringify({
    buildId,
    symbolicated,
    skipped: [...skippedBuilds.values()].reduce((sum, count) => sum + count, 0),
    skippedBuilds: Object.fromEntries(skippedBuilds)
  })}\n`
);
