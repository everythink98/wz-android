import { useEffect, useState } from 'react';
import { Activity } from 'lucide-react-native';
import type { AccountCenterCommand } from '@/domain/session/accountCenter';
import {
  nodeSeekUserIdForSession,
  type SessionSite,
  type SiteSessionViewModels
} from '@/domain/session/siteSessionState';
import type { LinuxDoLevelProfile, ReadGateway } from '@/sources/readGateway';
import type { NodeSeekAttendanceBoard, NodeSeekCheckInState, NodeSeekCreditCurrency } from '@/domain/forum/accountData';
import type { ForumSessionEpochs } from '@/platform/query/sessionEpochs';
import { ExpandableContent, MenuButton } from '@/ui/controls/ExpandableControls';
import { useReaderThemeStyles } from '@/ui/theme/ReaderStyleProvider';
import { useLatestCallback } from '@/ui/hooks/useLatestCallback';
import type { CredentialSummaries } from '../accountCenter';
import { createMoreScreenStyles } from '../styles';
import { AccountCenterPanel } from './AccountCenterPanel';
import { AccountOverviewPanel } from './AccountOverviewPanel';
import { useAccountOverview, type AccountOverviewGateway } from '../useAccountOverview';
import { LinuxDoLevelPanel } from './LinuxDoLevelPanel';
import { NodeSeekAttendancePanel, NodeSeekServicesPanel } from './NodeSeekServicesPanel';

