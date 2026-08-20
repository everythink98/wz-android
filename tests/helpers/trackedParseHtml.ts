import { vi, type Mock } from 'vitest';

type ParseHtml = typeof import('../../src/domain/forum/html').parseHtml;
type TrackedParseHtml = (value: Parameters<ParseHtml>[0], mode?: 'document' | 'forum-content') => ReturnType<ParseHtml>;
type DomParse = typeof import('node-html-parser').parse;

export async function withTrackedDomParse<T>(run: (parse: Mock<DomParse>) => T | Promise<T>): Promise<T> {
  vi.resetModules();
  const actualParser = await vi.importActual<typeof import('node-html-parser')>('node-html-parser');
  const parse = vi.fn(actualParser.parse);
  vi.doMock('node-html-parser', () => ({ ...actualParser, parse }));
  try {
    return await run(parse as Mock<DomParse>);
  } finally {
    vi.doUnmock('node-html-parser');
    vi.resetModules();
  }
}

export async function withTrackedParseHtml<T>(
  run: (parseHtml: Mock<ParseHtml>, actualParseHtml: ParseHtml) => T | Promise<T>
): Promise<T> {
  vi.resetModules();
  const actualHtml = await vi.importActual<typeof import('../../src/domain/forum/html')>('@/domain/forum/html');
  const actualTrackedParseHtml: TrackedParseHtml = (value, mode = 'document') =>
    mode === 'forum-content' ? actualHtml.parseForumContentHtml(value) : actualHtml.parseHtml(value);
  const parseHtml = vi.fn(actualTrackedParseHtml);
  vi.doMock('@/domain/forum/html', () => ({
    ...actualHtml,
    parseForumContentHtml: (value: unknown) => parseHtml(value, 'forum-content'),
    parseHtml: (value: unknown) => parseHtml(value, 'document')
  }));
  try {
    return await run(parseHtml as unknown as Mock<ParseHtml>, actualTrackedParseHtml as unknown as ParseHtml);
  } finally {
    vi.doUnmock('@/domain/forum/html');
    vi.resetModules();
  }
}
