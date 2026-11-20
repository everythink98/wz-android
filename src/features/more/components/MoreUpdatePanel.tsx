import { Pressable, Text, View } from 'react-native';
import { ActivityIndicator } from 'react-native-paper';
import type { AppUpdateDownloadProgress, AppUpdateInfo } from '@/platform/update/appUpdate';
import type { AppUpdateArtifact } from '@/platform/update/appUpdateDownload';
import type { AppUpdatePhase } from '@/platform/update/useAppUpdateRuntime';
import { recordUserInteraction } from '@/platform/network/userPresence';
import { CURRENT_APP_VERSION, formatAppUpdateDownloadProgress, sameAppUpdate } from '@/platform/update/appUpdate';
import { AppButton, IconButton } from '@/ui/controls/ButtonControls';
import { TOUCH_HIT_SLOP } from '@/ui/controls/touchTarget';
import { useReaderThemeStyles } from '@/ui/theme/ReaderStyleProvider';
import { ArrowDownToLine, Download, Info, Pause, Play, RefreshCw } from 'lucide-react-native';
import { createMoreScreenStyles } from '../styles';

export type MoreUpdateCapabilities = {
  phase: AppUpdatePhase;
  artifact: AppUpdateArtifact | null;
  restoreFailed: boolean;
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
    downloading: '',
    pausing: '正在暂停下载',
    verifying: '正在校验安装包',
    installing: '正在打开安装确认'
  }[runtime.phase];
  const notes = target?.notes.trim();
  const isUpToDateMessage = !runtime.info && runtime.message === `已是最新版 ${CURRENT_APP_VERSION}`;
  const isReady = runtime.artifact?.kind === 'verified';
  const isResumable = runtime.artifact?.kind === 'partial' && runtime.artifact.downloadedBytes > 0;
  const showLocalArtifactMeta = Boolean(runtime.artifact && (isReady || differentUpdate || !runtime.info));
  const status =
    phaseText ||
    (runtime.message === `当前版本 ${CURRENT_APP_VERSION}` ||
    isUpToDateMessage ||
    (runtime.info && runtime.message === `发现新版 ${runtime.info.version}`) ||
    (runtime.progress && runtime.message === '正在下载安装包') ||
    (showLocalArtifactMeta && isReady && runtime.message === '安装包已就绪，可安装')
      ? ''
      : runtime.message);
  const progress =
    runtime.progress ??
    (runtime.artifact?.kind === 'partial' && runtime.artifact.downloadedBytes > 0
      ? formatAppUpdateDownloadProgress(
          runtime.artifact.update.version,
          runtime.artifact.downloadedBytes,
          runtime.artifact.totalBytes ?? -1
        )
      : null);
  const isDownloading = runtime.phase === 'downloading';
  const actionLoading = runtime.phase === 'pausing' || runtime.phase === 'verifying' || runtime.phase === 'installing';
  const label =
    runtime.phase === 'pausing'
      ? '暂停中'
      : runtime.phase === 'verifying'
        ? '校验中'
        : runtime.phase === 'installing'
          ? '打开安装确认中'
          : isDownloading
            ? '暂停下载'
            : runtime.restoreFailed
              ? '重试恢复'
              : isReady
                ? '安装'
                : isResumable
                  ? '继续下载'
                  : '下载并安装';
  const mainAction = isDownloading
    ? runtime.pause
    : runtime.restoreFailed || isReady
      ? runtime.install
      : runtime.artifact
        ? runtime.resume
        : runtime.start;
  const actionIcon = runtime.restoreFailed ? RefreshCw : isReady ? ArrowDownToLine : Download;
  const mainDisabled = busy && !isDownloading;
  const progressWidth =
    progress?.percent !== null && progress?.percent !== undefined ? (`${progress.percent}%` as `${number}%`) : null;
  const versionMeta = runtime.info
    ? `${CURRENT_APP_VERSION} → ${runtime.info.version}`
    : isUpToDateMessage
      ? runtime.message
      : `版本 ${CURRENT_APP_VERSION}`;
  const hasCard = Boolean(target || status || progress || runtime.restoreFailed);
  const accentText = theme.dark ? theme.primary : theme.primaryStrong;
  const showFooterStatus = Boolean(status && (!actionLoading || !progress));

  return (
    <View style={[styles.updatePanel, hasCard && styles.updateCard]}>
      <View style={styles.updateHeaderRow}>
        <View style={styles.updateIdentity}>
          <View style={styles.updateIconBadge}>
            <Info size={17} color={theme.primary} strokeWidth={1.9} />
          </View>
          <View style={styles.flex}>
            <View style={styles.updateTitleRow}>
              <Text style={styles.menuLabel}>关于阅坛</Text>
              {runtime.info ? <Text style={styles.updateBadge}>有新版本</Text> : null}
            </View>
            <Text accessibilityLiveRegion={isUpToDateMessage ? 'polite' : 'none'} style={styles.updateVersionMeta}>
              {versionMeta}
            </Text>
          </View>
        </View>
        <IconButton
          ghost
          iconOnly
          icon={RefreshCw}
          iconSize={17}
          label={runtime.phase === 'checking' ? '检查中' : '检查更新'}
          loading={runtime.phase === 'checking' && !progress}
          disabled={busy}
          onPress={runtime.check}
        />
      </View>
      {hasCard ? (
        <View style={styles.updateDetails}>
          {showLocalArtifactMeta ? (
            <Text style={styles.meta}>
              本地安装包 {runtime.artifact!.update.version}
              {isReady ? ' · 已就绪' : ''}
            </Text>
          ) : null}
          {notes ? <Text style={styles.updateNotes}>{notes}</Text> : null}
          {progress ? (
            <Pressable
              testID="more-update-action"
              accessibilityRole="button"
              accessibilityLabel={label}
              accessibilityState={{ disabled: mainDisabled, busy: actionLoading }}
              accessibilityValue={{
                min: 0,
                max: 100,
                now: progress.percent ?? undefined,
                text: progress.percentLabel ? `${progress.sizeLabel}，${progress.percentLabel}` : progress.sizeLabel
              }}
              disabled={mainDisabled}
              hitSlop={TOUCH_HIT_SLOP}
              style={[styles.updateIntegratedBar, mainDisabled && !actionLoading && styles.updateBarDisabled]}
              onPress={() => {
                recordUserInteraction();
                mainAction();
              }}
            >
              <View
                pointerEvents="none"
                style={[styles.updateIntegratedFill, { width: progressWidth ?? (actionLoading ? '100%' : '0%') }]}
              />
              <View style={styles.updateIntegratedContent}>
                <View style={styles.updateIntegratedLeft}>
                  {actionLoading ? (
                    <ActivityIndicator accessible={false} size={14} color={accentText} />
                  ) : isDownloading ? (
                    <Pause accessible={false} size={13} color={accentText} fill={accentText} strokeWidth={0} />
                  ) : (
                    <Play accessible={false} size={13} color={accentText} fill={accentText} strokeWidth={0} />
                  )}
                  <Text style={styles.updateIntegratedActionText} numberOfLines={1}>
                    {actionLoading ? phaseText : label}
                  </Text>
                </View>
                <View style={styles.updateIntegratedRight}>
                  <Text style={styles.updateProgressMeta} numberOfLines={1}>
                    {progress.sizeLabel}
                  </Text>
                  {progress.percentLabel ? (
                    <Text style={styles.updateProgressPercent}>{progress.percentLabel}</Text>
                  ) : null}
                </View>
              </View>
            </Pressable>
          ) : target || runtime.restoreFailed ? (
            <View style={styles.updatePrimarySlot}>
              <AppButton
                testID="more-update-action"
                size="lg"
                icon={actionIcon}
                variant="solid"
                label={label}
                loading={actionLoading}
                disabled={mainDisabled}
                onPress={mainAction}
              />
            </View>
          ) : null}
          {differentUpdate ? (
            <View style={styles.updateSecondaryRow}>
              <Text style={[styles.meta, styles.flex]}>
                下载新版将替换本地 {runtime.artifact!.update.version} 的下载任务。
              </Text>
              <AppButton
                compact
                icon={Download}
                label={`下载新版 ${runtime.info!.version}`}
                disabled={busy}
                onPress={runtime.start}
              />
            </View>
          ) : null}
          {showFooterStatus ? (
            <Text accessibilityLiveRegion="polite" style={styles.meta}>
              {status}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
