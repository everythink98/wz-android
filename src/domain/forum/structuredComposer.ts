export type ComposerSite = 'linuxdo' | 'nodeseek';
export type ComposerMode = 'rich' | 'source';
export type ComposerPresentation = 'sheet' | 'fullscreen';
export const MAX_COMPOSER_MARKDOWN_LENGTH = 512 * 1024;

export type ComposerIntent =
  | {
      kind: 'reply';
      site: ComposerSite;
      topicId: string;
      replyTo?: { floor: number; author?: string; authorId?: string };
    }
  | {
      kind: 'edit-reply';
      site: ComposerSite;
      topicId: string;
      commentId: string;
      sourceMarkdown: string;
    }
  | {
      kind: 'private-message';
      site: ComposerSite;
      conversationId: string;
    };

export type ComposerValidationIssue = {
  code: string;
  message: string;
  from?: number;
  to?: number;
};

export type PendingNodeSeekPoll = {
  localId: string;
  fingerprint: string;
  title: string;
  multiple: boolean;
  isPublic: boolean;
  options: string[];
  remoteId?: string;
};

export type ComposerSnapshot = {
  revision: number;
  markdown: string;
  mode: ComposerMode;
  isEmpty: boolean;
  validationIssues: ComposerValidationIssue[];
  pendingNodeSeekPolls: PendingNodeSeekPoll[];
};

export type NodeSeekStardustReceive = {
  receiverMemberId: string;
  amount: number;
  refId: number;
  description: string;
  oneTime: boolean;
};

export type ParsedNodeSeekStardustReceive = NodeSeekStardustReceive & {
  rawMarker: string;
};

const NODESEEK_PENDING_POLL_PREFIX = '<!-- wz:nodeseek-poll:';
const NODESEEK_PENDING_POLL_SUFFIX = ' -->';
const NODESEEK_STARDUST_PREFIX = 'nsapp://stardust-receive?';
const NODESEEK_STARDUST_MIN_REF_ID = 100;

function cleanLocalId(value: unknown) {
  const localId = String(value || '').trim();
  return /^[A-Za-z0-9_-]{8,80}$/.test(localId) ? localId : '';
}

function cleanPollText(value: unknown) {
  return String(value || '')
    .replace(/\r\n?/g, '\n')
    .trim();
}

export function nodeSeekPendingPollToken(localId: string) {
  const clean = cleanLocalId(localId);
  if (!clean) throw new Error('本地投票 id 不正确');
  return `${NODESEEK_PENDING_POLL_PREFIX}${clean}${NODESEEK_PENDING_POLL_SUFFIX}`;
}

export function nodeSeekPendingPollIdFromToken(value: string) {
  if (!value.startsWith(NODESEEK_PENDING_POLL_PREFIX) || !value.endsWith(NODESEEK_PENDING_POLL_SUFFIX)) return null;
  const localId = cleanLocalId(value.slice(NODESEEK_PENDING_POLL_PREFIX.length, -NODESEEK_PENDING_POLL_SUFFIX.length));
  return localId || null;
}

export function nodeSeekPendingPollTokenRanges(markdown: string) {
  const ranges: { from: number; to: number; localId: string }[] = [];
  let cursor = 0;
  while (cursor < markdown.length) {
    const from = markdown.indexOf(NODESEEK_PENDING_POLL_PREFIX, cursor);
    if (from < 0) break;
    const end = markdown.indexOf(NODESEEK_PENDING_POLL_SUFFIX, from + NODESEEK_PENDING_POLL_PREFIX.length);
    if (end < 0) break;
    const to = end + NODESEEK_PENDING_POLL_SUFFIX.length;
    const localId = nodeSeekPendingPollIdFromToken(markdown.slice(from, to));
    if (localId) ranges.push({ from, to, localId });
    cursor = to;
  }
  return ranges;
}

export function nodeSeekRemotePollMarkerRanges(markdown: string) {
  const prefix = 'nsapp://vote?id=';
  const ranges: { from: number; to: number; pollId: string }[] = [];
  let cursor = 0;
  while (cursor < markdown.length) {
    const from = markdown.indexOf(prefix, cursor);
    if (from < 0) break;
    let to = from + prefix.length;
    while (to < markdown.length && /\d/.test(markdown[to]!)) to += 1;
    const pollId = markdown.slice(from + prefix.length, to);
    if (pollId) ranges.push({ from, to, pollId });
    cursor = Math.max(to, from + prefix.length);
  }
  return ranges;
}

