import { Platform, StyleSheet, StatusBar as NativeStatusBar } from 'react-native';
import { LIST_SWIPE_ACTION_WIDTH } from './listSwipeActions';
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

export function createTheme(settings: ReaderSettings, systemScheme: 'light' | 'dark' | null | undefined): ReaderTheme {
  const dark = settings.theme === 'dark' || (settings.theme === 'system' && systemScheme === 'dark');
  const palette = {
    sage: { light: '#016826', dark: '#6dc17b', lightOn: '#fbfbf9', darkOn: '#0b100c' },
    coral: { light: '#94563e', dark: '#d39780', lightOn: '#fdfaf8', darkOn: '#130d0a' },
    blue: { light: '#326893', dark: '#80b1da', lightOn: '#f8fbfd', darkOn: '#0a0f13' },
    mint: { light: '#1f6954', dark: '#72b8a0', lightOn: '#f8fbfa', darkOn: '#09100d' },
    berry: { light: '#80557c', dark: '#c899c3', lightOn: '#fcf9fc', darkOn: '#110d11' },
    noir: { light: '#3f3723', dark: '#c4af7e', lightOn: '#f1ebdc', darkOn: '#110e08' }
  }[settings.palette];
  const backgrounds = {
    warm: { background: '#f7f7f2', surface2: '#f6f6f1', line: '#e8e8e2', lineStrong: '#d7d7cf' },
    white: { background: '#ffffff', surface2: '#f7f7f7', line: '#e5e5e5', lineStrong: '#d8d8d8' },
    gray: { background: '#f5f5f5', surface2: '#f7f7f7', line: '#e6e6e6', lineStrong: '#d9d9d9' }
  };
  const background = backgrounds[settings.background];
  if (dark) {
    return {
      dark: true,
      background: '#151713',
      surface: '#1b1d18',
      surface2: '#22251f',
      line: '#31342d',
      lineStrong: '#45493f',
      ink: '#eeeeea',
      muted: '#aaa79f',
      primary: palette.dark,
      primarySoft: alphaColor(palette.dark, 0.16),
      mist: alphaColor(palette.dark, 0.18),
      onPrimary: palette.darkOn,
      danger: '#da8378',
      success: palette.dark
    };
  }
  return {
    dark: false,
    background: background.background,
    surface: '#ffffff',
    surface2: background.surface2,
    line: background.line,
    lineStrong: background.lineStrong,
    ink: '#191919',
    muted: '#666666',
    primary: palette.light,
    primarySoft: alphaColor(palette.light, 0.07),
    mist: alphaColor(palette.light, 0.09),
    onPrimary: palette.lightOn,
    danger: '#ad5349',
    success: palette.light
  };
}

