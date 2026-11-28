import { memo, useMemo, useState, useSyncExternalStore } from 'react';
import { Pressable, Text, View, useWindowDimensions } from 'react-native';
import { ActivityIndicator } from 'react-native-paper';
import Animated, { Easing, ReduceMotion, useAnimatedStyle, withTiming } from 'react-native-reanimated';
import MarkdownIt from 'markdown-it';
import RenderHTML, { defaultSystemFonts } from 'react-native-render-html';
import type { AppUpdateDownloadProgress, AppUpdateInfo } from '@/platform/update/appUpdate';
import type { AppUpdateArtifact } from '@/platform/update/appUpdateDownload';
import type { AppUpdatePhase } from '@/platform/update/useAppUpdateRuntime';
import type { AppUpdateProgressSource } from '@/platform/update/appUpdateOperation';
import { recordUserInteraction } from '@/platform/network/userPresence';
import { isHttpOrHttpsUrl } from '@/platform/media/imageRequestSource';
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
  progress: AppUpdateProgressSource;
  info: AppUpdateInfo | null;
  message: string;
  openReleaseNoteLink: (href: string) => void;
  check: () => void;
  start: () => void;
  pause: () => void;
  resume: () => void;
  install: () => void;
};

function updateAction(runtime: MoreUpdateCapabilities) {
  if (runtime.phase === 'downloading' || runtime.phase === 'pausing') {
    return { label: '暂停下载', icon: Pause, run: runtime.pause };
  }
  if (runtime.restoreFailed) return { label: '重试恢复', icon: RefreshCw, run: runtime.install };
  if (runtime.artifact?.kind === 'verified') return { label: '安装', icon: PackageCheck, run: runtime.install };
  if (runtime.artifact?.kind === 'partial') {
    return runtime.artifact.downloadedBytes > 0
      ? { label: '继续下载', icon: Play, run: runtime.resume }
      : { label: '下载并安装', icon: Download, run: runtime.resume };
  }
  return runtime.info ? { label: '下载并安装', icon: Download, run: runtime.start } : null;
}

function updateProgress(artifact: AppUpdateArtifact | null, progress: AppUpdateDownloadProgress | null) {
  if (artifact?.kind === 'verified') {
    return formatAppUpdateDownloadProgress(artifact.update.version, artifact.bytes, artifact.bytes);
  }
  if (progress || !artifact?.downloadedBytes) return progress;
  return formatAppUpdateDownloadProgress(artifact.update.version, artifact.downloadedBytes, artifact.totalBytes ?? -1);
}

function UpdateProgressFill({ percent }: { percent: number }) {
  const { styles } = useReaderThemeStyles(createMoreScreenStyles);
  const fillStyle = useAnimatedStyle(
    () => ({
      transform: [
        {
          scaleX: withTiming(percent / 100, { duration: 200, easing: Easing.linear, reduceMotion: ReduceMotion.System })
        }
      ]
    }),
    [percent]
  );
  return (
    <Animated.View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={[styles.updateIntegratedFill, fillStyle]}
    />
  );
}

const releaseNotesMarkdown = new MarkdownIt('commonmark', { html: false, breaks: true });
releaseNotesMarkdown.validateLink = isHttpOrHttpsUrl;
releaseNotesMarkdown.renderer.rules.image = (tokens, index) =>
  releaseNotesMarkdown.utils.escapeHtml(tokens[index].content);
const releaseNotesTextProps = { selectable: true };

