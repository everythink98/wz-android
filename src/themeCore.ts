import type { TextStyle } from 'react-native';
import { type ReaderSettings } from './readerData';
import type { Source } from './types';

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

export function androidRipple(color: string, borderless = false) {
  return { color, borderless };
}

export function lineHeightMultiplier(value: ReaderSettings['lineHeight']) {
  if (value === 'compact') {
    return 1.45;
  }
  if (value === 'loose') {
    return 1.82;
  }
  return 1.62;
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

type ChipTone = { light: string; dark: string };

const TOPIC_TAG_TONES: ChipTone[] = [
  { light: '#2f6555', dark: '#9fd0bf' },
  { light: '#386f8f', dark: '#9fc7e3' },
  { light: '#8a6430', dark: '#dfbd78' },
  { light: '#8f5963', dark: '#dfacb4' },
  { light: '#6b5d91', dark: '#c0b2e0' },
  { light: '#2d7072', dark: '#94d2d2' },
  { light: '#657333', dark: '#c8d88a' },
  { light: '#5d6874', dark: '#b8c2ca' }
];

const SOURCE_BADGE_COLORS: Record<Source, { dark: string; light: string }> = {
  v2ex: { light: '#6D8AA8', dark: '#9FB6CF' },
  linuxdo: { light: '#B08A5E', dark: '#D4B790' },
  nodeseek: { light: '#1677FF', dark: '#5B9CFF' },
  yaohuo: { light: '#A8788E', dark: '#D0A6B6' },
  xiaoyinsi: { light: '#7C6AA6', dark: '#B9AADE' }
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

function topicTagColor(label: string, theme: ReaderTheme) {
  const tone = TOPIC_TAG_TONES[stableToneIndex(label, TOPIC_TAG_TONES.length)];
  return theme.dark ? tone.dark : tone.light;
}

export function topicTagColorStyle(label: string, theme: ReaderTheme): TextStyle {
  const color = topicTagColor(label, theme);
  return {
    backgroundColor: alphaColor(color, theme.dark ? 0.17 : 0.085),
    borderColor: alphaColor(color, theme.dark ? 0.42 : 0.22),
    color
  };
}

export function topicTagTextColorStyle(label: string, theme: ReaderTheme): TextStyle {
  return { color: topicTagColor(label, theme) };
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
    backgroundColor: alphaColor(color, theme.dark ? 0.14 : 0.08),
    borderColor: alphaColor(color, theme.dark ? 0.26 : 0.16),
    color
  };
}

export function createTheme(settings: ReaderSettings): ReaderTheme {
  const dark = settings.theme === 'dark';
  const favorite = { light: '#facc15', dark: '#fde047' };
  if (dark) {
    return {
      dark: true,
      background: '#121212',
      surface: '#181818',
      surface2: '#222222',
      line: '#303030',
      lineStrong: '#444444',
      ink: '#F1F1F1',
      muted: '#A0A0A0',
      primary: '#5B9CFF',
      primaryStrong: '#1677FF',
      primarySoft: 'rgba(22, 119, 255, 0.16)',
      mist: 'rgba(22, 119, 255, 0.16)',
      onPrimary: '#121212',
      onOverlay: '#F1F1F1',
      danger: '#F08A7C',
      warning: '#D6A758',
      success: '#5B9CFF',
      favorite: favorite.dark
    };
  }
  return {
    dark: false,
    background: '#F7F7F7',
    surface: '#FCFCFC',
    surface2: '#F0F0F0',
    line: '#E3E3E3',
    lineStrong: '#D0D0D0',
    ink: '#181818',
    muted: '#707070',
    primary: '#1677FF',
    primaryStrong: '#0958D9',
    primarySoft: 'rgba(22, 119, 255, 0.10)',
    mist: 'rgba(22, 119, 255, 0.10)',
    onPrimary: '#FCFCFC',
    onOverlay: '#FCFCFC',
    danger: '#B84A3A',
    warning: '#8A641F',
    success: '#1677FF',
    favorite: favorite.light
  };
}
