import type { TextStyle } from 'react-native';
import { type ReaderSettings } from '@/domain/reader/readerData';
import type { Source } from '@/domain/forum/models';

export type ReaderStyleSettings = Pick<
  ReaderSettings,
  'theme' | 'fontScale' | 'listDensity' | 'lineHeight' | 'contentWidth' | 'fontFamily'
>;

export interface ReaderTheme {
  dark: boolean;
  background: string;
  surface: string;
  surface2: string;
  line: string;
  lineStrong: string;
  ink: string;
  muted: string;
  primary: string;
  primaryStrong: string;
  primarySoft: string;
  mist: string;
  onPrimary: string;
  onOverlay: string;
  danger: string;
  warning: string;
  success: string;
  favorite: string;
}

export const LINK_COLOR = '#1677FF';

export const readerRadii = {
  badge: 5,
  content: 10,
  control: 10,
  surface: 14,
  sheet: 20,
  pill: 999
};

export function lineHeightMultiplier(value: ReaderSettings['lineHeight']) {
  if (value === 'compact') {
    return 1.4;
  }
  if (value === 'loose') {
    return 1.7;
  }
  return 1.5;
}

export function contentWidthValue(value: ReaderSettings['contentWidth']) {
  if (value === 'narrow') {
    return 640;
  }
  if (value === 'wide') {
    return 820;
  }
  return 720;
}

export function fontFamilyValue(value: ReaderSettings['fontFamily']) {
  return value === 'serif' ? 'serif' : undefined;
}

export function alphaColor(hex: string, alpha: number) {
  const clean = hex.replace('#', '');
  const value = Number.parseInt(clean, 16);
  const red = (value >> 16) & 255;
  const green = (value >> 8) & 255;
  const blue = value & 255;
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

export type StatusBadgeTone = 'accent' | 'danger' | 'info' | 'neutral' | 'success' | 'warning';

type ChipTone = { light: { background: string; ink: string }; dark: { background: string; ink: string } };

// Radix step 3 backgrounds and step 11 text, darkened slightly where needed for 4.5:1 contrast.
const TOPIC_TAG_TONES: ChipTone[] = [
  { light: { background: '#E6F4FE', ink: '#0D6EC4' }, dark: { background: '#0D2847', ink: '#70B8FF' } },
  { light: { background: '#FEE9F5', ink: '#C12989' }, dark: { background: '#37172F', ink: '#FF8DCC' } },
  { light: { background: '#E0F8F3', ink: '#027C6C' }, dark: { background: '#0D2D2A', ink: '#0BD8B6' } },
  { light: { background: '#F4F0FE', ink: '#6550B9' }, dark: { background: '#291F43', ink: '#BAA7FF' } },
  { light: { background: '#FFEFD6', ink: '#B94905' }, dark: { background: '#331E0B', ink: '#FFA057' } },
  { light: { background: '#DEF7F9', ink: '#107791' }, dark: { background: '#082C36', ink: '#4CCCE6' } },
  { light: { background: '#FFE9F0', ink: '#CB1D63' }, dark: { background: '#381525', ink: '#FF92AD' } },
  { light: { background: '#EDF2FE', ink: '#3A5BC7' }, dark: { background: '#182449', ink: '#9EB1FF' } }
];

const SOURCE_BADGE_COLORS: Record<Source, { dark: string; light: string }> = {
  v2ex: { light: '#6D8AA8', dark: '#9FB6CF' },
  linuxdo: { light: '#B08A5E', dark: '#D4B790' },
  nodeseek: { light: '#1677FF', dark: '#5B9CFF' },
  yaohuo: { light: '#A8788E', dark: '#D0A6B6' }
};

function chipToneStyle(color: string, theme: ReaderTheme): TextStyle {
  return {
    backgroundColor: theme.surface2,
    borderColor: theme.line,
    color
  };
}

function statusToneColor(tone: StatusBadgeTone, theme: ReaderTheme) {
  if (tone === 'danger') {
    return theme.danger;
  }
  if (tone === 'warning') {
    return theme.warning;
  }
  if (tone === 'neutral') {
    return theme.muted;
  }
  return theme.primary;
}

function stableToneIndex(label: string, toneCount: number) {
  let hash = 0;
  const text = label.trim().toLowerCase();
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) | 0;
  }
  return Math.abs(hash) % toneCount;
}

