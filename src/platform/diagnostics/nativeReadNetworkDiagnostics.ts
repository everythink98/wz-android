import { NativeModules } from 'react-native';
import { sourceValues, type Source } from '@/domain/forum/sourceCatalog';

type NativeReadNetworkModule = {
  readNetworkDiagnosticEvents?: () => Promise<unknown>;
};

type NativeReadNetworkOperation = 'install' | 'request' | 'rotate-read-runtime';

const operations = new Set<NativeReadNetworkOperation>(['install', 'request', 'rotate-read-runtime']);
const phases = new Set([
  'call-start',
  'dns-start',
  'dns-end',
  'connect-start',
  'tls-start',
  'tls-end',
  'connect-end',
  'connect-failed',
  'connection-acquired',
  'connection-released',
  'response-start',
  'response-headers',
  'call-end',
  'call-failed',
  'call-canceled',
  'intent',
  'publish',
  'cancel',
  'drain',
  'finish'
]);
const sources = new Set<Source>(sourceValues);
const lanes = new Set(['forum', 'media']);
const methods = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);
const addressFamilies = new Set(['ipv4', 'ipv6', 'ipv4,ipv6', 'unknown']);
const protocols = new Set(['http/1.0', 'http/1.1', 'h2_prior_knowledge', 'h2', 'spdy/3.1', 'quic', 'unknown']);
const proxyTypes = new Set(['direct', 'http', 'socks']);
const tlsVersions = new Set(['TLSv1.3', 'TLSv1.2', 'TLSv1.1', 'TLSv1', 'SSLv3', 'unknown']);
const outcomes = new Set(['success', 'failure', 'canceled', 'noop', 'rollback', 'retired']);
const identityKeys = [
  'callId',
  'clientId',
  'poolId',
  'dispatcherId',
  'connectionId',
  'forumPoolId',
  'mediaPoolId',
  'imageClientId'
] as const;
const countKeys = [
  'generation',
  'previousGeneration',
  'elapsedMs',
  'queuedCount',
  'runningCount',
  'leaseCount',
  'cronetActiveCount',
  'status'
] as const;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function closedString(value: unknown, allowed: Set<string>) {
  return typeof value === 'string' && allowed.has(value) ? value : undefined;
}

function safeCount(value: unknown) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000_000
    ? value
    : undefined;
}

function safeTimestamp(value: unknown) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 8_640_000_000_000_000
    ? value
    : undefined;
}

function safeIdentity(value: unknown) {
  return typeof value === 'string' && /^[0-9a-f]{1,8}$/.test(value) ? value : undefined;
}

function safeTraceIdentity(value: unknown) {
  return typeof value === 'string' && /^(?:trace-[1-9][0-9]{0,9}|[0-9a-f]{1,16})$/.test(value) ? value : undefined;
}

function safeErrorType(value: unknown) {
  return typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_$]{0,79}$/.test(value) ? value : undefined;
}

function eventOutcome(operation: NativeReadNetworkOperation, phase: string, value: unknown) {
  const explicit = closedString(value, outcomes);
  if (explicit === 'failure' || explicit === 'rollback') return 'failure';
  if (explicit === 'canceled') return 'canceled';
  if (explicit === 'noop') return 'noop';
  if (phase.endsWith('failed')) return 'failure';
  if (phase.endsWith('canceled')) return 'canceled';
  if (operation === 'rotate-read-runtime' && phase === 'drain') return 'partial';
  return 'success';
}

function diagnosticPhase(operation: NativeReadNetworkOperation, phase: string) {
  if (operation === 'request') {
    if (phase === 'call-start') return 'intent';
    if (phase === 'call-end' || phase === 'call-failed') return 'finish';
    return 'transport';
  }
  if (phase === 'intent') return 'intent';
  if (phase === 'finish') return 'finish';
  return 'apply';
}

function nativeTraceId(operation: NativeReadNetworkOperation, input: Record<string, unknown>, index: number) {
  if (operation === 'request') {
    return `native-${safeIdentity(input.callId) || `request-${safeCount(input.generation) || 0}-${index}`}`;
  }
  if (operation === 'rotate-read-runtime') {
    const identity = safeTraceIdentity(input.traceIdentity);
    if (identity?.startsWith('trace-')) return identity;
    return `native-${identity || `rotation-${safeCount(input.generation) ?? safeCount(input.previousGeneration) ?? 0}`}`;
  }
  return `native-install-${safeCount(input.generation) || 0}`;
}

export function normalizeNativeReadNetworkDiagnosticEvents(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.slice(-512).flatMap((candidate, index) => {
    const input = record(candidate);
    if (!input) return [];
    const operation = closedString(input.operation, operations) as NativeReadNetworkOperation | undefined;
    const nativePhase = closedString(input.phase, phases);
    const timeMs = safeTimestamp(input.timeMs);
    if (!operation || !nativePhase || timeMs === undefined) return [];

    const output: Record<string, string | number> = {
      type: 'native-read-network',
      schemaVersion: 1,
      time: new Date(timeMs).toISOString(),
      appSessionId: 'native-read-runtime',
      traceId: nativeTraceId(operation, input, index),
      area: 'network',
      operation,
      phase: diagnosticPhase(operation, nativePhase),
      nativePhase,
      outcome: eventOutcome(operation, nativePhase, input.outcome),
      durationMs: safeCount(input.elapsedMs) || 0
    };
    const source = closedString(input.source, sources);
    const lane = closedString(input.lane, lanes);
    const method = closedString(input.method, methods);
    const addressFamily = closedString(input.addressFamily, addressFamilies);
    const networkProtocol = closedString(input.protocol, protocols);
    const proxyType = closedString(input.proxyType, proxyTypes);
    const tlsVersion = closedString(input.tlsVersion, tlsVersions);
    const errorType = safeErrorType(input.errorType);
    if (source) output.source = source;
    if (lane) output.lane = lane;
    if (method) output.method = method;
    if (addressFamily) output.addressFamily = addressFamily;
    if (networkProtocol) output.networkProtocol = networkProtocol;
    if (proxyType) output.proxyType = proxyType;
    if (tlsVersion) output.tlsVersion = tlsVersion;
    if (errorType) output.errorType = errorType;
    for (const key of identityKeys) {
      const identity = safeIdentity(input[key]);
      if (identity) output[key] = identity;
    }
    for (const key of countKeys) {
      const count = safeCount(input[key]);
      if (count !== undefined) output[key] = count;
    }
    return [output];
  });
}

export async function readNativeReadNetworkDiagnosticLines(
  module: NativeReadNetworkModule | undefined = NativeModules.NetworkProxyModule as NativeReadNetworkModule | undefined
) {
  if (!module?.readNetworkDiagnosticEvents) return '';
  try {
    const events = normalizeNativeReadNetworkDiagnosticEvents(await module.readNetworkDiagnosticEvents());
    return events.length ? `${events.map((event) => JSON.stringify(event)).join('\n')}\n` : '';
  } catch {
    // Native diagnostics are supplemental and must never block export.
    return '';
  }
}
