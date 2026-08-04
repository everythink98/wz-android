import { StyleSheet } from 'react-native';
import type { ReaderSettings } from '@/domain/reader/readerData';
import { alphaColor, fontFamilyValue, type ReaderTheme } from '@/ui/theme/tokens';

export function createNotificationStyles(theme: ReaderTheme, settings: ReaderSettings) {
  const fontFamily = fontFamilyValue(settings.fontFamily);
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.background },
    listContent: { paddingBottom: 32 },
    toolbar: {
      gap: 0,
      backgroundColor: theme.surface,
      borderBottomColor: theme.line,
      borderBottomWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: 16,
      paddingTop: 0,
      paddingBottom: 0
    },
    controlRow: {
      minHeight: 44,
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: 12
    },
    controlLabel: { flex: 1, color: theme.muted, fontFamily, fontSize: 12, fontWeight: '500', lineHeight: 18 },
    controlMeta: { color: theme.muted, fontFamily, fontSize: 12, lineHeight: 18 },
    inlineAction: {
      minHeight: 44,
      justifyContent: 'center',
      paddingHorizontal: 4
    },
    inlineActionText: { color: theme.primary, fontFamily, fontSize: 13, fontWeight: '600' },
    sourceNotice: {
      gap: 6,
      borderBottomColor: theme.line,
      borderBottomWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: 16,
      paddingVertical: 8
    },
    sourceErrorRow: { alignItems: 'center', flexDirection: 'row', gap: 8 },
    sourceErrorText: { flex: 1 },
    noticeText: { color: theme.muted, fontFamily, fontSize: 12, lineHeight: 18 },
    errorText: { color: theme.danger, fontFamily, fontSize: 12, lineHeight: 18 },
    row: {
      minHeight: 82,
      alignItems: 'flex-start',
      flexDirection: 'row',
      gap: 10,
      borderBottomColor: theme.line,
      borderBottomWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: 16,
      paddingVertical: 10
    },
    rowPressed: { backgroundColor: theme.surface2 },
    rowBody: { flex: 1, minWidth: 0, gap: 2 },
    actorRow: { alignItems: 'center', flexDirection: 'row', gap: 6 },
    actorText: { flex: 1, color: theme.ink, fontFamily, fontSize: 13, lineHeight: 18 },
    actorName: { fontWeight: '600' },
    actionText: { color: theme.muted, fontWeight: '400' },
    unreadDot: { width: 6, height: 6, backgroundColor: theme.primary, borderRadius: 3 },
    title: { color: theme.ink, fontFamily, fontSize: 13, lineHeight: 19 },
    titleUnread: { fontWeight: '600' },
    previewInline: { color: theme.muted, fontWeight: '400' },
    meta: { color: theme.muted, fontFamily, fontSize: 11, lineHeight: 16 },
    centeredState: { alignItems: 'center', gap: 10, paddingHorizontal: 28, paddingVertical: 40 },
    stateActions: { alignItems: 'center', flexDirection: 'row', gap: 8 },
    stateTitle: { color: theme.ink, fontFamily, fontSize: 15, fontWeight: '600', textAlign: 'center' },
    stateText: { color: theme.muted, fontFamily, fontSize: 13, lineHeight: 20, textAlign: 'center' },
    footer: { minHeight: 56, alignItems: 'center', justifyContent: 'center' },
    settingsContent: { gap: 20, padding: 16, paddingBottom: 40 },
    settingsIntro: { color: theme.muted, fontFamily, fontSize: 13, lineHeight: 20 },
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
    settingLabel: { color: theme.ink, fontFamily, fontSize: 15, fontWeight: '600', lineHeight: 21 },
    settingMeta: { color: theme.muted, fontFamily, fontSize: 12, lineHeight: 18 },
    permissionBox: {
      gap: 8,
      backgroundColor: theme.surface2,
      borderColor: theme.line,
      borderRadius: 10,
      borderWidth: StyleSheet.hairlineWidth,
      padding: 12
    },
    detailContent: { gap: 16, padding: 16, paddingBottom: 40 },
    detailHeader: {
      gap: 4,
      borderBottomColor: theme.line,
      borderBottomWidth: StyleSheet.hairlineWidth,
      paddingBottom: 12
    },
    detailTitle: { color: theme.ink, fontFamily, fontSize: 18, fontWeight: '700', lineHeight: 26 },
    detailMeta: { color: theme.muted, fontFamily, fontSize: 12, lineHeight: 18 },
    detailBody: { color: theme.ink, fontFamily, fontSize: 15, lineHeight: 23 },
    message: {
      gap: 5,
      borderBottomColor: theme.line,
      borderBottomWidth: StyleSheet.hairlineWidth,
      paddingVertical: 12
    },
    messageMine: { paddingLeft: 16 },
    messageAuthor: { color: theme.muted, fontFamily, fontSize: 12, fontWeight: '600', lineHeight: 18 },
    readFailure: {
      backgroundColor: theme.surface2,
      borderColor: alphaColor(theme.danger, theme.dark ? 0.4 : 0.24),
      borderRadius: 8,
      borderWidth: StyleSheet.hairlineWidth,
      padding: 10
    },
    disabled: { opacity: 0.45 }
  });
}
