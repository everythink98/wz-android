import type { NodeSeekStardustReceive } from '@/domain/forum/structuredComposer';
import { optionalNonNegativeInteger, NODESEEK_BASE_URL } from './protocol';
import { NODESEEK_ACTION_HEADERS } from './actionClient';
import { DEFAULT_NODESEEK_ANDROID_USER_AGENT } from '@/platform/android/nodeSeekUserAgent';
import { withBrowserFetchIntent } from '@/platform/network/browserFetchIntent';
import { fetchWithTimeout, type Fetcher } from '@/platform/network/request';

export type NodeSeekStardustStatus = {
  participantCount: number;
  totalAmount: number;
  paid: boolean;
  closed: boolean;
};

export function nodeSeekStardustReceiverName(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('获取支付基础信息失败');
  }
  const payload = value as Record<string, unknown>;
  if (payload.success !== true) throw new Error('获取支付基础信息失败');
  if (payload.allowedOrigin !== true) throw new Error('调用支付的网站未被授权');
  const receiverName = typeof payload.receiver_name === 'string' ? payload.receiver_name.trim() : '';
  if (!receiverName) throw new Error('获取支付基础信息失败');
  return receiverName;
}

function stardustRecords(value: unknown, optional = false) {
  if (optional && value === undefined) return [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('NodeSeek Stardust 返回内容格式不正确');
  }
  const payload = value as Record<string, unknown>;
  if (payload.success !== true) {
    const message = typeof payload.message === 'string' ? payload.message.trim() : '';
    throw new Error(message || 'NodeSeek Stardust 返回内容格式不正确');
  }
  if (
    !Array.isArray(payload.records) ||
    !payload.records.every((item) => Boolean(item && typeof item === 'object' && !Array.isArray(item)))
  ) {
    throw new Error('NodeSeek Stardust 返回内容格式不正确');
  }
  return payload.records as Record<string, unknown>[];
}

export function normalizeNodeSeekStardustStatus({
  listPayload,
  peerPayload,
  oneTime
}: {
  listPayload: unknown;
  peerPayload?: unknown;
  oneTime: boolean;
}): NodeSeekStardustStatus {
  const list = stardustRecords(listPayload);
  const peerList = stardustRecords(peerPayload, true);
  const participantCount = list.length;
  const totalAmount = list.reduce((sum, item) => {
    const diff = optionalNonNegativeInteger(item.diff);
    return sum + (diff && diff > 0 ? diff : 0);
  }, 0);
  return {
    participantCount,
    totalAmount,
    paid: peerList.length > 0,
    closed: oneTime && participantCount > 0
  };
}

async function fetchStardustList({
  fetcher,
  peerId,
  receive,
  signal,
  userAgent
}: {
  fetcher: Fetcher;
  peerId?: string;
  receive: NodeSeekStardustReceive;
  signal?: AbortSignal;
  userAgent?: string;
}) {
  const params = new URLSearchParams({ member_id: receive.receiverMemberId, ref_id: String(receive.refId) });
  if (peerId) params.set('peer_id', peerId);
  const response = await fetchWithTimeout(
    `${NODESEEK_BASE_URL}/api/stardust/list?${params.toString()}`,
    withBrowserFetchIntent(
      {
        method: 'GET',
        headers: {
          ...NODESEEK_ACTION_HEADERS,
          'user-agent': (userAgent || DEFAULT_NODESEEK_ANDROID_USER_AGENT).trim()
        }
      },
      { owner: 'write', priority: 'write' }
    ),
    { fetcher, signal }
  );
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new Error('NodeSeek Stardust 返回内容格式不正确');
  }
  if (!response.ok) throw new Error(`NodeSeek Stardust 状态读取失败：HTTP ${response.status}`);
  return data;
}

export async function fetchNodeSeekStardustStatus({
  currentMemberId,
  fetcher = fetch,
  receive,
  signal,
  userAgent
}: {
  currentMemberId?: string;
  fetcher?: Fetcher;
  receive: NodeSeekStardustReceive;
  signal?: AbortSignal;
  userAgent?: string;
}) {
  const [listPayload, peerPayload] = await Promise.all([
    fetchStardustList({ fetcher, receive, signal, userAgent }),
    currentMemberId ? fetchStardustList({ fetcher, peerId: currentMemberId, receive, signal, userAgent }) : undefined
  ]);
  return normalizeNodeSeekStardustStatus({ listPayload, peerPayload, oneTime: receive.oneTime });
}
