import { describe, expect, it } from 'vitest';
import { readableTopicError } from './topicError';

describe('topic display error', () => {
  it('translates only known upstream failures', () => {
    expect(readableTopicError('upstream unavailable')).toBe('来源暂时不可用，请稍后重试');
    expect(readableTopicError('HTTP 503')).toBe('来源暂时不可用（HTTP 503）');
    expect(readableTopicError('需要登录')).toBe('需要登录');
  });
});
