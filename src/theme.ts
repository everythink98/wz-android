import { Platform, StyleSheet, StatusBar as NativeStatusBar } from 'react-native';
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

export function createTheme(settings: ReaderSettings): ReaderTheme {
  const dark = settings.theme === 'dark';
  const palette = { light: '#2b5548', dark: '#82bda8', lightOn: '#f5faf8', darkOn: '#0b120f' };
  const background = { base: '#fafaf8', surface2: '#f0efec', line: '#e3e1dc', lineStrong: '#d0cec9' };
  if (dark) {
    return {
      dark: true,
      background: '#121210',
      surface: '#1a1918',
      surface2: '#242321',
      line: '#302f2c',
      lineStrong: '#454441',
      ink: '#eceae6',
      muted: '#a3a19b',
      primary: palette.dark,
      primarySoft: alphaColor(palette.dark, 0.12),
      mist: alphaColor(palette.dark, 0.12),
      onPrimary: palette.darkOn,
      danger: '#d4817a',
      success: palette.dark
    };
  }
  return {
    dark: false,
    background: background.base,
    surface: background.base,
    surface2: background.surface2,
    line: background.line,
    lineStrong: background.lineStrong,
    ink: '#1c1b19',
    muted: '#86847e',
    primary: palette.light,
    primarySoft: alphaColor(palette.light, 0.07),
    mist: alphaColor(palette.light, 0.09),
    onPrimary: palette.lightOn,
    danger: '#a35046',
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
  const topicRowBackground = theme.background;
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
      gap: 20
    },
    stack: {
      gap: 10,
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
      backgroundColor: theme.surface,
      elevation: 2
    },
    topicRowShell: {
      position: 'relative',
      overflow: 'hidden',
      backgroundColor: topicRowBackground
    },
    topicCard: {
      gap: 6,
      borderBottomColor: theme.line,
      borderBottomWidth: StyleSheet.hairlineWidth,
      backgroundColor: topicRowBackground
    },
    topicCardPressable: {
      gap: 7,
      paddingTop: densityPadding,
      paddingBottom: 4
    },
    topicCardRead: {
      opacity: 0.62
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
      borderRadius: 20,
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
      gap: 20,
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
      borderRadius: 10,
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
      borderRadius: 10,
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
      alignSelf: 'flex-start',
      borderRadius: 999,
      minHeight: 40,
      gap: 5,
      backgroundColor: theme.surface2,
      borderColor: theme.line,
      paddingHorizontal: 10,
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
      fontWeight: '500',
      includeFontPadding: false,
      lineHeight: 16
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
      borderRadius: 12,
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
      width: 32,
      height: 32,
      borderRadius: 10,
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
    removableChipShell: {
      position: 'relative',
      justifyContent: 'center',
      paddingRight: 5,
      paddingTop: 5
    },
    removableChipClose: {
      position: 'absolute',
      top: 0,
      right: 0,
      alignItems: 'center',
      justifyContent: 'center',
      width: 22,
      height: 22,
      borderRadius: 11,
      backgroundColor: theme.surface,
      borderColor: theme.line,
      borderWidth: StyleSheet.hairlineWidth
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
      borderRadius: 12,
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
      elevation: 2,
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
      borderRadius: 10,
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
      borderRadius: 12,
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
      gap: 6,
      paddingHorizontal: 10,
      paddingTop: Platform.OS === 'android' ? (NativeStatusBar.currentHeight ?? 0) + 6 : 12,
      paddingBottom: 6,
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
      textAlign: 'left'
    },
    topicTopActions: {
      alignItems: 'center',
      flexDirection: 'row',
      flexShrink: 0,
      gap: 2
    },
    article: {
      width: '100%',
      gap: 16,
      backgroundColor: 'transparent',
      borderColor: 'transparent',
      borderRadius: 0,
      borderWidth: 0,
      padding: 0
    },
    topicMetaStack: {
      gap: 10,
      paddingTop: 2
    },
    topicAuthorRow: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 10
    },
    topicAuthorMeta: {
      flex: 1,
      minWidth: 0,
      gap: 2
    },
    topicAvatar: {
      width: 42,
      height: 42,
      borderRadius: 21
    },
    topicPrimaryActions: {
      alignItems: 'center',
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      justifyContent: 'flex-start',
      paddingTop: 2
    },
    topicPostActionArea: {
      gap: 8,
      borderTopColor: theme.line,
      borderTopWidth: StyleSheet.hairlineWidth,
      marginTop: 2,
      paddingTop: 12,
      paddingBottom: 4
    },
    articleBody: {
      borderTopColor: theme.line,
      borderTopWidth: StyleSheet.hairlineWidth,
      marginTop: 2,
      paddingTop: 16
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
      borderRadius: 12,
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
      borderRadius: 12,
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
      gap: 10,
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
    replyAvatar: {
      alignItems: 'center',
      justifyContent: 'center',
      width: 34,
      height: 34,
      overflow: 'hidden',
      backgroundColor: theme.surface2,
      borderColor: theme.line,
      borderRadius: 17,
      borderWidth: StyleSheet.hairlineWidth
    },
    replyAvatarSmall: {
      width: 32,
      height: 32,
      borderRadius: 16
    },
    replyAvatarImage: {
      width: '100%',
      height: '100%'
    },
    replyAvatarText: {
      color: theme.primary,
      fontFamily: appFontFamily,
      fontSize: 13,
      fontWeight: '700'
    },
    replyAvatarSmallText: {
      fontSize: 11
    },
    replyFloorBadge: {
      alignItems: 'center',
      justifyContent: 'center',
      minWidth: 44,
      minHeight: 28,
      backgroundColor: theme.surface2,
      borderColor: theme.line,
      borderRadius: 999,
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
    replyContentArea: {
      gap: 10,
      paddingLeft: 42
    },
    replyBody: {
      paddingTop: 0
    },
    replyActionRow: {
      alignItems: 'center',
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      justifyContent: 'flex-start',
      minHeight: 40,
      paddingTop: 2
    },
    floorIndex: {
      maxHeight: 220,
      gap: 4,
      backgroundColor: theme.surface2,
      borderColor: theme.line,
      borderRadius: 12,
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
      borderRadius: 12,
      borderWidth: StyleSheet.hairlineWidth,
      padding: 11
    },
    quoteBody: {
      borderTopColor: theme.line,
      borderTopWidth: StyleSheet.hairlineWidth,
      paddingTop: 10
    },
    quoteAuthorRow: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 8,
      marginBottom: 8
    },
    replyMeta: {
      color: theme.muted,
      fontFamily: appFontFamily,
      fontSize: 12,
      lineHeight: 18
    },
    inlineForumImageText: {
      color: theme.ink,
      fontFamily: appFontFamily,
      fontSize: Math.round(16 * fontScale),
      lineHeight: Math.round(20 * fontScale)
    },
    inlineForumImage: {
      width: Math.round(104 * fontScale),
      height: Math.round(82 * fontScale),
      marginHorizontal: 2,
      resizeMode: 'contain'
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
      elevation: 4,
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
