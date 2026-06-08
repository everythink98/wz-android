import { Platform, type TextStyle } from 'react-native';
import { type ReaderSettings } from './readerData';

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
  primarySoft: string;
  mist: string;
  onPrimary: string;
  danger: string;
  success: string;
}

export function androidRipple(color: string, borderless = false) {
  return Platform.OS === 'android' ? { color, borderless } : undefined;
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

type ChipTone = { light: string; dark: string };

export type StatusBadgeTone = 'accent' | 'danger' | 'info' | 'neutral' | 'success' | 'warning';

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

const STATUS_BADGE_TONES: Record<StatusBadgeTone, ChipTone> = {
  accent: { light: '#5f6f2e', dark: '#c9d887' },
  danger: { light: '#a35046', dark: '#e09a91' },
  info: { light: '#386f8f', dark: '#9fc7e3' },
  neutral: { light: '#66706a', dark: '#b4bbb6' },
  success: { light: '#2f6555', dark: '#9fd0bf' },
  warning: { light: '#8a6430', dark: '#dfbd78' }
};

function stableToneIndex(label: string, toneCount: number) {
  let hash = 0;
  const text = label.trim().toLowerCase();
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash * 31) + text.charCodeAt(index)) | 0;
  }
  return Math.abs(hash) % toneCount;
}

function chipToneStyle(tone: ChipTone, theme: ReaderTheme): TextStyle {
  const color = theme.dark ? tone.dark : tone.light;
  return {
    backgroundColor: alphaColor(color, theme.dark ? 0.17 : 0.085),
    borderColor: alphaColor(color, theme.dark ? 0.42 : 0.22),
    color
  };
}

function chipToneTextStyle(tone: ChipTone, theme: ReaderTheme): TextStyle {
  return {
    color: theme.dark ? tone.dark : tone.light
  };
}

export function topicTagColorStyle(label: string, theme: ReaderTheme): TextStyle {
  return chipToneStyle(TOPIC_TAG_TONES[stableToneIndex(label, TOPIC_TAG_TONES.length)], theme);
}

export function topicTagTextColorStyle(label: string, theme: ReaderTheme): TextStyle {
  return chipToneTextStyle(TOPIC_TAG_TONES[stableToneIndex(label, TOPIC_TAG_TONES.length)], theme);
}

export function topicStatusBadgeColorStyle(tone: StatusBadgeTone, theme: ReaderTheme): TextStyle {
  return chipToneStyle(STATUS_BADGE_TONES[tone], theme);
}

export function topicStatusBadgeTextColorStyle(tone: StatusBadgeTone, theme: ReaderTheme): TextStyle {
  return chipToneTextStyle(STATUS_BADGE_TONES[tone], theme);
}

export function replyContextBadgeStyle(tone: StatusBadgeTone, theme: ReaderTheme): TextStyle {
  return chipToneStyle(STATUS_BADGE_TONES[tone], theme);
}

export function createTheme(settings: ReaderSettings): ReaderTheme {
  const dark = settings.theme === 'dark';
  const palette = { light: '#2f6555', dark: '#b7d8c9', lightOn: '#f6fbf8', darkOn: '#111111' };
  const background = { base: '#ffffff', surface: '#ffffff', surface2: '#f5f5f5', line: '#e7e7e7', lineStrong: '#d9d9d9' };
  if (dark) {
    return {
      dark: true,
      background: '#171717',
      surface: '#202020',
      surface2: '#2b2b2b',
      line: '#393939',
      lineStrong: '#525252',
      ink: '#eeeeee',
      muted: '#a8a8a8',
      primary: palette.dark,
      primarySoft: alphaColor(palette.dark, 0.13),
      mist: alphaColor(palette.dark, 0.11),
      onPrimary: palette.darkOn,
      danger: '#d4817a',
      success: palette.dark
    };
  }
  return {
    dark: false,
    background: background.base,
    surface: background.surface,
    surface2: background.surface2,
    line: background.line,
    lineStrong: background.lineStrong,
    ink: '#20211f',
    muted: '#7f837b',
    primary: palette.light,
    primarySoft: alphaColor(palette.light, 0.06),
    mist: alphaColor(palette.light, 0.065),
    onPrimary: palette.lightOn,
    danger: '#a35046',
    success: palette.light
  };
}
