export type XiaoyinsiApiCredentials = {
  apiKey: string;
  clientId: string;
};

export function cleanCredentials(credentials?: XiaoyinsiApiCredentials) {
  const apiKey = credentials?.apiKey.trim() || '';
  const clientId = credentials?.clientId.trim() || '';
  return apiKey && clientId ? { apiKey, clientId } : undefined;
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
