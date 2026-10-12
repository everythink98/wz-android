import { parse, type HTMLElement } from 'node-html-parser';
import type { DiscoursePostPolicy } from '@/domain/forum/discoursePolicy';
import { isRecord, transformForumElements } from '@/domain/forum/html';

export function discoursePostPolicy(raw: unknown): DiscoursePostPolicy | undefined {
  if (!isRecord(raw) || typeof raw.cooked !== 'string') return undefined;
  const postId = typeof raw.id === 'number' || typeof raw.id === 'string' ? Number(raw.id) : Number.NaN;
  if (
    !Number.isSafeInteger(postId) ||
    postId <= 0 ||
    typeof raw.policy_can_accept !== 'boolean' ||
    typeof raw.policy_can_revoke !== 'boolean' ||
    typeof raw.policy_accepted !== 'boolean' ||
    typeof raw.policy_revoked !== 'boolean' ||
    (raw.policy_accepted && raw.policy_revoked)
  )
    return undefined;
  const policy = parse(raw.cooked).querySelector('.policy');
  if (!policy) return undefined;
  return {
    postId: String(postId),
    version: policy.getAttribute('data-version')?.trim() || '1',
    acceptLabel: policy.getAttribute('data-accept')?.trim() || '接受',
    revokeLabel: policy.getAttribute('data-revoke')?.trim() || '撤销接受',
    accepted: raw.policy_accepted,
    revoked: raw.policy_revoked,
    canAccept: raw.policy_can_accept,
    canRevoke: raw.policy_can_revoke
  };
}

export function normalizeDiscoursePolicyMarkup(root: HTMLElement) {
  const selected: HTMLElement[] = [];
  const pending = root.children.map((node) => ({ node, insidePolicy: false })).reverse();
  while (pending.length) {
    const { node, insidePolicy } = pending.pop()!;
    if (insidePolicy && node.matches('.policy-footer, .policy-actions, .policy-preview')) selected.push(node);
    const nextInsidePolicy = insidePolicy || node.matches('.policy');
    const children = node.children;
    for (let index = children.length - 1; index >= 0; index--) {
      pending.push({ node: children[index], insidePolicy: nextInsidePolicy });
    }
  }
  transformForumElements(root, selected, () => []);
}
