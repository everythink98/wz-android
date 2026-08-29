import { useMemo } from 'react';
import { DefaultTheme } from '@react-navigation/native';
import { Text, View } from 'react-native';

import { AppNavigator } from '@/app/AppNavigator';
import { createAppStyles } from '@/app/styles';
import type { Topic } from '@/domain/forum/models';
import { TopicCard } from '@/ui/topic/TopicCard';
import { useReaderThemeStyles } from '@/ui/theme/ReaderStyleProvider';
import type { VisualScenarioDefinition } from '../../types';

const noop = () => undefined;
const FIXED_TIME = '2026-08-29T08:00:00.000Z';

function PlaceholderSurface({ label = '导航目标页' }: { label?: string }) {
  const { theme } = useReaderThemeStyles(() => null);
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.background }}>
      <Text style={{ color: theme.ink }}>{label}</Text>
    </View>
  );
}

function PlaceholderRoute() {
  return <PlaceholderSurface />;
}

function FeedTabSurface() {
  return <PlaceholderSurface label="首页导航目标" />;
}

function SearchTabSurface() {
  return <PlaceholderSurface label="搜索导航目标" />;
}

function LibraryRoute() {
  return <PlaceholderSurface label="收藏导航目标" />;
}

function MoreRoute() {
  return <PlaceholderSurface label="更多导航目标" />;
}

function NavShellScenario() {
  const { theme } = useReaderThemeStyles(() => null);
  const styles = useMemo(() => createAppStyles(theme), [theme]);
  const navigationTheme = useMemo(
    () => ({
      ...DefaultTheme,
      dark: theme.dark,
      colors: {
        ...DefaultTheme.colors,
        background: theme.background,
        border: theme.line,
        card: theme.surface,
        notification: theme.primary,
        primary: theme.primary,
        text: theme.ink
      }
    }),
    [theme]
  );
  return (
    <AppNavigator
      moreBadgeState="messages"
      navigationTheme={navigationTheme}
      FeedRouteComponent={FeedTabSurface}
      LibraryRouteComponent={LibraryRoute}
      MoreRouteComponent={MoreRoute}
      NotificationDetailRouteComponent={PlaceholderRoute}
      NotificationSettingsRouteComponent={PlaceholderRoute}
      NotificationsRouteComponent={PlaceholderRoute}
      ReadingSettingsRouteComponent={PlaceholderRoute}
      SearchRouteComponent={SearchTabSurface}
      TopicRouteComponent={PlaceholderRoute}
      UserRouteComponent={PlaceholderRoute}
      styles={styles}
      theme={theme}
      onReady={noop}
      onScreenChange={noop}
    />
  );
}

function RichTopicCardScenario() {
  const topic: Topic = {
    accessRequirement: { type: 'level', label: '需要等级 2' },
    author: '示例作者',
    authorLevelLabel: 'LV 3',
    category: '开发与创作',
    createdAt: FIXED_TIME,
    duplicateSources: ['NodeSeek'],
    excerpt: '这是一段固定的摘要，用于检查列表进入主题前的信息层级与点击区域。',
    id: 'nav-topic-card',
    replyCount: 28,
    source: 'linuxdo',
    tags: ['React Native', 'Android', '界面', '长标签'],
    title: '共享 TopicCard 进入主题详情的完整信息场景',
    url: 'https://visual.invalid/topic/nav-topic-card',
    viewCount: 1240
  };
  return (
    <TopicCard readerState={{ favorite: true, listDensity: 'loose', read: false }} topic={topic} onOpenTopic={noop} />
  );
}

export const navVisualScenarios: readonly VisualScenarioDefinition[] = [
  {
    capabilityIds: ['NAV-01'],
    id: 'nav.bottom-tabs.default',
    kind: 'rendered',
    tags: ['nav', 'bottom-tabs', 'badge'],
    title: '四格底部导航与消息角标',
    render: () => <NavShellScenario />
  },
  {
    capabilityIds: ['NAV-02'],
    id: 'nav.topic-entry.rich-card',
    kind: 'rendered',
    tags: ['nav', 'topic-card', 'entry'],
    title: '列表进入主题·完整 TopicCard',
    render: () => <RichTopicCardScenario />
  },
  {
    capabilityIds: ['NAV-02', 'NAV-03'],
    id: 'nav.native-stack.interactions',
    kind: 'device-only',
    note: '快速连点、嵌套 route 状态、转场中间帧与 Android 硬件返回必须在真实 native stack 验证。',
    tags: ['nav', 'native-stack', 'hardware-back'],
    title: '嵌套导航与硬件返回'
  }
];
