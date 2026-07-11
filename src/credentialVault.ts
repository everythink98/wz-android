import * as SecureStore from 'expo-secure-store';

export type CredentialSite = 'nodeseek' | 'linuxdo' | 'yaohuo';
export type CredentialProtection = 'biometric' | 'device';

export type CredentialSummary =
  | {
    site: CredentialSite;
    state: 'missing';
    hasCredential: false;
    protection: null;
  }
  | {
    site: CredentialSite;
    state: 'invalidated';
    hasCredential: false;
    protection: null;
  }
  | {
    site: CredentialSite;
    state: 'saved';
    hasCredential: true;
    protection: CredentialProtection;
  };

export type CredentialSummaries = Record<CredentialSite, CredentialSummary>;

export type SavedCredential = {
  site: CredentialSite;
  account: string;
  password: string;
  updatedAt: number;
};

export type CredentialVaultErrorCode =
  | 'biometric-unavailable'
  | 'invalid-input'
  | 'invalidated';

export class CredentialVaultError extends Error {
  constructor(
    readonly code: CredentialVaultErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'CredentialVaultError';
  }
}

type StoredCredential = SavedCredential & { version: 1 };
type CredentialSlot = 0 | 1;
type CredentialValueSlot = CredentialSlot | 'legacy';
type StoredSummary = {
  version: 1;
  site: CredentialSite;
  protection: CredentialProtection;
  state?: 'saved' | 'invalidated';
  slot?: CredentialSlot;
  cleanupSlots?: CredentialValueSlot[];
};

const SITES = new Set<CredentialSite>(['nodeseek', 'linuxdo', 'yaohuo']);
const MAX_CREDENTIAL_BYTES = 1900;
const siteOperationTails = new Map<CredentialSite, Promise<void>>();

export function emptyCredentialSummaries(): CredentialSummaries {
  return Object.fromEntries([...SITES].map((site) => [site, {
    site,
    state: 'missing',
    hasCredential: false,
    protection: null
  }])) as CredentialSummaries;
}

function assertSite(site: CredentialSite) {
  if (!SITES.has(site)) {
    throw new CredentialVaultError('invalid-input', '不支持该网站的登录信息');
  }
}

function storageKey(site: CredentialSite, kind: 'value' | 'value.0' | 'value.1' | 'summary') {
  assertSite(site);
  return `site-login-credential.${site}.${kind}`;
}

function valueStorageKey(site: CredentialSite, slot: CredentialValueSlot = 'legacy') {
  return storageKey(site, slot === 'legacy' ? 'value' : `value.${slot}`);
}

function missingSummary(site: CredentialSite): CredentialSummary {
  return { site, state: 'missing', hasCredential: false, protection: null };
}

function parseStoredSummary(site: CredentialSite, raw: string | null): StoredSummary | null {
  if (!raw) {
    return null;
  }
  try {
    const value = JSON.parse(raw) as Partial<StoredSummary>;
    if (value.version === 1
      && value.site === site
      && (value.protection === 'biometric' || value.protection === 'device')
      && (value.state === undefined || value.state === 'saved' || value.state === 'invalidated')
      && (value.slot === undefined || value.slot === 0 || value.slot === 1)
      && (value.cleanupSlots === undefined || (Array.isArray(value.cleanupSlots)
        && value.cleanupSlots.every((slot) => slot === 'legacy' || slot === 0 || slot === 1)))) {
      return {
        version: 1,
        site,
        protection: value.protection,
        ...(value.state ? { state: value.state } : {}),
        ...(value.slot === undefined ? {} : { slot: value.slot }),
        ...(value.cleanupSlots === undefined ? {} : { cleanupSlots: [...new Set(value.cleanupSlots)] })
      };
    }
  } catch {
    // Invalid local metadata must never expose or guess a credential.
  }
  return null;
}

function summaryFromStored(site: CredentialSite, value: StoredSummary | null): CredentialSummary {
  if (!value) {
    return missingSummary(site);
  }
  if (value.state === 'invalidated') {
    return { site, state: 'invalidated', hasCredential: false, protection: null };
  }
  return { site, state: 'saved', hasCredential: true, protection: value.protection };
}

