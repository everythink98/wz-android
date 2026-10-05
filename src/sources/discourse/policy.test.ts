import { describe, expect, it } from 'vitest';
import { discoursePostPolicy } from './policy';

const post = {
  id: 777,
  cooked:
    '<div class="policy" data-version="3" data-accept="已阅读" data-revoke="取消确认"><p>我已知晓此更新内容</p></div>',
  policy_can_accept: true,
  policy_can_revoke: false,
  policy_accepted: false,
  policy_revoked: false
};

describe('Discourse post policy', () => {
  it('preserves the original labels and authoritative permissions independently of notification read state', () => {
    expect(discoursePostPolicy({ ...post, read: true })).toEqual({
      postId: '777',
      version: '3',
      acceptLabel: '已阅读',
      revokeLabel: '取消确认',
      accepted: false,
      revoked: false,
      canAccept: true,
      canRevoke: false
    });
    expect(
      discoursePostPolicy({ ...post, policy_accepted: true, policy_can_accept: false, policy_can_revoke: true })
    ).toMatchObject({ accepted: true, canAccept: false, canRevoke: true });
    expect(discoursePostPolicy({ ...post, policy_revoked: true })).toMatchObject({ accepted: false, revoked: true });
  });

  it.each([
    { ...post, id: undefined },
    { ...post, id: '777wrong' },
    { ...post, id: -777 },
    { ...post, id: Number.MAX_SAFE_INTEGER + 1 },
    { ...post, cooked: '<p>ordinary post</p>' },
    { ...post, policy_can_accept: 'true' },
    { ...post, policy_accepted: undefined },
    { ...post, policy_accepted: true, policy_revoked: true }
  ])('does not invent a policy state or action from incomplete data', (value) => {
    expect(discoursePostPolicy(value)).toBeUndefined();
  });
});