function topicTagTone(label: string, theme: ReaderTheme, tags: readonly string[]) {
  const normalized = label.trim().toLowerCase();
  const labels = [...new Set([label, ...tags].map((tag) => tag.trim().toLowerCase()))].sort();
  const used = new Set<number>();
  let toneIndex = 0;
  for (const tag of labels) {
    toneIndex = stableToneIndex(tag, TOPIC_TAG_TONES.length);
    // shortcut: Groups above eight distinct tags reuse hues; expand the palette if they become common.
    while (used.has(toneIndex) && used.size < TOPIC_TAG_TONES.length) {
      toneIndex = (toneIndex + 1) % TOPIC_TAG_TONES.length;
    }
    if (tag === normalized) break;
    used.add(toneIndex);
  }
  const tone = TOPIC_TAG_TONES[toneIndex];
  return theme.dark ? tone.dark : tone.light;
}

export function topicTagColorStyle(label: string, theme: ReaderTheme, tags: readonly string[] = []): TextStyle {
  const tone = topicTagTone(label, theme, tags);
  return {
    backgroundColor: tone.background,
    borderColor: 'transparent',
    color: tone.ink
  };
}

export function topicTagTextColorStyle(label: string, theme: ReaderTheme, tags: readonly string[] = []): TextStyle {
  return { color: topicTagTone(label, theme, tags).ink };
}

export function topicStatusBadgeColorStyle(tone: StatusBadgeTone, theme: ReaderTheme): TextStyle {
  return chipToneStyle(statusToneColor(tone, theme), theme);
}

export function topicStatusBadgeTextColorStyle(tone: StatusBadgeTone, theme: ReaderTheme): TextStyle {
  return { color: statusToneColor(tone, theme) };
}

export function replyContextBadgeStyle(tone: StatusBadgeTone, theme: ReaderTheme): TextStyle {
  return chipToneStyle(statusToneColor(tone, theme), theme);
}

export function sourceBadgeColorStyle(source: Source, theme: ReaderTheme): TextStyle {
  const color = SOURCE_BADGE_COLORS[source][theme.dark ? 'dark' : 'light'];
  return {
    backgroundColor: 'transparent',
    borderColor: 'transparent',
    color
  };
}

export function createTheme(settings: Pick<ReaderStyleSettings, 'theme'>): ReaderTheme {
  const dark = settings.theme === 'dark';
  const favorite = { light: '#facc15', dark: '#fde047' };
  if (dark) {
    return {
      dark: true,
      background: '#111113',
      surface: '#18191B',
      surface2: '#212225',
      line: '#2E3135',
      lineStrong: '#43484E',
      ink: '#EDEEF0',
      muted: '#B0B4BA',
      primary: '#5B9CFF',
      primaryStrong: '#1677FF',
      primarySoft: 'rgba(22, 119, 255, 0.16)',
      mist: 'rgba(22, 119, 255, 0.16)',
      onPrimary: '#111113',
      onOverlay: '#EDEEF0',
      danger: '#FF9592',
      warning: '#FFCA16',
      success: '#5B9CFF',
      favorite: favorite.dark
    };
  }
  return {
    dark: false,
    background: '#F9F9FB',
    surface: '#FFFFFF',
    surface2: '#F0F0F3',
    line: '#E8E8EC',
    lineStrong: '#CDCED6',
    ink: '#1C2024',
    muted: '#60646C',
    primary: '#1677FF',
    primaryStrong: '#0958D9',
    primarySoft: 'rgba(22, 119, 255, 0.10)',
    mist: 'rgba(22, 119, 255, 0.10)',
    onPrimary: '#FFFFFF',
    onOverlay: '#FFFFFF',
    danger: '#CE2C31',
    warning: '#AB6400',
    success: '#1677FF',
    favorite: favorite.light
  };
}
