import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const rootDir = path.resolve(__dirname, '..');

function readSource(...parts: string[]) {
  return readFileSync(path.join(rootDir, ...parts), 'utf8');
}

describe('feed pagination guard', () => {
  it('passes the active feed cursor when loading more than the first page', () => {
    const source = readSource('src', 'app', 'AppRoot.tsx');

    expect(source).toContain('loadFeed({ page: activeFeedState.page + 1, cursor: activeFeedState.nextCursor, nocache: true });');
    expect(source).not.toContain("cursor: feedSource === 'all' ? activeFeedState.nextCursor : undefined");
  });

  it('starts from the first page when switching feed sources', () => {
    const source = readSource('src', 'app', 'useFeedController.ts');

    expect(source).toContain('if (source !== feedSource) {');
    expect(source).toContain('[source]: createFeedSourceState()');
  });
});
