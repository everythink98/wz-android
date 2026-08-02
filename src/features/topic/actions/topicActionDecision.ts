import type { Reply, TopicDetail, TopicPoll } from '@/domain/forum/models';
import { sourceSupportsTopicAction, type TopicActionCapability } from '@/domain/forum/sourceCatalog';
import type { SiteSessionViewModel } from '@/domain/session/siteSessionState';

export type TopicActionDecisionReason =
  | 'allowed'
  | 'unsupported'
  | 'login-required'
  | 'identity-pending'
  | 'object-forbidden'
  | 'missing-target'
  | 'already-complete'
  | 'pending';

export type TopicActionDecision = {
  allowed: boolean;
  reason: TopicActionDecisionReason;
};

export type TopicActionDecisionRequest = {
  action: TopicActionCapability;
  actionKey?: string;
  alreadyComplete?: boolean;
  objectAllowed?: boolean;
  pending?: boolean;
  poll?: TopicPoll;
  reply?: Reply;
  targetPresent?: boolean;
};

export type TopicActionDecisionFor = (request: TopicActionDecisionRequest) => TopicActionDecision;

export function topicActionDecisionMessage(decision: TopicActionDecision) {
  switch (decision.reason) {
    case 'unsupported':
      return '当前来源不支持此操作';
    case 'login-required':
      return '请先登录后再操作';
    case 'identity-pending':
      return '登录状态待确认，请稍后重试';
    case 'object-forbidden':
      return '当前内容不允许此操作';
    case 'missing-target':
      return '当前操作目标不完整，请刷新后重试';
    case 'already-complete':
      return '当前操作已经完成';
    case 'pending':
      return '操作正在提交，请勿重复操作';
    case 'allowed':
      return '';
  }
}

export function decideTopicAction({
  account,
  action,
  alreadyComplete = false,
  objectAllowed = true,
  pending = false,
  targetPresent = true,
  topic
}: {
  account?: SiteSessionViewModel;
  action: TopicActionCapability;
  alreadyComplete?: boolean;
  objectAllowed?: boolean;
  pending?: boolean;
  targetPresent?: boolean;
  topic: TopicDetail | null;
}): TopicActionDecision {
  if (!topic?.id) return { allowed: false, reason: 'missing-target' };
  if (!sourceSupportsTopicAction(topic.source, action)) return { allowed: false, reason: 'unsupported' };
  if (account?.identityTrust === 'pending') return { allowed: false, reason: 'identity-pending' };
  if (!account?.canWrite) return { allowed: false, reason: 'login-required' };
  if (!objectAllowed) return { allowed: false, reason: 'object-forbidden' };
  if (!targetPresent) return { allowed: false, reason: 'missing-target' };
  if (alreadyComplete) return { allowed: false, reason: 'already-complete' };
  if (pending) return { allowed: false, reason: 'pending' };
  return { allowed: true, reason: 'allowed' };
}
