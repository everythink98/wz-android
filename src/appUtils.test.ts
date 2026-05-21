import { describe, expect, it } from 'vitest';
import { finishAbortableRequest, isCanceledRequest, sourceLabel, startAbortableRequest } from './appUtils';
import { REQUEST_CANCELED_MESSAGE } from './request';

describe('Android app utils', () => {
  it('formats source labels and canceled request errors', () => {
    expect(sourceLabel('all')).toBe('全部');
    expect(sourceLabel('linuxdo')).toBe('linux.do');
    expect(sourceLabel('nodeseek')).toBe('NodeSeek');
    expect(sourceLabel('yaohuo')).toBe('妖火');
    expect(sourceLabel('v2ex')).toBe('V2EX');
    expect(isCanceledRequest(new Error(REQUEST_CANCELED_MESSAGE))).toBe(true);
  });

  it('starts and finishes abortable requests by controller identity', () => {
    const ref: { current: AbortController | null } = { current: null };
    const first = startAbortableRequest(ref);
    const second = startAbortableRequest(ref);

    expect(first.signal.aborted).toBe(true);
    expect(ref.current).toBe(second);
    finishAbortableRequest(ref, first);
    expect(ref.current).toBe(second);
    finishAbortableRequest(ref, second);
    expect(ref.current).toBeNull();
  });
});
