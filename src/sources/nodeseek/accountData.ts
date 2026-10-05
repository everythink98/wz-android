import type {
  NodeSeekAccountOverview,
  NodeSeekAttendanceBoard,
  NodeSeekAttendanceEntry,
  NodeSeekAttendanceRecord,
  NodeSeekCreditPage,
  NodeSeekStardustCreditPage
} from '@/domain/forum/accountData';
import { isRecord, toIsoString } from '@/domain/forum/html';
import { proveForumReadResponse } from '@/sources/forumSourceReadAttempt';
import { fetchNodeSeekJson, fetchNodeSeekTextResult, type NodeSeekOptions } from './reader';
import { optionalNonNegativeInteger } from './protocol';
import { nodeSeekCurrentUserFromConfig, parseNodeSeekUserDetails } from './userParser';

type AccountDataOptions = NodeSeekOptions & { userId: string };

function count(value: unknown) {
  const parsed = optionalNonNegativeInteger(value);
  if (parsed === undefined || !Number.isSafeInteger(parsed) || (typeof value === 'number' && parsed !== value)) {
    throw new Error('NodeSeek 账号数据格式不正确');
  }
  return parsed;
}

function finiteNumber(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('NodeSeek 账号数据格式不正确');
  return value;
}

function timestamp(value: unknown) {
  const parsed = toIsoString(value);
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
    !parsed
  ) {
    throw new Error('NodeSeek 账号数据时间不正确');
  }
  return parsed;
}

function accountOptions(options: AccountDataOptions): NodeSeekOptions {
  if (!/^\d+$/.test(options.userId)) throw new Error('NodeSeek 账号数据需要数字用户 ID');
  return { ...options, browserFetchIntent: { owner: 'user', priority: 'foreground' } };
}

export async function getNodeSeekAccountOverview(options: AccountDataOptions): Promise<NodeSeekAccountOverview> {
  const { pageDocument, response } = await fetchNodeSeekTextResult('/', accountOptions(options));
  return proveForumReadResponse(response, () => {
    const user = pageDocument?.embedded?.user;
    const identity = nodeSeekCurrentUserFromConfig(pageDocument?.embedded);
    if (!isRecord(user) || identity?.id !== options.userId) {
      throw new Error('NodeSeek 账号资料身份不匹配');
    }
    return {
      source: 'nodeseek',
      userId: options.userId,
      profile: parseNodeSeekUserDetails(options.userId, user),
      coin: typeof user.coin === 'number' ? finiteNumber(user.coin) : undefined,
      stardust: typeof user.stardust === 'number' ? finiteNumber(user.stardust) : undefined,
      follows: optionalNonNegativeInteger(user.follows),
      fans: optionalNonNegativeInteger(user.fans),
      collectionCount: optionalNonNegativeInteger(user.collectionCount)
    };
  });
}

function attendanceRecord(value: unknown): NodeSeekAttendanceRecord {
  if (!isRecord(value)) {
    throw new Error('NodeSeek 签到数据格式不正确');
  }
  const gain = finiteNumber(value.gain);
  return {
    id: String(count(value.id)),
    memberId: String(count(value.member_id)),
    dayId: count(value.day_id),
    gain,
    createdAt: timestamp(value.created_at)
  };
}

function attendanceEntry(value: unknown): NodeSeekAttendanceEntry {
  if (!isRecord(value) || typeof value.member_name !== 'string') {
    throw new Error('NodeSeek 签到数据格式不正确');
  }
  return { ...attendanceRecord(value), memberName: value.member_name };
}

export async function getNodeSeekAttendanceBoard(options: AccountDataOptions): Promise<NodeSeekAttendanceBoard> {
  const data = await fetchNodeSeekJson('/api/attendance/board?page=1', accountOptions(options));
  if (!isRecord(data) || !Array.isArray(data.list) || !('record' in data) || !('order' in data)) {
    throw new Error('NodeSeek 签到数据格式不正确');
  }
  const record = data.record === null ? null : attendanceRecord(data.record);
  if (record && record.memberId !== options.userId) throw new Error('NodeSeek 签到记录身份不匹配');
  return {
    source: 'nodeseek',
    userId: options.userId,
    list: data.list.map(attendanceEntry),
    record,
    order: data.order === null ? null : count(data.order),
    total: count(data.total)
  };
}

