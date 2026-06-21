export function isLinuxDoLoginCheckUnknown(value: { ok?: boolean; loginRequired?: boolean; message?: string } | undefined) {
  return Boolean(value && !value.ok && !value.loginRequired);
}
