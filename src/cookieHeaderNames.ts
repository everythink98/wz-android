export function cookieNamesFromHeader(header?: string | null) {
  const names = new Set<string>();
  for (const segment of String(header || '').split(';')) {
    const separator = segment.indexOf('=');
    if (separator <= 0) {
      continue;
    }
    const name = segment.slice(0, separator).trim();
    const value = segment.slice(separator + 1).trim();
    if (name && value) {
      names.add(name);
    }
  }
  return [...names].sort((left, right) => left.localeCompare(right));
}
