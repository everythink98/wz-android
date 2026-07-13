import { describe, expect, it } from 'vitest';

import { isNodeSeekHost } from './forumHosts';

describe('forum host predicates', () => {
  it('accepts only the NodeSeek root host and its subdomains', () => {
    expect(isNodeSeekHost('nodeseek.com')).toBe(true);
    expect(isNodeSeekHost('www.NodeSeek.com')).toBe(true);
    expect(isNodeSeekHost('nodeseek.com.evil.example')).toBe(false);
    expect(isNodeSeekHost('evilnodeseek.com')).toBe(false);
  });
});
