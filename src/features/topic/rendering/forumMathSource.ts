type TextCarrier = { data?: unknown; children?: readonly unknown[] };

function rawText(node: unknown): string {
  if (!node || typeof node !== 'object') return '';
  const { data, children } = node as TextCarrier;
  if (typeof data === 'string') return data;
  return children?.map(rawText).join('') || '';
}

export function forumMathSource(tnode: { data?: string; domNode?: unknown; children: readonly unknown[] }) {
  return (tnode.data || rawText(tnode.domNode) || tnode.children.map(rawText).join('')).trim();
}
