import { View } from 'react-native';
import { AppButton } from '@/ui/controls/AppControls';
import type { MoreScreenStyles } from '../styles';

export function BackupRestorePanel({
  backupBusy,
  styles,
  onExportBackupFile,
  onImportBackupFile
}: {
  backupBusy: boolean;
  styles: MoreScreenStyles;
  onExportBackupFile: () => void;
  onImportBackupFile: () => void;
}) {
  return (
    <View style={styles.stack}>
      <View style={styles.actions}>
        <AppButton
          label={backupBusy ? '处理中' : '导出备份文件'}
          styles={styles}
          disabled={backupBusy}
          onPress={onExportBackupFile}
        />
        <AppButton
          label="选择备份文件恢复"
          variant="ghost"
          styles={styles}
          disabled={backupBusy}
          onPress={onImportBackupFile}
        />
      </View>
    </View>
  );
}
