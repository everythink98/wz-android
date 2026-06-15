import { describe, expect, it } from 'vitest';
import { readAppRuntimeSource } from './sourceTestUtils';

const removedBlockLabel = (target: string) => `屏${''}蔽${target}`;

describe('Android topic detail actions', () => {
  it('does not expose block author or node buttons in the topic detail screen', () => {
    const appSource = readAppRuntimeSource();

    expect(appSource).not.toContain(`label="${removedBlockLabel('作者')}"`);
    expect(appSource).not.toContain(`label="${removedBlockLabel('节点')}"`);
  });
});
