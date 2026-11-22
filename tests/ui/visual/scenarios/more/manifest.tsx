import { useState, type PropsWithChildren } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { defaultContentSourcePreferences } from '@/domain/reader/contentSourcePreferences';
import { createEmptyReaderData } from '@/domain/reader/readerData';
import { AppearancePanel } from '@/features/more/components/AppearancePanel';
import { ContentSourcesPanel } from '@/features/more/components/ContentSourcesPanel';
import { MoreUpdatePanel } from '@/features/more/components/MoreUpdatePanel';
import { MoreUtilityPanels, type MoreUtilityCapabilities } from '@/features/more/components/MoreUtilityPanels';
import { NetworkProxyScreen } from '@/features/more/components/NetworkProxyScreen';
import { createMoreScreenStyles } from '@/features/more/styles';
import { type NetworkProxyProfile, type NetworkProxyState } from '@/platform/network/networkProxy';
import { formatAppUpdateDownloadProgress, type AppUpdateInfo } from '@/platform/update/appUpdate';
import { useReaderThemeStyles } from '@/ui/theme/ReaderStyleProvider';
import type { VisualScenarioDefinition } from '../../types';

const noop = () => undefined;
const noopAsync = async () => undefined;
const noStyles = () => null;

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
    library: {
      open: noop
    },
    backup: {
      recovery: false,
      operation: 'idle',
      exportFile: noop,
      importFile: noop
    },
    diagnostics: {
      busy: false,
      exportLog: noop
    },
    proxy: {
      summary: '跟随系统',
      open: noop
    },
    settings: {
      value: { ...createEmptyReaderData().settings, ...settings },
      visible: false,
      changeVisible: noop,
      update: noop
    }
  };
  return (
    <MoreScreenFrame>
      <MoreUtilityPanels runtime={runtime} contentSourcesExpanded={false} onContentSourcesExpandedChange={noop} />
    </MoreScreenFrame>
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
  if (!visible) return null;
  return (
    <SafeAreaInsetsContext.Provider value={{ top: 0, right: 0, bottom: 0, left: 0 }}>
      <NetworkProxyScreen
        active
        applyError="代理应用失败，已保持受管请求阻断"
        applyStatus="failed"
        proxyState={state}
        styles={styles}
        theme={theme}
        onClose={() => setVisible(false)}
        onDeleteProfile={noopAsync}
        onSelectProfile={noopAsync}
        onUpsertProfile={noopAsync}
      />
    </SafeAreaInsetsContext.Provider>
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

const updateInfo: AppUpdateInfo = {
  version: '1.4.0',
  apkUrl: 'https://updates.visual.invalid/app.apk',
  notes: '新版本包含阅读体验改进和稳定性修复。',
  sha256: '0'.repeat(64),
  packageName: 'visual.invalid',
  versionName: '1.4.0',
  versionCode: 140,
  signerSha256: '1'.repeat(64)
};

function UpdateAvailableScenario({ phase = 'idle' }: { phase?: 'idle' | 'restoring' | 'checking' }) {
  return (
    <MoreScreenFrame>
      <MoreUpdatePanel
        runtime={{
          phase,
          artifact: null,
          restoreFailed: false,
          progress: null,
          info: phase === 'idle' ? updateInfo : null,
          message: '',
          check: noop,
          start: noop,
          pause: noop,
          resume: noop,
          install: noop
        }}
      />
    </MoreScreenFrame>
  );
}

function UpdateProgressScenario({
  phase = 'downloading',
  unknownTotal = false
}: {
  phase?: 'downloading' | 'pausing' | 'verifying' | 'installing';
  unknownTotal?: boolean;
}) {
  const downloadedBytes = phase === 'verifying' || phase === 'installing' ? 80_000_000 : 34_000_000;
  return (
    <MoreScreenFrame>
      <MoreUpdatePanel
        runtime={{
          phase,
          restoreFailed: false,
          artifact:
            phase === 'installing'
              ? { kind: 'verified', update: updateInfo, bytes: downloadedBytes }
              : { kind: 'partial', update: updateInfo, totalBytes: unknownTotal ? null : 80_000_000, downloadedBytes },
          info: updateInfo,
          message: '',
          progress: formatAppUpdateDownloadProgress(
            updateInfo.version,
            downloadedBytes,
            unknownTotal ? -1 : 80_000_000
          ),
          check: noop,
          start: noop,
          pause: noop,
          resume: noop,
          install: noop
        }}
      />
    </MoreScreenFrame>
  );
}

function UpdateRetainedScenario({
  ready,
  newer = false,
  message
}: {
  ready: boolean;
  newer?: boolean;
  message?: string;
}) {
  return (
    <MoreScreenFrame>
      <MoreUpdatePanel
        runtime={{
          phase: 'idle',
          restoreFailed: false,
          info: newer
            ? { ...updateInfo, version: '1.4.1', versionName: '1.4.1', versionCode: 141, sha256: '2'.repeat(64) }
            : null,
          progress: null,
          artifact: ready
            ? { kind: 'verified', update: updateInfo, bytes: 80_000_000 }
            : { kind: 'partial', update: updateInfo, totalBytes: 80_000_000, downloadedBytes: 34_000_000 },
          message:
            message ?? (ready ? '无法打开安装确认，安装包已保留，可再次安装' : '网络已断开，进度已保留，可继续下载'),
          check: noop,
          start: noop,
          pause: noop,
          resume: noop,
          install: noop
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
    title: '管理代理·应用失败',
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
  ...(['restoring', 'checking'] as const).map((phase): VisualScenarioDefinition => ({
    capabilityIds: ['MORE-04'],
    id: `more.update.${phase}`,
    kind: 'rendered',
    tags: ['more', 'update', phase],
    title: phase === 'restoring' ? '关于阅坛·恢复本地任务' : '关于阅坛·检查中',
    render: () => <UpdateAvailableScenario phase={phase} />
  })),
  {
    capabilityIds: ['MORE-04'],
    id: 'more.update.downloading',
    kind: 'rendered',
    tags: ['more', 'update', 'downloading', 'progress'],
    title: '关于阅坛·下载进度',
    render: () => <UpdateProgressScenario />
  },
  ...(['pausing', 'verifying', 'installing'] as const).map((phase): VisualScenarioDefinition => ({
    capabilityIds: ['MORE-04'],
    id: `more.update.${phase}`,
    kind: 'rendered',
    tags: ['more', 'update', phase],
    title: { pausing: '关于阅坛·暂停中', verifying: '关于阅坛·校验中', installing: '关于阅坛·打开安装确认中' }[phase],
    render: () => <UpdateProgressScenario phase={phase} />
  })),
  {
    capabilityIds: ['MORE-04'],
    id: 'more.update.unknown-total',
    kind: 'rendered',
    tags: ['more', 'update', 'progress'],
    title: '关于阅坛·未知总大小',
    render: () => <UpdateProgressScenario unknownTotal />
  },
  {
    capabilityIds: ['MORE-04'],
    id: 'more.update.ready',
    kind: 'rendered',
    tags: ['more', 'update', 'ready'],
    title: '关于阅坛·后台完成待安装',
    render: () => <UpdateRetainedScenario ready message="" />
  },
  {
    capabilityIds: ['MORE-04'],
    id: 'more.update.newer',
    kind: 'rendered',
    tags: ['more', 'update', 'newer'],
    title: '关于阅坛·本地包与不同新版',
    render: () => <UpdateRetainedScenario ready newer message="" />
  },
  {
    capabilityIds: ['MORE-04'],
    id: 'more.update.paused',
    kind: 'rendered',
    tags: ['more', 'update', 'paused', 'progress'],
    title: '关于阅坛·断网保留进度',
    render: () => <UpdateRetainedScenario ready={false} />
  },
  {
    capabilityIds: ['MORE-04'],
    id: 'more.update.install-retry',
    kind: 'rendered',
    tags: ['more', 'update', 'installer', 'error'],
    title: '关于阅坛·安装失败重试',
    render: () => <UpdateRetainedScenario ready />
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