function parseCredential(site: CredentialSite, raw: string): SavedCredential | null {
  try {
    const value = JSON.parse(raw) as Partial<StoredCredential>;
    if (value.version === 1
      && value.site === site
      && typeof value.account === 'string'
      && value.account.length > 0
      && typeof value.password === 'string'
      && value.password.length > 0
      && typeof value.updatedAt === 'number'
      && Number.isFinite(value.updatedAt)
      && value.updatedAt > 0) {
      return {
        site,
        account: value.account,
        password: value.password,
        updatedAt: value.updatedAt
      };
    }
  } catch {
    // Corrupt protected values are handled like invalidated keys below.
  }
  return null;
}

function secureOptions(protection: CredentialProtection, prompt: string) {
  return protection === 'biometric'
    ? { requireAuthentication: true, authenticationPrompt: prompt }
    : undefined;
}

async function getSummary(site: CredentialSite): Promise<CredentialSummary> {
  return summaryFromStored(site, await getStoredSummary(site));
}

async function finishPendingCleanup(site: CredentialSite, summary: StoredSummary) {
  const activeSlot: CredentialValueSlot | null = summary.state === 'invalidated'
    ? null
    : summary.slot ?? 'legacy';
  const pendingSlots = summary.cleanupSlots?.filter((slot) => slot !== activeSlot) ?? [];
  if (!pendingSlots.length) {
    return summary;
  }
  const remainingSlots: CredentialValueSlot[] = [];
  for (const slot of pendingSlots) {
    try {
      await SecureStore.deleteItemAsync(valueStorageKey(site, slot));
    } catch {
      remainingSlots.push(slot);
    }
  }
  if (remainingSlots.length === pendingSlots.length) {
    return summary;
  }
  const { cleanupSlots: _, ...summaryWithoutCleanup } = summary;
  const cleanedSummary: StoredSummary = {
    ...summaryWithoutCleanup,
    ...(remainingSlots.length ? { cleanupSlots: remainingSlots } : {})
  };
  try {
    await SecureStore.setItemAsync(storageKey(site, 'summary'), JSON.stringify(cleanedSummary));
    return cleanedSummary;
  } catch {
    return summary;
  }
}

async function getStoredSummary(site: CredentialSite): Promise<StoredSummary | null> {
  assertSite(site);
  const summary = parseStoredSummary(site, await SecureStore.getItemAsync(storageKey(site, 'summary')));
  return summary ? finishPendingCleanup(site, summary) : null;
}

async function save(
  site: CredentialSite,
  input: { account: string; password: string; allowUnprotected?: boolean }
): Promise<CredentialSummary> {
  assertSite(site);
  const account = typeof input?.account === 'string' ? input.account.trim() : '';
  const password = typeof input?.password === 'string' ? input.password : '';
  if (!account || !password) {
    throw new CredentialVaultError('invalid-input', '账号和密码不能为空');
  }

  const protection: CredentialProtection = SecureStore.canUseBiometricAuthentication()
    ? 'biometric'
    : 'device';
  if (protection === 'device' && input.allowUnprotected !== true) {
    throw new CredentialVaultError(
      'biometric-unavailable',
      '当前设备无法使用身份安全识别，请确认后再使用本机加密保存'
    );
  }

  const record: StoredCredential = {
    version: 1,
    site,
    account,
    password,
    updatedAt: Date.now()
  };
  const serialized = JSON.stringify(record);
  if (new TextEncoder().encode(serialized).byteLength > MAX_CREDENTIAL_BYTES) {
    throw new CredentialVaultError('invalid-input', '账号或密码过长');
  }

  const previousSummary = await getStoredSummary(site);
  const slot: CredentialSlot = previousSummary?.slot === 0 ? 1 : 0;
  const stagedValueKey = valueStorageKey(site, slot);
  const invalidatedSummary: StoredSummary = { version: 1, site, protection, state: 'invalidated', slot };
  const pendingSummaryBase = previousSummary ?? invalidatedSummary;
  const pendingSummary: StoredSummary = {
    ...pendingSummaryBase,
    cleanupSlots: [...new Set([...(pendingSummaryBase.cleanupSlots ?? []), slot])]
  };
  const previousSlot: CredentialValueSlot | undefined = previousSummary
    ? previousSummary.slot ?? 'legacy'
    : undefined;
  const cleanupSlots = [...new Set([
    ...(previousSummary?.cleanupSlots ?? []),
    ...(previousSlot === undefined ? [] : [previousSlot])
  ])].filter((pendingSlot) => pendingSlot !== slot);
  const storedSummary: StoredSummary = {
    version: 1,
    site,
    protection,
    state: 'saved',
    slot,
    ...(cleanupSlots.length ? { cleanupSlots } : {})
  };
  await SecureStore.setItemAsync(storageKey(site, 'summary'), JSON.stringify(pendingSummary));
  try {
    await SecureStore.setItemAsync(
      stagedValueKey,
      serialized,
      secureOptions(protection, '保存登录信息')
    );
    await SecureStore.setItemAsync(
      storageKey(site, 'summary'),
      JSON.stringify(storedSummary)
    );
  } catch (error) {
    try {
      await SecureStore.deleteItemAsync(stagedValueKey);
      if (previousSummary) {
        await SecureStore.setItemAsync(storageKey(site, 'summary'), JSON.stringify(previousSummary));
      } else {
        await SecureStore.deleteItemAsync(storageKey(site, 'summary'));
      }
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], '保存登录信息失败，且清理未完成');
    }
    throw error;
  }
  await finishPendingCleanup(site, storedSummary);
  return {
    site,
    state: 'saved',
    hasCredential: true,
    protection
  };
}

