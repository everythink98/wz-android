export function isSvgContentType(value: string | null) {
  return /(?:^|;|\s)(?:image|application)\/svg\+xml(?:;|\s|$)/i.test(value || '');
}

export function positiveHeaderNumber(value: string | null) {
  const parsed = value ? Number(value) : 0;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}
