import type { TopicStyles } from '../styles';
import { Modal, Pressable, Text, View } from 'react-native';
import { ExternalLink, RefreshCw, Settings, Share2 } from 'lucide-react-native';
import { type ReaderTheme } from '@/ui/theme/tokens';

export function TopicMenu({
  onOpenOriginal,
  onOpenReadingSettings,
  onRefreshTopic,
  onRefreshWholeTopic,
  onRequestClose,
  onShareTopic,
  runTopicMenuAction,
  styles,
  theme,
  topicUrl,
  visible
}: {
  onOpenOriginal: (url: string) => void;
  onOpenReadingSettings: () => void;
  onRefreshTopic: () => void;
  onRefreshWholeTopic: () => void;
  onRequestClose: () => void;
  onShareTopic: () => void;
  runTopicMenuAction: (action: () => void) => void;
  styles: TopicStyles;
  theme: ReaderTheme;
  topicUrl: string;
  visible: boolean;
}) {
  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onRequestClose}>
      <View style={styles.topicMenuLayer}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="关闭更多操作"
          style={styles.topicMenuDismissLayer}
          onPress={onRequestClose}
        />
        <View style={styles.topicOverflowMenu}>
          <Pressable
            accessibilityRole="menuitem"
            android_ripple={{ color: theme.primarySoft }}
            style={styles.topicMenuItem}
            onPress={() => runTopicMenuAction(onShareTopic)}
          >
            <Share2 size={17} color={theme.ink} strokeWidth={1.8} />
            <Text style={styles.topicMenuItemText}>分享</Text>
          </Pressable>
          <Pressable
            accessibilityRole="menuitem"
            android_ripple={{ color: theme.primarySoft }}
            style={styles.topicMenuItem}
            onPress={() => runTopicMenuAction(onRefreshTopic)}
          >
            <RefreshCw size={17} color={theme.ink} strokeWidth={1.8} />
            <Text style={styles.topicMenuItemText}>刷新评论</Text>
          </Pressable>
          <Pressable
            accessibilityRole="menuitem"
            android_ripple={{ color: theme.primarySoft }}
            style={styles.topicMenuItem}
            onPress={() => runTopicMenuAction(onRefreshWholeTopic)}
          >
            <RefreshCw size={17} color={theme.ink} strokeWidth={1.8} />
            <Text style={styles.topicMenuItemText}>刷新全文</Text>
          </Pressable>
          <Pressable
            accessibilityRole="menuitem"
            accessibilityLabel="阅读设置"
            android_ripple={{ color: theme.primarySoft }}
            style={styles.topicMenuItem}
            onPress={() => runTopicMenuAction(onOpenReadingSettings)}
          >
            <Settings size={17} color={theme.ink} strokeWidth={1.8} />
            <Text style={styles.topicMenuItemText}>阅读设置</Text>
          </Pressable>
          <Pressable
            accessibilityRole="menuitem"
            android_ripple={{ color: theme.primarySoft }}
            style={[styles.topicMenuItem, styles.topicMenuItemLast]}
            onPress={() => runTopicMenuAction(() => onOpenOriginal(topicUrl))}
          >
            <ExternalLink size={17} color={theme.ink} strokeWidth={1.8} />
            <Text style={styles.topicMenuItemText}>原站打开</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
