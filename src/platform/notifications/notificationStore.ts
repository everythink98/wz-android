import AsyncStorage from '@react-native-async-storage/async-storage';
import { notificationSources, type NotificationSource } from '@/domain/forum/sourceCatalog';
import { recordDiagnosticError } from '@/platform/diagnostics/diagnostics';

export const NOTIFICATION_STORAGE_KEY = 'wz.notifications.v1';
const MAX_DELIVERED_IDS = 200;

interface NotificationSourceState {
  intentEnabled: boolean;
  identityKey?: string;
  deliveryGeneration?: number;
  baselineReady: boolean;
  deliveredIds: string[];
  lastSuccessAt?: string;
  unreadCount?: number;
  notificationIdentifier?: string;
}

export interface NotificationState {
  version: 1;
  globalEnabled: boolean;
  hasOptedIn: boolean;
  androidPermissionRequestStarted: boolean;
  sources: Record<NotificationSource, NotificationSourceState>;
}

function emptySourceState(): NotificationSourceState {
  return { intentEnabled: false, baselineReady: false, deliveredIds: [] };
}

export function defaultNotificationState(): NotificationState {
  return {
    version: 1,
    globalEnabled: false,
    hasOptedIn: false,
    androidPermissionRequestStarted: false,
    sources: Object.fromEntries(notificationSources.map((source) => [source, emptySourceState()])) as Record<
      NotificationSource,
      NotificationSourceState
    >
  };
}

function shortString(value: unknown, maxLength = 256) {
  return typeof value === 'string' && value.length <= maxLength ? value : undefined;
}

function normalizeSourceState(source: NotificationSource, value: unknown): NotificationSourceState {
  const data = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const identityKey = shortString(data.identityKey);
  const deliveredIds = Array.isArray(data.deliveredIds)
    ? [...new Set(data.deliveredIds.map((id) => shortString(id)).filter((id): id is string => Boolean(id)))].slice(
        0,
        MAX_DELIVERED_IDS
      )
    : [];
  const unreadCount = Number(data.unreadCount);
  const deliveryGeneration = data.deliveryGeneration;
  return {
    intentEnabled: data.intentEnabled === true,
    ...(identityKey?.startsWith(`${source}:`) ? { identityKey } : {}),
    ...(typeof deliveryGeneration === 'number' && Number.isSafeInteger(deliveryGeneration) && deliveryGeneration > 0
      ? { deliveryGeneration }
      : {}),
    baselineReady: data.baselineReady === true,
    deliveredIds,
    ...(shortString(data.lastSuccessAt) ? { lastSuccessAt: shortString(data.lastSuccessAt) } : {}),
    ...(Number.isInteger(unreadCount) && unreadCount >= 0 ? { unreadCount } : {}),
    ...(shortString(data.notificationIdentifier)
      ? { notificationIdentifier: shortString(data.notificationIdentifier) }
      : {})
  };
}

export function normalizeNotificationState(value: unknown): NotificationState {
  const data = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const rawSources =
    data.sources && typeof data.sources === 'object' && !Array.isArray(data.sources)
      ? (data.sources as Record<string, unknown>)
      : {};
  const hasOptedIn = data.hasOptedIn === true;
  const androidPermissionRequestStarted =
    typeof data.androidPermissionRequestStarted === 'boolean' ? data.androidPermissionRequestStarted : hasOptedIn;
  return {
    version: 1,
    globalEnabled: data.globalEnabled === true,
    hasOptedIn,
    androidPermissionRequestStarted,
    sources: Object.fromEntries(
      notificationSources.map((source) => [source, normalizeSourceState(source, rawSources[source])])
    ) as Record<NotificationSource, NotificationSourceState>
  };
}

export async function loadNotificationState() {
  const raw = await AsyncStorage.getItem(NOTIFICATION_STORAGE_KEY);
  if (raw === null) return defaultNotificationState();
  try {
    return normalizeNotificationState(JSON.parse(raw));
  } catch (error) {
    recordDiagnosticError('app', 'notification-state-load', error);
    throw Object.assign(new Error('通知存储格式损坏'), { reason: 'invalid_response' });
  }
}

export async function saveNotificationState(state: NotificationState) {
  const normalized = normalizeNotificationState(state);
  await AsyncStorage.setItem(NOTIFICATION_STORAGE_KEY, JSON.stringify(normalized));
  return normalized;
}

let mutationQueue = Promise.resolve<unknown>(undefined);

