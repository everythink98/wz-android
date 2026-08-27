export type LinuxDoPollType = 'regular' | 'multiple' | 'number' | 'ranked_choice';
export type LinuxDoPollResults = 'always' | 'on_vote' | 'on_close' | 'staff_only';
export type LinuxDoPollGroup = { id: number; name: string; displayName: string };
export type LinuxDoPollCapabilities = { groups: LinuxDoPollGroup[]; canUseStaffResults: boolean };
export type LinuxDoPollDraft = {
  type: LinuxDoPollType;
  name: string;
  title: string;
  options: string[];
  results: LinuxDoPollResults;
  min: number;
  max: number;
  step: number;
  publicPoll: boolean;
  chartType: 'bar' | 'pie';
  dynamic: boolean;
  groups: string[];
  close: string;
  status: string;
  unknownAttributes: string[];
  unknownBodyLines: string[];
};

export function emptyLinuxDoPoll(): LinuxDoPollDraft {
  return {
    type: 'regular',
    name: '',
    title: '',
    options: ['选项一', '选项二'],
    results: 'always',
    min: 1,
    max: 2,
    step: 1,
    publicPoll: false,
    chartType: 'bar',
    dynamic: false,
    groups: [],
    close: '',
    status: '',
    unknownAttributes: [],
    unknownBodyLines: []
  };
}

const KNOWN_ATTRIBUTES = new Set([
  'type',
  'name',
  'results',
  'min',
  'max',
  'step',
  'public',
  'charttype',
  'dynamic',
  'groups',
  'close',
  'status'
]);

function integer(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function unquote(value: string) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

export function parseLinuxDoPoll(raw: string): LinuxDoPollDraft | null {
  const match = raw.match(/^\[poll([^\]]*)\]\r?\n?([\s\S]*?)\r?\n?\[\/poll\]$/i);
  if (!match) return null;
  const values = new Map<string, string>();
  const unknownAttributes: string[] = [];
  for (const attribute of match[1]!.matchAll(/([^\s=]+)(?:=("[^"]*"|'[^']*'|[^\s]+))?/g)) {
    const rawAttribute = attribute[0];
    const key = String(attribute[1] || '').toLowerCase();
    const value = unquote(String(attribute[2] || ''));
    if (KNOWN_ATTRIBUTES.has(key)) values.set(key, value);
    else unknownAttributes.push(rawAttribute);
  }
  const type = values.get('type');
  const results = values.get('results');
  const chartType = values.get('charttype');
  const options: string[] = [];
  const unknownBodyLines: string[] = [];
  let title = '';
  String(match[2] || '')
    .split(/\r?\n/)
    .forEach((line) => {
      if (!title && /^#\s+/.test(line)) title = line.replace(/^#\s+/, '').trim();
      else if (/^\s*\*\s+/.test(line)) options.push(line.replace(/^\s*\*\s+/, '').trim());
      else if (line.trim()) unknownBodyLines.push(line);
    });
  return {
    type: type === 'multiple' || type === 'number' || type === 'ranked_choice' ? type : 'regular',
    name: values.get('name') || '',
    title,
    options,
    results: results === 'on_vote' || results === 'on_close' || results === 'staff_only' ? results : 'always',
    min: integer(values.get('min'), 1),
    max: integer(values.get('max'), Math.max(2, options.length)),
    step: Math.max(1, integer(values.get('step'), 1)),
    publicPoll: values.get('public') === 'true',
    chartType: chartType === 'pie' ? 'pie' : 'bar',
    dynamic: values.get('dynamic') === 'true',
    groups: (values.get('groups') || '')
      .split(',')
      .map((group) => group.trim())
      .filter(Boolean),
    close: values.get('close') || '',
    status: values.get('status') || '',
    unknownAttributes,
    unknownBodyLines
  };
}

function cleanInline(value: string) {
  return value.replace(/[\r\n]/g, ' ').trim();
}

export function serializeLinuxDoPoll(draft: LinuxDoPollDraft) {
  const options = draft.options.map(cleanInline).filter(Boolean);
  if (draft.type !== 'number' && options.length < 1) throw new Error('投票至少需要一个选项');
  if (new Set(options).size !== options.length) throw new Error('投票选项不能重复');
  if (!Number.isSafeInteger(draft.min) || draft.min < 0) throw new Error('最小值不正确');
  if (!Number.isSafeInteger(draft.max) || draft.max < draft.min) throw new Error('最大值不正确');
  if (!Number.isSafeInteger(draft.step) || draft.step < 1) throw new Error('步长不正确');
  if (draft.type === 'multiple' && draft.max > options.length) throw new Error('最大选择数不能超过选项数');
  const attributes = [
    draft.name ? `name=${cleanInline(draft.name)}` : '',
    `type=${draft.type}`,
    `results=${draft.results}`,
    draft.type === 'multiple' || draft.type === 'number' ? `min=${draft.min}` : '',
    draft.type === 'multiple' || draft.type === 'number' ? `max=${draft.max}` : '',
    draft.type === 'number' ? `step=${draft.step}` : '',
    `public=${draft.publicPoll ? 'true' : 'false'}`,
    draft.type === 'regular' || draft.type === 'multiple' ? `chartType=${draft.chartType}` : '',
    draft.dynamic ? 'dynamic=true' : '',
    draft.groups.length
      ? `groups=${[...new Set(draft.groups.map((group) => cleanInline(group).replace(/\s+/g, '')).filter(Boolean))].join(',')}`
      : '',
    draft.close.trim() ? `close=${cleanInline(draft.close)}` : '',
    draft.status.trim() ? `status=${cleanInline(draft.status)}` : '',
    ...draft.unknownAttributes.filter((value) => value && !value.includes(']'))
  ].filter(Boolean);
  const body = [
    draft.title.trim() ? `# ${cleanInline(draft.title)}` : '',
    ...(draft.type === 'number' ? [] : options.map((option) => `* ${option}`)),
    ...draft.unknownBodyLines
  ].filter(Boolean);
  return `[poll ${attributes.join(' ')}]\n${body.join('\n')}\n[/poll]`;
}
