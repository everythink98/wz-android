export type XiaoyinsiApiScope = 'read' | 'write' | 'notifications';

export type XiaoyinsiStoredCredential = {
  apiKey: string;
  scopes: XiaoyinsiApiScope[];
};

export type XiaoyinsiApiCredentials = {
  apiKey: string;
  clientId: string;
  generation?: number;
  scopes?: XiaoyinsiApiScope[];
};

const LEGACY_SCOPES: XiaoyinsiApiScope[] = ['read', 'write'];
const VALID_SCOPES = new Set<XiaoyinsiApiScope>(['read', 'write', 'notifications']);

function cleanScopes(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(value.filter((scope): scope is XiaoyinsiApiScope => VALID_SCOPES.has(scope as XiaoyinsiApiScope)))
  ];
}

export function parseStoredXiaoyinsiCredential(
  value: string | null | undefined
): XiaoyinsiStoredCredential | undefined {
  const raw = value?.trim() || '';
  if (!raw) return undefined;
  if (!raw.startsWith('{')) return { apiKey: raw, scopes: [...LEGACY_SCOPES] };
  try {
    const parsed = JSON.parse(raw) as { version?: unknown; apiKey?: unknown; scopes?: unknown };
    const apiKey = typeof parsed.apiKey === 'string' ? parsed.apiKey.trim() : '';
    const scopes = cleanScopes(parsed.scopes);
    return parsed.version === 1 && apiKey && scopes.length ? { apiKey, scopes } : undefined;
  } catch {
    return undefined;
  }
}

export function serializeXiaoyinsiCredential(credential: XiaoyinsiStoredCredential) {
  const apiKey = credential.apiKey.trim();
  const scopes = cleanScopes(credential.scopes);
  if (!apiKey || !scopes.length) throw new Error('小隐寺授权信息不完整');
  return JSON.stringify({ version: 1, apiKey, scopes });
}

export function xiaoyinsiCredentialsHaveScope(
  credentials: Pick<XiaoyinsiApiCredentials, 'scopes'> | XiaoyinsiStoredCredential | undefined,
  scope: XiaoyinsiApiScope
) {
  return (credentials?.scopes || LEGACY_SCOPES).includes(scope);
}

export function cleanCredentials(credentials?: XiaoyinsiApiCredentials) {
  const apiKey = credentials?.apiKey.trim() || '';
  const clientId = credentials?.clientId.trim() || '';
  return apiKey && clientId
    ? { apiKey, clientId, ...(credentials?.scopes ? { scopes: cleanScopes(credentials.scopes) } : {}) }
    : undefined;
}

export function requestHeaders(credentials?: XiaoyinsiApiCredentials) {
  const clean = cleanCredentials(credentials);
  return {
    Accept: 'application/json',
    ...(clean
      ? {
          'User-Api-Key': clean.apiKey,
          'User-Api-Client-Id': clean.clientId
        }
      : {})
  };
}
