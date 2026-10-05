import { StyleSheet, Text, View } from 'react-native';
import type { DiscoursePostPolicy } from '@/domain/forum/discoursePolicy';
import { AppButton } from '@/ui/controls/ButtonControls';
import { useReaderThemeStyles } from '@/ui/theme/ReaderStyleProvider';
import { fontFamilyValue, type ReaderStyleSettings, type ReaderTheme } from '@/ui/theme/tokens';

function createStyles(theme: ReaderTheme, settings: ReaderStyleSettings) {
  const fontFamily = fontFamilyValue(settings.fontFamily);
  const scaled = (value: number) => Math.round(value * settings.fontScale);
  return StyleSheet.create({
    section: { gap: 10, borderTopColor: theme.line, borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: 16 },
    title: { color: theme.ink, fontFamily, fontSize: scaled(15), fontWeight: '600', lineHeight: scaled(22) },
    text: { color: theme.muted, fontFamily, fontSize: scaled(13), lineHeight: scaled(20) },
    confirmed: { color: theme.primary, fontFamily, fontSize: scaled(14), fontWeight: '600', lineHeight: scaled(21) },
    error: { color: theme.danger, fontFamily, fontSize: scaled(13), lineHeight: scaled(20) }
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
        <AppButton
          label={busy ? '正在提交…' : policy.acceptLabel}
          accessibilityLabel={policy.acceptLabel}
          variant="primary"
          disabled={disabled || busy}
          onPress={() => onSetAcceptance(true)}
        />
      ) : null}
      {policy.canRevoke ? (
        <AppButton
          label={busy ? '正在提交…' : policy.revokeLabel || '撤销阅读确认'}
          accessibilityLabel={policy.revokeLabel || '撤销阅读确认'}
          disabled={disabled || busy}
          onPress={() => onSetAcceptance(false)}
        />
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
