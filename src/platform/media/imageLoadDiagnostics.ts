import { useEffect, useMemo } from 'react';
import type { ImageURISource } from 'react-native';
import { createTrace, finishDiagnosticTrace, markDiagnosticStage } from '@/platform/diagnostics/diagnostics';
import { diagnosticRef, type DiagnosticFields } from '@/platform/diagnostics/diagnosticPolicy';

const TRACE_HEADER = 'X-WZ-Image-Trace';
const MEDIA_HEADER = 'X-WZ-Image-Ref';
const SESSION_HEADER = 'X-WZ-Image-Session';

export function isImageDiagnosticHeader(name: string) {
  return [TRACE_HEADER, MEDIA_HEADER, SESSION_HEADER].some((header) => header.toLowerCase() === name.toLowerCase());
}

export function recordImageBudgetTimeout(requestIdentity: string, timeoutMs: number) {
  finishDiagnosticTrace(createTrace('media', 'image-budget'), 'failure', {
    mediaRef: diagnosticRef('media', requestIdentity.split('\u0000')[0].split('#')[0]),
    imageFailure: 'timeout',
    timeoutMs
  });
}

// Inspect locally, emit only this closed classification. Never persist the native message.
export function imageFailureKind(error: unknown): NonNullable<DiagnosticFields['imageFailure']> {
  const value = error as { nativeEvent?: { error?: unknown }; error?: unknown; message?: unknown } | null;
  const detail = typeof error === 'string' ? error : (value?.nativeEvent?.error ?? value?.error ?? value?.message);
  const message = typeof detail === 'string' ? detail.slice(0, 8192) : '';
  if (/executor rejected|RejectedExecutionException/i.test(message)) return 'executor_rejected';
  if (/timeout|timed out|deadline/i.test(message)) return 'timeout';
  if (/cancelled|canceled|aborted/i.test(message)) return 'canceled';
  if (/status code|http.*\b[45]\d\d\b/i.test(message)) return 'http_error';
  if (/decode|codec|bitmap|image format|invalid image|unsupported image/i.test(message)) return 'decode_error';
  if (/SSL|certificate|handshake/i.test(message)) return 'tls_error';
  if (/UnknownHost|Unable to resolve host/i.test(message)) return 'dns_error';
  if (/IOException|connection|socket|network/i.test(message)) return 'network_error';
  return 'unknown';
}

export function imageLoadDiagnosticAttempt(
  source: ImageURISource,
  imageConsumer: 'fresco' | 'glide',
  mediaUri = source.uri
) {
  const trace = createTrace('media', 'image-load');
  const fields = { mediaRef: diagnosticRef('media', mediaUri?.split('#')[0] || ''), imageConsumer };
  const sourceWithTrace = /^https?:\/\//i.test(source.uri || '')
    ? {
        ...source,
        headers: {
          ...source.headers,
          [TRACE_HEADER]: trace.traceId,
          [MEDIA_HEADER]: fields.mediaRef,
          [SESSION_HEADER]: trace.appSessionId
        }
      }
    : source;
  return {
    source: sourceWithTrace,
    start: () => markDiagnosticStage(trace, 'intent', fields),
    loaded: (cacheType?: string) =>
      markDiagnosticStage(trace, 'parse', {
        ...fields,
        state: 'loaded',
        ...(cacheType === 'none' || cacheType === 'disk' || cacheType === 'memory' ? { cacheType } : {})
      }),
    displayed: () => finishDiagnosticTrace(trace, 'success', { ...fields, state: 'displayed' }),
    failed: (error: unknown) =>
      finishDiagnosticTrace(trace, 'failure', { ...fields, imageFailure: imageFailureKind(error) }),
    canceled: () => finishDiagnosticTrace(trace, 'canceled', { ...fields, imageFailure: 'canceled' })
  };
}

export function useImageLoadDiagnostics(
  source: ImageURISource,
  attemptIdentity: string | number,
  imageConsumer: 'fresco' | 'glide',
  enabled = true,
  mediaUri = source.uri
) {
  // Native sources are JSON records. Equal values must not rotate the trace header and reload the image.
  const sourceKey = JSON.stringify(source, (_key, value) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)))
      : value
  );
  const diagnostic = useMemo(() => {
    void attemptIdentity;
    return imageLoadDiagnosticAttempt(JSON.parse(sourceKey) as ImageURISource, imageConsumer, mediaUri);
  }, [attemptIdentity, imageConsumer, mediaUri, sourceKey]);
  useEffect(() => {
    if (!enabled) return;
    diagnostic.start();
    return diagnostic.canceled;
  }, [diagnostic, enabled]);
  return diagnostic;
}