export function createStyles(theme: ReaderTheme, settings: ReaderSettings, windowHeight: number) {
  const fontScale = settings.fontScale;
  const titleFontScale = Math.min(fontScale, 1.12);
  const listFontScale = Math.max(0.9, Math.min(settings.fontScale, 1.08) * 0.96);
  const densityPadding = settings.listDensity === 'compact' ? 10 : settings.listDensity === 'loose' ? 16 : 13;
  const loginWebViewHeight = Math.min(480, Math.max(320, Math.round(windowHeight * 0.58)));
  const appFontFamily = fontFamilyValue(settings.fontFamily);
  const topicRowBackground = theme.dark || settings.background === 'white' ? theme.surface : theme.background;
  return StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: theme.background
    },
    content: {
      flex: 1
    },
    topicContent: {
      backgroundColor: theme.surface
    },
    contentInner: {
      gap: 10,
      padding: 16,
      paddingTop: Platform.OS === 'android' ? (NativeStatusBar.currentHeight ?? 0) + 4 : 14,
      paddingBottom: Platform.OS === 'android' ? 96 : 94
    },
    topicContentInner: {
      alignItems: 'center',
      paddingTop: 18
    },
    topicHeaderStack: {
      width: '100%',
      alignItems: 'center',
      gap: 18
    },
    stack: {
      gap: 9,
      width: '100%'
    },
    sectionHeader: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: 10
    },
    sectionTitle: {
      color: theme.ink,
      fontFamily: appFontFamily,
      fontSize: 17,
      fontWeight: '600'
    },
    countText: {
      color: theme.muted,
      fontFamily: appFontFamily,
      fontSize: 12,
      fontWeight: '500'
    },
    panelTitle: {
      color: theme.ink,
      fontFamily: appFontFamily,
      fontSize: 15,
      fontWeight: '600'
    },
    feedList: {
      borderTopColor: theme.line,
      borderTopWidth: StyleSheet.hairlineWidth
    },
    feedFloatingActions: {
      position: 'absolute',
      right: 16,
      bottom: Platform.OS === 'android' ? 78 : 78,
      gap: 8
    },
    floatingIconButton: {
      alignItems: 'center',
      justifyContent: 'center',
      width: 44,
      height: 44,
      borderRadius: 22,
      borderColor: theme.line,
      borderWidth: StyleSheet.hairlineWidth,
      backgroundColor: theme.surface
    },
    topicSwipeShell: {
      position: 'relative',
      overflow: 'hidden',
      backgroundColor: topicRowBackground
    },
    topicSwipeAction: {
      position: 'absolute',
      top: 0,
      right: 0,
      bottom: 0,
      width: LIST_SWIPE_ACTION_WIDTH,
      backgroundColor: theme.mist
    },
    topicSwipeActionDanger: {
      backgroundColor: alphaColor(theme.danger, theme.dark ? 0.16 : 0.08)
    },
    topicSwipeActionButton: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 4,
      paddingHorizontal: 8
    },
    topicSwipeActionText: {
      color: theme.primary,
      fontFamily: appFontFamily,
      fontSize: 12,
      fontWeight: '600'
    },
    topicSwipeActionTextDanger: {
      color: theme.danger
    },
    topicCard: {
      gap: 5,
      borderBottomColor: theme.line,
      borderBottomWidth: StyleSheet.hairlineWidth,
      backgroundColor: topicRowBackground
    },
    topicCardPressable: {
      gap: 5,
      paddingTop: densityPadding,
      paddingBottom: 4
    },
    topicCardRead: {
      opacity: 0.62
    },
    topicCardTracked: {
      backgroundColor: theme.primarySoft
    },
    topicCardHead: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: 10
    },
    sourceText: {
      color: theme.muted,
      fontFamily: appFontFamily,
      fontSize: 12,
      fontWeight: '500'
    },
    topicCardSource: {
      flex: 1,
      minWidth: 0
    },
    timeText: {
      flexShrink: 0,
      color: theme.muted,
      fontFamily: appFontFamily,
      fontSize: 12
    },
    cardTitle: {
      color: theme.ink,
      fontFamily: appFontFamily,
      fontSize: Math.round(16 * listFontScale),
      fontWeight: '400',
      lineHeight: Math.round(22 * listFontScale)
    },
    excerpt: {
      color: theme.muted,
      fontFamily: appFontFamily,
      fontSize: 12,
      lineHeight: 18
    },
    highlightText: {
      color: theme.ink,
      backgroundColor: alphaColor(theme.primary, theme.dark ? 0.28 : 0.16)
    },
    meta: {
      color: theme.muted,
      fontFamily: appFontFamily,
      fontSize: 12,
      lineHeight: 17
    },
    topicAccessBadge: {
      alignSelf: 'flex-start',
      overflow: 'hidden',
      color: theme.danger,
      fontFamily: appFontFamily,
      fontSize: 11,
      fontWeight: '600',
      lineHeight: 16,
      backgroundColor: alphaColor(theme.danger, theme.dark ? 0.16 : 0.08),
      borderColor: alphaColor(theme.danger, 0.34),
      borderRadius: 999,
      borderWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: 8,
      paddingVertical: 3
    },
    topicMetaRow: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 8,
      paddingBottom: densityPadding
    },
    topicMetaText: {
      flex: 1,
      minWidth: 0
    },
    pillRail: {
      gap: 4,
      paddingVertical: 0
    },
    pill: {
      minHeight: 40,
      justifyContent: 'center',
      backgroundColor: 'transparent',
      borderRadius: 6,
      paddingHorizontal: 10,
      paddingVertical: 3
    },
    pillActive: {
      backgroundColor: theme.mist
    },
    pillText: {
      color: theme.muted,
      fontFamily: appFontFamily,
      fontSize: 12,
      fontWeight: '400'
    },
    pillTextActive: {
      color: theme.primary,
      fontWeight: '500'
    },
    tabRail: {
      gap: 16,
      borderBottomColor: theme.line,
      borderBottomWidth: StyleSheet.hairlineWidth
    },
    tab: {
      minHeight: 40,
      justifyContent: 'center',
      borderBottomColor: 'transparent',
      borderBottomWidth: 2,
      paddingBottom: 4
    },
    tabActive: {
      borderBottomColor: theme.primary
    },
    tabText: {
      color: theme.muted,
      fontFamily: appFontFamily,
      fontSize: 14,
      fontWeight: '400'
    },
    tabTextActive: {
      color: theme.primary,
      fontWeight: '500'
    },
    input: {
      minHeight: 44,
      backgroundColor: theme.surface,
      borderColor: theme.lineStrong,
      borderRadius: 6,
      borderWidth: StyleSheet.hairlineWidth,
      color: theme.ink,
      fontFamily: appFontFamily,
      fontSize: 14,
      paddingHorizontal: 12,
      paddingVertical: 9
    },
    replyInput: {
      minHeight: 92,
      textAlignVertical: 'top'
    },
    searchRow: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 8
    },
    flex: {
      flex: 1
    },
    actions: {
      alignItems: 'center',
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8
    },
    button: {
      minHeight: 42,
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'row',
      gap: 6,
      backgroundColor: theme.surface,
      borderColor: theme.line,
      borderRadius: 6,
      borderWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: 12,
      paddingVertical: 5
    },
    buttonCompact: {
      minHeight: 40,
      gap: 4,
      paddingHorizontal: 8,
      paddingVertical: 2
    },
    buttonIconOnly: {
      width: 44,
      minHeight: 44,
      backgroundColor: 'transparent',
      borderColor: 'transparent',
      borderRadius: 22,
      paddingHorizontal: 0,
      paddingVertical: 0
    },
    buttonTiny: {
      minHeight: 40,
      gap: 3,
      backgroundColor: 'transparent',
      borderColor: 'transparent',
      paddingHorizontal: 8,
      paddingVertical: 0
    },
    buttonGhost: {
      backgroundColor: 'transparent',
      borderColor: 'transparent'
    },
    buttonActive: {
      backgroundColor: theme.mist,
      borderColor: 'transparent'
    },
    buttonDisabled: {
      opacity: 0.45
    },
    buttonText: {
      color: theme.ink,
      fontFamily: appFontFamily,
      fontSize: 13,
      fontWeight: '600'
    },
    buttonTextCompact: {
      fontSize: 12,
      fontWeight: '500'
    },
    buttonTextTiny: {
      color: theme.muted,
      fontSize: 12,
      fontWeight: '500'
    },
    buttonTextActive: {
      color: theme.primary
    },
    empty: {
      color: theme.muted,
      fontFamily: appFontFamily,
      fontSize: 13,
      paddingVertical: 24,
      textAlign: 'center'
    },
    endOfListText: {
      color: theme.muted,
      fontFamily: appFontFamily,
      fontSize: 12,
      lineHeight: 17,
      paddingVertical: 18,
      textAlign: 'center'
    },
    group: {
      gap: 10,
      backgroundColor: theme.surface,
      borderColor: theme.line,
      borderRadius: 8,
      borderWidth: StyleSheet.hairlineWidth,
      padding: 12
    },
    menuButton: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 10,
      minHeight: 44
    },
    menuIcon: {
      alignItems: 'center',
      justifyContent: 'center',
      width: 30,
      height: 30,
      borderRadius: 8,
      backgroundColor: theme.surface2
    },
    menuLabel: {
      color: theme.ink,
      fontFamily: appFontFamily,
      fontSize: 15,
      fontWeight: '600'
    },
    categoryGroup: {
      gap: 8,
      paddingTop: 4
    },
    categoryItem: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 8,
      borderTopColor: theme.line,
      borderTopWidth: StyleSheet.hairlineWidth,
      paddingTop: 10
    },
    categoryName: {
      color: theme.ink,
      fontFamily: appFontFamily,
      fontSize: 14,
      fontWeight: '600'
    },
    settingGroup: {
      gap: 7
    },
    chipWrap: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8
    },
    removableChip: {
      minHeight: 44,
      justifyContent: 'center',
      backgroundColor: theme.surface2,
      borderColor: theme.line,
      borderRadius: 999,
      borderWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: 11,
      paddingVertical: 6
    },
    inlineChipGroup: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 2
    },
    loginPanel: {
      gap: 10
    },
    webViewShell: {
      height: loginWebViewHeight,
      overflow: 'hidden',
      borderColor: theme.line,
      borderRadius: 8,
      borderWidth: StyleSheet.hairlineWidth,
      backgroundColor: theme.surface
    },
    hiddenBrowserWebViewHost: {
      position: 'absolute',
      top: 0,
      left: 0,
      width: 1,
      height: 1,
      overflow: 'hidden',
      opacity: 0,
      zIndex: -1,
      elevation: -1
    },
    hiddenBrowserWebView: {
      flex: 0,
      width: 1,
      height: 1,
      opacity: 0,
      backgroundColor: 'transparent'
    },
    webViewErrorPlaceholder: {
      flex: 1,
      backgroundColor: theme.surface
    },
    loading: {
      position: 'absolute',
      zIndex: 1,
      top: 14,
      alignSelf: 'center',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: theme.surface,
      borderColor: alphaColor(theme.primary, theme.dark ? 0.24 : 0.16),
      borderRadius: 999,
      borderWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: 12,
      paddingVertical: 8
    },
    loadingText: {
      color: theme.muted,
      fontFamily: appFontFamily,
      fontSize: 12
    },
    libraryItem: {
      gap: 8
    },
    librarySectionTitle: {
      color: theme.ink,
      fontFamily: appFontFamily,
      fontSize: 14,
      fontWeight: '700',
      paddingTop: 8
    },
    libraryMetaBlock: {
      gap: 3,
      paddingTop: 2
    },
    librarySelectRow: {
      alignSelf: 'flex-start',
      minHeight: 36,
      justifyContent: 'center',
      backgroundColor: theme.surface2,
      borderColor: theme.line,
      borderRadius: 6,
      borderWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: 10
    },
    noticeBox: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: 8,
      backgroundColor: theme.mist,
      borderColor: theme.line,
      borderRadius: 8,
      borderWidth: StyleSheet.hairlineWidth,
      padding: 10
    },
    noticeText: {
      color: theme.primary,
      fontFamily: appFontFamily,
      fontSize: 12,
      fontWeight: '600'
    },
    topicTopBar: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: 8,
      paddingHorizontal: 12,
      paddingTop: Platform.OS === 'android' ? (NativeStatusBar.currentHeight ?? 0) + 6 : 12,
      paddingBottom: 8,
      backgroundColor: theme.surface,
      borderBottomColor: theme.line,
      borderBottomWidth: StyleSheet.hairlineWidth
    },
    topicTopHint: {
      flex: 1,
      color: theme.muted,
      fontFamily: appFontFamily,
      fontSize: 12,
      fontWeight: '500',
      textAlign: 'center'
    },
    topicTopActions: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 2
    },
    topicTopActionScroll: {
      flexGrow: 0,
      maxWidth: 220
    },
    article: {
      width: '100%',
      gap: 13,
      backgroundColor: 'transparent',
      borderColor: 'transparent',
      borderRadius: 0,
      borderWidth: 0,
      padding: 0
    },
    topicMetaStack: {
      gap: 5
    },
    topicPrimaryActions: {
      alignItems: 'center',
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      paddingTop: 2
    },
    articleBody: {
      borderTopColor: theme.line,
      borderTopWidth: StyleSheet.hairlineWidth,
      marginTop: 8,
      paddingTop: 18
    },
    articleTitle: {
      color: theme.ink,
      fontFamily: appFontFamily,
      fontSize: Math.round(21 * titleFontScale),
      fontWeight: '600',
      lineHeight: Math.round(30 * titleFontScale)
    },
    loadingState: {
      alignItems: 'stretch',
      justifyContent: 'center',
      gap: 12,
      minHeight: 156,
      backgroundColor: alphaColor(theme.primary, 0.035),
      borderColor: alphaColor(theme.primary, theme.dark ? 0.2 : 0.12),
      borderRadius: 8,
      borderWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: 16,
      paddingVertical: 22
    },
    loadingStateHeader: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 9
    },
    loadingStateText: {
      color: theme.muted,
      fontFamily: appFontFamily,
      fontSize: 13
    },
    loadingPlaceholderStack: {
      gap: 8
    },
    loadingPlaceholderLine: {
      alignSelf: 'stretch',
      height: 10,
      borderRadius: 999,
      backgroundColor: alphaColor(theme.primary, theme.dark ? 0.16 : 0.08)
    },
    loadingPlaceholderLineShort: {
      width: '42%'
    },
    loadingPlaceholderLineMuted: {
      width: '68%'
    },
    errorBox: {
      gap: 8,
      backgroundColor: alphaColor(theme.danger, theme.dark ? 0.16 : 0.08),
      borderColor: alphaColor(theme.danger, 0.34),
      borderRadius: 8,
      borderWidth: StyleSheet.hairlineWidth,
      padding: 12
    },
    errorText: {
      color: theme.danger,
      fontFamily: appFontFamily,
      fontSize: 13,
      lineHeight: 19
    },
    replyBox: {
      width: '100%',
      gap: 8,
      backgroundColor: theme.surface,
      borderColor: theme.line,
      borderRadius: 8,
      borderWidth: StyleSheet.hairlineWidth,
      padding: 12
    },
    replyHeader: {
      width: '100%',
      gap: 10,
      borderTopColor: theme.background,
      borderTopWidth: 12,
      paddingTop: 16
    },
    replyList: {
      width: '100%',
      overflow: 'hidden',
      borderColor: 'transparent',
      borderRadius: 0,
      borderWidth: 0,
      backgroundColor: 'transparent'
    },
    replyListItem: {
      alignSelf: 'center'
    },
    topicFooter: {
      alignSelf: 'center',
      paddingTop: 14
    },
    replyCard: {
      gap: 12,
      borderBottomColor: theme.line,
      borderBottomWidth: StyleSheet.hairlineWidth,
      backgroundColor: 'transparent',
      paddingHorizontal: 0,
      paddingVertical: 20
    },
    replyHead: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 10
    },
    replyFloorBadge: {
      alignItems: 'center',
      justifyContent: 'center',
      minWidth: 38,
      minHeight: 24,
      backgroundColor: theme.surface2,
      borderColor: theme.line,
      borderRadius: 6,
      borderWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: 8
    },
    replyFloorText: {
      color: theme.primary,
      fontFamily: appFontFamily,
      fontSize: 12,
      fontWeight: '700',
      lineHeight: 16
    },
    replyAuthorBlock: {
      flex: 1,
      minWidth: 0,
      gap: 2
    },
    replyAuthor: {
      color: theme.ink,
      fontFamily: appFontFamily,
      fontSize: 14,
      fontWeight: '600',
      lineHeight: 19
    },
    replyTime: {
      color: theme.muted,
      fontFamily: appFontFamily,
      fontSize: 11,
      lineHeight: 15
    },
    replyBody: {
      paddingTop: 2
    },
    replyActionRow: {
      alignItems: 'center',
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      justifyContent: 'flex-end',
      paddingTop: 2
    },
    floorIndex: {
      maxHeight: 220,
      gap: 4,
      backgroundColor: theme.surface2,
      borderColor: theme.line,
      borderRadius: 8,
      borderWidth: StyleSheet.hairlineWidth,
      padding: 8
    },
    floorIndexItem: {
      minHeight: 34,
      justifyContent: 'center',
      borderBottomColor: theme.line,
      borderBottomWidth: StyleSheet.hairlineWidth
    },
    quoteStack: {
      gap: 10
    },
    quoteBox: {
      gap: 8,
      backgroundColor: theme.surface2,
      borderColor: theme.line,
      borderRadius: 8,
      borderWidth: StyleSheet.hairlineWidth,
      padding: 11
    },
    quoteBody: {
      borderTopColor: theme.line,
      borderTopWidth: StyleSheet.hairlineWidth,
      paddingTop: 10
    },
    replyMeta: {
      color: theme.muted,
      fontFamily: appFontFamily,
      fontSize: 12,
      lineHeight: 18
    },
    nav: {
      position: 'absolute',
      right: 0,
      bottom: 0,
      left: 0,
      flexDirection: 'row',
      borderTopColor: theme.line,
      borderTopWidth: StyleSheet.hairlineWidth,
      backgroundColor: theme.surface,
      paddingBottom: 8,
      paddingHorizontal: 10,
      paddingTop: 4
    },
    navItem: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 1,
      minHeight: 48,
      borderRadius: 6
    },
    navItemActive: {
      backgroundColor: 'transparent'
    },
    navText: {
      color: theme.muted,
      fontFamily: appFontFamily,
      fontSize: 10,
      fontWeight: '600'
    },
    navTextActive: {
      color: theme.primary
    },
    imagePreviewOverlay: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: '#000000'
    },
    imagePreviewTopBar: {
      position: 'absolute',
      top: Platform.OS === 'android' ? (NativeStatusBar.currentHeight ?? 0) + 10 : 18,
      right: 14,
      left: 14,
      zIndex: 2,
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between'
    },
    imagePreviewTopActions: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 10
    },
    imagePreviewCount: {
      color: '#ffffff',
      fontFamily: appFontFamily,
      fontSize: 13,
      fontWeight: '600'
    },
    imagePreviewTextButton: {
      alignItems: 'center',
      justifyContent: 'center',
      minWidth: 58,
      height: 44,
      borderRadius: 22,
      backgroundColor: 'rgba(255, 255, 255, 0.14)'
    },
    imagePreviewButtonText: {
      color: '#ffffff',
      fontFamily: appFontFamily,
      fontSize: 13,
      fontWeight: '700'
    },
    imagePreviewClose: {
      alignItems: 'center',
      justifyContent: 'center',
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: 'rgba(255, 255, 255, 0.14)'
    },
    imagePreviewScroll: {
      flex: 1,
      width: '100%'
    },
    imagePreviewScrollContent: {
      minHeight: '100%',
      alignItems: 'center',
      justifyContent: 'center'
    },
    imagePreviewVerticalScroll: {
      maxHeight: '100%'
    },
    imagePreviewVerticalContent: {
      alignItems: 'center',
      justifyContent: 'center'
    },
    imagePreviewImage: {
      width: '100%',
      height: '100%'
    },
    imagePreviewState: {
      position: 'absolute',
      alignSelf: 'center',
      top: '46%',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      borderRadius: 10,
      backgroundColor: 'rgba(0, 0, 0, 0.58)',
      paddingHorizontal: 14,
      paddingVertical: 11
    },
    imagePreviewStateText: {
      color: '#ffffff',
      fontFamily: appFontFamily,
      fontSize: 13,
      fontWeight: '600'
    },
    imagePreviewControls: {
      position: 'absolute',
      right: 18,
      bottom: Platform.OS === 'android' ? 30 : 24,
      left: 18,
      flexDirection: 'row',
      justifyContent: 'space-between'
    },
    imagePreviewControl: {
      alignItems: 'center',
      justifyContent: 'center',
      width: 46,
      height: 46,
      borderRadius: 23,
      backgroundColor: 'rgba(255, 255, 255, 0.14)'
    },
    imagePreviewThumbnailRail: {
      position: 'absolute',
      right: 78,
      bottom: Platform.OS === 'android' ? 30 : 24,
      left: 78,
      maxHeight: 58
    },
    imagePreviewThumbnailContent: {
      gap: 8,
      alignItems: 'center'
    },
    imagePreviewThumbnail: {
      width: 52,
      height: 52,
      overflow: 'hidden',
      borderColor: 'rgba(255, 255, 255, 0.28)',
      borderRadius: 8,
      borderWidth: 1
    },
    imagePreviewThumbnailActive: {
      borderColor: '#ffffff',
      borderWidth: 2
    },
    imagePreviewThumbnailImage: {
      width: '100%',
      height: '100%'
    },
    statusDetailRow: {
      gap: 3,
      borderTopColor: theme.line,
      borderTopWidth: StyleSheet.hairlineWidth,
      paddingTop: 8
    },
    statusOk: {
      color: theme.success
    },
    statusBad: {
      color: theme.danger
    }
  });
}
