import type { TopicStyles } from '../styles';
import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { type ReaderTheme } from '@/ui/theme/tokens';
import { DisclosureChevron } from '@/ui/controls/ExpandableControls';

export function TopicBodyQuoteCard({
  completeContent,
  completeContentMountedExternally,
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
  completeContentMountedExternally?: boolean;
  completeTestID?: string;
  expanded: boolean;
  header: ReactNode;
  loading: boolean;
  onToggle?: () => void;
  preview?: ReactNode;
  previewTestID?: string;
  styles: TopicStyles;
  testID?: string;
  theme: ReaderTheme;
}) {
  return (
    <View style={[styles.quoteBox, completeContentMountedExternally && styles.quoteRowTop]} testID={testID}>
      <View style={styles.quotePanelHeader}>
        <View style={styles.quoteAuthorSummary}>{header}</View>
        {onToggle ? (
          <Pressable
            accessibilityLabel={loading ? '读取' : expanded ? '收起' : '展开'}
            accessibilityRole="button"
            accessibilityState={{ disabled: loading, expanded }}
            disabled={loading}
            style={styles.quotePanelState}
            onPress={onToggle}
          >
            <Text style={styles.quotePanelStateText}>{loading ? '读取' : expanded ? '收起' : '展开'}</Text>
            <View style={styles.quotePanelStateIcon}>
              <DisclosureChevron expanded={expanded} color={theme.primary} size={16} />
            </View>
          </Pressable>
        ) : null}
      </View>
      {preview && !completeContent && !completeContentMountedExternally ? (
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
