import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { ChevronDown, ChevronUp } from 'lucide-react-native';
import { androidRipple, createStyles, type ReaderTheme } from '../../theme';

export function TopicBodyQuoteCard({
  completeContent,
  completeTestID,
  expanded,
  header,
  loading,
  onToggle,
  preview,
  previewTestID,
  styles,
  testID,
  theme
}: {
  completeContent?: ReactNode;
  completeTestID?: string;
  expanded: boolean;
  header: ReactNode;
  loading: boolean;
  onToggle?: () => void;
  preview?: ReactNode;
  previewTestID?: string;
  styles: ReturnType<typeof createStyles>;
  testID?: string;
  theme: ReaderTheme;
}) {
  const StateIcon = expanded ? ChevronUp : ChevronDown;
  return (
    <View style={styles.quoteBox} testID={testID}>
      <View style={styles.quotePanelHeader}>
        <View style={styles.quoteAuthorSummary}>{header}</View>
        {onToggle ? (
          <Pressable
            accessibilityLabel={loading ? '读取' : expanded ? '收起' : '展开'}
            accessibilityRole="button"
            accessibilityState={{ disabled: loading, expanded }}
            android_ripple={androidRipple(theme.primarySoft)}
            disabled={loading}
            style={styles.quotePanelState}
            onPress={onToggle}
          >
            <Text style={styles.quotePanelStateText}>{loading ? '读取' : expanded ? '收起' : '展开'}</Text>
            <View style={styles.quotePanelStateIcon}>
              <StateIcon size={16} color={theme.primary} strokeWidth={1.9} />
            </View>
          </Pressable>
        ) : null}
      </View>
      {preview && !completeContent ? (
        <View style={[styles.quoteBody, styles.quotePanelBody]} testID={previewTestID}>
          {preview}
        </View>
      ) : null}
      {completeContent ? (
        <View style={[styles.quoteBody, styles.quotePanelBody]} testID={completeTestID}>
          {completeContent}
        </View>
      ) : null}
    </View>
  );
}
