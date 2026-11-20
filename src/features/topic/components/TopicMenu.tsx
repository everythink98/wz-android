import type { TopicStyles } from '../styles';
import { ArrowUp, ExternalLink, ListRestart, RefreshCw, Settings, Share2, Pencil } from 'lucide-react-native';
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
  refreshing = false,
  runTopicMenuAction,
  styles,
  topicUrl,
  visible
}: {
  onEditTopic?: () => void;
  onOpenOpening?: () => void;
  onOpenOriginal: (url: string) => void;
  onOpenReadingSettings: () => void;
  onRefreshTopic?: () => void;
  onRefreshWholeTopic: () => void;
  onRequestClose: () => void;
  onShareTopic: () => void;
  refreshing?: boolean;
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
      {onRefreshTopic ? (
        <PopupMenuItem
          disabled={refreshing}
          icon={ListRestart}
          label="刷新评论"
          onPress={() => runTopicMenuAction(onRefreshTopic)}
        />
      ) : null}
      <PopupMenuItem
        disabled={refreshing}
        icon={RefreshCw}
        label="刷新全文"
        onPress={() => runTopicMenuAction(onRefreshWholeTopic)}
      />
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
