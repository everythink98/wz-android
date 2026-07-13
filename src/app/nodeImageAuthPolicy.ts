export async function ensureNodeImageApiKeyForRequest(
  options: { forceRefresh?: boolean; clearOnCancel?: boolean } | undefined,
  dependencies: {
    clearApiKey: () => Promise<void>;
    loadApiKey: () => Promise<string | null>;
    openAuthorization: () => Promise<string | null>;
    setSaved: (saved: boolean) => void;
  }
) {
  if (!options?.forceRefresh) {
    const apiKey = await dependencies.loadApiKey();
    if (apiKey) {
      dependencies.setSaved(true);
      return apiKey;
    }
  }
  const apiKey = await dependencies.openAuthorization();
  if (!apiKey && options?.clearOnCancel) {
    await dependencies.clearApiKey();
    dependencies.setSaved(false);
  }
  return apiKey;
}
