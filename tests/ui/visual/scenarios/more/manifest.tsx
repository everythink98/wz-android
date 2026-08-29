import { useState, type PropsWithChildren } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { defaultContentSourcePreferences } from '@/domain/reader/contentSourcePreferences';
import { AppearancePanel } from '@/features/more/components/AppearancePanel';
import { ContentSourcesPanel } from '@/features/more/components/ContentSourcesPanel';
import { MoreUpdatePanel } from '@/features/more/components/MoreUpdatePanel';
import { MoreUtilityPanels, type MoreUtilityCapabilities } from '@/features/more/components/MoreUtilityPanels';
import { NetworkProxyModal } from '@/features/more/components/NetworkProxyModal';
import { createMoreScreenStyles } from '@/features/more/styles';
import {
  createEmptyNetworkProxyState,
  type NetworkProxyProfile,
  type NetworkProxyState
} from '@/platform/network/networkProxy';
import type { AppUpdateInfo } from '@/platform/update/appUpdate';
import { useReaderThemeStyles } from '@/ui/theme/ReaderStyleProvider';
import type { VisualScenarioDefinition } from '../../types';

const noop = () => undefined;
const noopAsync = async () => undefined;
const noStyles = () => null;

function SafeAreaShell({ children }: PropsWithChildren) {
  return (
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 0, right: 0, bottom: 0, left: 0 }
      }}
    >
      {children}
    </SafeAreaProvider>
  );
}

function MoreScreenFrame({ children }: PropsWithChildren) {
  const { styles } = useReaderThemeStyles(createMoreScreenStyles);
  return (
    <ScrollView style={styles.content} contentContainerStyle={styles.moreContentInner}>
      <View style={styles.stack}>{children}</View>
    </ScrollView>
  );
}

function UtilityOverviewScenario() {
  const { settings } = useReaderThemeStyles(noStyles);
  const runtime: MoreUtilityCapabilities = {
    notifications: {
      hasUnread: false,
      open: noop,
      summary: '暂无未读·后台通知未开启'
    },
    backup: {
      busy: false,
      exportFile: noop,
      importFile: noop
    },
    diagnostics: {
      busy: false,
      exportLog: noop
    },
    proxy: {
      activeProfile: null,
      applyError: '',
      applyStatus: 'idle',
      state: createEmptyNetworkProxyState(),
      summary: '未启用',
      visible: false,
      close: noop,
      open: noop,
      deleteProfile: noopAsync,
      selectProfile: noopAsync,
      setEnabled: noopAsync,
      testProfile: async () => ({ ok: false, message: '视觉场景不执行网络测试' }),
      upsertProfile: noopAsync
    },
    settings: {
      value: settings,
      visible: false,
      changeVisible: noop,
      update: noop
    }
  };
  return (
    <SafeAreaShell>
      <MoreScreenFrame>
        <MoreUtilityPanels runtime={runtime} />
      </MoreScreenFrame>
    </SafeAreaShell>
  );
}

function ProxyScenario() {
  const { styles, theme } = useReaderThemeStyles(createMoreScreenStyles);
  const [visible, setVisible] = useState(true);
  const profile: NetworkProxyProfile = {
    id: 'visual-proxy',
    name: '示例代理',
    protocol: 'http',
    host: 'proxy.visual.invalid',
    port: 8080,
    username: 'visual-user'
  };
  const state: NetworkProxyState = {
    enabled: true,
    activeId: profile.id,
    profiles: [profile]
  };
  return (
    <SafeAreaShell>
      <NetworkProxyModal
        activeProfile={profile}
        applyError="代理应用失败，已保持受管请求阻断"
        applyStatus="failed"
        proxyState={state}
        styles={styles}
        theme={theme}
        visible={visible}
        onClose={() => setVisible(false)}
        onDeleteProfile={noopAsync}
        onSelectProfile={noopAsync}
        onSetEnabled={noopAsync}
        onTestProfile={async () => ({ ok: false, message: '视觉场景不执行网络测试' })}
        onUpsertProfile={noopAsync}
      />
    </SafeAreaShell>
  );
}

function AppearanceScenario() {
  const { settings, styles, theme } = useReaderThemeStyles(createMoreScreenStyles);
  return (
    <MoreScreenFrame>
      <AppearancePanel settings={settings} showSettingsPanel styles={styles} theme={theme} onUpdateSettings={noop} />
    </MoreScreenFrame>
  );
}

function UpdateAvailableScenario() {
  const info: AppUpdateInfo = {
    version: '1.4.0',
    apkUrl: 'https://updates.visual.invalid/app.apk',
    notes: '新版本包含阅读体验改进和稳定性修复。',
    sha256: '0'.repeat(64),
    packageName: 'visual.invalid',
    versionName: '1.4.0',
    versionCode: 140,
    signerSha256: '1'.repeat(64)
  };
  return (
    <MoreScreenFrame>
      <MoreUpdatePanel
        runtime={{
          busy: false,
          downloading: false,
          progress: null,
          info,
          message: '发现新版 1.4.0',
          check: noop,
          download: noop
        }}
      />
    </MoreScreenFrame>
  );
}

