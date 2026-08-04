import AsyncStorage from '@react-native-async-storage/async-storage';
import { notificationSources, type NotificationSource } from '@/domain/forum/sourceCatalog';

export const NOTIFICATION_STORAGE_KEY = 'wz.notifications.v1';
const MAX_DELIVERED_IDS = 200;
export const initialNotificationOptInSources = [
  'nodeseek',
  'linuxdo',
  'yaohuo',
  'xiaoyinsi'
] as const satisfies readonly NotificationSource[];

export interface NotificationSourceState {
  intentEnabled: boolean;
  identityKey?: string;
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
  return {
    intentEnabled: data.intentEnabled === true,
    ...(identityKey?.startsWith(`${source}:`) ? { identityKey } : {}),
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
  return {
    version: 1,
    globalEnabled: data.globalEnabled === true,
    hasOptedIn: data.hasOptedIn === true,
    sources: Object.fromEntries(
      notificationSources.map((source) => [source, normalizeSourceState(source, rawSources[source])])
    ) as Record<NotificationSource, NotificationSourceState>
  };
}

export async function loadNotificationState() {
  const raw = await AsyncStorage.getItem(NOTIFICATION_STORAGE_KEY);
  if (!raw) return defaultNotificationState();
  try {
    return normalizeNotificationState(JSON.parse(raw));
  } catch {
    return defaultNotificationState();
  }
}

export async function saveNotificationState(state: NotificationState) {
  const normalized = normalizeNotificationState(state);
  await AsyncStorage.setItem(NOTIFICATION_STORAGE_KEY, JSON.stringify(normalized));
  return normalized;
}

let mutationQueue = Promise.resolve<unknown>(undefined);

function updateNotificationState(update: (state: NotificationState) => NotificationState) {
  const operation = mutationQueue.then(async () => saveNotificationState(update(await loadNotificationState())));
  mutationQueue = operation.catch(() => undefined);
  return operation;
}

export function setGlobalNotificationIntent(enabled: boolean) {
  return updateNotificationState((current) => {
    const firstOptIn = enabled && !current.hasOptedIn;
    const sources = { ...current.sources };
    if (firstOptIn) {
      for (const source of initialNotificationOptInSources) {
        sources[source] = { ...sources[source], intentEnabled: true };
      }
    } else if (!enabled) {
      for (const source of notificationSources) {
        sources[source] = {
          ...sources[source],
          baselineReady: false,
          deliveredIds: [],
          notificationIdentifier: undefined
        };
      }
    }
    return {
      ...current,
      globalEnabled: enabled,
      hasOptedIn: current.hasOptedIn || enabled,
      sources
    };
  });
}

export function setSourceNotificationIntent(source: NotificationSource, enabled: boolean) {
  return updateNotificationState((current) => ({
    ...current,
    sources: {
      ...current.sources,
      [source]: {
        ...current.sources[source],
        intentEnabled: enabled,
        ...(!enabled
          ? { baselineReady: false, deliveredIds: [], notificationIdentifier: undefined }
          : current.sources[source].intentEnabled
            ? {}
            : { baselineReady: false, deliveredIds: [] })
      }
    }
  }));
}

export function advanceNotificationDelivery(
  previous: NotificationSourceState | undefined,
  identityKey: string,
  scannedIds: string[]
) {
  const ids = [...new Set(scannedIds.filter(Boolean))];
  const identityChanged = previous?.identityKey !== identityKey;
  const baselineReady = previous?.baselineReady === true && !identityChanged;
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

export function recordNotificationDelivery(
  source: NotificationSource,
  identityKey: string,
  scannedIds: string[],
  fields: { lastSuccessAt: string; unreadCount: number }
) {
  let newIds: string[] = [];
  const operation = updateNotificationState((current) => {
    const sourceState = current.sources[source];
    if (!current.globalEnabled || !sourceState.intentEnabled || sourceState.identityKey !== identityKey) return current;
    const advanced = advanceNotificationDelivery(sourceState, identityKey, scannedIds);
    newIds = advanced.newIds;
    return {
      ...current,
      sources: {
        ...current.sources,
        [source]: {
          ...advanced.state,
          lastSuccessAt: fields.lastSuccessAt,
          unreadCount: fields.unreadCount
        }
      }
    };
  });
  return operation.then((state) => ({
    state,
    newIds,
    rollback: () =>
      updateNotificationState((current) => {
        const sourceState = current.sources[source];
        if (sourceState.identityKey !== identityKey || !newIds.length) return current;
        const released = new Set(newIds);
        return {
          ...current,
          sources: {
            ...current.sources,
            [source]: {
              ...sourceState,
              deliveredIds: sourceState.deliveredIds.filter((id) => !released.has(id))
            }
          }
        };
      })
  }));
}

export function resetNotificationSourceIdentity(source: NotificationSource, identityKey?: string) {
  return updateNotificationState((current) => ({
    ...current,
    sources: {
      ...current.sources,
      [source]: {
        ...emptySourceState(),
        intentEnabled: current.sources[source].intentEnabled,
        ...(identityKey ? { identityKey } : {})
      }
    }
  }));
}

export function setNotificationIdentifier(
  source: NotificationSource,
  identityKey: string,
  notificationIdentifier: string
) {
  return updateNotificationState((current) => {
    const sourceState = current.sources[source];
    if (!current.globalEnabled || !sourceState.intentEnabled || sourceState.identityKey !== identityKey) return current;
    return {
      ...current,
      sources: {
        ...current.sources,
        [source]: {
          ...sourceState,
          notificationIdentifier
        }
      }
    };
  });
}

export function recordNotificationSnapshot(
  source: NotificationSource,
  identityKey: string,
  unreadCount: number,
  lastSuccessAt: string
) {
  return updateNotificationState((current) => ({
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
  }));
}