export function validatePendingNodeSeekPoll(value: Omit<PendingNodeSeekPoll, 'fingerprint'> | PendingNodeSeekPoll) {
  const localId = cleanLocalId(value.localId);
  const title = cleanPollText(value.title);
  const options = value.options.map(cleanPollText).filter(Boolean);
  if (!localId) throw new Error('本地投票 id 不正确');
  if (!title) throw new Error('请输入投票标题');
  if (options.length < 2) throw new Error('投票至少需要两个选项');
  if (new Set(options).size !== options.length) throw new Error('投票选项不能重复');
  return {
    localId,
    title,
    multiple: Boolean(value.multiple),
    isPublic: Boolean(value.isPublic),
    options,
    ...(value.remoteId && /^\d+$/.test(value.remoteId) ? { remoteId: value.remoteId } : {})
  };
}

function fnv1a(value: string, seed: number) {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export function fingerprintNodeSeekPoll(value: Omit<PendingNodeSeekPoll, 'fingerprint'> | PendingNodeSeekPoll) {
  const poll = validatePendingNodeSeekPoll(value);
  const canonical = JSON.stringify({
    title: poll.title,
    multiple: poll.multiple,
    isPublic: poll.isPublic,
    options: poll.options
  });
  return `${fnv1a(canonical, 0x811c9dc5)}${fnv1a(canonical, 0x9e3779b9)}`;
}

export function normalizePendingNodeSeekPoll(
  value: Omit<PendingNodeSeekPoll, 'fingerprint'> | PendingNodeSeekPoll
): PendingNodeSeekPoll {
  const poll = validatePendingNodeSeekPoll(value);
  return { ...poll, fingerprint: fingerprintNodeSeekPoll(poll) };
}

function positiveSafeInteger(value: unknown) {
  const number = typeof value === 'number' ? value : Number(String(value || '').trim());
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

export function normalizeNodeSeekStardustRefId(value: unknown) {
  const refId = positiveSafeInteger(value);
  return refId !== null && refId >= NODESEEK_STARDUST_MIN_REF_ID ? refId : null;
}

export function generateNodeSeekStardustRefId() {
  return NODESEEK_STARDUST_MIN_REF_ID + Math.floor(100_000_000 * Math.random());
}

function stardustBoolean(value: string | null) {
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  return null;
}

export function parseNodeSeekStardustReceive(marker: string): ParsedNodeSeekStardustReceive | null {
  const rawMarker = marker.trim();
  if (!rawMarker.startsWith(NODESEEK_STARDUST_PREFIX) || /[\s<>"']/u.test(rawMarker)) return null;
  try {
    const params = new URLSearchParams(rawMarker.slice(NODESEEK_STARDUST_PREFIX.length));
    const receiverMemberId = String(params.get('member_id') || '').trim();
    const amount = positiveSafeInteger(params.get('diff'));
    const refId = positiveSafeInteger(params.get('ref_id'));
    const oneTime = stardustBoolean(params.get('onetime'));
    const description = params.get('description');
    if (!/^\d+$/.test(receiverMemberId) || !amount || !refId || oneTime === null || description === null) return null;
    return {
      receiverMemberId,
      amount,
      refId,
      description,
      oneTime,
      rawMarker
    };
  } catch {
    return null;
  }
}

export function serializeNodeSeekStardustReceive(value: NodeSeekStardustReceive) {
  const receiverMemberId = String(value.receiverMemberId || '').trim();
  const amount = positiveSafeInteger(value.amount);
  const refId = normalizeNodeSeekStardustRefId(value.refId);
  if (!/^\d+$/.test(receiverMemberId)) throw new Error('NodeSeek 收款人不正确');
  if (!amount) throw new Error('Stardust 数额必须为正安全整数');
  if (!refId) throw new Error('Ref ID 必须为大于等于 100 的安全整数');
  const params = new URLSearchParams();
  params.set('member_id', receiverMemberId);
  params.set('ref_id', String(refId));
  params.set('description', String(value.description || ''));
  params.set('diff', String(amount));
  params.set('onetime', value.oneTime ? 'true' : 'false');
  return `${NODESEEK_STARDUST_PREFIX}${params.toString()}`;
}

export function nodeSeekStardustMarkerRanges(markdown: string) {
  const ranges: { from: number; to: number; receive: ParsedNodeSeekStardustReceive | null; rawMarker: string }[] = [];
  let cursor = 0;
  while (cursor < markdown.length) {
    const from = markdown.indexOf(NODESEEK_STARDUST_PREFIX, cursor);
    if (from < 0) break;
    let to = from + NODESEEK_STARDUST_PREFIX.length;
    while (to < markdown.length && !/[\s<>"']/u.test(markdown[to]!)) to += 1;
    const rawMarker = markdown.slice(from, to);
    ranges.push({ from, to, rawMarker, receive: parseNodeSeekStardustReceive(rawMarker) });
    cursor = to;
  }
  return ranges;
}

export function replacePendingNodeSeekPollToken(markdown: string, localId: string, remoteId: string) {
  if (!/^\d+$/.test(remoteId)) throw new Error('NodeSeek 投票 id 不正确');
  return markdown.split(nodeSeekPendingPollToken(localId)).join(`nsapp://vote?id=${remoteId}`);
}
