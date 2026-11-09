import { notificationSources, type NotificationSource } from '@/domain/forum/sourceCatalog';

type NotificationSourceLifecycle =
  { phase: 'clean' | 'cleanup-required' | 'cleanup-failed' } | { phase: 'cleaning'; operation: Promise<void> };

export type NotificationSourceLifecyclePhase = NotificationSourceLifecycle['phase'];

export type NotificationSourceLifecycleRegistry = Record<NotificationSource, NotificationSourceLifecycle>;

export function createNotificationSourceLifecycleRegistry(): NotificationSourceLifecycleRegistry {
  return Object.fromEntries(
    notificationSources.map((source) => [source, { phase: 'clean' }])
  ) as NotificationSourceLifecycleRegistry;
}

export function markNotificationSourcesCleaning(
  registry: NotificationSourceLifecycleRegistry,
  sources: readonly NotificationSource[]
) {
  let changed = false;
  for (const source of sources) {
    const current = registry[source];
    if (current.phase === 'cleaning' || current.phase === 'cleanup-required') continue;
    registry[source] = { phase: 'cleanup-required' };
    changed = true;
  }
  return changed;
}

export function runNotificationSourceCleanup(
  registry: NotificationSourceLifecycleRegistry,
  source: NotificationSource,
  cleanup: () => Promise<void>,
  onTransition: () => void
) {
  const current = registry[source];
  if (current.phase === 'cleaning') {
    return { operation: current.operation, started: false };
  }

  let operation: Promise<void>;
  operation = Promise.resolve()
    .then(cleanup)
    .then(
      () => {
        const current = registry[source];
        if (current.phase !== 'cleaning' || current.operation !== operation) return;
        registry[source] = { phase: 'clean' };
        onTransition();
      },
      (error) => {
        const current = registry[source];
        if (current.phase === 'cleaning' && current.operation === operation) {
          registry[source] = { phase: 'cleanup-failed' };
          onTransition();
        }
        throw error;
      }
    );
  registry[source] = { operation, phase: 'cleaning' };
  return { operation, started: true };
}

export function notificationSourceIsOperational(
  registry: NotificationSourceLifecycleRegistry,
  source: NotificationSource,
  runtimeReady: boolean,
  enabledSources: readonly NotificationSource[]
) {
  return runtimeReady && enabledSources.includes(source) && registry[source].phase === 'clean';
}

export function operationalNotificationSources(
  registry: NotificationSourceLifecycleRegistry,
  enabledSources: readonly NotificationSource[],
  runtimeReady: boolean
) {
  return runtimeReady ? enabledSources.filter((source) => registry[source].phase === 'clean') : [];
}