function updateNotificationState(update: (state: NotificationState) => NotificationState | Promise<NotificationState>) {
  const operation = mutationQueue.then(async () => {
    const current = await loadNotificationState();
    const next = await update(current);
    return next === current ? current : saveNotificationState(next);
  });
  mutationQueue = operation.catch(() => undefined);
  return operation;
}

function restartNotificationDelivery(previous: NotificationSourceState) {
  return { deliveryGeneration: (previous.deliveryGeneration ?? 0) + 1, baselineReady: false, deliveredIds: [] };
}

export function setGlobalNotificationIntent(enabled: boolean) {
  return updateNotificationState((current) => {
    const firstOptIn = enabled && !current.hasOptedIn;
    if (!firstOptIn && current.globalEnabled === enabled) return current;
    const sources = { ...current.sources };
    for (const source of notificationSources) {
      const previous = current.sources[source];
      sources[source] = {
        ...previous,
        ...restartNotificationDelivery(previous),
        intentEnabled: firstOptIn || previous.intentEnabled
      };
    }
    return {
      ...current,
      globalEnabled: enabled,
      hasOptedIn: current.hasOptedIn || enabled,
      sources
    };
  });
}

export function markAndroidNotificationPermissionRequestStarted() {
  return updateNotificationState((current) =>
    current.androidPermissionRequestStarted
      ? current
      : {
          ...current,
          androidPermissionRequestStarted: true
        }
  );
}

export function setSourceNotificationIntent(source: NotificationSource, enabled: boolean) {
  return updateNotificationState((current) => {
    const previous = current.sources[source];
    if (previous.intentEnabled === enabled) return current;
    return {
      ...current,
      sources: {
        ...current.sources,
        [source]: { ...previous, ...restartNotificationDelivery(previous), intentEnabled: enabled }
      }
    };
  });
}

export function confirmDisabledNotificationDismissal(
  source: NotificationSource,
  identityKey: string | undefined,
  identifier: string
) {
  return updateNotificationState((current) => {
    const state = current.sources[source];
    if (
      (current.globalEnabled && state.intentEnabled) ||
      state.identityKey !== identityKey ||
      state.notificationIdentifier !== identifier
    )
      return current;
    return {
      ...current,
      sources: { ...current.sources, [source]: { ...state, notificationIdentifier: undefined } }
    };
  });
}

export type NotificationContentDisableGuard = NotificationDeliveryScope & {
  sourceStillDisabled(): Promise<boolean>;
};

export function clearNotificationSourceForContentDisable(
  source: NotificationSource,
  guard?: NotificationContentDisableGuard
) {
  return updateNotificationState(async (current) => {
    const previous = current.sources[source];
    const { identityKey, intentEnabled } = previous;
    if (guard && (!ownsNotificationDelivery(previous, guard) || !(await guard.sourceStillDisabled()))) return current;
    return {
      ...current,
      sources: {
        ...current.sources,
        [source]: {
          intentEnabled,
          ...(identityKey ? { identityKey } : {}),
          ...restartNotificationDelivery(previous)
        }
      }
    };
  });
}

export function advanceNotificationDelivery(
  previous: NotificationSourceState | undefined,
  identityKey: string,
  scannedIds: string[]
) {
  const ids = [...new Set(scannedIds.filter(Boolean))];
  const identityChanged = previous?.identityKey !== identityKey;
  // Older NodeSeek clients persisted timestamp fallbacks before recognizing the site's max_id.
  const legacyNodeSeekMessages =
    identityKey.startsWith('nodeseek:') && previous?.deliveredIds.some((id) => id.startsWith('message:fallback:'));
  const baselineReady = previous?.baselineReady === true && !identityChanged && !legacyNodeSeekMessages;
  const known = new Set(baselineReady ? previous?.deliveredIds || [] : []);
  const newIds = baselineReady ? ids.filter((id) => !known.has(id)) : [];
  return {
    newIds,
    state: {
      ...(previous || emptySourceState()),
      identityKey,
      baselineReady: true,
      deliveredIds: [...new Set([...ids, ...(baselineReady ? previous?.deliveredIds || [] : [])])].slice(
        0,
        MAX_DELIVERED_IDS
      )
    }
  };
}

export interface NotificationDeliveryCommit {
  expectedNewIds: readonly string[];
  previousIdentifier: string | undefined;
  notificationIdentifier: string;
}

export type NotificationDeliveryScope = Readonly<{ identityKey: string; deliveryGeneration: number }>;

