import type { TopicStyles } from '../styles';
import { ExternalLink, RefreshCw, Settings, Share2 } from 'lucide-react-native';
import { PopupMenu, PopupMenuItem } from '@/ui/controls/PopupMenu';

export function TopicMenu({
  onOpenOriginal,
  onOpenReadingSettings,
  onRefreshTopic,
  onRefreshWholeTopic,
  onRequestClose,
  onShareTopic,
  runTopicMenuAction,
  styles,
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
  topicUrl: string;
  visible: boolean;
}) {
  return (
    <PopupMenu
      accessibilityLabel="关闭更多操作"
      placementStyle={styles.topicOverflowMenu}
      visible={visible}
      onRequestClose={onRequestClose}
    >
      <PopupMenuItem icon={Share2} label="分享" onPress={() => runTopicMenuAction(onShareTopic)} />
      <PopupMenuItem icon={RefreshCw} label="刷新评论" onPress={() => runTopicMenuAction(onRefreshTopic)} />
      <PopupMenuItem icon={RefreshCw} label="刷新全文" onPress={() => runTopicMenuAction(onRefreshWholeTopic)} />
      <PopupMenuItem icon={Settings} label="阅读设置" onPress={() => runTopicMenuAction(onOpenReadingSettings)} />
      <PopupMenuItem
        last
        icon={ExternalLink}
        label="原站打开"
        onPress={() => runTopicMenuAction(() => onOpenOriginal(topicUrl))}
      />
    </PopupMenu>
  );
}