async function markInvalidated(site: CredentialSite, storedSummary: StoredSummary) {
  const activeSlot: CredentialValueSlot = storedSummary.slot ?? 'legacy';
  let activeCleanupFailed = false;
  await SecureStore.deleteItemAsync(
    valueStorageKey(site, activeSlot),
    secureOptions(storedSummary.protection, '清理已失效的登录信息')
  ).catch(() => { activeCleanupFailed = true; });
  const cleanupSlots = [...new Set([
    ...(storedSummary.cleanupSlots ?? []),
    ...(activeCleanupFailed ? [activeSlot] : [])
  ])];
  const summary: StoredSummary = {
    version: 1,
    site,
    protection: storedSummary.protection,
    state: 'invalidated',
    ...(storedSummary.slot === undefined ? {} : { slot: storedSummary.slot }),
    ...(cleanupSlots.length ? { cleanupSlots } : {})
  };
  await SecureStore.setItemAsync(storageKey(site, 'summary'), JSON.stringify(summary));
}

async function readForFill(site: CredentialSite): Promise<SavedCredential | null> {
  const storedSummary = await getStoredSummary(site);
  const summary = summaryFromStored(site, storedSummary);
  if (summary.state === 'invalidated') {
    throw new CredentialVaultError('invalidated', '保存的登录信息已失效，请重新保存');
  }
  if (!summary.hasCredential) {
    return null;
  }
  const raw = await SecureStore.getItemAsync(
    valueStorageKey(site, storedSummary?.slot ?? 'legacy'),
    secureOptions(summary.protection, '使用保存的登录信息')
  );
  const credential = raw ? parseCredential(site, raw) : null;
  if (credential) {
    return credential;
  }

  await markInvalidated(site, storedSummary!);
  throw new CredentialVaultError('invalidated', '保存的登录信息已失效，请重新保存');
}

async function remove(site: CredentialSite): Promise<void> {
  const storedSummary = await getStoredSummary(site);
  const summary = summaryFromStored(site, storedSummary);
  if (summary.hasCredential && summary.protection === 'biometric') {
    await SecureStore.getItemAsync(
      valueStorageKey(site, storedSummary?.slot ?? 'legacy'),
      secureOptions(summary.protection, '删除保存的登录信息')
    );
  }
  await SecureStore.deleteItemAsync(valueStorageKey(site));
  await SecureStore.deleteItemAsync(valueStorageKey(site, 0));
  await SecureStore.deleteItemAsync(valueStorageKey(site, 1));
  await SecureStore.deleteItemAsync(storageKey(site, 'summary'));
}

function runExclusive<T>(site: CredentialSite, operation: () => Promise<T>): Promise<T> {
  assertSite(site);
  const result = (siteOperationTails.get(site) ?? Promise.resolve())
    .then(operation, operation);
  const tail = result.then(() => undefined, () => undefined);
  siteOperationTails.set(site, tail);
  void tail.then(() => {
    if (siteOperationTails.get(site) === tail) {
      siteOperationTails.delete(site);
    }
  });
  return result;
}

export const credentialVault = {
  getSummary: (site: CredentialSite) => runExclusive(site, () => getSummary(site)),
  save: (
    site: CredentialSite,
    input: { account: string; password: string; allowUnprotected?: boolean }
  ) => runExclusive(site, () => save(site, input)),
  readForFill: (site: CredentialSite) => runExclusive(site, () => readForFill(site)),
  delete: (site: CredentialSite) => runExclusive(site, () => remove(site))
};
