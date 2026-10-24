import { isRecord } from '@/domain/forum/html';
import {
  LinuxDoCreditError,
  type LinuxDoCreditAccount,
  type LinuxDoCreditEntry,
  type LinuxDoCreditPage
} from '@/domain/forum/linuxDoCredit';
import { isCloudflareChallengeResponse, LinuxDoCloudflareError } from '@/platform/network/cloudflareChallenge';
import { fetchWithTimeout, RequestCanceledError, type Fetcher } from '@/platform/network/request';
import { LINUXDO_BASE_URL, linuxDoRequestError } from './protocol';

export const LINUXDO_CREDIT_URL = 'https://credit.linux.do';
const PAGE_SIZE = 20;

interface LinuxDoCreditOptions {
  userId: string;
  username?: string;
  userAgent?: string;
  fetcher: Fetcher;
  signal?: AbortSignal;
}

function invalidResponse(): never {
  throw new LinuxDoCreditError('unavailable', 'LDC 返回的数据不完整，请稍后重试');
}

function readText(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return invalidResponse();
  return value;
}

function readId(value: unknown): string {
  if (typeof value !== 'string' || !/^-?(?:0|[1-9]\d{0,19})$/.test(value)) return invalidResponse();
  return value;
}

function readAmount(value: unknown): string {
  if (typeof value !== 'string' || !/^-?(?:0|[1-9]\d{0,17})(?:\.\d{1,2})?$/.test(value)) {
    return invalidResponse();
  }
  return value;
}

async function readCreditJson(
  path: '/oauth/user-info' | '/order/transactions',
  options: LinuxDoCreditOptions,
  body?: { page: number; page_size: number }
): Promise<unknown> {
  if (options.signal?.aborted) throw new RequestCanceledError();
  let response: Response;
  let bodyText: string;
  try {
    response = await fetchWithTimeout(
      `${LINUXDO_CREDIT_URL}/api/v1${path}`,
      {
        method: body ? 'POST' : 'GET',
        headers: {
          Accept: 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...(options.userAgent ? { 'User-Agent': options.userAgent } : {})
        },
        ...(body ? { body: JSON.stringify(body) } : {})
      },
      options
    );
    bodyText = await response.text();
  } catch (error) {
    if (options.signal?.aborted || error instanceof RequestCanceledError) throw new RequestCanceledError();
    if (error instanceof LinuxDoCloudflareError) {
      throw new LinuxDoCreditError('verification-required', 'LDC 需要在官网完成验证');
    }
    throw new LinuxDoCreditError('unavailable', '暂时无法连接 LDC，请稍后重试');
  }
  if (options.signal?.aborted) throw new RequestCanceledError();
  if (isCloudflareChallengeResponse({ status: response.status, headers: response.headers, bodyText })) {
    throw new LinuxDoCreditError('verification-required', 'LDC 需要在官网完成验证');
  }
  if (response.status === 401) {
    throw new LinuxDoCreditError('authorization-required', '请先使用当前 L 站账号登录 LDC');
  }
  if (!response.ok) {
    throw new LinuxDoCreditError('unavailable', 'LDC 暂时无法读取，请前往官网查看或稍后重试');
  }
  let envelope: unknown;
  try {
    envelope = JSON.parse(bodyText);
  } catch {
    return invalidResponse();
  }
  if (!isRecord(envelope) || envelope.error_msg !== '' || !('data' in envelope)) return invalidResponse();
  return envelope.data;
}

async function readForumIdentity(options: LinuxDoCreditOptions): Promise<{ userId: string; username: string }> {
  if (options.signal?.aborted) throw new RequestCanceledError();
  // Preserve managed forum errors so a real forum 401 can expire its session normally.
  const response = await fetchWithTimeout(
    `${LINUXDO_BASE_URL}/session/current.json`,
    {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        ...(options.userAgent ? { 'User-Agent': options.userAgent } : {})
      }
    },
    options
  );
  const bodyText = await response.text();
  if (options.signal?.aborted) throw new RequestCanceledError();
  if (isCloudflareChallengeResponse({ status: response.status, headers: response.headers, bodyText })) {
    throw new LinuxDoCloudflareError(response);
  }
  if (!response.ok) throw linuxDoRequestError(`L 站账号核对失败：HTTP ${response.status}`, response.status);
  let data: unknown;
  try {
    data = JSON.parse(bodyText);
  } catch {
    return invalidResponse();
  }
  if (!isRecord(data) || !isRecord(data.current_user)) return invalidResponse();
  const currentUser = data.current_user;
  if (typeof currentUser.id === 'number' && !Number.isSafeInteger(currentUser.id)) return invalidResponse();
  const userId = readId(typeof currentUser.id === 'number' ? String(currentUser.id) : currentUser.id);
  const username = readText(currentUser.username);
  const matchesIdentity =
    options.username && options.userId === options.username
      ? username === options.username
      : /^[1-9]\d*$/.test(options.userId) &&
        userId === options.userId &&
        (!options.username || username === options.username);
  if (!/^[1-9]\d*$/.test(userId) || !matchesIdentity) {
    throw new LinuxDoCreditError('identity-mismatch', '当前 L 站登录账号已变化，请先核对账号');
  }
  return { userId, username };
}

