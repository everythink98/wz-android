import { useState } from 'react';
import { Text, View } from 'react-native';
import Bell from 'lucide-react-native/icons/bell';
import Bug from 'lucide-react-native/icons/bug';
import DatabaseBackup from 'lucide-react-native/icons/database-backup';
import Server from 'lucide-react-native/icons/server';
import Settings from 'lucide-react-native/icons/settings';
import type { ReaderSettings } from '@/domain/reader/readerData';
import type { NetworkProxyProfile, NetworkProxyState, NetworkProxyStatus } from '@/platform/network/networkProxy';
import { AppButton } from '@/ui/controls/ButtonControls';
import { ExpandablePanel, MenuButton } from '@/ui/controls/ExpandableControls';
import { useReaderThemeStyles } from '@/ui/theme/ReaderStyleProvider';
import { createMoreScreenStyles } from '../styles';
import { AppearancePanel } from './AppearancePanel';
import { NetworkProxyModal } from './NetworkProxyModal';

function appearanceSummary(settings: ReaderSettings) {
  const themeLabel = settings.theme === 'dark' ? '深色' : '浅色';
  const densityLabel =
    settings.listDensity === 'compact' ? '紧凑密度' : settings.listDensity === 'loose' ? '宽松密度' : '标准密度';
  return `${themeLabel} · 字号 ${Math.round(settings.fontScale * 100)}% · ${densityLabel}`;
}

export type MoreUtilityCapabilities = {
  notifications: {
    hasUnread: boolean;
    open: () => void;
    summary: string;
  };
  backup: {
    busy: boolean;
    exportFile: () => void;
    importFile: () => void;
  };
  diagnostics: {
    busy: boolean;
    exportLog: () => void;
  };
  proxy: {
    activeProfile: NetworkProxyProfile | null;
    applyError: string;
    applyStatus: string;
    state: NetworkProxyState;
    summary: string;
    visible: boolean;
    close: () => void;
    open: () => void;
    deleteProfile: (id: string) => Promise<void>;
    selectProfile: (id: string) => Promise<void>;
    setEnabled: (enabled: boolean) => Promise<void>;
    testProfile: (profile: NetworkProxyProfile) => Promise<NetworkProxyStatus>;
    upsertProfile: (profile: NetworkProxyProfile) => Promise<void>;
  };
  settings: {
    value: ReaderSettings;
    visible: boolean;
    changeVisible: (value: boolean) => void;
    update: (patch: Partial<ReaderSettings>) => void;
  };
};

export function MoreUtilityPanels({ runtime }: { runtime: MoreUtilityCapabilities }) {
  const { styles, theme } = useReaderThemeStyles(createMoreScreenStyles);
  const [backupExpanded, setBackupExpanded] = useState(false);
  const [diagnosticExpanded, setDiagnosticExpanded] = useState(false);

  return (
    <>
      <View style={styles.groupList}>
        <View testID="more-notifications-row" style={[styles.menuRowDivider, styles.notificationMenuRow]}>
          <MenuButton
            accessibilityLabel={`消息通知，${runtime.notifications.summary}`}
            icon={Bell}
            label="消息通知"
            value={runtime.notifications.summary}
            onPress={runtime.notifications.open}
          />
          {runtime.notifications.hasUnread ? (
            <View pointerEvents="none" testID="more-notifications-unread-dot" style={styles.notificationUnreadDot} />
          ) : null}
        </View>
        <MenuButton icon={Server} label="服务器代理" value={runtime.proxy.summary} onPress={runtime.proxy.open} />
      </View>
      <NetworkProxyModal
        activeProfile={runtime.proxy.activeProfile}
        applyError={runtime.proxy.applyError}
        applyStatus={runtime.proxy.applyStatus}
        proxyState={runtime.proxy.state}
        styles={styles}
        theme={theme}
        visible={runtime.proxy.visible}
        onClose={runtime.proxy.close}
        onDeleteProfile={runtime.proxy.deleteProfile}
        onSelectProfile={runtime.proxy.selectProfile}
        onSetEnabled={runtime.proxy.setEnabled}
        onTestProfile={runtime.proxy.testProfile}
        onUpsertProfile={runtime.proxy.upsertProfile}
      />
      <ExpandablePanel
        quiet
        title="问题诊断"
        meta={runtime.diagnostics.busy ? '正在生成' : '生成脱敏日志并分享'}
        icon={Bug}
        expanded={diagnosticExpanded}
        onExpandedChange={setDiagnosticExpanded}
      >
        <View style={styles.stack}>
          <Text style={styles.meta}>
            日志只保存在本机并经过脱敏。显示问题请同时附截图；特定内容解析异常请附原帖链接。
          </Text>
          <AppButton
            label={runtime.diagnostics.busy ? '正在生成' : '生成并分享诊断日志'}
            disabled={runtime.diagnostics.busy}
            onPress={runtime.diagnostics.exportLog}
          />
        </View>
      </ExpandablePanel>
      <ExpandablePanel
        quiet
        title="备份 / 恢复"
        meta={runtime.backup.busy ? '处理中' : '文件导出和恢复'}
        icon={DatabaseBackup}
        expanded={backupExpanded}
        onExpandedChange={setBackupExpanded}
      >
        <View style={styles.stack}>
          <View style={styles.actions}>
            <AppButton
              label={runtime.backup.busy ? '处理中' : '导出备份文件'}
              disabled={runtime.backup.busy}
              onPress={runtime.backup.exportFile}
            />
            <AppButton
              label="选择备份文件恢复"
              variant="ghost"
              disabled={runtime.backup.busy}
              onPress={runtime.backup.importFile}
            />
          </View>
        </View>
      </ExpandablePanel>
      <ExpandablePanel
        quiet
        title="外观"
        meta={appearanceSummary(runtime.settings.value)}
        icon={Settings}
        expanded={runtime.settings.visible}
        onExpandedChange={runtime.settings.changeVisible}
      >
        <AppearancePanel
          settings={runtime.settings.value}
          showSettingsPanel={runtime.settings.visible}
          styles={styles}
          theme={theme}
          onUpdateSettings={runtime.settings.update}
        />
      </ExpandablePanel>
    </>
  );
}
