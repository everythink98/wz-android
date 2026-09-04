import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const patch = readFileSync(join(process.cwd(), 'patches', 'expo-image+57.0.4.patch'), 'utf8');

describe('expo-image resize patch', () => {
  it('defers resize rerenders and drops stale recycled-view work', () => {
    expect(patch).toContain('private var resizeRerenderGeneration = 0');
    expect(patch).toContain('val generation = ++resizeRerenderGeneration');
    expect(patch).toContain('post {');
    expect(patch).toContain('generation != resizeRerenderGeneration ||');
    expect(patch).toContain('!isAttachedToWindow ||');
    expect(patch).toContain('width != w ||');
    expect(patch).toContain('height != h');
    expect(patch).toContain('rerenderIfNeeded(shouldRerenderBecauseOfResize = true)');
  });
});
