export function androidShareDidNotStart(error: unknown): boolean {
  return error !== null && typeof error === 'object' && 'code' in error && error.code === 'ERR_SHARING_NOT_STARTED';
}
