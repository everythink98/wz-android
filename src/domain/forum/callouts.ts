export const DISCOURSE_CALLOUT_ATTRIBUTE = 'data-forum-callout';
export const DISCOURSE_CALLOUT_TYPE_ATTRIBUTE = 'data-forum-callout-type';
export const DISCOURSE_CALLOUT_FOLD_ATTRIBUTE = 'data-forum-callout-fold';
export const DISCOURSE_CALLOUT_TITLE_CLASS = 'forum-callout-title';
export const DISCOURSE_CALLOUT_CONTENT_CLASS = 'forum-callout-content';
export const DISCOURSE_CALLOUT_TONE_CLASS_PREFIX = 'forum-callout-tone-';

export type DiscourseCalloutType =
  | 'note'
  | 'abstract'
  | 'info'
  | 'todo'
  | 'tip'
  | 'success'
  | 'question'
  | 'warning'
  | 'failure'
  | 'danger'
  | 'bug'
  | 'example'
  | 'quote';

export type DiscourseCalloutFold = 'collapsed' | 'expanded';
export type DiscourseCalloutTone = 'primary' | 'success' | 'warning' | 'danger' | 'muted';

export type DiscourseCalloutDefinition = {
  title: string;
  tone: DiscourseCalloutTone;
  type: DiscourseCalloutType;
};

const callout = (
  type: DiscourseCalloutType,
  title: string,
  tone: DiscourseCalloutTone
): DiscourseCalloutDefinition => ({ type, title, tone });

export const DISCOURSE_CALLOUT_REGISTRY: Readonly<Record<string, DiscourseCalloutDefinition>> = {
  note: callout('note', 'Note', 'primary'),
  abstract: callout('abstract', 'Abstract', 'primary'),
  summary: callout('abstract', 'Summary', 'primary'),
  tldr: callout('abstract', 'TLDR', 'primary'),
  info: callout('info', 'Info', 'primary'),
  todo: callout('todo', 'Todo', 'primary'),
  tip: callout('tip', 'Tip', 'primary'),
  hint: callout('tip', 'Hint', 'primary'),
  important: callout('tip', 'Important', 'primary'),
  success: callout('success', 'Success', 'success'),
  check: callout('success', 'Check', 'success'),
  done: callout('success', 'Done', 'success'),
  question: callout('question', 'Question', 'warning'),
  help: callout('question', 'Help', 'warning'),
  faq: callout('question', 'FAQ', 'warning'),
  warning: callout('warning', 'Warning', 'warning'),
  caution: callout('warning', 'Caution', 'warning'),
  attention: callout('warning', 'Attention', 'warning'),
  failure: callout('failure', 'Failure', 'danger'),
  fail: callout('failure', 'Fail', 'danger'),
  missing: callout('failure', 'Missing', 'danger'),
  danger: callout('danger', 'Danger', 'danger'),
  error: callout('danger', 'Error', 'danger'),
  bug: callout('bug', 'Bug', 'danger'),
  example: callout('example', 'Example', 'primary'),
  quote: callout('quote', 'Quote', 'muted'),
  cite: callout('quote', 'Cite', 'muted')
};

export function isDiscourseCalloutType(value: unknown): value is DiscourseCalloutType {
  const key = typeof value === 'string' ? value : '';
  return Boolean(key && DISCOURSE_CALLOUT_REGISTRY[key]?.type === key);
}
