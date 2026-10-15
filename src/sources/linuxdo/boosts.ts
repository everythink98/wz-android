import { HTMLElement, TextNode, type Node } from 'node-html-parser';
import { absoluteUrl, isRecord, parseHtml } from '@/domain/forum/html';
import type { DiscourseBoost, Reply } from '@/domain/forum/models';
import { LINUXDO_BASE_URL, linuxDoAvatarUrl, linuxDoUserUrl } from './protocol';

export function linuxDoBoostFromData(value: unknown): DiscourseBoost | null {
  if (!isRecord(value) || !Number.isSafeInteger(value.id) || Number(value.id) <= 0 || !isRecord(value.user))
    return null;
  const username = typeof value.user.username === 'string' ? value.user.username.trim() : '';
  if (!username || typeof value.cooked !== 'string') return null;
  const content: DiscourseBoost['content'] = [];
  function visit(node: Node) {
    if (node instanceof TextNode) {
      if (node.text) content.push({ text: node.text });
      return;
    }
    if (!(node instanceof HTMLElement) || ['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(node.tagName)) return;
    if (node.tagName === 'IMG') {
      const emoji = node.getAttribute('alt') || '';
      const imageUrl = absoluteUrl(node.getAttribute('src'), LINUXDO_BASE_URL);
      if (
        (node.getAttribute('class') || '').split(/\s+/).includes('emoji') &&
        imageUrl &&
        /^https?:\/\//.test(imageUrl)
      ) {
        content.push({ emoji, imageUrl });
      } else if (emoji) content.push({ text: emoji });
      return;
    }
    node.childNodes.forEach(visit);
  }
  parseHtml(value.cooked).childNodes.forEach(visit);
  if (!content.length) return null;
  return {
    id: Number(value.id),
    user: {
      source: 'linuxdo',
      ...(typeof value.user.id === 'number' ? { id: String(value.user.id) } : {}),
      username,
      displayName: typeof value.user.name === 'string' ? value.user.name : username,
      avatar: linuxDoAvatarUrl(value.user.avatar_template),
      url: linuxDoUserUrl(username)
    },
    content,
    canDelete: value.can_delete === true
  };
}

export function linuxDoBoostFields(value: Record<string, unknown>): NonNullable<Reply['siteExtension']> {
  const seen = new Set<number>();
  const boosts = Array.isArray(value.boosts)
    ? value.boosts.flatMap((item) => {
        const boost = linuxDoBoostFromData(item);
        if (!boost || seen.has(boost.id)) return [];
        seen.add(boost.id);
        return [boost];
      })
    : undefined;
  return {
    ...(boosts ? { boosts } : {}),
    ...(typeof value.can_boost === 'boolean' ? { canBoost: value.can_boost } : {})
  };
}
