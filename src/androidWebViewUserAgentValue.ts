export function androidWebViewUserAgentFromReactNativeImport(mod: any) {
  const nativeModules = mod?.NativeModules || mod?.default?.NativeModules;
  return String(nativeModules?.NetworkProxyModule?.defaultWebViewUserAgent || '')
    .replace(/\s+/g, ' ')
    .trim();
}
