import { describe, expect, it } from 'vitest';

import { buildDiscourseSourceActionRequest, discourseSourceUploadUrl } from '@/discourseSourceActions';

describe('Discourse source action composition', () => {
  it('uses the portable operation for standard behavior on both sites', () => {
    const action = { type: 'set-like' as const, postId: 9, active: true };
    expect(buildDiscourseSourceActionRequest('linuxdo', action)).toEqual(
      buildDiscourseSourceActionRequest('xiaoyinsi', action)
    );
  });

  it('keeps Xiaoyinsi bookmark removal as a site operation override', () => {
    expect(
      buildDiscourseSourceActionRequest('xiaoyinsi', {
        type: 'set-bookmark',
        targetId: '42',
        targetType: 'Topic',
        active: false
      })
    ).toEqual({
      method: 'PUT',
      path: '/t/42/remove_bookmarks',
      body: undefined,
      headers: {}
    });
  });

  it('resolves upload results with registered site identity', () => {
    expect(discourseSourceUploadUrl('xiaoyinsi', { url: '/uploads/image.png' })).toBe(
      'https://forum.xiaoyinsi.com/uploads/image.png'
    );
  });
});
