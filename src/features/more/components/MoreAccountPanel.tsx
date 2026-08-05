import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Activity } from 'lucide-react-native';
import type { AccountCenterCommand, XiaoyinsiAuthPhase } from '@/domain/session/accountCenter';
import {
  nodeSeekUserIdForSession,
  type SessionSite,
  type SiteSessionViewModels
} from '@/domain/session/siteSessionState';
import type { LinuxDoLevelProfile } from '@/sources/readGateway';
import type { XiaoyinsiPendingAuthorization } from '@/sources/xiaoyinsi/auth';
import type { XiaoyinsiLevelProfile } from '@/sources/xiaoyinsi/account';
import { MenuButton } from '@/ui/controls/ExpandableControls';
import { useReaderThemeStyles } from '@/ui/theme/ReaderStyleProvider';
import type { CredentialSummaries } from '../accountCenter';
import { createMoreScreenStyles } from '../styles';
import { AccountCenterPanel } from './AccountCenterPanel';
import { LinuxDoLevelPanel } from './LinuxDoLevelPanel';
import { NodeSeekServicesPanel } from './NodeSeekServicesPanel';
import { XiaoyinsiAuthPanel } from './XiaoyinsiAuthPanel';

const styles = StyleSheet.create({
  accountFooterAction: {
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: 4,
    paddingTop: 4
  }
});

export type MoreAccountCapabilities = {
  read: {
    sessions: SiteSessionViewModels;
    statusBusy: boolean;
  };
  center: {
    command: (command: AccountCenterCommand) => void | Promise<void>;
    credentials: {
      summaries: CredentialSummaries;
      pendingFillSite: SessionSite | null;
    };
    linuxDoLevel: {
      busy: boolean;
      error: string;
      profile: LinuxDoLevelProfile | null;
      refresh: () => unknown;
    };
    nodeImageKey: {
      authorize: () => unknown;
      busy: boolean;
      clear: () => unknown;
      save: (value: string) => unknown;
      saved: boolean;
    };
    nodeSeek: {
      checkIn: () => unknown;
      webLoginUserId: number | null;
    };
    xiaoyinsiAuth: {
      begin: () => unknown;
      cancel: () => unknown;
      message: string;
      openBrowser: () => unknown;
      pending: XiaoyinsiPendingAuthorization | null;
      phase: XiaoyinsiAuthPhase;
      revoke: () => unknown;
      secondsRemaining: number;
    };
    xiaoyinsiLevel: {
      busy: boolean;
      error: string;
      profile: XiaoyinsiLevelProfile | null;
      refresh: () => unknown;
    };
  };
  surfaces: {
    closeAll: () => void;
    linuxdo: boolean;
    nodeseek: boolean;
    yaohuo: boolean;
  };
};

