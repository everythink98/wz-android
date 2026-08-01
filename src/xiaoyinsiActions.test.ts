import { describe, expect, it } from 'vitest';

import { buildXiaoyinsiActionRequest } from './xiaoyinsiActions';

describe('小隐寺 Discourse action extensions', () => {
  it('[REG-XIAOYINSI-003] removes a topic bookmark without a bookmark id', () => {
    expect(
      buildXiaoyinsiActionRequest({
        type: 'set-bookmark',
        targetId: 42,
        targetType: 'Topic',
        active: false
      })
    ).toEqual({
      path: '/t/42/remove_bookmarks',
      method: 'PUT',
      headers: {},
      body: undefined
    });
  });

  it('delegates standard actions to the shared Discourse contract', () => {
    expect(buildXiaoyinsiActionRequest({ type: 'set-like', postId: 101, active: true })).toEqual({
      path: '/post_actions',
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'id=101&post_action_type_id=2'
    });
  });
});
