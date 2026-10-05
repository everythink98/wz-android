import type { Reply, TopicDetail, TopicPoll } from '@/domain/forum/models';
import type { InteractionType } from '@/domain/forum/topicActionState';
import { sourceSupportsTopicAction, type TopicActionCapability } from '@/domain/forum/sourceCatalog';
import type { SiteSessionViewModel } from '@/domain/session/siteSessionState';

export type TopicActionDecisionReason =
  | 'allowed'
  | 'unsupported'
  | 'login-required'
  | 'identity-pending'
  | 'identity-unavailable'
  | 'object-forbidden'
  | 'topic-ended'
  | 'topic-closed'
  | 'missing-target'
  | 'already-complete'
  | 'pending';

export type TopicActionDecision = {
  allowed: boolean;
  reason: TopicActionDecisionReason;
};

export type TopicActionDecisionRequest = {
  action: TopicActionCapability | 'policy';
  actionKey?: string;
  alreadyComplete?: boolean;
  interaction?: InteractionType;
  objectAllowed?: boolean;
  pending?: boolean;
  poll?: TopicPoll;
  reply?: Reply;
  target?: Reply | TopicDetail;
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
    case 'identity-unavailable':
      return '账号状态暂不可确认，请重试账号核对';
    case 'object-forbidden':
      return '当前内容不允许此操作';
    case 'topic-ended':
      return '本帖已结束，无法回复';
    case 'topic-closed':
      return '本帖已关闭，无法回复';
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
  reply,
  targetPresent = true,
  topic
}: {
  account?: SiteSessionViewModel;
  action: TopicActionDecisionRequest['action'];
  alreadyComplete?: boolean;
  objectAllowed?: boolean;
  pending?: boolean;
  reply?: Reply;
  targetPresent?: boolean;
  topic: TopicDetail | null;
}): TopicActionDecision {
  if (!topic?.id) return { allowed: false, reason: 'missing-target' };
  if (action === 'policy' ? topic.source !== 'linuxdo' : !sourceSupportsTopicAction(topic.source, action)) {
    return { allowed: false, reason: 'unsupported' };
  }
  if (
    topic.closed &&
    (action === 'reply' || (action === 'upload' && !(topic.source === 'linuxdo' && reply?.canEdit === true)))
  ) {
    return { allowed: false, reason: topic.source === 'yaohuo' ? 'topic-ended' : 'topic-closed' };
  }
  if (account?.identityTrust === 'unknown') return { allowed: false, reason: 'identity-unavailable' };
  if (!account?.canWrite) return { allowed: false, reason: 'login-required' };
  if (!objectAllowed) return { allowed: false, reason: 'object-forbidden' };
  if (!targetPresent) return { allowed: false, reason: 'missing-target' };
  if (pending) return { allowed: false, reason: 'pending' };
  if (alreadyComplete) return { allowed: false, reason: 'already-complete' };
  return { allowed: true, reason: 'allowed' };
}