function UpdateProgressScenario() {
  return (
    <MoreScreenFrame>
      <MoreUpdatePanel
        runtime={{
          busy: false,
          downloading: true,
          info: null,
          message: '正在下载安装包',
          progress: {
            title: '正在下载更新',
            downloadedBytes: 34_000_000,
            totalBytes: 80_000_000,
            percent: 42,
            percentLabel: '42%',
            sizeLabel: '32.4 MB / 76.3 MB'
          },
          check: noop,
          download: noop
        }}
      />
    </MoreScreenFrame>
  );
}

function ContentSourcesScenario() {
  const preferences = defaultContentSourcePreferences().map((preference, index) => ({
    ...preference,
    enabled: index !== 2
  }));
  return (
    <MoreScreenFrame>
      <ContentSourcesPanel expanded preferences={preferences} onChange={noop} onExpandedChange={noop} />
    </MoreScreenFrame>
  );
}

export const moreVisualScenarios: readonly VisualScenarioDefinition[] = [
  {
    capabilityIds: ['MORE-01', 'MORE-02', 'MORE-03'],
    id: 'more.utilities.overview',
    kind: 'rendered',
    tags: ['more', 'utilities', 'overview'],
    title: '更多工具·默认状态',
    render: () => <UtilityOverviewScenario />
  },
  {
    capabilityIds: ['MORE-01'],
    id: 'more.proxy.failed',
    kind: 'rendered',
    tags: ['more', 'proxy', 'failed', 'synthetic'],
    title: '服务器代理·应用失败',
    render: () => <ProxyScenario />
  },
  {
    capabilityIds: ['MORE-03'],
    id: 'more.appearance.controls',
    kind: 'rendered',
    tags: ['more', 'appearance', 'settings'],
    title: '外观·完整阅读设置',
    render: () => <AppearanceScenario />
  },
  {
    capabilityIds: ['MORE-04'],
    id: 'more.update.available',
    kind: 'rendered',
    tags: ['more', 'update', 'available'],
    title: '关于阅坛·发现新版',
    render: () => <UpdateAvailableScenario />
  },
  {
    capabilityIds: ['MORE-04'],
    id: 'more.update.downloading',
    kind: 'rendered',
    tags: ['more', 'update', 'downloading', 'progress'],
    title: '关于阅坛·下载进度',
    render: () => <UpdateProgressScenario />
  },
  {
    capabilityIds: ['MORE-05'],
    id: 'more.sources.mixed',
    kind: 'rendered',
    tags: ['more', 'content-sources', 'mixed', 'expanded'],
    title: '内容源·混合启用状态',
    render: () => <ContentSourcesScenario />
  },
  {
    capabilityIds: ['MORE-01'],
    id: 'more.proxy.native-runtime',
    kind: 'device-only',
    note: '画廊使用 .invalid 合成主机且不执行测试或启停；Native apply、受管请求和 WebView 代理效果必须设备验收。',
    tags: ['more', 'proxy', 'native-runtime', 'privacy-boundary'],
    title: '服务器代理·Native 运行时'
  },
  {
    capabilityIds: ['MORE-02'],
    id: 'more.diagnostics.system-share',
    kind: 'device-only',
    note: '画廊只显示 App 自有的问题诊断入口和忙碌态；不读取诊断内容，系统分享也不模拟。',
    tags: ['more', 'diagnostics', 'system-share', 'privacy-boundary'],
    title: '问题诊断·生成与系统分享'
  },
  {
    capabilityIds: ['MORE-03'],
    id: 'more.appearance.persistence',
    kind: 'non-visual',
    note: '画廊覆盖生产外观控件；ReaderSettings 落盘与重启恢复是非视觉语义。',
    tags: ['more', 'appearance', 'persistence'],
    title: '外观设置·持久化'
  },
  {
    capabilityIds: ['MORE-04'],
    id: 'more.update.system-installer',
    kind: 'device-only',
    note: '下载、APK 校验、FileProvider 和 Android 安装器不进入画廊；只评价 App 内版本、进度和错误 framing。',
    tags: ['more', 'update', 'installer', 'system-ui'],
    title: '应用更新·系统安装器'
  },
  {
    capabilityIds: ['MORE-05'],
    id: 'more.sources.talkback-drag',
    kind: 'device-only',
    note: '静态面板可渲染；TalkBack 焦点、位置朗读、上移/下移与 Reanimated 长按拖拽几何必须设备验收。',
    tags: ['more', 'content-sources', 'talkback', 'drag'],
    title: '内容源·TalkBack 与拖拽'
  }
];
