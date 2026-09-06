import { Text, View } from 'react-native';
import type { AppUpdateDownloadProgress, AppUpdateInfo } from '@/platform/update/appUpdate';
import type { AppUpdateArtifact } from '@/platform/update/appUpdateDownload';
import type { AppUpdatePhase } from '@/platform/update/useAppUpdateRuntime';
import { CURRENT_APP_VERSION, formatAppUpdateDownloadProgress, sameAppUpdate } from '@/platform/update/appUpdate';
import { AppButton } from '@/ui/controls/ButtonControls';
import { useReaderThemeStyles } from '@/ui/theme/ReaderStyleProvider';
import Activity from 'lucide-react-native/icons/activity';
import { createMoreScreenStyles } from '../styles';

export type MoreUpdateCapabilities = {
  phase: AppUpdatePhase;
  artifact: AppUpdateArtifact | null;
  progress: AppUpdateDownloadProgress | null;
  info: AppUpdateInfo | null;
  message: string;
  check: () => void;
  start: () => void;
  pause: () => void;
  resume: () => void;
  install: () => void;
};

export function MoreUpdatePanel({ runtime }: { runtime: MoreUpdateCapabilities }) {
  const { styles, theme } = useReaderThemeStyles(createMoreScreenStyles);
  const busy = runtime.phase !== 'idle';
  const target = runtime.artifact?.update ?? runtime.info;
  const differentUpdate = runtime.artifact && runtime.info && !sameAppUpdate(runtime.artifact.update, runtime.info);
  const phaseText = {
    idle: '',
    restoring: '正在恢复下载记录',
    checking: '正在检查更新',
    downloading: '离开此页仍会继续下载',
    pausing: '正在暂停下载',
    verifying: '正在校验安装包',
    installing: '正在打开安装确认'
  }[runtime.phase];
  const notes = target?.notes.trim();
  const progress =
    runtime.progress ??
    (runtime.artifact && !runtime.artifact.ready && runtime.artifact.downloadedBytes > 0
      ? {
          ...formatAppUpdateDownloadProgress(
            runtime.artifact.update.version,
            runtime.artifact.downloadedBytes,
            runtime.artifact.totalBytes ?? -1
          ),
          title: '下载进度已保留'
        }
      : null);
  const label =
    runtime.phase === 'pausing'
      ? '暂停中'
      : runtime.phase === 'verifying'
        ? '校验中'
        : runtime.phase === 'installing'
          ? '打开安装确认中'
          : runtime.phase === 'downloading'
            ? '下载中'
            : runtime.artifact?.ready
              ? '安装'
              : runtime.artifact && runtime.artifact.downloadedBytes > 0
                ? '继续下载'
                : '下载并安装';
  const mainAction = runtime.artifact?.ready ? runtime.install : runtime.artifact ? runtime.resume : runtime.start;
  const status =
    phaseText ||
    (runtime.message === `当前版本 ${CURRENT_APP_VERSION}` ||
    (runtime.info && runtime.message === `发现新版 ${runtime.info.version}`)
      ? ''
      : runtime.message);
  const progressTitle =
    runtime.phase === 'pausing' || runtime.phase === 'verifying' || runtime.phase === 'installing'
      ? phaseText
      : progress?.title;
  const progressWidth =
    progress?.percent !== null && progress?.percent !== undefined ? (`${progress.percent}%` as `${number}%`) : null;
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
      {runtime.artifact ? (
        <Text style={styles.meta}>
          本地安装包 {runtime.artifact.update.version}
          {runtime.artifact.ready ? ' · 已就绪' : ''}
        </Text>
      ) : null}
      <View style={styles.actions}>
        {target ? <AppButton variant="primary" label={label} disabled={busy} onPress={mainAction} /> : null}
        {runtime.phase === 'downloading' ? <AppButton tiny label="暂停下载" onPress={runtime.pause} /> : null}
        {differentUpdate ? (
          <AppButton tiny label={`下载新版 ${runtime.info!.version}`} disabled={busy} onPress={runtime.start} />
        ) : null}
        <AppButton
          tiny
          label={runtime.phase === 'checking' ? '检查中' : '检查更新'}
          disabled={busy}
          onPress={runtime.check}
        />
      </View>
      {differentUpdate ? (
        <Text style={styles.meta}>下载新版将替换本地 {runtime.artifact!.update.version} 的下载任务。</Text>
      ) : null}
      {progress ? (
        <View
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel={progressTitle}
          accessibilityValue={{ min: 0, max: 100, now: progress.percent ?? undefined, text: progress.sizeLabel }}
          style={styles.updateProgressBox}
        >
          <View style={styles.updateProgressHeader}>
            <Text style={styles.updateProgressTitle}>{progressTitle}</Text>
            {progress.percentLabel ? <Text style={styles.updateProgressPercent}>{progress.percentLabel}</Text> : null}
          </View>
          {progressWidth ? (
            <View style={styles.updateProgressTrack}>
              <View style={[styles.updateProgressFill, { width: progressWidth }]} />
            </View>
          ) : null}
          <Text style={styles.updateProgressMeta}>{progress.sizeLabel}</Text>
        </View>
      ) : null}
      {status && (!progress || status !== progressTitle) ? (
        <Text accessibilityLiveRegion="polite" style={styles.meta}>
          {status}
        </Text>
      ) : null}
      {notes ? <Text style={styles.meta}>{notes}</Text> : null}
    </View>
  );
}
