import { describe, expect, it } from 'vitest';
import { forumMediaTargetClass } from './mediaRequestContext';

describe('forum media diagnostics classification', () => {
  it('classifies targets without exposing their URLs', () => {
    expect(forumMediaTargetClass('https://cdn.linux.do/image.png', 'linuxdo')).toBe('same-source');
    expect(forumMediaTargetClass('https://www.nodeseek.com/image.png', 'linuxdo')).toBe('cross-source');
    expect(forumMediaTargetClass('https://cdn.example.com/image.png', 'linuxdo')).toBe('unmanaged');
    expect(forumMediaTargetClass('data:image/png;base64,AA==', 'linuxdo')).toBe('data');
  });
});
