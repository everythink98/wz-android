import type { SessionSite, SiteSessionViewModels } from '@/domain/session/siteSessionState';
import { createSiteSessionStates, createSiteSessionViewModels } from '@/domain/session/siteSessionState';
import { AccountCenterPanel } from '@/features/more/components/AccountCenterPanel';
import { LinuxDoLevelPanel } from '@/features/more/components/LinuxDoLevelPanel';
import { NodeSeekServicesPanel } from '@/features/more/components/NodeSeekServicesPanel';
import { createMoreScreenStyles } from '@/features/more/styles';
import { emptyCredentialSummaries, type CredentialSummaries } from '@/platform/storage/credentialVault';
import type { LinuxDoLevelProfile } from '@/sources/readGateway';
import { useReaderThemeStyles } from '@/ui/theme/ReaderStyleProvider';
import type { VisualScenarioDefinition } from '../../types';

const FIXED_TIME = '2026-08-29T08:00:00.000Z';
const noop = () => undefined;
const noopAsync = async () => undefined;

function createAnonymousSessions() {
  return createSiteSessionViewModels(createSiteSessionStates());
}

function createLoggedInSessions() {
  return createSiteSessionViewModels(
    createSiteSessionStates({
      nodeseek: {
        site: 'nodeseek',
        status: 'logged-in',
        cookieSummary: [],
        isVerifying: false,
        currentUser: {
          source: 'nodeseek',
          id: '42',
          username: 'visual-user',
          displayName: '示例用户',
          url: 'https://account.visual.invalid/nodeseek/users/42',
          topics: []
        }
      },
      linuxdo: {
        site: 'linuxdo',
        status: 'logged-in',
        cookieSummary: [],
        isVerifying: false,
        currentUser: {
          source: 'linuxdo',
          id: 'visual-linuxdo',
          username: 'visual-linuxdo',
          displayName: '示例用户',
          url: 'https://account.visual.invalid/linuxdo/users/visual-linuxdo',
          topics: []
        }
      },
      yaohuo: {
        site: 'yaohuo',
        status: 'expired',
        cookieSummary: [],
        isVerifying: false
      }
    })
  );
}

function createMixedSessions() {
  return createSiteSessionViewModels(
    createSiteSessionStates({
      nodeseek: {
        site: 'nodeseek',
        status: 'logged-in',
        cookieSummary: [],
        isVerifying: false,
        currentUser: {
          source: 'nodeseek',
          id: '42',
          username: 'visual-user',
          displayName: '示例用户',
          url: 'https://account.visual.invalid/nodeseek/users/42',
          topics: []
        }
      },
      linuxdo: {
        site: 'linuxdo',
        status: 'verification-required',
        cookieSummary: [],
        isVerifying: false,
        lastError: '需要完成站点验证'
      },
      yaohuo: {
        site: 'yaohuo',
        status: 'expired',
        cookieSummary: [],
        isVerifying: false
      }
    })
  );
}

function deviceProtectedSummaries(): CredentialSummaries {
  return {
    ...emptyCredentialSummaries(),
    yaohuo: {
      site: 'yaohuo',
      state: 'saved',
      hasCredential: true,
      protection: 'device'
    }
  };
}

function AccountCenterScenario({
  credentials = emptyCredentialSummaries(),
  enabledSessionSources = ['nodeseek', 'linuxdo', 'yaohuo'],
  nodeSeekUserId = null,
  sessions = createAnonymousSessions(),
  statusBusy = false
}: {
  credentials?: CredentialSummaries;
  enabledSessionSources?: readonly SessionSite[];
  nodeSeekUserId?: number | null;
  sessions?: SiteSessionViewModels;
  statusBusy?: boolean;
}) {
  const { styles, theme } = useReaderThemeStyles(createMoreScreenStyles);
  return (
    <AccountCenterPanel
      credentials={credentials}
      enabledSessionSources={enabledSessionSources}
      expanded
      nodeSeekUserId={nodeSeekUserId}
      sessions={sessions}
      siteContent={{}}
      statusBusy={statusBusy}
      styles={styles}
      theme={theme}
      onCommand={noopAsync}
      onExpandedChange={noop}
    />
  );
}

function NodeSeekServicesScenario() {
  const { styles, theme } = useReaderThemeStyles(createMoreScreenStyles);
  const sessions = createLoggedInSessions();
  return (
    <NodeSeekServicesPanel
      apiKeyBusy={false}
      apiKeySaved={false}
      recoveryThreshold={2}
      session={sessions.nodeseek}
      styles={styles}
      theme={theme}
      onAuthorizeApiKey={noop}
      onCheckIn={noop}
      onClearApiKey={noop}
      onRecoveryThresholdChange={noop}
      onSaveApiKey={noop}
    />
  );
}

