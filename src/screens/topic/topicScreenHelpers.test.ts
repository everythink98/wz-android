import { describe, expect, it } from 'vitest';
import { visibleFloorIndexReplies } from './topicScreenHelpers';
import type { Reply } from '../../types';

describe('topic screen helpers', () => {
  it('keeps the floor index bounded for long threads', () => {
    const replies: Reply[] = Array.from({ length: 500 }, (_, index) => ({
      floor: index + 1,
      author: `user-${index + 1}`,
      createdAt: `2026-05-23T00:00:${String(index % 60).padStart(2, '0')}.000Z`,
      contentHtml: '<p>reply</p>'
    }));

    const visible = visibleFloorIndexReplies(replies, 160);

    expect(visible).toHaveLength(160);
    expect(visible[0].floor).toBe(1);
    expect(visible[79].floor).toBe(80);
    expect(visible[80].floor).toBe(421);
    expect(visible[159].floor).toBe(500);
  });
});
