import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { ActivityIndicator } from 'react-native-paper';
import Animated, { Easing, ReduceMotion, useAnimatedStyle, withTiming } from 'react-native-reanimated';
import type { AppUpdateDownloadProgress, AppUpdateInfo } from '@/platform/update/appUpdate';
import type { AppUpdateArtifact } from '@/platform/update/appUpdateDownload';
import type { AppUpdatePhase } from '@/platform/update/useAppUpdateRuntime';
import { recordUserInteraction } from '@/platform/network/userPresence';
import { CURRENT_APP_VERSION, formatAppUpdateDownloadProgress, sameAppUpdate } from '@/platform/update/appUpdate';
import { AppButton, IconButton } from '@/ui/controls/ButtonControls';
import { ExpandablePanel } from '@/ui/controls/ExpandableControls';
import { TOUCH_HIT_SLOP } from '@/ui/controls/touchTarget';
import { useReaderThemeStyles } from '@/ui/theme/ReaderStyleProvider';
import { Download, Info, PackageCheck, Pause, Play, RefreshCw } from 'lucide-react-native';
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

function updateAction(runtime: MoreUpdateCapabilities) {
  if (runtime.phase === 'downloading') return { label: '暂停下载', icon: Pause, run: runtime.pause };
  if (runtime.restoreFailed) return { label: '重试恢复', icon: RefreshCw, run: runtime.install };
  if (runtime.artifact?.kind === 'verified') return { label: '安装', icon: PackageCheck, run: runtime.install };
  if (runtime.artifact?.kind === 'partial') {
    return runtime.artifact.downloadedBytes > 0
      ? { label: '继续下载', icon: Play, run: runtime.resume }
      : { label: '下载并安装', icon: Download, run: runtime.resume };
  }
  return runtime.info
    ? { label: '下载并安装', icon: Download, run: runtime.start }
    : { label: '检查更新', icon: RefreshCw, run: runtime.check };
}

function updateProgress({ artifact, progress }: MoreUpdateCapabilities) {
  if (artifact?.kind === 'verified') {
    return formatAppUpdateDownloadProgress(artifact.update.version, artifact.bytes, artifact.bytes);
  }
  if (progress || !artifact?.downloadedBytes) return progress;
  return formatAppUpdateDownloadProgress(artifact.update.version, artifact.downloadedBytes, artifact.totalBytes ?? -1);
}

function UpdateProgressFill({ percent, downloading }: { percent: number; downloading: boolean }) {
  const { styles } = useReaderThemeStyles(createMoreScreenStyles);
  const fillStyle = useAnimatedStyle(() => {
    const fraction = percent / 100;
    return {
      transform: [
        {
          scaleX: downloading
            ? withTiming(fraction, { duration: 200, easing: Easing.linear, reduceMotion: ReduceMotion.System })
            : fraction
        }
      ]
    };
  }, [percent, downloading]);
  return (
    <Animated.View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={[styles.updateIntegratedFill, fillStyle]}
    />
  );
}

