import { StyleSheet, Text, View } from 'react-native';
import type { DiscoursePostPolicy } from '@/domain/forum/discoursePolicy';
import { AppButton } from '@/ui/controls/ButtonControls';
import { useReaderThemeStyles } from '@/ui/theme/ReaderStyleProvider';
import {
  createUiFontSizer,
  fontFamilyValue,
  type ReaderStyleSettings,
  type ReaderTheme,
  textSizeStyle
} from '@/ui/theme/tokens';

function createStyles(theme: ReaderTheme, settings: ReaderStyleSettings) {
  const fontFamily = fontFamilyValue(settings.uiFontFamily);
  const scaled = createUiFontSizer(settings);
  return StyleSheet.create({
    section: { gap: 10, borderTopColor: theme.line, borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: 16 },
    title: { color: theme.ink, fontFamily, ...textSizeStyle(scaled(15), scaled(22)), fontWeight: '600' },
    text: { color: theme.muted, fontFamily, ...textSizeStyle(scaled(13), scaled(20)) },
    confirmed: { color: theme.primary, fontFamily, ...textSizeStyle(scaled(14), scaled(21)), fontWeight: '600' },
    error: { color: theme.danger, fontFamily, ...textSizeStyle(scaled(13), scaled(20)) },
    actions: { alignItems: 'flex-start' }
  });
}

export function DiscoursePolicyPanel({
  policy,
  busy = false,
  disabled = false,
  error,
  status,
  onSetAcceptance
}: {
  policy: DiscoursePostPolicy;
  busy?: boolean;
  disabled?: boolean;
  error?: string;
  status?: string;
  onSetAcceptance: (accepted: boolean) => void;
}) {
  const { styles } = useReaderThemeStyles(createStyles);
  return (
    <View style={styles.section} testID={`discourse-policy-${policy.postId}`}>
      <Text style={styles.title} accessibilityRole="header">
        阅读确认
      </Text>
      <Text style={policy.accepted ? styles.confirmed : styles.text} accessibilityLiveRegion="polite">
        {policy.accepted ? '已确认阅读当前版本' : policy.revoked ? '已撤销阅读确认' : '尚未确认阅读当前版本'}
      </Text>
      {policy.canAccept ? (
        <View style={styles.actions}>
          <AppButton
            compact
            label={busy ? '正在提交…' : policy.acceptLabel}
            accessibilityLabel={policy.acceptLabel}
            loading={busy}
            variant="primary"
            disabled={disabled || busy}
            onPress={() => onSetAcceptance(true)}
          />
        </View>
      ) : null}
      {policy.canRevoke ? (
        <View style={styles.actions}>
          <AppButton
            compact
            label={busy ? '正在提交…' : policy.revokeLabel || '撤销阅读确认'}
            accessibilityLabel={policy.revokeLabel || '撤销阅读确认'}
            loading={busy}
            disabled={disabled || busy}
            onPress={() => onSetAcceptance(false)}
          />
        </View>
      ) : null}
      {!policy.accepted && !policy.canAccept && !policy.canRevoke ? (
        <Text style={styles.text}>原站当前未开放此账号的确认操作。</Text>
      ) : null}
      {status ? (
        <Text style={styles.text} accessibilityLiveRegion="polite">
          {status}
        </Text>
      ) : null}
      {error ? (
        <Text style={styles.error} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </View>
  );
}
