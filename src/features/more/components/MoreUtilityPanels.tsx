import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Bug, DatabaseBackup, Download, History, RotateCcw, Server, Settings, Star, Users } from 'lucide-react-native';
import type { LibraryTab } from '@/domain/forum/feed';
import type { ReaderSettings } from '@/domain/reader/readerData';
import type { ReaderSettingsUpdate } from '@/domain/reader/readerRecordState';
import { AppButton } from '@/ui/controls/ButtonControls';
import { ExpandablePanel, MenuButton } from '@/ui/controls/ExpandableControls';
import { useReaderThemeStyles } from '@/ui/theme/ReaderStyleProvider';
import { createMoreScreenStyles } from '../styles';
import type { DocumentOperation } from '../useDocumentOperation';
import { AppearancePanel } from './AppearancePanel';
import { ContentSourcesPanel } from './ContentSourcesPanel';

function appearanceSummary(settings: ReaderSettings) {
  const themeLabel = settings.theme === 'dark' ? '深色' : '浅色';
  const interfaceSize = Math.round((settings.uiFontScale ?? 1) * 100);
  const readingSize = Math.round(settings.fontScale * 100);
  return `${themeLabel} ·\u00A0界\u2060面\u00A0${interfaceSize}% ·\u00A0阅\u2060读\u00A0${readingSize}%`;
}

export type MoreUtilityCapabilities = {
  library: {
    open: (tab?: LibraryTab) => void;
  };
  backup: {
    recovery: boolean;
    operation: DocumentOperation;
    exportFile: () => void;
    importFile: () => void;
  };
  diagnostics: {
    busy: boolean;
    exportLog: () => void;
  };
  proxy: {
    summary: string;
    open: () => void;
  };
  settings: {
    value: ReaderSettings;
    visible: boolean;
    changeVisible: (value: boolean) => void;
    update: (patch: ReaderSettingsUpdate) => void;
  };
};

export function MoreUtilityPanels({
  runtime,
  contentSourcesExpanded,
  onContentSourcesExpandedChange
}: {
  runtime: MoreUtilityCapabilities;
  contentSourcesExpanded: boolean;
  onContentSourcesExpandedChange: (expanded: boolean) => void;
}) {
  const { styles, theme } = useReaderThemeStyles(createMoreScreenStyles);
  const [backupExpanded, setBackupExpanded] = useState(false);
  const { operation } = runtime.backup;
  const backupBusy = operation !== 'idle';
  const updateSettings = runtime.settings.update;

  return (
    <>
      <View testID="more-library-row" style={styles.libraryShortcuts}>
        {(
          [
            { tab: 'favorites', label: '收藏', icon: Star },
            { tab: 'users', label: '关注', icon: Users },
            { tab: 'history', label: '历史', icon: History }
          ] satisfies { tab: LibraryTab; label: string; icon: typeof Star }[]
        ).map(({ tab, label, icon: Icon }) => (
          <Pressable
            key={tab}
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityHint={
              tab === 'users' ? '查看本机关注的用户' : tab === 'history' ? '查看浏览历史' : '查看本机收藏的帖子'
            }
            style={styles.libraryShortcut}
            onPress={() => runtime.library.open(tab)}
          >
            <Icon size={21} color={theme.primary} strokeWidth={1.7} />
            <Text style={styles.libraryShortcutLabel}>{label}</Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.settingsSection}>
        <ContentSourcesPanel
          expanded={contentSourcesExpanded}
          preferences={runtime.settings.value.contentSources}
          onChange={updateSettings}
          onExpandedChange={onContentSourcesExpandedChange}
        />
        <ExpandablePanel
          quiet
          testID="more-appearance"
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
        <View style={styles.groupList}>
          <MenuButton
            testID="more-proxy"
            icon={Server}
            label="网络设置"
            value={runtime.proxy.summary}
            onPress={runtime.proxy.open}
          />
        </View>
        <View style={styles.groupList}>
          <MenuButton
            testID="more-diagnostics"
            accessibilityLabel={runtime.diagnostics.busy ? '问题诊断，正在生成' : '问题诊断'}
            icon={Bug}
            label="问题诊断"
            value={runtime.diagnostics.busy ? '正在生成' : ''}
            busy={runtime.diagnostics.busy}
            onPress={runtime.diagnostics.exportLog}
          />
        </View>
        {runtime.backup.recovery ? (
          <Text accessibilityRole="alert" style={styles.meta}>
            本机资料读取失败，来源访问已暂停。请导入备份恢复；原设置、凭据和通知意图会保留。
          </Text>
        ) : null}
        <ExpandablePanel
          quiet
          testID="more-backup"
          title="备份 / 恢复"
          meta={!backupExpanded && backupBusy ? (operation === 'import' ? '恢复中' : '导出中') : undefined}
          icon={DatabaseBackup}
          expanded={backupExpanded}
          onExpandedChange={setBackupExpanded}
        >
          <View style={styles.stack}>
            <View style={styles.backupActions}>
              <AppButton
                testID="more-backup-export"
                icon={Download}
                label={operation === 'export' ? '导出中' : '导出备份文件'}
                loading={operation === 'export'}
                disabled={backupBusy || runtime.backup.recovery}
                onPress={runtime.backup.exportFile}
              />
              <AppButton
                testID="more-backup-import"
                icon={RotateCcw}
                label={operation === 'import' ? '恢复中' : '选择备份文件恢复'}
                loading={operation === 'import'}
                disabled={backupBusy}
                onPress={runtime.backup.importFile}
              />
            </View>
          </View>
        </ExpandablePanel>
      </View>
    </>
  );
}
