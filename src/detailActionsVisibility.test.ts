import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Android topic detail actions', () => {
  it('does not expose block author or node buttons in the topic detail screen', () => {
    const appSource = readFileSync(join(process.cwd(), 'android-app', 'App.tsx'), 'utf8');

    expect(appSource).not.toContain('label="屏蔽作者"');
    expect(appSource).not.toContain('label="屏蔽节点"');
  });
});