const ReleaseNotes = memo(function ReleaseNotes({
  update,
  showVersion,
  onOpenLink
}: {
  update: AppUpdateInfo;
  showVersion: boolean;
  onOpenLink: (href: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const { styles } = useReaderThemeStyles(createMoreScreenStyles);
  const { width } = useWindowDimensions();
  const source = useMemo(() => ({ html: releaseNotesMarkdown.render(update.notes.trim()) }), [update.notes]);
  const renderersProps = useMemo(
    () => ({ a: { onPress: (_event: unknown, href: string) => onOpenLink(href) } }),
    [onOpenLink]
  );
  const family = styles.updateNotes.fontFamily;
  const systemFonts = useMemo(() => (family ? [...defaultSystemFonts, family] : defaultSystemFonts), [family]);
  const tagsStyles = useMemo(
    () => ({
      h1: styles.updateNotesHeading,
      h2: styles.updateNotesHeading,
      h3: styles.updateNotesHeading,
      h4: styles.updateNotesHeading,
      h5: styles.updateNotesHeading,
      h6: styles.updateNotesHeading,
      p: styles.updateNotesParagraph,
      ul: styles.updateNotesList,
      ol: styles.updateNotesList,
      li: styles.updateNotesListItem,
      a: styles.updateNotesLink,
      code: styles.updateNotesCode
    }),
    [styles]
  );
  return (
    <ExpandablePanel
      quiet
      fadeContent={false}
      title="更新说明"
      meta={showVersion ? update.version : undefined}
      expanded={expanded}
      onExpandedChange={setExpanded}
    >
      <RenderHTML
        baseStyle={styles.updateNotes}
        contentWidth={width}
        defaultTextProps={releaseNotesTextProps}
        renderersProps={renderersProps}
        source={source}
        systemFonts={systemFonts}
        tagsStyles={tagsStyles}
      />
    </ExpandablePanel>
  );
});

function UpdateDownloadButton({
  runtime,
  action
}: {
  runtime: MoreUpdateCapabilities;
  action: NonNullable<ReturnType<typeof updateAction>>;
}) {
  const { styles, theme } = useReaderThemeStyles(createMoreScreenStyles);
  const { artifact, info, phase } = runtime;
  const pending = {
    idle: '',
    restoring: '正在恢复下载记录',
    checking: '',
    downloading: '',
    pausing: '正在暂停下载',
    verifying: '正在校验安装包',
    installing: '正在打开安装确认'
  }[phase];
  // A pause is still stopping the current writer. Keep its visible control until it settles.
  const visiblePending = phase === 'pausing' ? '' : pending;
  const liveProgress = useSyncExternalStore(
    runtime.progress.subscribe,
    runtime.progress.getSnapshot,
    runtime.progress.getSnapshot
  );
  const progress = updateProgress(artifact, liveProgress);
  const { label, icon: ActionIcon, run } = action;
  const mainDisabled = phase !== 'idle' && phase !== 'downloading';

  return (
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
        <UpdateProgressFill key={artifact?.update.sha256 ?? info?.sha256} percent={progress.percent} />
      ) : null}
      <View style={styles.updateIntegratedContent}>
        <View style={styles.updateIntegratedLeft}>
          {visiblePending ? (
            <ActivityIndicator accessible={false} size={18} color={theme.ink} />
          ) : (
            <ActionIcon accessible={false} size={18} color={theme.ink} strokeWidth={1.9} />
          )}
          <Text style={styles.updateIntegratedActionText}>{visiblePending || label}</Text>
        </View>
        {progress ? (
          <View style={styles.updateIntegratedRight}>
            {progress.percentLabel ? <Text style={styles.updateProgressPercent}>{progress.percentLabel}</Text> : null}
            {artifact?.kind !== 'verified' ? <Text style={styles.updateProgressMeta}>{progress.sizeLabel}</Text> : null}
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

export function MoreUpdatePanel({ runtime }: { runtime: MoreUpdateCapabilities }) {
  const { styles, theme } = useReaderThemeStyles(createMoreScreenStyles);
  const { artifact, info, phase } = runtime;
  const busy = phase !== 'idle';
  const checking = phase === 'checking';
  const action = updateAction(runtime);
  const differentUpdate = artifact && info && !sameAppUpdate(artifact.update, info);
  const notesUpdate = info ?? artifact?.update;
  const targetVersion = (artifact?.update ?? info)?.version;
  const currentVersion = `当前版本 ${CURRENT_APP_VERSION}`;

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
        {!info ? (
          <IconButton
            testID="more-update-check"
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
      {action ? <UpdateDownloadButton runtime={runtime} action={action} /> : null}
      {phase === 'restoring' && !action ? (
        <Text accessibilityLiveRegion="polite" style={styles.meta}>
          正在恢复下载记录
        </Text>
      ) : null}
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
          onOpenLink={runtime.openReleaseNoteLink}
          showVersion={Boolean(differentUpdate)}
        />
      ) : null}
    </View>
  );
}
