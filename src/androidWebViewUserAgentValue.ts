export function androidWebViewUserAgentFromReactNativeImport(mod: any) {
  const nativeModules = mod?.NativeModules || mod?.default?.NativeModules;
  return String(nativeModules?.LinuxDoCookieModule?.defaultUserAgent || '')
    .replace(/\s+/g, ' ')
    .trim();
}