export async function getLinuxDoCreditAccount(options: LinuxDoCreditOptions): Promise<LinuxDoCreditAccount> {
  const forumIdentity = await readForumIdentity(options);
  const data = await readCreditJson('/oauth/user-info', options);
  if (!isRecord(data)) return invalidResponse();
  const userId = readId(data.id);
  const username = readText(data.username);
  // Credit stores the Connect/Discourse user ID; usernames can be reassigned.
  if (userId !== forumIdentity.userId || username !== forumIdentity.username) {
    throw new LinuxDoCreditError('identity-mismatch', 'LDC 登录的账号与当前 L 站账号不一致，请前往官网核对');
  }
  return {
    userId,
    username,
    availableBalance: readAmount(data.available_balance),
    pendingBalance: readAmount(data.pending_balance)
  };
}

function readEntry(value: unknown, userId: string): LinuxDoCreditEntry {
  if (!isRecord(value)) return invalidResponse();
  const id = readId(value.id);
  const payerId = readId(value.payer_user_id);
  const payeeId = readId(value.payee_user_id);
  const amount = readAmount(value.amount);
  const type = readText(value.type);
  const status = readText(value.status);
  const createdAt = readText(value.created_at);
  const isPayer = payerId === userId;
  const isPayee = payeeId === userId;
  if (!/^[1-9]\d*$/.test(id) || !Number.isFinite(Date.parse(createdAt))) return invalidResponse();
  if (!isPayer && !isPayee) {
    throw new LinuxDoCreditError('identity-mismatch', 'LDC 明细与当前账号不一致，请重新读取');
  }
  if (typeof value.payer_username !== 'string' || typeof value.payee_username !== 'string') return invalidResponse();
  if (value.payee_transfer_status !== 'pending' && value.payee_transfer_status !== 'completed')
    return invalidResponse();
  if (amount.startsWith('-') && type !== 'community') return invalidResponse();

  const settled = status === 'success' || status === 'disputing' || status === 'refused';
  const knownType = [
    'payment',
    'receive',
    'community',
    'online',
    'distribute',
    'transfer',
    'red_envelope_send',
    'red_envelope_receive',
    'red_envelope_refund'
  ].includes(type);
  let direction: LinuxDoCreditEntry['direction'] = 'neutral';
  // Refunds retain the original order amount; pending, failed and test orders are not balance changes.
  if (settled && knownType && isPayer !== isPayee && !/^-?0(?:\.0{1,2})?$/.test(amount)) {
    direction = isPayee !== amount.startsWith('-') ? 'income' : 'expense';
  }
  return {
    id,
    title: readText(value.order_name),
    amount,
    direction,
    status,
    type,
    createdAt,
    counterparty: isPayee ? value.payer_username : value.payee_username,
    settlementPending: settled && knownType && isPayee && value.payee_transfer_status === 'pending'
  };
}

export async function getLinuxDoCreditTransactions(
  options: LinuxDoCreditOptions & { page: number }
): Promise<LinuxDoCreditPage> {
  if (!Number.isSafeInteger(options.page) || options.page < 1) return invalidResponse();
  const account = await getLinuxDoCreditAccount(options);
  const data = await readCreditJson('/order/transactions', options, { page: options.page, page_size: PAGE_SIZE });
  if (
    !isRecord(data) ||
    data.page !== options.page ||
    data.page_size !== PAGE_SIZE ||
    typeof data.total !== 'number' ||
    !Number.isSafeInteger(data.total) ||
    data.total < 0 ||
    !Array.isArray(data.orders) ||
    data.orders.length > PAGE_SIZE ||
    data.orders.length > data.total
  ) {
    return invalidResponse();
  }
  const entries = data.orders.map((entry) => readEntry(entry, account.userId));
  if (new Set(entries.map((entry) => entry.id)).size !== entries.length) return invalidResponse();
  return {
    userId: account.userId,
    entries,
    page: options.page,
    total: data.total,
    nextPage: entries.length > 0 && options.page * PAGE_SIZE < data.total ? options.page + 1 : null
  };
}
