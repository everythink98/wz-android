import type { HTMLElement } from 'node-html-parser';
import { decodeHtml, escapeHtmlAttribute, escapeHtmlText, parseHtml } from '@/domain/forum/html';
import { nodeSeekStardustMarkerRanges, type NodeSeekStardustReceive } from '@/domain/forum/structuredComposer';

export const NODESEEK_STARDUST_PLACEHOLDER_TAG = 'forum-nodeseek-stardust';

export function nodeSeekStardustPlaceholderHtml(receive: NodeSeekStardustReceive) {
  return `<${NODESEEK_STARDUST_PLACEHOLDER_TAG} member-id="${escapeHtmlAttribute(
    receive.receiverMemberId
  )}" amount="${receive.amount}" ref-id="${receive.refId}" description="${escapeHtmlAttribute(
    encodeURIComponent(receive.description)
  )}" data-one-time="${receive.oneTime ? 'true' : 'false'}"></${NODESEEK_STARDUST_PLACEHOLDER_TAG}>`;
}

function normalizeTextNode(parent: HTMLElement, childIndex: number) {
  const child = parent.childNodes[childIndex];
  if (!child || child.nodeType !== 3) return 0;
  const text = child.text;
  const ranges = nodeSeekStardustMarkerRanges(text).filter((range) => range.receive);
  if (!ranges.length) return 0;
  let cursor = 0;
  const replacementHtml = ranges
    .map((range) => {
      const prefix = escapeHtmlText(text.slice(cursor, range.from));
      cursor = range.to;
      return `${prefix}${nodeSeekStardustPlaceholderHtml(range.receive!)}`;
    })
    .join('');
  const replacement = parseHtml(`${replacementHtml}${escapeHtmlText(text.slice(cursor))}`).childNodes;
  replacement.forEach((node) => {
    node.parentNode = parent;
  });
  parent.childNodes.splice(childIndex, 1, ...replacement);
  return replacement.length - 1;
}

function completeStardustMarker(value: string) {
  const marker = decodeHtml(value).trim();
  const [range, ...extra] = nodeSeekStardustMarkerRanges(marker);
  return !extra.length && range?.from === 0 && range.to === marker.length ? range.receive : undefined;
}

export function normalizeNodeSeekStardustMarkers(root: HTMLElement) {
  const visit = (element: HTMLElement) => {
    const tag = String(element.rawTagName || '').toLowerCase();
    if (tag === 'pre' || tag === 'code') return;
    if (tag === 'a') {
      const dataHref = element.getAttribute('data-href');
      const receive = completeStardustMarker(dataHref ?? element.textContent ?? '');
      if (receive) element.replaceWith(nodeSeekStardustPlaceholderHtml(receive));
      return;
    }
    for (let index = 0; index < element.childNodes.length; index += 1) {
      const child = element.childNodes[index];
      if (child?.nodeType === 1) visit(child as HTMLElement);
      else index += normalizeTextNode(element, index);
    }
  };
  visit(root);
}

export function nodeSeekStardustReceiveFromAttributes(attributes: Record<string, string>) {
  const receiverMemberId = String(attributes['member-id'] || '').trim();
  const amount = Number(attributes.amount);
  const refId = Number(attributes['ref-id']);
  const oneTime = attributes['data-one-time'] === 'true';
  let description = '';
  try {
    description = decodeURIComponent(attributes.description || '');
  } catch {
    return null;
  }
  if (!/^\d+$/.test(receiverMemberId) || !Number.isSafeInteger(amount) || amount <= 0) return null;
  if (!Number.isSafeInteger(refId) || refId <= 0) return null;
  return { receiverMemberId, amount, refId, description, oneTime } satisfies NodeSeekStardustReceive;
}
