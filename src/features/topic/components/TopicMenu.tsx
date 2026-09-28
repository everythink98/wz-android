import type { TopicStyles } from '../styles';
import { ArrowUp, ExternalLink, RefreshCw, Settings, Share2, Pencil } from 'lucide-react-native';
import { PopupMenu, PopupMenuItem } from '@/ui/controls/PopupMenu';

export function TopicMenu({
  onEditTopic,
  onOpenOpening,
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
  onEditTopic?: () => void;
  onOpenOpening?: () => void;
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
      {onEditTopic ? (
        <PopupMenuItem icon={Pencil} label="编辑帖子" onPress={() => runTopicMenuAction(onEditTopic)} />
      ) : null}
      {onOpenOpening ? (
        <PopupMenuItem icon={ArrowUp} label="回到主楼" onPress={() => runTopicMenuAction(onOpenOpening)} />
      ) : null}
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
