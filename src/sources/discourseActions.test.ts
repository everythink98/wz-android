import { describe, expect, it } from 'vitest';

import { discourseSourceUploadUrl } from './discourseActions';

describe('Discourse source action composition', () => {
  it('resolves upload results with registered site identity', () => {
    expect(discourseSourceUploadUrl('linuxdo', { url: '/uploads/image.png' })).toBe(
      'https://linux.do/uploads/image.png'
    );
  });
});
