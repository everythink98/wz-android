export function isYaohuoLoginRequiredError(error: unknown) {
  return Boolean(
    error &&
    typeof error === 'object' &&
    'loginRequired' in error &&
    (error as { loginRequired?: unknown }).loginRequired
  );
}

export function isYaohuoLoginExpiredError(error: unknown) {
  return Boolean(isYaohuoLoginRequiredError(error) && (error as { reason?: unknown }).reason === 'expired');
}

export function isLinuxDoCloudflareError(error: unknown) {
  return Boolean(
    error &&
    typeof error === 'object' &&
    (error as { source?: unknown }).source === 'linuxdo' &&
    (error as { reason?: unknown }).reason === 'cloudflare'
  );
}

export function isNodeSeekCloudflareError(error: unknown) {
  return Boolean(
    error &&
    typeof error === 'object' &&
    (error as { source?: unknown }).source === 'nodeseek' &&
    (error as { reason?: unknown }).reason === 'cloudflare'
  );
}