function createLinuxDoLevelProfile(): LinuxDoLevelProfile {
  return {
    username: 'visual-linuxdo',
    currentLevel: 1,
    targetLevel: 2,
    source: 'connect',
    estimate: false,
    note: '示例进度，不连接站点。',
    requirements: [
      {
        key: 'days_visited',
        label: '访问天数',
        current: 9,
        required: 15,
        met: false,
        direction: 'minimum',
        ratio: 0.6,
        displayCurrent: '9',
        displayRequired: '15',
        displayChange: '较上次 +2'
      },
      {
        key: 'likes_received',
        label: '获赞',
        current: 3,
        required: 1,
        met: true,
        direction: 'minimum',
        ratio: 1,
        displayCurrent: '3',
        displayRequired: '1'
      },
      {
        key: 'connect:被举报帖子',
        label: '被举报帖子',
        current: 2,
        required: 5,
        met: true,
        direction: 'maximum',
        ratio: 0.4,
        displayCurrent: '2',
        displayRequired: '5',
        change: 1,
        displayChange: '较上次 +1'
      },
      {
        key: 'connect:被禁言',
        label: '被禁言',
        current: 0,
        required: 0,
        met: true,
        direction: 'maximum',
        ratio: 0,
        displayCurrent: '0',
        displayRequired: '已通过'
      }
    ],
    activity: {
      daysVisited: 9,
      topicsEntered: 36,
      postsReadCount: 248,
      timeRead: 6420,
      likesGiven: 7,
      likesReceived: 3,
      postCount: 6,
      topicCount: 2
    },
    achievedCount: 3,
    totalCount: 4,
    fetchedAt: FIXED_TIME
  };
}

function LinuxDoLevelScenario() {
  const { styles, theme } = useReaderThemeStyles(createMoreScreenStyles);
  const sessions = createLoggedInSessions();
  return (
    <LinuxDoLevelPanel
      busy={false}
      error=""
      profile={createLinuxDoLevelProfile()}
      siteSession={sessions.linuxdo}
      styles={styles}
      theme={theme}
      onOpenLogin={noop}
      onRefresh={noop}
    />
  );
}

export const accountVisualScenarios: readonly VisualScenarioDefinition[] = [
  {
    capabilityIds: ['ACCOUNT-01'],
    id: 'account.center.anonymous',
    kind: 'rendered',
    tags: ['account', 'center', 'anonymous'],
    title: '账号中心·三站未登录',
    render: () => <AccountCenterScenario />
  },
  {
    capabilityIds: ['ACCOUNT-01', 'ACCOUNT-03', 'ACCOUNT-05'],
    id: 'account.center.mixed',
    kind: 'rendered',
    tags: ['account', 'center', 'mixed', 'credential-summary'],
    title: '账号中心·混合状态',
    render: () => (
      <AccountCenterScenario
        credentials={deviceProtectedSummaries()}
        nodeSeekUserId={42}
        sessions={createMixedSessions()}
      />
    )
  },
  {
    capabilityIds: ['ACCOUNT-03', 'ACCOUNT-05'],
    id: 'account.credentials.saved-summary',
    kind: 'rendered',
    tags: ['account', 'credential-summary', 'device-protected'],
    title: '自动填入·已使用本机加密',
    render: () => <AccountCenterScenario credentials={deviceProtectedSummaries()} enabledSessionSources={['yaohuo']} />
  },
  {
    capabilityIds: ['ACCOUNT-04'],
    id: 'account.services.nodeseek',
    kind: 'rendered',
    tags: ['account', 'nodeseek', 'services'],
    title: 'NodeSeek 站点服务',
    render: () => <NodeSeekServicesScenario />
  },
  {
    capabilityIds: ['ACCOUNT-04'],
    id: 'account.services.linuxdo-level',
    kind: 'rendered',
    tags: ['account', 'linuxdo', 'level', 'official-requirements'],
    title: 'linux.do 等级·官方要求',
    render: () => <LinuxDoLevelScenario />
  },
  {
    capabilityIds: ['ACCOUNT-02'],
    id: 'account.webview.authentication',
    kind: 'device-only',
    note: '只评价 App 自有的弹层、加载、错误和关闭 framing；原站网页、Cookie 与登录结果必须在设备上验证。',
    tags: ['account', 'webview', 'authentication', 'privacy-boundary'],
    title: '站点登录与验证 WebView'
  },
  {
    capabilityIds: ['ACCOUNT-04'],
    id: 'account.nodeimage.connect',
    kind: 'device-only',
    note: 'NodeImage 授权、Connect 与签到依赖真实身份和站点终态；画廊不读取 Key，也不发起写入。',
    tags: ['account', 'nodeimage', 'connect', 'external-service'],
    title: 'NodeImage 授权与 NodeSeek Connect'
  },
  {
    capabilityIds: ['ACCOUNT-05'],
    id: 'account.credentials.system-auth',
    kind: 'device-only',
    note: '画廊可显示 App 自有的凭据摘要和提示；Android 用户身份认证 sheet 属于系统 UI。',
    tags: ['account', 'credential', 'system-auth'],
    title: '凭据保护·系统用户身份认证'
  },
  {
    capabilityIds: ['ACCOUNT-01'],
    id: 'account.session.persistence',
    kind: 'non-visual',
    note: 'AccountSessionSnapshot 冷启动恢复、epoch 和串行落盘是后台协议，不制造伪页面。',
    tags: ['account', 'session', 'persistence'],
    title: '账号终态恢复与持久化'
  },
  {
    capabilityIds: ['ACCOUNT-03', 'ACCOUNT-05'],
    id: 'account.credentials.secure-storage',
    kind: 'non-visual',
    note: '凭据隔离、SecureStore 保护和取消完整性由行为测试与设备验收负责；场景永不接收完整凭据对象。',
    tags: ['account', 'credential', 'secure-storage', 'privacy-boundary'],
    title: '凭据安全存储协议'
  }
];
