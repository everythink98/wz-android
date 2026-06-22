import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const topicActionsController = readFileSync('src/app/useTopicActionsController.ts', 'utf8');

describe('topic action auth guards', () => {
  it('does not mark linux.do as expired before an unauthenticated action request is sent', () => {
    const unauthenticatedBranches = topicActionsController.match(
      /if \(!canUseLinuxDoActions\) \{[\s\S]*?authActionMessageForSource\('linuxdo'[\s\S]*?return false;\s*}/g
    ) || [];

    expect(unauthenticatedBranches).toHaveLength(2);
    for (const branch of unauthenticatedBranches) {
      expect(branch).not.toContain('updateLinuxDoSession');
    }
  });
});