export async function getNodeSeekCredits(options: AccountDataOptions & { page?: number }): Promise<NodeSeekCreditPage> {
  const page = options.page ?? 1;
  if (!Number.isSafeInteger(page) || page < 1) throw new Error('NodeSeek 收支页码不正确');
  const data = await fetchNodeSeekJson(`/api/account/credit/page-${page}`, accountOptions(options));
  if (!isRecord(data) || data.success !== true || !Array.isArray(data.data)) {
    throw new Error('NodeSeek 收支数据格式不正确');
  }
  const entries = data.data.map((entry) => {
    if (!Array.isArray(entry) || entry.length < 4 || typeof entry[2] !== 'string') {
      throw new Error('NodeSeek 收支记录格式不正确');
    }
    const balance = finiteNumber(entry[1]);
    return {
      change: finiteNumber(entry[0]),
      balance,
      reason: entry[2],
      createdAt: timestamp(entry[3])
    };
  });
  const total = count(data.total);
  if (total > 0 && entries.length === 0) throw new Error('NodeSeek 收支数据格式不正确');
  const hasMore = entries.length > 0 && (page - 1) * 20 + entries.length < total;
  return {
    source: 'nodeseek',
    userId: options.userId,
    entries,
    page,
    total,
    hasMore,
    nextPage: hasMore ? page + 1 : null
  };
}

function stardustRecordId(value: unknown) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error('NodeSeek 星辰记录 ID 格式不正确');
  }
  return value;
}

const stardustReasonLabels = new Map([
  ['system', '系统'],
  ['admin', '管理'],
  ['transfer', '转账'],
  ['upvote', '点赞'],
  ['buyCode', '购买邀请码']
]);

export async function getNodeSeekStardustCredits(
  options: AccountDataOptions & { beforeId?: number }
): Promise<NodeSeekStardustCreditPage> {
  const beforeId = options.beforeId === undefined ? undefined : stardustRecordId(options.beforeId);
  const params = new URLSearchParams({ count: '10', member_id: options.userId });
  if (beforeId !== undefined) params.set('before_id', String(beforeId));
  const data = await fetchNodeSeekJson(`/api/stardust/list?${params.toString()}`, accountOptions(options));
  if (
    !isRecord(data) ||
    data.success !== true ||
    !Array.isArray(data.records) ||
    typeof data.exist_more !== 'boolean'
  ) {
    throw new Error('NodeSeek 星辰收支数据格式不正确');
  }
  const entries = data.records.map((value) => {
    if (!isRecord(value) || typeof value.type !== 'string') {
      throw new Error('NodeSeek 星辰收支记录格式不正确');
    }
    stardustRecordId(value.id);
    const memberId = stardustRecordId(value.member_id);
    if (String(memberId) !== options.userId) throw new Error('NodeSeek 星辰收支记录身份不匹配');
    for (const field of ['peer_id', 'ref_id', 'comment_id'] as const) {
      if (typeof value[field] !== 'number' || !Number.isSafeInteger(value[field])) {
        throw new Error('NodeSeek 星辰收支记录格式不正确');
      }
    }
    return {
      change: finiteNumber(value.diff),
      balance: finiteNumber(value.result),
      reason: stardustReasonLabels.get(value.type) || value.type,
      createdAt: timestamp(value.created_at)
    };
  });
  const cursor =
    data.cursor === undefined || data.cursor === null || data.cursor === 0 ? null : stardustRecordId(data.cursor);
  const hasMore = data.exist_more;
  if (hasMore && (cursor === null || entries.length === 0 || (beforeId !== undefined && cursor >= beforeId))) {
    throw new Error('NodeSeek 星辰收支分页格式不正确');
  }
  return { source: 'nodeseek', userId: options.userId, entries, hasMore, nextBeforeId: hasMore ? cursor : null };
}
