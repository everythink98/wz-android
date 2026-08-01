import { describe, expect, it } from 'vitest';

import { linuxDoReactionStats } from './reactions';

describe('linux.do reaction presentation', () => {
  it('renders reaction ids from the provided catalog and keeps boosts as text', () => {
    const stats = linuxDoReactionStats(
      {
        likeCount: 9,
        reactionSummary: [
          { id: 'heart', count: 9 },
          { id: '+1', count: 2 },
          { id: 'distorted_face', count: 1 },
          { id: 'tieba_087', count: 1 }
        ],
        siteExtension: { source: 'linuxdo', boostCount: 3 }
      },
      {
        heart: 'https://linux.do/images/emoji/twemoji/heart.png',
        '+1': 'https://linux.do/images/emoji/twemoji/+1.png',
        distorted_face: 'https://linux.do/images/emoji/twemoji/distorted_face.png',
        tieba_087: 'https://cdn3.ldstatic.com/original/3X/2/e/tieba.png'
      }
    );

    expect(stats).toEqual([
      {
        id: 'heart',
        label: 'heart',
        value: 9,
        imageUrl: 'https://linux.do/images/emoji/twemoji/heart.png'
      },
      {
        id: '+1',
        label: '+1',
        value: 2,
        imageUrl: 'https://linux.do/images/emoji/twemoji/+1.png'
      },
      {
        id: 'distorted_face',
        label: 'distorted face',
        value: 1,
        imageUrl: 'https://linux.do/images/emoji/twemoji/distorted_face.png'
      },
      {
        id: 'tieba_087',
        label: 'tieba 087',
        value: 1,
        imageUrl: 'https://cdn3.ldstatic.com/original/3X/2/e/tieba.png'
      },
      {
        id: 'boost',
        label: '加电',
        value: 3
      }
    ]);
  });

  it('uses likeCount as a heart reaction only when heart is absent', () => {
    expect(
      linuxDoReactionStats({
        likeCount: 4,
        reactionSummary: [{ id: '+1', count: 2 }]
      }).map((stat) => stat.id)
    ).toEqual(['heart', '+1']);

    expect(
      linuxDoReactionStats({
        likeCount: 4,
        reactionSummary: [{ id: 'heart', count: 4 }]
      })
    ).toHaveLength(1);
  });

  it('falls back to text for unknown custom reactions', () => {
    expect(
      linuxDoReactionStats({
        reactionSummary: [{ id: 'unknown_custom', count: 1 }]
      })
    ).toEqual([
      {
        id: 'unknown_custom',
        label: 'unknown custom',
        value: 1
      }
    ]);
  });
});
