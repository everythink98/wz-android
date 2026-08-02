import { Text, View } from 'react-native';
import type { AppUpdateDownloadProgress, AppUpdateInfo } from '@/platform/update/appUpdate';
import { CURRENT_APP_VERSION } from '@/platform/update/appUpdate';
import { AppButton } from '@/ui/controls/ButtonControls';
import { useReaderThemeStyles } from '@/ui/theme/ReaderStyleProvider';
import { Activity } from 'lucide-react-native';
import { createMoreScreenStyles } from '../styles';

export type MoreUpdateCapabilities = {
  busy: boolean;
  downloading: boolean;
  progress: AppUpdateDownloadProgress | null;
  info: AppUpdateInfo | null;
  message: string;
  check: () => void;
  download: () => void;
};

export function MoreUpdatePanel({ runtime }: { runtime: MoreUpdateCapabilities }) {
  const { styles, theme } = useReaderThemeStyles(createMoreScreenStyles);
  const notes = runtime.info?.notes.trim();
  const status =
    runtime.message === `当前版本 ${CURRENT_APP_VERSION}` ||
    (runtime.info && runtime.message === `发现新版 ${runtime.info.version}`)
      ? ''
      : runtime.message;
  const progressWidth =
    runtime.progress?.percent !== null && runtime.progress?.percent !== undefined
      ? (`${runtime.progress.percent}%` as `${number}%`)
      : null;
  const versionMeta = runtime.info
    ? `当前版本 ${CURRENT_APP_VERSION} · 最新版本 ${runtime.info.version}`
    : `多网站第三方客户端 · 当前版本 ${CURRENT_APP_VERSION}`;

  return (
    <View style={styles.groupList}>
      <View style={styles.menuButton}>
        <View style={styles.menuIcon}>
          <Activity size={19} color={theme.primary} strokeWidth={1.8} />
        </View>
        <View style={styles.flex}>
          <View style={styles.actions}>
            <Text style={styles.menuLabel}>关于阅坛</Text>
            {runtime.info ? <Text style={styles.updateBadge}>有新版本</Text> : null}
          </View>
          <Text style={styles.meta}>{versionMeta}</Text>
        </View>
      </View>
      <View style={styles.actions}>
        {runtime.info ? (
          <>
            <AppButton
              variant="primary"
              label={runtime.downloading ? '下载中' : '下载并安装'}
              disabled={runtime.busy || runtime.downloading}
              onPress={runtime.download}
            />
            <AppButton
              tiny
              label={runtime.busy ? '检查中' : '检查更新'}
              disabled={runtime.busy || runtime.downloading}
              onPress={runtime.check}
            />
          </>
        ) : (
          <AppButton
            tiny
            label={runtime.busy ? '检查中' : '检查更新'}
            disabled={runtime.busy}
            onPress={runtime.check}
          />
        )}
      </View>
      {runtime.progress ? (
        <View style={styles.updateProgressBox}>
          <View style={styles.updateProgressHeader}>
            <Text style={styles.updateProgressTitle}>{runtime.progress.title}</Text>
            {runtime.progress.percentLabel ? (
              <Text style={styles.updateProgressPercent}>{runtime.progress.percentLabel}</Text>
            ) : null}
          </View>
          {progressWidth ? (
            <View style={styles.updateProgressTrack}>
              <View style={[styles.updateProgressFill, { width: progressWidth }]} />
            </View>
          ) : null}
          <Text style={styles.updateProgressMeta}>{runtime.progress.sizeLabel}</Text>
        </View>
      ) : null}
      {status && !runtime.progress ? <Text style={styles.meta}>{status}</Text> : null}
      {runtime.info && notes ? <Text style={styles.meta}>{notes}</Text> : null}
    </View>
  );
}