export type MoreAccountCapabilities = {
  active: boolean;
  enabledSessionSources: readonly SessionSite[];
  read: {
    gateway: AccountOverviewGateway & Pick<ReadGateway, 'getNodeSeekCredits' | 'getNodeSeekStardustCredits'>;
    sessionEpochs: ForumSessionEpochs;
    sessions: SiteSessionViewModels;
    statusBusy: boolean;
  };
  center: {
    openCredits: (currency: NodeSeekCreditCurrency) => void;
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
      busy: boolean;
      state: NodeSeekCheckInState;
      checkIn: (random: boolean) => unknown;
      observeBoard: (board: NodeSeekAttendanceBoard) => void;
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
  const [selectedSite, setSelectedSite] = useState<SessionSite>('nodeseek');
  const [linuxDoLevelExpanded, setLinuxDoLevelExpanded] = useState(false);
  const [linuxDoLevelContentOwner, setLinuxDoLevelContentOwner] = useState<string | null>(null);
  const sessions = runtime.read.sessions;
  const nodeSeekEnabled = runtime.enabledSessionSources.includes('nodeseek');
  const linuxDoEnabled = runtime.enabledSessionSources.includes('linuxdo');
  const yaohuoEnabled = runtime.enabledSessionSources.includes('yaohuo');
  const linuxDoSession = sessions.linuxdo;
  const forcedSite =
    nodeSeekEnabled && runtime.surfaces.nodeseek
      ? 'nodeseek'
      : yaohuoEnabled && runtime.surfaces.yaohuo
        ? 'yaohuo'
        : linuxDoEnabled && runtime.surfaces.linuxdo
          ? 'linuxdo'
          : null;
  const requestedSite = forcedSite || runtime.center.credentials.pendingFillSite || selectedSite;
  const site = runtime.enabledSessionSources.includes(requestedSite)
    ? requestedSite
    : runtime.enabledSessionSources[0] || 'nodeseek';
  useEffect(() => {
    if (runtime.enabledSessionSources.includes(site) && site !== selectedSite) setSelectedSite(site);
  }, [site, selectedSite, runtime.enabledSessionSources]);
  const session = sessions[site];
  const siteOwner = `${site}:${session.currentUser?.id ?? 'anonymous'}`;
  if (linuxDoLevelContentOwner !== null && linuxDoLevelContentOwner !== siteOwner) setLinuxDoLevelContentOwner(null);
  const linuxDoLevelContentVisited = linuxDoLevelExpanded || linuxDoLevelContentOwner === siteOwner;
  const dataActive =
    runtime.active && expanded && runtime.enabledSessionSources.includes(site) && !runtime.surfaces[site];
  const data = useAccountOverview({
    active: dataActive,
    gateway: runtime.read.gateway,
    session,
    sessionEpochs: runtime.read.sessionEpochs,
    site
  });
  const observeBoard = useLatestCallback(runtime.center.nodeSeek.observeBoard);
  const refreshData = useLatestCallback(data.refresh);
  const refreshLevel = useLatestCallback(() => {
    if (
      dataActive &&
      site === 'linuxdo' &&
      linuxDoLevelExpanded &&
      linuxDoSession.canWrite &&
      !runtime.center.linuxDoLevel.busy
    ) {
      return runtime.center.linuxDoLevel.refresh();
    }
  });
  const handleCommand = useLatestCallback(async (command: AccountCenterCommand) => {
    await runtime.center.command(command);
    if (command.type === 'refresh') await Promise.all([refreshData(), refreshLevel()]);
  });
  useEffect(() => {
    if (dataActive && data.board) observeBoard(data.board);
  }, [dataActive, data.board, data.boardUpdatedAt, observeBoard]);
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
      dataActive &&
      site === 'linuxdo' &&
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
    dataActive,
    site,
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
      forcedSite={forcedSite}
      selectedSite={site}
      onSelectedSiteChange={setSelectedSite}
      profile={data.profile}
      overviewContent={
        session.currentUser && session.canWrite && session.identityTrust === 'confirmed' ? (
          <AccountOverviewPanel
            data={data}
            site={site}
            user={session.currentUser}
            styles={screenStyles}
            onCommand={runtime.center.command}
            onOpenCredits={runtime.center.openCredits}
          />
        ) : null
      }
      pendingFillSite={runtime.center.credentials.pendingFillSite}
      nodeSeekUserId={nodeSeekEnabled ? nodeSeekUserIdForSession(sessions.nodeseek) : null}
      sessions={sessions}
      siteContent={{
        nodeseek:
          nodeSeekEnabled && sessions.nodeseek.canWrite ? (
            <NodeSeekAttendancePanel
              board={data.board}
              busy={runtime.center.nodeSeek.busy}
              loading={data.boardBusy}
              error={data.boardError}
              state={runtime.center.nodeSeek.state}
              styles={screenStyles}
              onCheckIn={(random) => void runtime.center.nodeSeek.checkIn(random)}
              onRefresh={() => void data.retryAttendance()}
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
              onPress={() => {
                setLinuxDoLevelContentOwner(siteOwner);
                setLinuxDoLevelExpanded((value) => !value);
              }}
            />
            <ExpandableContent expanded={linuxDoLevelExpanded} style={screenStyles.stack}>
              {linuxDoLevelContentVisited ? (
                <LinuxDoLevelPanel
                  key={linuxDoSession.currentUser?.id ?? 'anonymous'}
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
            </ExpandableContent>
          </>
        ) : null,
        yaohuo: yaohuoEnabled ? null : undefined
      }}
      siteSettings={{
        nodeseek: nodeSeekEnabled
          ? (active) => (
              <NodeSeekServicesPanel
                active={active}
                apiKeyBusy={runtime.center.nodeImageKey.busy}
                apiKeySaved={runtime.center.nodeImageKey.saved}
                recoveryThreshold={nodeSeekRecoveryThreshold}
                styles={screenStyles}
                theme={theme}
                onAuthorizeApiKey={() => void runtime.center.nodeImageKey.authorize()}
                onClearApiKey={() => void runtime.center.nodeImageKey.clear()}
                onRecoveryThresholdChange={onNodeSeekRecoveryThresholdChange}
                onSaveApiKey={(value) => void runtime.center.nodeImageKey.save(value)}
              />
            )
          : undefined
      }}
      statusBusy={
        runtime.read.statusBusy ||
        data.busy ||
        data.boardBusy ||
        (site === 'linuxdo' && linuxDoLevelExpanded && linuxDoLevelBusy)
      }
      styles={screenStyles}
      theme={theme}
      onCommand={handleCommand}
      onExpandedChange={setExpanded}
    />
  );
}
