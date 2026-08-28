import { describe, expect, it } from 'vitest';
import {
  FORUM_MEDIA_IDENTITY_HEADER,
  forumMediaIdentityHeaderValue,
  forumMediaTargetClass
} from './mediaRequestContext';

describe('forum media request identity', () => {
  it('carries the opaque session epoch in a dedicated Glide model header', () => {
    expect(FORUM_MEDIA_IDENTITY_HEADER).toBe('X-WZ-Forum-Media-Identity');
    expect(
      forumMediaIdentityHeaderValue({
        contentSource: 'nodeseek',
        sessionIdentity: 'nodeseek:41'
      })
    ).toBe('nodeseek:41');
    expect(forumMediaIdentityHeaderValue(null)).toBe('public:0');
  });
});

describe('forum media diagnostics classification', () => {
  it('classifies targets without exposing their URLs', () => {
    expect(forumMediaTargetClass('https://cdn.linux.do/image.png', 'linuxdo')).toBe('same-source');
    expect(forumMediaTargetClass('https://www.nodeseek.com/image.png', 'linuxdo')).toBe('cross-source');
    expect(forumMediaTargetClass('https://cdn.example.com/image.png', 'linuxdo')).toBe('unmanaged');
    expect(forumMediaTargetClass('data:image/png;base64,AA==', 'linuxdo')).toBe('data');
  });
});
