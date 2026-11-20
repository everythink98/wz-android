import {
  isNotificationSource,
  isSessionSource,
  sourceCatalog,
  sourceValues,
  type NotificationSource,
  type SessionSource,
  type Source
} from '@/domain/forum/sourceCatalog';

export interface ContentSourcePreference {
  source: Source;
  enabled: boolean;
}

export type ContentSourceEdit =
  | { kind: 'set-source-enabled'; source: Source; enabled: boolean }
  | { kind: 'move-source'; source: Source; offset: -1 | 1 }
  | { kind: 'drop-source'; source: Source; target: Source; fromOrder: readonly Source[] };

export function applyContentSourceEdit(preferences: ContentSourcePreference[], edit: ContentSourceEdit) {
  const from = preferences.findIndex(({ source }) => source === edit.source);
  const moving = preferences[from];
  if (!moving) return preferences;
  if (edit.kind === 'set-source-enabled') {
    if (moving.enabled === edit.enabled) return preferences;
    return preferences.map((preference) =>
      preference.source === edit.source ? { ...preference, enabled: edit.enabled } : preference
    );
  }
  if (
    edit.kind === 'drop-source' &&
    (preferences.length !== edit.fromOrder.length ||
      preferences.some(({ source }, index) => source !== edit.fromOrder[index]))
  )
    return preferences;
  const to =
    edit.kind === 'move-source' ? from + edit.offset : preferences.findIndex(({ source }) => source === edit.target);
  if (!preferences[to] || to === from) return preferences;
  const next = [...preferences];
  next.splice(from, 1);
  next.splice(to, 0, moving);
  return next;
}

const initialDefaultSources: Source[] = ['v2ex', 'linuxdo', 'nodeseek', 'yaohuo'];
const defaultSources = [
  ...initialDefaultSources,
  ...sourceValues.filter((source) => !initialDefaultSources.includes(source))
];

export function defaultContentSourcePreferences(): ContentSourcePreference[] {
  return defaultSources.map((source) => ({ source, enabled: true }));
}

export function normalizeContentSourcePreferences(value: unknown): ContentSourcePreference[] {
  const preferences = Array.isArray(value) ? value : [];
  const seen = new Set<Source>();
  const normalized: ContentSourcePreference[] = [];

  for (const preference of preferences) {
    if (!preference || typeof preference !== 'object' || Array.isArray(preference)) {
      continue;
    }
    const { enabled, source } = preference as Record<string, unknown>;
    if (
      typeof source !== 'string' ||
      !Object.prototype.hasOwnProperty.call(sourceCatalog, source) ||
      typeof enabled !== 'boolean'
    ) {
      continue;
    }
    const typedSource = source as Source;
    if (seen.has(typedSource)) {
      continue;
    }
    seen.add(typedSource);
    normalized.push({ source: typedSource, enabled });
  }

  for (const source of defaultSources) {
    if (!seen.has(source)) {
      normalized.push({ source, enabled: true });
    }
  }
  return normalized;
}

export function projectContentSourcePreferences(
  value: unknown,
  settled = true
): {
  orderedSources: Source[];
  enabledSources: Source[];
  sessionSources: SessionSource[];
  notificationSources: NotificationSource[];
} {
  if (!settled) {
    return {
      orderedSources: [],
      enabledSources: [],
      sessionSources: [],
      notificationSources: []
    };
  }
  const orderedSources = normalizeContentSourcePreferences(value);
  const enabledSources = orderedSources
    .filter((preference) => preference.enabled)
    .map((preference) => preference.source);
  return {
    orderedSources: orderedSources.map((preference) => preference.source),
    enabledSources,
    sessionSources: enabledSources.filter(isSessionSource),
    notificationSources: enabledSources.filter(isNotificationSource)
  };
}

export function canonicalEnabledSourcesKey(value: unknown) {
  const enabledSources = new Set(
    normalizeContentSourcePreferences(value)
      .filter((preference) => preference.enabled)
      .map((preference) => preference.source)
  );
  return sourceValues.filter((source) => enabledSources.has(source)).join(',');
}
