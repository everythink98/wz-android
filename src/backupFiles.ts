export function safeFileName(value: string, extension: string, timestamp = Date.now()) {
  const clean = value.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 72);
  return `${clean || 'forum-reader'}-${timestamp}.${extension}`;
}
