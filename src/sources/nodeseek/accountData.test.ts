import { Buffer } from 'buffer';
import { describe, expect, it, vi } from 'vitest';
import type { Fetcher } from '@/platform/network/request';
import {
  getNodeSeekAccountOverview,
  getNodeSeekAttendanceBoard,
  getNodeSeekCredits,
  getNodeSeekStardustCredits
} from './accountData';

const record = {
  id: 91,
  member_id: 7,
  day_id: 120,
  gain: 3,
  created_at: '2026-10-01T17:14:50.000Z'
};
const leaderboardEntry = { ...record, member_name: 'alice' };
const stardustRecord = {
  id: 91,
  member_id: 7,
  peer_id: 8,
  type: 'upvote',
  diff: 1,
  result: 2,
  ref_id: 3,
  created_at: '2026-10-01T17:14:50.000Z',
  comment_id: 4
};

describe('NodeSeek private account data', () => {
  it('reads the current account overview without dropping zero balances or public profile fields', async () => {
    const embedded = Buffer.from(
      JSON.stringify({
        user: {
          member_id: 7,
          member_name: 'alice',
          rank: 2,
          coin: 0,
          stardust: 4,
          nPost: 3,
          nComment: 5,
          follows: 1,
          fans: 0,
          collectionCount: 6,
          bio: '简介',
          created_at: '2024-01-01T00:00:00.000Z'
        }
      })
    ).toString('base64');
    const fetcher = vi.fn(async () => new Response(`<script>window.__config__ = '${embedded}'</script>`));
    expect(await getNodeSeekAccountOverview({ userId: '7', fetcher })).toMatchObject({
      source: 'nodeseek',
      userId: '7',
      coin: 0,
      stardust: 4,
      follows: 1,
      fans: 0,
      collectionCount: 6,
      profile: {
        id: '7',
        username: 'alice',
        levelLabel: 'Lv2',
        topicCount: 3,
        replyCount: 5,
        bio: '简介',
        joinedAt: '2024-01-01T00:00:00.000Z'
      }
    });
    expect(fetcher).toHaveBeenCalledWith('https://www.nodeseek.com/', expect.any(Object));
    await expect(getNodeSeekAccountOverview({ userId: '8', fetcher })).rejects.toThrow('身份不匹配');
  });

  it('preserves signed financial balances from the account overview', async () => {
    const embedded = Buffer.from(
      JSON.stringify({ user: { member_id: 7, member_name: 'alice', coin: -2, stardust: -4 } })
    ).toString('base64');
    expect(
      await getNodeSeekAccountOverview({
        userId: '7',
        fetcher: async () => new Response(`<script>window.__config__ = '${embedded}'</script>`)
      })
    ).toMatchObject({ coin: -2, stardust: -4 });
  });

  it('distinguishes an explicit unsigned board from a missing or mismatched record', async () => {
    const read = (data: unknown) =>
      getNodeSeekAttendanceBoard({ userId: '7', fetcher: async () => Response.json(data) });
    expect(await read({ list: [leaderboardEntry], record, order: 9, total: 30 })).toMatchObject({
      record: { id: '91', memberId: '7', dayId: 120, gain: 3 },
      order: 9,
      total: 30
    });
    expect(await read({ list: [], record: null, order: null, total: 0 })).toMatchObject({
      record: null,
      order: null,
      total: 0
    });
    expect(await read({ list: [], record: { ...record, gain: -2 }, order: 9, total: 1 })).toMatchObject({
      record: { gain: -2 }
    });
    await expect(read({ list: [], order: null, total: 0 })).rejects.toThrow('格式不正确');
    await expect(read({ list: [], record: { ...record, member_id: 8 }, order: 9, total: 30 })).rejects.toThrow(
      '身份不匹配'
    );
    await expect(
      read({ list: [{ ...leaderboardEntry, created_at: 'bad-date' }], record: null, order: null, total: 1 })
    ).rejects.toThrow('时间不正确');
    await expect(read({ list: [], record: { ...record, created_at: '3' }, order: 9, total: 1 })).rejects.toThrow(
      '时间不正确'
    );
  });

  it('accepts attendance records without leaderboard-only member names', async () => {
    const board = await getNodeSeekAttendanceBoard({
      userId: '7',
      fetcher: async () => Response.json({ list: [leaderboardEntry], record, order: 9, total: 30 })
    });
    expect(board.record).toEqual({
      id: '91',
      memberId: '7',
      dayId: 120,
      gain: 3,
      createdAt: '2026-10-01T17:14:50.000Z'
    });
    expect(board.list[0]).toMatchObject({ memberName: 'alice', gain: 3 });
  });

  it.each(['id', 'member_id', 'day_id', 'gain', 'created_at'] as const)(
    'rejects an attendance record missing required %s evidence',
    async (field) => {
      await expect(
        getNodeSeekAttendanceBoard({
          userId: '7',
          fetcher: async () =>
            Response.json({ list: [], record: { ...record, [field]: undefined }, order: 9, total: 1 })
        })
      ).rejects.toThrow();
    }
  );

  it('keeps leaderboard member names required independently of the current-account record', async () => {
    await expect(
      getNodeSeekAttendanceBoard({
        userId: '7',
        fetcher: async () => Response.json({ list: [record], record: null, order: null, total: 1 })
      })
    ).rejects.toThrow('签到数据格式不正确');
  });

  it('preserves signed credit changes and advances only with a remaining authoritative total', async () => {
    const fetcher = vi.fn(async () =>
      Response.json({
        success: true,
        data: [
          [-2, -2, '消费', '2026-10-02T01:00:00.000Z'],
          [8, 0, '签到', '2026-10-02T02:00:00.000Z']
        ],
        total: 22
      })
    );
    expect(await getNodeSeekCredits({ userId: '7', page: 1, fetcher })).toMatchObject({
      entries: [
        { change: -2, balance: -2, reason: '消费' },
        { change: 8, balance: 0, reason: '签到' }
      ],
      page: 1,
      total: 22,
      hasMore: true,
      nextPage: 2
    });
    expect(fetcher).toHaveBeenCalledWith('https://www.nodeseek.com/api/account/credit/page-1', expect.any(Object));
    expect(await getNodeSeekCredits({ userId: '7', page: 2, fetcher })).toMatchObject({
      hasMore: false,
      nextPage: null
    });
    await expect(getNodeSeekCredits({ userId: '7', page: 0, fetcher })).rejects.toThrow('页码不正确');
    await expect(
      getNodeSeekCredits({
        userId: '7',
        fetcher: async () => Response.json({ success: true, data: [[8, 9, '签到']], total: 1 })
      })
    ).rejects.toThrow('记录格式不正确');
    await expect(
      getNodeSeekCredits({ userId: '7', fetcher: async () => Response.json({ success: false, data: [], total: 0 }) })
    ).rejects.toThrow('格式不正确');
    await expect(
      getNodeSeekCredits({
        userId: '7',
        fetcher: async () =>
          Response.json({ success: true, data: [[8, Infinity, '签到', record.created_at]], total: 1 })
      })
    ).rejects.toThrow('格式不正确');
  });

  it.each([1, 2])('rejects an empty credit page %s when the server declares records', async (page) => {
    await expect(
      getNodeSeekCredits({
        userId: '7',
        page,
        fetcher: async () => Response.json({ success: true, data: [], total: 1 })
      })
    ).rejects.toThrow('收支数据格式不正确');
  });

  it('reads the official Stardust records and advances by server cursor without inventing page totals', async () => {
    const fetcher = vi.fn<Fetcher>(async () =>
      Response.json({
        success: true,
        records: [stardustRecord, { ...stardustRecord, id: 90, result: 1 }],
        exist_more: true,
        cursor: 90
      })
    );
    expect(await getNodeSeekStardustCredits({ userId: '7', beforeId: 100, fetcher })).toEqual({
      source: 'nodeseek',
      userId: '7',
      entries: [
        { change: 1, balance: 2, reason: '点赞', createdAt: stardustRecord.created_at },
        { change: 1, balance: 1, reason: '点赞', createdAt: stardustRecord.created_at }
      ],
      hasMore: true,
      nextBeforeId: 90
    });
    expect(fetcher).toHaveBeenCalledWith(
      'https://www.nodeseek.com/api/stardust/list?count=10&member_id=7&before_id=100',
      expect.any(Object)
    );
  });

  it.each([
    ['system', '系统'],
    ['admin', '管理'],
    ['transfer', '转账'],
    ['upvote', '点赞'],
    ['buyCode', '购买邀请码'],
    ['unknown-event', 'unknown-event'],
    ['constructor', 'constructor']
  ])('uses the official Stardust reason label for %s', async (type, reason) => {
    const page = await getNodeSeekStardustCredits({
      userId: '7',
      fetcher: async () =>
        Response.json({
          success: true,
          records: [
            { ...stardustRecord, type, diff: -2, result: -2 },
            { ...stardustRecord, id: 90, diff: 0, result: 0 }
          ],
          exist_more: false,
          cursor: 90
        })
    });
    expect(page.entries).toMatchObject([
      { change: -2, balance: -2, reason },
      { change: 0, balance: 0 }
    ]);
    expect(page.hasMore).toBe(false);
    expect(page.nextBeforeId).toBeNull();
  });

  it.each([undefined, null, 0, 90])(
    'does not require a next cursor for an exhausted Stardust ledger: %s',
    async (cursor) => {
      const fetcher = vi.fn<Fetcher>(async () =>
        Response.json({ success: true, records: [], exist_more: false, cursor })
      );
      expect(await getNodeSeekStardustCredits({ userId: '7', fetcher })).toEqual({
        source: 'nodeseek',
        userId: '7',
        entries: [],
        hasMore: false,
        nextBeforeId: null
      });
      expect(fetcher).toHaveBeenCalledWith(
        'https://www.nodeseek.com/api/stardust/list?count=10&member_id=7',
        expect.any(Object)
      );
    }
  );

  it.each([0, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'rejects an unsafe Stardust before ID %s before sending',
    async (beforeId) => {
      const fetcher = vi.fn<Fetcher>();
      await expect(getNodeSeekStardustCredits({ userId: '7', beforeId, fetcher })).rejects.toThrow(
        '记录 ID 格式不正确'
      );
      expect(fetcher).not.toHaveBeenCalled();
    }
  );

  it.each([
    { exist_more: true, cursor: undefined },
    { exist_more: true, cursor: null },
    { exist_more: true, cursor: 0 },
    { exist_more: true, cursor: 100 },
    { exist_more: true, cursor: 101 },
    { exist_more: false, cursor: -1 },
    { exist_more: false, cursor: '90' },
    { exist_more: true, cursor: 90.5 },
    { exist_more: true, cursor: Number.MAX_SAFE_INTEGER + 1 },
    { exist_more: undefined, cursor: 90 }
  ])('rejects incomplete or non-progressing Stardust pagination: %j', async (fields) => {
    await expect(
      getNodeSeekStardustCredits({
        userId: '7',
        beforeId: 100,
        fetcher: async () => Response.json({ success: true, records: [stardustRecord], ...fields })
      })
    ).rejects.toThrow('格式不正确');
  });

  it.each(['id', 'member_id', 'peer_id', 'type', 'diff', 'result', 'ref_id', 'created_at', 'comment_id'] as const)(
    'rejects Stardust records missing required %s evidence',
    async (field) => {
      await expect(
        getNodeSeekStardustCredits({
          userId: '7',
          fetcher: async () =>
            Response.json({
              success: true,
              records: [{ ...stardustRecord, [field]: undefined }],
              exist_more: false,
              cursor: 91
            })
        })
      ).rejects.toThrow();
    }
  );

  it('rejects mismatched Stardust owners, malformed money and non-ISO dates without inventing values', async () => {
    for (const fields of [{ member_id: 8 }, { diff: Infinity }, { result: Infinity }, { created_at: '3' }]) {
      await expect(
        getNodeSeekStardustCredits({
          userId: '7',
          fetcher: async () =>
            Response.json({ success: true, records: [{ ...stardustRecord, ...fields }], exist_more: false, cursor: 91 })
        })
      ).rejects.toThrow();
    }
    await expect(
      getNodeSeekStardustCredits({
        userId: '7',
        fetcher: async () => Response.json({ success: true, records: [], exist_more: true, cursor: 91 })
      })
    ).rejects.toThrow('分页格式不正确');
  });
});