export function readNotificationDeliveryScope(state: NotificationState, source: NotificationSource) {
  const sourceState = state.sources[source];
  const { identityKey, intentEnabled, deliveryGeneration = 0 } = sourceState;
  return state.globalEnabled && intentEnabled && identityKey ? { identityKey, deliveryGeneration } : undefined;
}

function ownsNotificationDelivery(
  sourceState: Pick<NotificationSourceState, 'identityKey' | 'deliveryGeneration'>,
  scope: NotificationDeliveryScope
) {
  return (
    sourceState.identityKey === scope.identityKey && (sourceState.deliveryGeneration ?? 0) === scope.deliveryGeneration
  );
}

export function notificationDeliveryAllowed(
  state: NotificationState,
  source: NotificationSource,
  scope: NotificationDeliveryScope
) {
  const current = readNotificationDeliveryScope(state, source);
  return current !== undefined && ownsNotificationDelivery(current, scope);
}

export function notificationDeliveryPlanMatches(
  advanced: ReturnType<typeof advanceNotificationDelivery>,
  plan?: Pick<NotificationDeliveryCommit, 'expectedNewIds' | 'previousIdentifier'>
) {
  if (!plan) return advanced.newIds.length === 0;
  return (
    advanced.state.notificationIdentifier === plan.previousIdentifier &&
    advanced.newIds.length === plan.expectedNewIds.length &&
    advanced.newIds.every((id, index) => id === plan.expectedNewIds[index])
  );
}

type DeliveryRecording =
  | { phase: 'uncommitted'; newIds: string[] }
  | { phase: 'committed'; newIds: string[]; previous: Pick<NotificationSourceState, 'baselineReady' | 'deliveredIds'> };

export function recordNotificationDelivery(
  source: NotificationSource,
  scope: NotificationDeliveryScope,
  scannedIds: string[],
  fields: { lastSuccessAt: string },
  delivery?: NotificationDeliveryCommit
) {
  let recording: DeliveryRecording = { phase: 'uncommitted', newIds: [] };
  const operation = updateNotificationState((current) => {
    const sourceState = current.sources[source];
    if (!notificationDeliveryAllowed(current, source, scope)) return current;
    const advanced = advanceNotificationDelivery(sourceState, scope.identityKey, scannedIds);
    const newIds = advanced.newIds;
    recording = { phase: 'uncommitted', newIds };
    if (!notificationDeliveryPlanMatches(advanced, delivery)) return current;
    recording = {
      phase: 'committed',
      newIds,
      previous: {
        baselineReady: sourceState.baselineReady,
        deliveredIds: sourceState.deliveredIds
      }
    };
    return {
      ...current,
      sources: {
        ...current.sources,
        [source]: {
          ...advanced.state,
          lastSuccessAt: fields.lastSuccessAt,
          ...(delivery ? { notificationIdentifier: delivery.notificationIdentifier } : {})
        }
      }
    };
  });
  return operation.then((state) => {
    const receipt = recording;
    return {
      state,
      newIds: receipt.newIds,
      committed: receipt.phase === 'committed',
      rollback: () =>
        receipt.phase !== 'committed' || !delivery
          ? Promise.resolve(state)
          : updateNotificationState((current) => {
              const sourceState = current.sources[source];
              if (
                !notificationDeliveryAllowed(current, source, scope) ||
                !sourceState.baselineReady ||
                sourceState.notificationIdentifier !== delivery.notificationIdentifier
              ) {
                return current;
              }
              return {
                ...current,
                sources: {
                  ...current.sources,
                  [source]: {
                    ...sourceState,
                    ...receipt.previous,
                    notificationIdentifier: delivery.previousIdentifier
                  }
                }
              };
            })
    };
  });
}

export function resetNotificationSourceIdentity(source: NotificationSource, identityKey?: string) {
  return updateNotificationState((current) => ({
    ...current,
    sources: {
      ...current.sources,
      [source]: {
        ...restartNotificationDelivery(current.sources[source]),
        intentEnabled: current.sources[source].intentEnabled,
        ...(identityKey ? { identityKey } : {})
      }
    }
  }));
}

export function recordNotificationSnapshot(
  source: NotificationSource,
  identityKey: string,
  unreadCount: number,
  lastSuccessAt: string,
  canCommit: () => boolean = () => true
) {
  return updateNotificationState((current) => {
    if (!canCommit()) return current;
    return {
      ...current,
      sources: {
        ...current.sources,
        [source]: {
          ...current.sources[source],
          identityKey,
          unreadCount,
          lastSuccessAt
        }
      }
    };
  });
}
