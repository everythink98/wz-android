import { notificationSources, type NotificationSource } from '@/domain/forum/sourceCatalog';

export type NotificationSourceLifecyclePhase = 'clean' | 'cleaning' | 'cleanup-failed';

type NotificationSourceLifecycle = {
  phase: NotificationSourceLifecyclePhase;
  operation?: Promise<void>;
};

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
    if (registry[source].phase === 'cleaning') continue;
    registry[source] = { phase: 'cleaning' };
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
  if (current.phase === 'cleaning' && current.operation) {
    return { operation: current.operation, started: false };
  }

  let operation: Promise<void>;
  operation = Promise.resolve()
    .then(cleanup)
    .then(
      () => {
        if (registry[source].operation !== operation) return;
        registry[source] = { phase: 'clean' };
        onTransition();
      },
      (error) => {
        if (registry[source].operation === operation) {
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
