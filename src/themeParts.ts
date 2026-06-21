import { Platform, StyleSheet } from 'react-native';
import type { ReaderTheme } from './theme';

type AlphaColor = (hex: string, alpha: number) => string;

export function createNavigationStyles(theme: ReaderTheme, appFontFamily: string | undefined) {
  return {
    nav: {
      flexDirection: 'row' as const,
      borderTopColor: theme.line,
      borderTopWidth: StyleSheet.hairlineWidth,
      backgroundColor: theme.surface,
      elevation: 0,
      paddingBottom: Platform.OS === 'android' ? 8 : 10,
      paddingHorizontal: 10,
      paddingTop: 4,
      height: Platform.OS === 'android' ? 64 : 70
    },
    navItem: {
      flex: 1,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      gap: 2,
      minHeight: 48,
      borderRadius: 6
    },
    navItemActive: {
      backgroundColor: 'transparent'
    },
    navItemIndicator: {
      width: 18,
      height: 2,
      borderRadius: 999,
      backgroundColor: 'transparent'
    },
    navItemIndicatorActive: {
      backgroundColor: theme.primary
    },
    navIconWrap: {
      position: 'relative' as const
    },
    navBadge: {
      position: 'absolute' as const,
      top: -2,
      right: -7,
      width: 8,
      height: 8,
      borderRadius: 999,
      borderColor: theme.surface,
      borderWidth: StyleSheet.hairlineWidth,
      backgroundColor: theme.danger
    },
    navText: {
      color: theme.muted,
      fontFamily: appFontFamily,
      fontSize: 10,
      fontWeight: '600' as const,
      letterSpacing: 0
    },
    navTextActive: {
      color: theme.primary
    }
  };
}
export function createTopicStyles(
  theme: ReaderTheme,
  appFontFamily: string | undefined,
  fontScale: number,
  alphaColor: AlphaColor
) {
  return {
    topicAccessNotice: {
      gap: 8,
      backgroundColor: alphaColor(theme.danger, theme.dark ? 0.14 : 0.06),
      borderColor: alphaColor(theme.danger, 0.28),
      borderRadius: 8,
      borderWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: 12,
      paddingVertical: 12
    },
    topicAccessNoticeTitle: {
      color: theme.danger,
      fontFamily: appFontFamily,
      fontSize: 16,
      fontWeight: '700' as const,
      lineHeight: 22
    },
    topicAccessNoticeDetail: {
      color: theme.ink,
      fontFamily: appFontFamily,
      fontSize: 13,
      lineHeight: 20
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
      resizeMode: 'contain' as const
    },
    replyNewBadge: {
      alignSelf: 'flex-start' as const,
      overflow: 'hidden' as const,
      color: theme.primary,
      fontFamily: appFontFamily,
      fontSize: 11,
      fontWeight: '600' as const,
      lineHeight: 16,
      backgroundColor: alphaColor(theme.primary, theme.dark ? 0.20 : 0.12),
      borderColor: alphaColor(theme.primary, 0.32),
      borderRadius: 999,
      borderWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: 8,
      paddingVertical: 3
    }
  };
}
export function createPanelStyles(theme: ReaderTheme, appFontFamily: string | undefined) {
  return {
    groupList: {
      gap: 7,
      backgroundColor: 'transparent',
      borderBottomColor: theme.line,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderRadius: 0,
      paddingHorizontal: 0,
      paddingVertical: 12
    },
    statusOk: {
      color: theme.success
    },
    buttonPrimary: {
      backgroundColor: theme.primary,
      borderColor: theme.primary
    },
    buttonTextPrimary: {
      color: theme.onPrimary,
      fontWeight: '700' as const,
      letterSpacing: 0
    },
    panelTitle: {
      color: theme.ink,
      fontFamily: appFontFamily,
      fontSize: 15,
      fontWeight: '600' as const
    }
  };
}
