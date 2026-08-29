import { MoreUtilityPanels, type MoreUtilityCapabilities } from '@/features/more/components/MoreUtilityPanels';
import { createEmptyNetworkProxyState } from '@/platform/network/networkProxy';
import { useReaderThemeStyles } from '@/ui/theme/ReaderStyleProvider';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { VisualScenarioDefinition } from '../../types';

const noop = () => undefined;
const noopAsync = async () => undefined;
const noStyles = () => null;

function createSafeAreaMetrics() {
  return {
    frame: { x: 0, y: 0, width: 390, height: 844 },
    insets: { top: 0, right: 0, bottom: 0, left: 0 }
  };
}

function BackupScenario() {
  const { settings } = useReaderThemeStyles(noStyles);
  const runtime: MoreUtilityCapabilities = {
    notifications: {
      hasUnread: false,
      open: noop,
      summary: '暂无未读'
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
      testProfile: async () => ({ ok: true, latencyMs: 0 }),
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
    <SafeAreaProvider initialMetrics={createSafeAreaMetrics()}>
      <MoreUtilityPanels runtime={runtime} />
    </SafeAreaProvider>
  );
}

export const dataVisualScenarios: readonly VisualScenarioDefinition[] = [
  {
    capabilityIds: ['DATA-01'],
    id: 'data.reader.persistence',
    kind: 'non-visual',
    note: 'ReaderData 写入排队、失败回滚和旧保存结算是后台语义；可见结果由 Library 生产 Screen 独立覆盖。',
    tags: ['data', 'reader-data', 'persistence'],
    title: 'ReaderData 持久化与回滚'
  },
  {
    capabilityIds: ['DATA-02'],
    id: 'data.reader.migration',
    kind: 'non-visual',
    note: '存储 key、v2 迁移、3 秒读取上限和迟到结果隔离不对应独立 App 页面。',
    tags: ['data', 'migration', 'storage'],
    title: 'ReaderData 迁移与读取时序'
  },
  {
    capabilityIds: ['DATA-03'],
    id: 'data.backup.entry',
    kind: 'rendered',
    tags: ['data', 'backup', 'app-framing'],
    title: '备份 / 恢复·App 入口',
    render: () => <BackupScenario />
  },
  {
    capabilityIds: ['DATA-03'],
    id: 'data.backup.system-picker',
    kind: 'device-only',
    note: '画廊只渲染 App 内的备份入口与忙碌语义；系统文件选择、导出与分享不模拟。',
    tags: ['data', 'backup', 'file-picker', 'system-ui'],
    title: '备份 / 恢复·系统文件选择'
  }
];
