export function isLinuxDoCloudflareError(error: unknown) {
  return Boolean(
    error &&
    typeof error === 'object' &&
    (error as { source?: unknown }).source === 'linuxdo' &&
    (error as { reason?: unknown }).reason === 'cloudflare'
  );
}