export function MoreAccountPanel({
  nodeSeekRecoveryThreshold,
  runtime,
  onNodeSeekRecoveryThresholdChange
}: {
  nodeSeekRecoveryThreshold: number;
  runtime: MoreAccountCapabilities;
  onNodeSeekRecoveryThresholdChange: (value: number) => void;
}) {
  const { styles: screenStyles, theme } = useReaderThemeStyles(createMoreScreenStyles);
  const [expanded, setExpanded] = useState(false);
  const [linuxDoLevelExpanded, setLinuxDoLevelExpanded] = useState(false);
  const [xiaoyinsiLevelExpanded, setXiaoyinsiLevelExpanded] = useState(false);
  const sessions = runtime.read.sessions;
  const linuxDoSession = sessions.linuxdo;
  const xiaoyinsiSession = sessions.xiaoyinsi;
  const auth = runtime.center.xiaoyinsiAuth;
  const {
    busy: linuxDoLevelBusy,
    error: linuxDoLevelError,
    profile: linuxDoLevelProfile,
    refresh: refreshLinuxDoLevel
  } = runtime.center.linuxDoLevel;
  const {
    busy: xiaoyinsiLevelBusy,
    error: xiaoyinsiLevelError,
    profile: xiaoyinsiLevelProfile,
    refresh: refreshXiaoyinsiLevel
  } = runtime.center.xiaoyinsiLevel;
  const authForcedOpen = auth.phase === 'requesting' || auth.phase === 'waiting' || auth.phase === 'cleanup';
  const projectedSessions =
    auth.phase === 'cleanup'
      ? {
          ...sessions,
          xiaoyinsi: {
            ...xiaoyinsiSession,
            status: 'authorizing' as const,
            statusLabel: '待清理',
            summaryLabel: '本机清理未完成',
            cookieSummary: [],
            isVerified: false,
            isLoggedIn: false,
            isVerifying: true,
            canWrite: false,
            currentUser: undefined
          }
        }
      : sessions;

  useEffect(() => {
    if (runtime.surfaces.nodeseek || runtime.surfaces.yaohuo || runtime.surfaces.linuxdo || authForcedOpen) {
      setExpanded(true);
    }
  }, [authForcedOpen, runtime.surfaces.linuxdo, runtime.surfaces.nodeseek, runtime.surfaces.yaohuo]);

  useEffect(() => {
    if (
      linuxDoLevelExpanded &&
      linuxDoSession.canWrite &&
      !linuxDoLevelProfile &&
      !linuxDoLevelBusy &&
      !linuxDoLevelError
    ) {
      void refreshLinuxDoLevel();
    }
  }, [
    linuxDoLevelBusy,
    linuxDoLevelError,
    linuxDoLevelExpanded,
    linuxDoLevelProfile,
    linuxDoSession.canWrite,
    refreshLinuxDoLevel
  ]);

  useEffect(() => {
    if (
      xiaoyinsiLevelExpanded &&
      xiaoyinsiSession.canWrite &&
      !xiaoyinsiLevelProfile &&
      !xiaoyinsiLevelBusy &&
      !xiaoyinsiLevelError
    ) {
      void refreshXiaoyinsiLevel();
    }
  }, [
    refreshXiaoyinsiLevel,
    xiaoyinsiLevelExpanded,
    xiaoyinsiLevelBusy,
    xiaoyinsiLevelError,
    xiaoyinsiLevelProfile,
    xiaoyinsiSession.canWrite
  ]);
  const linuxDoLevelMeta = !linuxDoSession.canWrite
    ? '登录后查看'
    : linuxDoLevelBusy
      ? '读取中'
      : linuxDoLevelProfile
        ? `LV ${linuxDoLevelProfile.currentLevel}${linuxDoLevelProfile.targetLevel !== null ? ` → LV ${linuxDoLevelProfile.targetLevel}` : ''}`
        : linuxDoLevelError || '点击读取';
  const xiaoyinsiLevelMeta = !xiaoyinsiSession.canWrite
    ? '授权后查看'
    : xiaoyinsiLevelBusy
      ? '读取中'
      : xiaoyinsiLevelProfile
        ? `LV ${xiaoyinsiLevelProfile.currentLevel}${xiaoyinsiLevelProfile.targetLevel !== null ? ` → LV ${xiaoyinsiLevelProfile.targetLevel}` : ''}`
        : xiaoyinsiLevelError || '点击读取';

  return (
    <AccountCenterPanel
      credentials={runtime.center.credentials.summaries}
      expanded={expanded}
      forcedSite={
        runtime.surfaces.nodeseek
          ? 'nodeseek'
          : runtime.surfaces.yaohuo
            ? 'yaohuo'
            : runtime.surfaces.linuxdo
              ? 'linuxdo'
              : authForcedOpen
                ? 'xiaoyinsi'
                : null
      }
      pendingFillSite={runtime.center.credentials.pendingFillSite}
      nodeSeekUserId={nodeSeekUserIdForSession(sessions.nodeseek, runtime.center.nodeSeek.webLoginUserId)}
      sessions={projectedSessions}
      siteContent={{
        nodeseek: (
          <NodeSeekServicesPanel
            apiKeyBusy={runtime.center.nodeImageKey.busy}
            apiKeySaved={runtime.center.nodeImageKey.saved}
            recoveryThreshold={nodeSeekRecoveryThreshold}
            session={sessions.nodeseek}
            styles={screenStyles}
            theme={theme}
            onAuthorizeApiKey={() => void runtime.center.nodeImageKey.authorize()}
            onCheckIn={() => void runtime.center.nodeSeek.checkIn()}
            onClearApiKey={() => void runtime.center.nodeImageKey.clear()}
            onRecoveryThresholdChange={onNodeSeekRecoveryThresholdChange}
            onSaveApiKey={(value) => void runtime.center.nodeImageKey.save(value)}
          />
        ),
        linuxdo: (
          <>
            <MenuButton
              nested
              icon={Activity}
              label="linux.do 等级"
              value={linuxDoLevelMeta}
              expanded={linuxDoLevelExpanded}
              onPress={() => setLinuxDoLevelExpanded((value) => !value)}
            />
            {linuxDoLevelExpanded ? (
              <LinuxDoLevelPanel
                busy={linuxDoLevelBusy}
                error={linuxDoLevelError}
                siteSession={linuxDoSession}
                profile={linuxDoLevelProfile}
                styles={screenStyles}
                theme={theme}
                onOpenLogin={() => {
                  void runtime.center.command({ type: 'open-login', site: 'linuxdo' });
                }}
                onRefresh={() => void refreshLinuxDoLevel()}
              />
            ) : null}
          </>
        ),
        yaohuo: null,
        xiaoyinsi: (
          <>
            <XiaoyinsiAuthPanel
              message={auth.message}
              pending={auth.pending}
              phase={auth.phase}
              secondsRemaining={auth.secondsRemaining}
              session={xiaoyinsiSession}
              styles={screenStyles}
              theme={theme}
              onBegin={() => void auth.begin()}
              onCancel={() => void auth.cancel()}
              onOpenBrowser={() => void auth.openBrowser()}
              onRevoke={() => void auth.revoke()}
            />
            <View
              testID={
                xiaoyinsiLevelExpanded &&
                xiaoyinsiSession.canWrite &&
                !xiaoyinsiLevelBusy &&
                (xiaoyinsiLevelProfile || xiaoyinsiLevelError)
                  ? 'xiaoyinsi-level-settled'
                  : undefined
              }
              style={[styles.accountFooterAction, { borderTopColor: theme.line }]}
            >
              <MenuButton
                nested
                icon={Activity}
                label="查看等级"
                value={xiaoyinsiLevelMeta}
                expanded={xiaoyinsiLevelExpanded}
                onPress={() => setXiaoyinsiLevelExpanded((value) => !value)}
              />
              {xiaoyinsiLevelExpanded ? (
                <LinuxDoLevelPanel
                  busy={xiaoyinsiLevelBusy}
                  error={xiaoyinsiLevelError}
                  loginButtonLabel="授权登录"
                  loginMessage="需要先完成小隐寺授权，等级数据只使用 App 保存的 User API Key 读取。"
                  profile={xiaoyinsiLevelProfile}
                  siteSession={xiaoyinsiSession}
                  styles={screenStyles}
                  theme={theme}
                  onOpenLogin={() => void auth.begin()}
                  onRefresh={() => void refreshXiaoyinsiLevel()}
                />
              ) : null}
            </View>
          </>
        )
      }}
      statusBusy={runtime.read.statusBusy}
      styles={screenStyles}
      theme={theme}
      onCommand={runtime.center.command}
      onExpandedChange={setExpanded}
    />
  );
}