function ReleaseNotes({ update, showVersion }: { update: AppUpdateInfo; showVersion: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const { styles } = useReaderThemeStyles(createMoreScreenStyles);
  return (
    <ExpandablePanel
      quiet
      title="更新说明"
      meta={showVersion ? update.version : undefined}
      expanded={expanded}
      onExpandedChange={setExpanded}
    >
      <Text selectable style={styles.updateNotes}>
        {update.notes.trim()}
      </Text>
    </ExpandablePanel>
  );
}

export function MoreUpdatePanel({ runtime }: { runtime: MoreUpdateCapabilities }) {
  const { styles, theme } = useReaderThemeStyles(createMoreScreenStyles);
  const busy = runtime.phase !== 'idle';
  const checking = runtime.phase === 'checking';
  const { artifact, info } = runtime;
  const hasUpdateAction = Boolean(artifact || info || runtime.restoreFailed);
  const differentUpdate = artifact && info && !sameAppUpdate(artifact.update, info);
  const notesUpdate = info ?? artifact?.update;
  const targetVersion = (artifact?.update ?? info)?.version;
  const currentVersion = `当前版本 ${CURRENT_APP_VERSION}`;
  const pending = {
    idle: '',
    restoring: '正在恢复下载记录',
    checking: hasUpdateAction ? '' : '检查中',
    downloading: '',
    pausing: '正在暂停下载',
    verifying: '正在校验安装包',
    installing: '正在打开安装确认'
  }[runtime.phase];
  const progress = updateProgress(runtime);
  const { label, icon: ActionIcon, run } = updateAction(runtime);
  const mainDisabled = busy && runtime.phase !== 'downloading';

  return (
    <View testID="more-update-section" style={styles.updatePanel}>
      <View style={styles.updateHeaderRow}>
        <View style={styles.updateIdentity}>
          <View style={styles.updateIconBadge}>
            <Info size={17} color={theme.primary} strokeWidth={1.9} />
          </View>
          <View style={styles.flex}>
            <Text style={styles.menuLabel}>关于阅坛</Text>
            <Text
              accessibilityLabel={targetVersion ? `${currentVersion}，更新至 ${targetVersion}` : currentVersion}
              accessibilityLiveRegion="polite"
              style={styles.updateVersionMeta}
            >
              {targetVersion ? `${currentVersion} → ${targetVersion}` : currentVersion}
            </Text>
          </View>
        </View>
        {hasUpdateAction ? (
          <IconButton
            ghost
            iconOnly
            icon={RefreshCw}
            iconSize={17}
            label={checking ? '检查中' : '检查更新'}
            loading={checking}
            disabled={busy && !checking}
            onPress={runtime.check}
          />
        ) : null}
      </View>
      <Pressable
        testID="more-update-action"
        accessibilityRole="button"
        accessibilityLabel={pending || label}
        accessibilityState={{ disabled: mainDisabled, busy: Boolean(pending) }}
        accessibilityValue={
          progress
            ? {
                min: 0,
                max: 100,
                now: progress.percent ?? undefined,
                text: progress.percentLabel ? `${progress.sizeLabel}，${progress.percentLabel}` : progress.sizeLabel
              }
            : undefined
        }
        disabled={mainDisabled}
        hitSlop={TOUCH_HIT_SLOP}
        style={styles.updateIntegratedBar}
        onPress={() => {
          recordUserInteraction();
          run();
        }}
      >
        {progress?.percent != null ? (
          <UpdateProgressFill
            key={artifact?.update.sha256 ?? info?.sha256}
            percent={progress.percent}
            downloading={runtime.phase === 'downloading'}
          />
        ) : null}
        <View style={styles.updateIntegratedContent}>
          <View style={styles.updateIntegratedLeft}>
            {pending ? (
              <ActivityIndicator accessible={false} size={18} color={theme.ink} />
            ) : (
              <ActionIcon accessible={false} size={18} color={theme.ink} strokeWidth={1.9} />
            )}
            <Text style={styles.updateIntegratedActionText}>{pending || label}</Text>
          </View>
          {progress ? (
            <View style={styles.updateIntegratedRight}>
              {progress.percentLabel ? <Text style={styles.updateProgressPercent}>{progress.percentLabel}</Text> : null}
              {artifact?.kind !== 'verified' ? (
                <Text style={styles.updateProgressMeta}>{progress.sizeLabel}</Text>
              ) : null}
            </View>
          ) : null}
        </View>
      </Pressable>
      {differentUpdate ? (
        <AppButton
          compact
          icon={Download}
          label={`下载 ${info.version} 并替换本地包`}
          disabled={busy}
          onPress={runtime.start}
        />
      ) : null}
      {runtime.message ? (
        <Text accessibilityLiveRegion="polite" style={styles.meta}>
          {runtime.message}
        </Text>
      ) : null}
      {notesUpdate?.notes.trim() ? (
        <ReleaseNotes
          key={`${notesUpdate.versionCode}:${notesUpdate.sha256}`}
          update={notesUpdate}
          showVersion={Boolean(differentUpdate)}
        />
      ) : null}
    </View>
  );
}
