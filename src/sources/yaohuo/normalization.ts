import { elementText, parseHtml } from '@/domain/forum/html';
import { YAOHUO_CATEGORIES } from './protocol';

export const categoryNames = new Map(YAOHUO_CATEGORIES.map((category) => [category.id, category.name]));

const BEIJING_OFFSET_MS = 8 * 3600 * 1000;

type YaohuoClock = { year: number; month: number; day: number; nowMs: number };

export function currentYaohuoClock(): YaohuoClock {
  const nowMs = Date.now();
  const beijingNow = new Date(nowMs + BEIJING_OFFSET_MS);
  return {
    year: beijingNow.getUTCFullYear(),
    month: beijingNow.getUTCMonth() + 1,
    day: beijingNow.getUTCDate(),
    nowMs
  };
}

export function parseYaohuoDate(value: unknown, now = currentYaohuoClock()) {
  const text = String(value || '').trim();
  const full = yaohuoFullDateText(text);
  const partial = yaohuoPartialDateText(text);
  const relative = parseYaohuoRelativeDate(text, now);
  const fullParts = full.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})\s+(\d{1,2}):(\d{1,2})/)?.slice(1);
  const partialParts = partial.match(/(\d{1,2})[-/](\d{1,2})\s+(\d{1,2}):(\d{1,2})/)?.slice(1);
  const parts = fullParts || (partialParts ? [String(now.year), ...partialParts] : null);
  if (relative) {
    return relative;
  }
  if (!parts) {
    return '';
  }
  let [year, month, day, hour, minute] = parts.map(Number);
  if (!full && month > now.month) {
    year -= 1;
  }
  const date = beijingDateToIso(year, month, day, hour, minute);
  return date || '';
}

function yaohuoFullDateText(text: string) {
  return text.match(/\d{4}[-/]\d{1,2}[-/]\d{1,2}\s+\d{1,2}:\d{1,2}/)?.[0] || '';
}

function yaohuoPartialDateText(text: string) {
  if (yaohuoFullDateText(text)) {
    return '';
  }
  return text.match(/\d{1,2}[-/]\d{1,2}\s+\d{1,2}:\d{1,2}/)?.[0] || '';
}

function yaohuoRelativeDateText(text: string) {
  return (
    text.match(
      /(?:刚刚|刚才|\d{1,4}\s*(?:分钟|小时|天)前|(?:今天|昨天|前天)\s*(?:(?:午夜|凌晨|上午|中午|下午|晚上)\s*)?\d{1,2}:\d{1,2}|(?:今天|昨天|前天)\s*(?:午夜|凌晨|上午|中午|下午|晚上))/
    )?.[0] || ''
  );
}

export function yaohuoDisplayTimeText(text: string) {
  return yaohuoFullDateText(text) || yaohuoPartialDateText(text) || yaohuoRelativeDateText(text);
}

function beijingDateToIso(year: number, month: number, day: number, hour: number, minute: number) {
  const date = new Date(Date.UTC(year, month - 1, day, hour - 8, minute));
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function parseYaohuoRelativeDate(text: string, now: YaohuoClock) {
  const numericRelative = text.match(/^(\d{1,4})\s*(分钟|小时|天)前$/);
  if (/^(刚刚|刚才)$/.test(text)) {
    return new Date(now.nowMs).toISOString();
  }
  if (numericRelative) {
    const value = Number(numericRelative[1]);
    const unit = numericRelative[2];
    const unitMs = unit === '分钟' ? 60_000 : unit === '小时' ? 60 * 60_000 : 24 * 60 * 60_000;
    return new Date(now.nowMs - value * unitMs).toISOString();
  }
  const dayAndTime = text.match(/(今天|昨天|前天)\s*(?:(午夜|凌晨|上午|中午|下午|晚上)\s*)?(\d{1,2}):(\d{1,2})/);
  const periodTime = text.match(/(?:(今天|昨天|前天)\s*)?(午夜|凌晨|上午|中午|下午|晚上)(?:\s*(\d{1,2}):(\d{1,2}))?/);
  const match = dayAndTime || periodTime;
  if (!match) {
    return '';
  }
  const dayWord = match[1] || '今天';
  const period = match[2] || '';
  const rawHour = match[3] === undefined ? undefined : Number(match[3]);
  const minute = match[4] === undefined ? 0 : Number(match[4]);
  const dayOffset = dayWord === '前天' ? 2 : dayWord === '昨天' ? 1 : 0;
  const beijingDay = new Date(Date.UTC(now.year, now.month - 1, now.day - dayOffset, 0, 0));
  const hour = normalizeYaohuoRelativeHour(period, rawHour);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || minute < 0 || minute > 59) {
    return '';
  }
  return beijingDateToIso(
    beijingDay.getUTCFullYear(),
    beijingDay.getUTCMonth() + 1,
    beijingDay.getUTCDate(),
    hour,
    minute
  );
}

