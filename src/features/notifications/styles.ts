import { StyleSheet } from 'react-native';
import type { ReaderSettings } from '@/domain/reader/readerData';
import { alphaColor, fontFamilyValue, type ReaderTheme } from '@/ui/theme/tokens';

export function createNotificationStyles(theme: ReaderTheme, settings: ReaderSettings) {
  const fontFamily = fontFamilyValue(settings.fontFamily);
  const scaled = (value: number) => Math.round(value * settings.fontScale);
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.background },
    listContent: { backgroundColor: theme.surface, paddingBottom: 32 },
    toolbar: {
      gap: 0,
      backgroundColor: theme.surface,
      borderBottomColor: theme.line,
      borderBottomWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: 16,
      paddingTop: 0,
      paddingBottom: 0
    },
    categoryRail: {
      borderBottomColor: theme.line,
      borderBottomWidth: StyleSheet.hairlineWidth,
      paddingVertical: 7
    },
    controlRow: {
      minHeight: 48,
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: 16
    },
    unreadControl: { alignItems: 'center', flexDirection: 'row', gap: 7 },
    controlLabel: { color: theme.muted, fontFamily, fontSize: scaled(12), fontWeight: '500', lineHeight: scaled(18) },
    controlMeta: { color: theme.muted, fontFamily, fontSize: scaled(11), lineHeight: scaled(16) },
    inlineAction: {
      minHeight: 44,
      justifyContent: 'center',
      paddingHorizontal: 4
    },
    inlineActionText: { color: theme.primary, fontFamily, fontSize: scaled(13), fontWeight: '600' },
    sourceNotice: {
      gap: 6,
      borderBottomColor: theme.line,
      borderBottomWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: 16,
      paddingVertical: 8
    },
    sourceErrorRow: { alignItems: 'center', flexDirection: 'row', gap: 8 },
    sourceErrorText: { flex: 1 },
    noticeText: { color: theme.muted, fontFamily, fontSize: scaled(12), lineHeight: scaled(18) },
    errorText: { color: theme.danger, fontFamily, fontSize: scaled(12), lineHeight: scaled(18) },
    row: {
      minHeight: 78,
      alignItems: 'flex-start',
      flexDirection: 'row',
      gap: 12,
      backgroundColor: theme.surface,
      borderBottomColor: theme.line,
      borderBottomWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: 16,
      paddingVertical: 11
    },
    rowBody: { flex: 1, minWidth: 0, gap: 3 },
    actorRow: { alignItems: 'center', flexDirection: 'row', gap: 6 },
    actorText: { flex: 1, color: theme.ink, fontFamily, fontSize: scaled(13), lineHeight: scaled(18) },
    actorName: { fontWeight: '600' },
    actionText: { color: theme.muted, fontWeight: '400' },
    unreadDot: { width: 6, height: 6, backgroundColor: theme.primary, borderRadius: 3 },
    title: { color: theme.ink, fontFamily, fontSize: scaled(14), lineHeight: scaled(20) },
    titleUnread: { fontWeight: '600' },
    previewInline: { color: theme.muted, fontWeight: '400' },
    meta: { color: theme.muted, fontFamily, fontSize: scaled(11), lineHeight: scaled(16) },
    centeredState: { alignItems: 'center', gap: 10, paddingHorizontal: 28, paddingVertical: 40 },
    stateActions: { alignItems: 'center', flexDirection: 'row', gap: 8 },
    stateTitle: { color: theme.ink, fontFamily, fontSize: scaled(15), fontWeight: '600', textAlign: 'center' },
    stateText: { color: theme.muted, fontFamily, fontSize: scaled(13), lineHeight: scaled(20), textAlign: 'center' },
    footer: { minHeight: 56, alignItems: 'center', justifyContent: 'center' },
    settingsContent: { gap: 20, padding: 16, paddingBottom: 40 },
    settingsIntro: { color: theme.muted, fontFamily, fontSize: scaled(13), lineHeight: scaled(20) },
    settingsSection: {
      borderTopColor: theme.line,
      borderTopWidth: StyleSheet.hairlineWidth
    },
    settingRow: {
      minHeight: 64,
      alignItems: 'center',
      flexDirection: 'row',
      gap: 12,
      borderBottomColor: theme.line,
      borderBottomWidth: StyleSheet.hairlineWidth,
      paddingVertical: 8
    },
    settingBody: { flex: 1, minWidth: 0, gap: 2 },
    settingLabel: { color: theme.ink, fontFamily, fontSize: scaled(15), fontWeight: '600', lineHeight: scaled(21) },
    settingMeta: { color: theme.muted, fontFamily, fontSize: scaled(12), lineHeight: scaled(18) },
    permissionBox: {
      gap: 8,
      backgroundColor: theme.surface2,
      borderColor: theme.line,
      borderRadius: 10,
      borderWidth: StyleSheet.hairlineWidth,
      padding: 12
    },
    detailContent: { gap: 16, padding: 16, paddingBottom: 24 },
    conversationScreen: { backgroundColor: theme.surface2 },
    conversationContent: { flexGrow: 1, gap: 12, paddingHorizontal: 12, paddingTop: 8, paddingBottom: 12 },
    conversationContext: {
      minHeight: 36,
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: 8
    },
    conversationContextText: {
      flex: 1,
      color: theme.muted,
      fontFamily,
      fontSize: scaled(11),
      lineHeight: scaled(16)
    },
    conversationOriginal: {
      gap: 6,
      backgroundColor: theme.surface,
      borderColor: theme.line,
      borderRadius: 12,
      borderWidth: StyleSheet.hairlineWidth,
      padding: 11
    },
    conversationOriginalLabel: {
      color: theme.muted,
      fontFamily,
      fontSize: scaled(11),
      fontWeight: '600',
      lineHeight: scaled(16)
    },
    conversationMessageList: { flexGrow: 1, justifyContent: 'flex-end', gap: 9 },
    detailHeader: {
      gap: 12,
      borderBottomColor: theme.line,
      borderBottomWidth: StyleSheet.hairlineWidth,
      paddingBottom: 14
    },
    detailActorRow: { alignItems: 'center', flexDirection: 'row', gap: 10 },
    detailActorBody: { flex: 1, minWidth: 0, gap: 1 },
    detailActorName: {
      color: theme.ink,
      fontFamily,
      fontSize: scaled(13),
      fontWeight: '600',
      lineHeight: scaled(19)
    },
    detailTitle: { color: theme.ink, fontFamily, fontSize: scaled(18), fontWeight: '700', lineHeight: scaled(26) },
    detailMeta: { color: theme.muted, fontFamily, fontSize: scaled(12), lineHeight: scaled(18) },
    detailBody: { color: theme.ink, fontFamily, fontSize: scaled(15), lineHeight: scaled(23) },
    detailLink: { color: theme.primary, fontWeight: '600' },
    conversationNotice: {
      color: theme.muted,
      fontFamily,
      fontSize: scaled(12),
      lineHeight: scaled(18),
      textAlign: 'center'
    },
    messageRow: { alignItems: 'flex-start', gap: 3 },
    messageRowMine: { alignItems: 'flex-end' },
    messageBubble: {
      maxWidth: '86%',
      backgroundColor: theme.surface,
      borderColor: theme.line,
      borderRadius: 16,
      borderBottomLeftRadius: 4,
      borderWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: 13,
      paddingVertical: 10
    },
    messageBubbleMine: {
      backgroundColor: theme.primarySoft,
      borderColor: alphaColor(theme.primary, 0.22),
      borderBottomLeftRadius: 16,
      borderBottomRightRadius: 4
    },
    messageMetaRow: { maxWidth: '86%', marginHorizontal: 4 },
    messageMetaMine: { justifyContent: 'flex-end' },
    messageAuthor: {
      color: theme.muted,
      fontFamily,
      fontSize: scaled(11),
      fontWeight: '600',
      lineHeight: scaled(16)
    },
    messageTime: {
      color: theme.muted,
      fontFamily,
      fontSize: scaled(10),
      lineHeight: scaled(15),
      marginHorizontal: 4
    },
    messageBody: { color: theme.ink, fontFamily, fontSize: scaled(14), lineHeight: scaled(21) },
    replyDock: {
      backgroundColor: theme.surface,
      borderTopColor: theme.line,
      borderTopWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: 12,
      paddingVertical: 9
    },
    replyLauncher: {
      minHeight: 50,
      alignItems: 'center',
      flexDirection: 'row',
      gap: 10,
      backgroundColor: theme.surface2,
      borderColor: theme.lineStrong,
      borderRadius: 25,
      borderWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: 15,
      paddingVertical: 7
    },
    replyLauncherBody: { flex: 1, minWidth: 0, alignItems: 'center', flexDirection: 'row', gap: 8 },
    replyLauncherTitle: {
      flex: 1,
      color: theme.muted,
      fontFamily,
      fontSize: scaled(14),
      lineHeight: scaled(20)
    },
    replyLauncherHint: {
      color: theme.primary,
      fontFamily,
      fontSize: scaled(11),
      fontWeight: '600',
      lineHeight: scaled(16)
    },
    replyDisabledReason: {
      color: theme.muted,
      fontFamily,
      fontSize: scaled(11),
      lineHeight: scaled(16),
      marginTop: 5
    },
    readFailure: {
      backgroundColor: theme.surface2,
      borderColor: alphaColor(theme.danger, theme.dark ? 0.4 : 0.24),
      borderRadius: 8,
      borderWidth: StyleSheet.hairlineWidth,
      padding: 10
    },
    readOnlyNotice: {
      backgroundColor: theme.surface2,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 10
    },
    topicActionDock: {
      backgroundColor: theme.surface,
      borderTopColor: theme.line,
      borderTopWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: 12,
      paddingVertical: 9
    },
    topicActionButton: {
      minHeight: 48,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.primaryStrong,
      borderRadius: 14,
      paddingHorizontal: 16
    },
    topicActionText: {
      color: theme.onPrimary,
      fontFamily,
      fontSize: scaled(14),
      fontWeight: '700',
      lineHeight: scaled(20)
    },
    disabled: { opacity: 0.45 }
  });
}
