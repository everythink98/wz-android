import { useEffect, useState } from 'react';
import Activity from 'lucide-react-native/icons/activity';
import type { AccountCenterCommand } from '@/domain/session/accountCenter';
import {
  nodeSeekUserIdForSession,
  type SessionSite,
  type SiteSessionViewModels
} from '@/domain/session/siteSessionState';
import type { LinuxDoLevelProfile } from '@/sources/readGateway';
import { MenuButton } from '@/ui/controls/ExpandableControls';
import { useReaderThemeStyles } from '@/ui/theme/ReaderStyleProvider';
import type { CredentialSummaries } from '../accountCenter';
import { createMoreScreenStyles } from '../styles';
import { AccountCenterPanel } from './AccountCenterPanel';
import { LinuxDoLevelPanel } from './LinuxDoLevelPanel';
import { NodeSeekServicesPanel } from './NodeSeekServicesPanel';

export type MoreAccountCapabilities = {
  enabledSessionSources: readonly SessionSite[];
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
  const sessions = runtime.read.sessions;
  const nodeSeekEnabled = runtime.enabledSessionSources.includes('nodeseek');
  const linuxDoEnabled = runtime.enabledSessionSources.includes('linuxdo');
  const yaohuoEnabled = runtime.enabledSessionSources.includes('yaohuo');
  const linuxDoSession = sessions.linuxdo;
  const {
    busy: linuxDoLevelBusy,
    error: linuxDoLevelError,
    profile: linuxDoLevelProfile,
    refresh: refreshLinuxDoLevel
  } = runtime.center.linuxDoLevel;
  useEffect(() => {
    if (
      (nodeSeekEnabled && runtime.surfaces.nodeseek) ||
      (yaohuoEnabled && runtime.surfaces.yaohuo) ||
      (linuxDoEnabled && runtime.surfaces.linuxdo)
    ) {
      setExpanded(true);
    }
  }, [
    linuxDoEnabled,
    nodeSeekEnabled,
    runtime.surfaces.linuxdo,
    runtime.surfaces.nodeseek,
    runtime.surfaces.yaohuo,
    yaohuoEnabled
  ]);

  useEffect(() => {
    if (
      linuxDoLevelExpanded &&
      linuxDoEnabled &&
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
    linuxDoEnabled,
    linuxDoLevelProfile,
    linuxDoSession.canWrite,
    refreshLinuxDoLevel
  ]);

  const linuxDoLevelMeta = !linuxDoSession.canWrite
    ? '登录后查看'
    : linuxDoLevelBusy
      ? '读取中'
      : linuxDoLevelProfile
        ? `LV ${linuxDoLevelProfile.currentLevel}${linuxDoLevelProfile.targetLevel !== null ? ` → LV ${linuxDoLevelProfile.targetLevel}` : ''}`
        : linuxDoLevelError || '点击读取';

  return (
    <AccountCenterPanel
      credentials={runtime.center.credentials.summaries}
      enabledSessionSources={runtime.enabledSessionSources}
      expanded={expanded}
      forcedSite={
        nodeSeekEnabled && runtime.surfaces.nodeseek
          ? 'nodeseek'
          : yaohuoEnabled && runtime.surfaces.yaohuo
            ? 'yaohuo'
            : linuxDoEnabled && runtime.surfaces.linuxdo
              ? 'linuxdo'
              : null
      }
      pendingFillSite={runtime.center.credentials.pendingFillSite}
      nodeSeekUserId={nodeSeekEnabled ? nodeSeekUserIdForSession(sessions.nodeseek) : null}
      sessions={sessions}
      siteContent={{
        nodeseek: nodeSeekEnabled ? (
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
        ) : null,
        linuxdo: linuxDoEnabled ? (
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
        ) : null,
        yaohuo: yaohuoEnabled ? null : undefined
      }}
      statusBusy={runtime.read.statusBusy}
      styles={screenStyles}
      theme={theme}
      onCommand={runtime.center.command}
      onExpandedChange={setExpanded}
    />
  );
}