function normalizeYaohuoRelativeHour(period: string, rawHour?: number) {
  let hour = rawHour;
  if (hour === undefined) {
    hour = period === '中午' ? 12 : 0;
  }
  if (hour < 0 || hour > 23) {
    return NaN;
  }
  if ((period === '下午' || period === '晚上') && hour < 12) {
    return hour + 12;
  }
  if (period === '中午' && hour < 11) {
    return hour + 12;
  }
  if ((period === '午夜' || period === '凌晨' || period === '上午') && hour === 12) {
    return 0;
  }
  return hour;
}

export function profileStats(root: ReturnType<typeof parseHtml>, text: string) {
  const topicCount = profileStructuredStatValue(root, 'posts') ?? profileStatValue(text, '主题|帖子|贴子|发帖');
  const replyCount = profileStructuredStatValue(root, 'replies') ?? profileStatValue(text, '回复|回帖');
  return {
    topicCount,
    replyCount,
    postCount: topicCount !== undefined && replyCount !== undefined ? topicCount + replyCount : undefined
  };
}

function profileStatNumber(value: unknown) {
  const text = String(value ?? '')
    .replace(/,/g, '')
    .trim();
  return /^\d+$/.test(text) ? Number(text) : undefined;
}

function profileStructuredStatValue(root: ReturnType<typeof parseHtml>, className: string) {
  for (const element of root.querySelectorAll('.uinfo-stat')) {
    const classes = String(element.getAttribute('class') || '').split(/\s+/);
    if (!classes.includes(className)) {
      continue;
    }
    return profileStatNumber(elementText(element.querySelector('.value')));
  }
  return undefined;
}

function profileStatValue(text: string, labels: string) {
  const match = text.match(new RegExp(`(?:^|[^\\d])(?:${labels})\\s*(?:[:：]?\\s*|[（(]\\s*)([\\d,]{1,6})(?!\\d)`));
  return profileStatNumber(match?.[1]);
}

function cleanYaohuoLevelLabel(value: unknown) {
  const text = String(value || '')
    .replace(/\s+/g, '')
    .trim();
  return /^\d{1,3}级/.test(text) && text.length <= 32 ? text : '';
}

export function yaohuoProfileLevelLabel(text: string) {
  return (
    cleanYaohuoLevelLabel(text.match(/【等级】\s*([^【\s]+)/)?.[1]) ||
    cleanYaohuoLevelLabel(text.match(/(\d{1,3}\s*级)\s*等级/)?.[1]) ||
    cleanYaohuoLevelLabel(text.match(/经验值\s*[:：]\s*[\d,]+\s*(\d{1,3}\s*级)/)?.[1]) ||
    undefined
  );
}

export function yaohuoAuthorLevelLabel(text: string) {
  for (const match of text.matchAll(/[（(]([^（）()]{0,32}\d{1,3}\s*级[^（）()]{0,32})[)）]/g)) {
    const levelLabel = cleanYaohuoLevelLabel(match[1]);
    if (levelLabel) {
      return levelLabel;
    }
  }
  return undefined;
}

export function safeYaohuoProfileName(value: unknown) {
  const text = String(value || '').trim();
  if (!text || text.length > 32 || /正在论坛|查看更多|动态|人气|留言板|我的地盘|小时前|分钟前|今天|昨天/.test(text)) {
    return '';
  }
  return text;
}

export function safeYaohuoCurrentUserName(value: unknown) {
  const text = safeYaohuoProfileName(value);
  return text && !/^(我的|个人|空间|资料|消息|退出|用户中心|个人中心|我的地盘)$/.test(text) ? text : '';
}

export function topicTitle(root: ReturnType<typeof parseHtml>) {
  const content = elementText(root.querySelector('div.content'));
  return (
    content.match(/\[标题\]\s*(.*?)\s*\(阅/i)?.[1]?.trim() ||
    elementText(root.querySelector('title'))
      .replace(/[-_].*$/, '')
      .trim()
  );
}
