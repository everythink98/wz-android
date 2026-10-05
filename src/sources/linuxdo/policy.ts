import type { DiscoursePostPolicy } from '@/domain/forum/discoursePolicy';
import type { Fetcher } from '@/platform/network/request';
import { runLinuxDoAction } from './actionClient';

export async function setLinuxDoPolicyAcceptance({
  policy,
  accepted,
  fetcher,
  signal,
  timeoutMs,
  userAgent
}: {
  policy: DiscoursePostPolicy;
  accepted: boolean;
  fetcher?: Fetcher;
  signal?: AbortSignal;
  timeoutMs?: number;
  userAgent?: string;
}): Promise<{ confirmed: boolean; message?: string }> {
  if (!/^[1-9]\d*$/.test(policy.postId)) throw new Error('公告帖子信息不完整');
  if (!(accepted ? policy.canAccept : policy.canRevoke)) throw new Error('原站未允许此公告操作，请刷新后重试');
  const result = await runLinuxDoAction({
    fetcher,
    signal,
    timeoutMs,
    userAgent,
    request: {
      path: accepted ? '/policy/accept' : '/policy/unaccept',
      method: 'PUT',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ post_id: policy.postId }).toString()
    }
  });
  return result.success === true || result.success === 'OK'
    ? { confirmed: true }
    : { confirmed: false, message: '原站尚未明确确认操作结果，请刷新公告核对' };
}
