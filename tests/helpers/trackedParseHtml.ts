import { vi, type Mock } from 'vitest';

type ParseHtml = typeof import('../../src/domain/forum/html').parseHtml;

export async function withTrackedParseHtml<T>(
  run: (parseHtml: Mock<ParseHtml>, actualParseHtml: ParseHtml) => T | Promise<T>
): Promise<T> {
  vi.resetModules();
  const actualHtml = await vi.importActual<typeof import('../../src/domain/forum/html')>('@/domain/forum/html');
  const parseHtml = vi.fn(actualHtml.parseHtml);
  vi.doMock('@/domain/forum/html', () => ({ ...actualHtml, parseHtml }));
  try {
    return await run(parseHtml, actualHtml.parseHtml);
  } finally {
    vi.doUnmock('@/domain/forum/html');
    vi.resetModules();
  }
}
