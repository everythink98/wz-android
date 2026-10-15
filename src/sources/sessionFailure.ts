import { isRecord } from '@/domain/forum/html';
import { sourceCatalog, type Source } from '@/domain/forum/sourceCatalog';
import { isCloudflareChallengeResponse } from '@/platform/network/cloudflareChallenge';
import { withAbortableTimeout } from '@/platform/network/request';
import { discourseActionResponseMessage } from '@/sources/discourse/actionRequest';
import { linuxDoRequestError } from '@/sources/linuxdo/protocol';
import { errorRequiresAccountRecheck } from './sourceErrors';

export async function forumResponseAccountFailure(
  source: Source,
  input: string,
  response: Response,
  signal?: AbortSignal
): Promise<'http-401' | 'account-recheck-required' | undefined> {
  if (signal?.aborted || new URL(input).origin !== new URL(sourceCatalog[source].baseUrl).origin) return;
  if (response.status === 401) return 'http-401';
  if (source !== 'linuxdo' || ![403, 404].includes(response.status)) return;
  let body: string;
  try {
    body = await withAbortableTimeout(() => response.clone().text(), { signal });
  } catch {
    return;
  }
  if (
    signal?.aborted ||
    isCloudflareChallengeResponse({ headers: response.headers, status: response.status, bodyText: body })
  )
    return;
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    data = undefined;
  }
  const payload = Array.isArray(data) ? { errors: data.filter((value) => typeof value === 'string') } : data;
  const message = isRecord(payload) ? discourseActionResponseMessage(payload, body) : body;
  if (errorRequiresAccountRecheck(linuxDoRequestError(message, response.status, payload)))
    return 'account-recheck-required';
}
