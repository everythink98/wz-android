import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render } from '../render';
import React, { type ComponentProps } from 'react';
import { StyleSheet } from 'react-native';
import { emptyCredentialSummaries } from '@/platform/storage/credentialVault';
import { createEmptyNetworkProxyState } from '@/platform/network/networkProxy';
import { createEmptyReaderData } from '@/domain/reader/readerData';
import { MoreScreen } from '@/features/more/MoreScreen';
import { createSiteSessionStates, createSiteSessionViewModels } from '@/domain/session/siteSessionState';
import { createTheme } from '@/ui/theme/tokens';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ bottom: 0, left: 0, right: 0, top: 0 })
}));

jest.mock('react-native-webview', () => {
  const ReactModule = require('react') as typeof React;
  const { View } = require('react-native') as typeof import('react-native');
  return {
    WebView: ReactModule.forwardRef(function MockWebView(props: Record<string, unknown>, ref) {
      ReactModule.useImperativeHandle(ref, () => ({ injectJavaScript: () => undefined, reload: () => undefined }));
      return ReactModule.createElement(View, props);
    })
  };
});

jest.mock('react-native-gesture-handler', () => {
  const ReactModule = require('react') as typeof React;
  return {
    Gesture: {
      Pan: () => ({
        minDistance() {
          return this;
        },
        runOnJS() {
          return this;
        },
        onBegin() {
          return this;
        },
        onUpdate() {
          return this;
        },
        onEnd() {
          return this;
        },
        onFinalize() {
          return this;
        }
      })
    },
    GestureDetector: ({ children }: { children: React.ReactNode }) =>
      ReactModule.createElement(ReactModule.Fragment, null, children),
    ScrollView: require('react-native').ScrollView
  };
});

jest.mock('lucide-react-native', () => {
  const Icon = () => null;
  return {
    Activity: Icon,
    ArrowLeft: Icon,
    Bell: Icon,
    Bug: Icon,
    Check: Icon,
    CheckCircle: Icon,
    ChevronDown: Icon,
    ChevronRight: Icon,
    ChevronUp: Icon,
    DatabaseBackup: Icon,
    Image: Icon,
    Info: Icon,
    RefreshCw: Icon,
    Server: Icon,
    Settings: Icon,
    Trash2: Icon,
    User: Icon,
    X: Icon
  };
});

const readerData = createEmptyReaderData();
const sessionViewModels = createSiteSessionViewModels(createSiteSessionStates());
const authorizedXiaoyinsiSessions = createSiteSessionViewModels(
  createSiteSessionStates({
    xiaoyinsi: {
      site: 'xiaoyinsi',
      status: 'logged-in',
      cookieSummary: [],
      isVerifying: false,
      currentUser: {
        source: 'xiaoyinsi',
        id: 'alice',
        username: 'alice',
        displayName: 'Alice',
        url: 'https://forum.xiaoyinsi.com/u/alice',
        topics: []
      }
    }
  })
);

type MoreScreenProps = ComponentProps<typeof MoreScreen>;
type MoreScreenOverrides = {
  account?: {
    read?: Partial<MoreScreenProps['account']['read']>;
    center?: {
      command?: MoreScreenProps['account']['center']['command'];
      credentials?: Partial<MoreScreenProps['account']['center']['credentials']>;
      linuxDoLevel?: Partial<MoreScreenProps['account']['center']['linuxDoLevel']>;
      nodeImageKey?: Partial<MoreScreenProps['account']['center']['nodeImageKey']>;
      nodeSeek?: Partial<MoreScreenProps['account']['center']['nodeSeek']>;
      xiaoyinsiAuth?: Partial<MoreScreenProps['account']['center']['xiaoyinsiAuth']>;
      xiaoyinsiLevel?: Partial<MoreScreenProps['account']['center']['xiaoyinsiLevel']>;
    };
    surfaces?: Partial<MoreScreenProps['account']['surfaces']>;
  };
  update?: Partial<MoreScreenProps['update']>;
  utilities?: {
    notifications?: Partial<MoreScreenProps['utilities']['notifications']>;
    backup?: Partial<MoreScreenProps['utilities']['backup']>;
    diagnostics?: Partial<MoreScreenProps['utilities']['diagnostics']>;
    proxy?: Partial<MoreScreenProps['utilities']['proxy']>;
    settings?: Partial<MoreScreenProps['utilities']['settings']>;
  };
};

function moreProps(overrides: MoreScreenOverrides = {}): MoreScreenProps {
  const account: MoreScreenProps['account'] = {
    read: {
      sessions: sessionViewModels,
      statusBusy: false,
      ...overrides.account?.read
    },
    center: {
      command: jest.fn(async () => undefined),
      credentials: {
        summaries: emptyCredentialSummaries(),
        pendingFillSite: null,
        ...overrides.account?.center?.credentials
      },
      linuxDoLevel: {
        busy: false,
        error: '',
        profile: null,
        refresh: jest.fn(),
        ...overrides.account?.center?.linuxDoLevel
      },
      nodeImageKey: {
        authorize: jest.fn(),
        busy: false,
        clear: jest.fn(),
        save: jest.fn(),
        saved: false,
        ...overrides.account?.center?.nodeImageKey
      },
      nodeSeek: {
        checkIn: jest.fn(),
        webLoginUserId: null,
        ...overrides.account?.center?.nodeSeek
      },
      xiaoyinsiAuth: {
        begin: jest.fn(),
        cancel: jest.fn(),
        message: '',
        openBrowser: jest.fn(),
        pending: null,
        phase: 'idle',
        revoke: jest.fn(),
        secondsRemaining: 0,
        ...overrides.account?.center?.xiaoyinsiAuth
      },
      xiaoyinsiLevel: {
        busy: false,
        error: '',
        profile: null,
        refresh: jest.fn(),
        ...overrides.account?.center?.xiaoyinsiLevel
      },
      ...(overrides.account?.center?.command ? { command: overrides.account.center.command } : {})
    },
    surfaces: {
      closeAll: jest.fn(),
      linuxdo: false,
      nodeseek: false,
      yaohuo: false,
      ...overrides.account?.surfaces
    }
  };
  return {
    account,
    update: {
      busy: false,
      downloading: false,
      progress: null,
      info: null,
      message: '当前版本 1.3.63',
      check: jest.fn(),
      download: jest.fn(),
      ...overrides.update
    },
    utilities: {
      notifications: {
        open: jest.fn(),
        summary: '暂无未读 · 后台通知未开启',
        ...overrides.utilities?.notifications
      },
      backup: {
        busy: false,
        exportFile: jest.fn(),
        importFile: jest.fn(),
        ...overrides.utilities?.backup
      },
      diagnostics: {
        busy: false,
        exportLog: jest.fn(),
        ...overrides.utilities?.diagnostics
      },
      proxy: {
        activeProfile: null,
        applyError: '',
        applyStatus: 'idle',
        state: createEmptyNetworkProxyState(),
        summary: '未启用',
        visible: false,
        close: jest.fn(),
        open: jest.fn(),
        deleteProfile: jest.fn(async () => undefined),
        selectProfile: jest.fn(async () => undefined),
        setEnabled: jest.fn(async () => undefined),
        testProfile: jest.fn(async () => ({ ok: true, latencyMs: 10 })),
        upsertProfile: jest.fn(async () => undefined),
        ...overrides.utilities?.proxy
      },
      settings: {
        value: readerData.settings,
        visible: false,
        changeVisible: jest.fn(),
        update: jest.fn(),
        ...overrides.utilities?.settings
      }
    }
  };
}

function collectRenderedText(node: unknown): string[] {
  if (typeof node === 'string') {
    return [node];
  }
  if (Array.isArray(node)) {
    return node.flatMap(collectRenderedText);
  }
  if (!node || typeof node !== 'object' || !('children' in node)) {
    return [];
  }
  return collectRenderedText((node as { children?: unknown }).children);
}

describe('More screen state and actions', () => {
  it('opens the unified message center with an accurate summary', async () => {
    const open = jest.fn();
    const view = await render(
      <MoreScreen
        {...moreProps({
          utilities: {
            notifications: { open, summary: '有未读 · 后台通知已开启' }
          }
        })}
      />
    );

    await fireEvent.press(view.getByLabelText('消息通知，有未读 · 后台通知已开启'));
    expect(open).toHaveBeenCalledTimes(1);
    expect(StyleSheet.flatten(view.getByTestId('more-notifications-row').props.style)).toMatchObject({
      borderBottomColor: createTheme(readerData.settings).line,
      borderBottomWidth: StyleSheet.hairlineWidth
    });
  });

  it('shows current, checking, available-update and download progress states', async () => {
    const onCheckAppUpdate = jest.fn();
    const onDownloadAppUpdate = jest.fn();
    const view = await render(
      <MoreScreen {...moreProps({ update: { check: onCheckAppUpdate, download: onDownloadAppUpdate } })} />
    );

    expect(view.queryByText('有新版本')).toBeNull();
    await fireEvent.press(view.getByLabelText('检查更新'));
    expect(onCheckAppUpdate).toHaveBeenCalledTimes(1);

    await view.rerender(
      <MoreScreen {...moreProps({ update: { busy: true, check: onCheckAppUpdate, download: onDownloadAppUpdate } })} />
    );
    expect(view.getByLabelText('检查中').props.accessibilityState.disabled).toBe(true);

    const appUpdateInfo = {
      version: '1.4.0',
      apkUrl: 'https://github.com/everythink98/wz-android/releases/download/v1.4.0/app-arm64-v8a-release.apk',
      notes: '修复已知问题',
      sha256: 'a'.repeat(64),
      packageName: 'com.everythink.wzandroid',
      versionName: '1.4.0',
      versionCode: 68,
      signerSha256: 'b'.repeat(64)
    };
    await view.rerender(
      <MoreScreen
        {...moreProps({
          update: {
            info: appUpdateInfo,
            message: '发现新版 1.4.0',
            check: onCheckAppUpdate,
            download: onDownloadAppUpdate
          }
        })}
      />
    );
    expect(view.getByText('有新版本')).toBeTruthy();
    expect(view.getByText('修复已知问题')).toBeTruthy();
    await fireEvent.press(view.getByLabelText('下载并安装'));
    expect(onDownloadAppUpdate).toHaveBeenCalledTimes(1);

    await view.rerender(
      <MoreScreen
        {...moreProps({
          update: {
            busy: true,
            downloading: true,
            progress: {
              title: '正在下载 1.4.0',
              downloadedBytes: 1024,
              totalBytes: 2048,
              percent: 50,
              percentLabel: '50%',
              sizeLabel: '1 KB / 2 KB'
            },
            info: appUpdateInfo,
            check: onCheckAppUpdate,
            download: onDownloadAppUpdate
          }
        })}
      />
    );
    expect(view.getByText('正在下载 1.4.0')).toBeTruthy();
    expect(view.getByText('50%')).toBeTruthy();
    expect(view.getByLabelText('下载中').props.accessibilityState.disabled).toBe(true);
  });

  it('routes proxy, diagnostic and backup actions and exposes their busy gates', async () => {
    const onExportBackupFile = jest.fn();
    const onExportDiagnosticLog = jest.fn();
    const onImportBackupFile = jest.fn();
    const onShowNetworkProxyPanelChange = jest.fn();
    const props = moreProps({
      utilities: {
        backup: { exportFile: onExportBackupFile, importFile: onImportBackupFile },
        diagnostics: { exportLog: onExportDiagnosticLog },
        proxy: { open: () => onShowNetworkProxyPanelChange(true) }
      }
    });
    const view = await render(<MoreScreen {...props} />);

    await fireEvent.press(view.getByText('服务器代理'));
    expect(onShowNetworkProxyPanelChange).toHaveBeenCalledWith(true);

    await fireEvent.press(view.getByLabelText('展开问题诊断'));
    expect(view.getByText(/日志只保存在本机并经过脱敏/)).toBeTruthy();
    await fireEvent.press(view.getByLabelText('生成并分享诊断日志'));
    expect(onExportDiagnosticLog).toHaveBeenCalledTimes(1);

    await fireEvent.press(view.getByLabelText('展开备份 / 恢复'));
    await fireEvent.press(view.getByLabelText('导出备份文件'));
    await fireEvent.press(view.getByLabelText('选择备份文件恢复'));
    expect(onExportBackupFile).toHaveBeenCalledTimes(1);
    expect(onImportBackupFile).toHaveBeenCalledTimes(1);

    await view.rerender(
      <MoreScreen
        {...moreProps({
          utilities: {
            backup: { busy: true, exportFile: onExportBackupFile, importFile: onImportBackupFile },
            diagnostics: { busy: true, exportLog: onExportDiagnosticLog }
          }
        })}
      />
    );
    expect(view.getByLabelText('正在生成').props.accessibilityState.disabled).toBe(true);
    expect(view.getByLabelText('处理中').props.accessibilityState.disabled).toBe(true);
    expect(view.getByLabelText('选择备份文件恢复').props.accessibilityState.disabled).toBe(true);
  });

  it('[REG-TEST-003] never exposes an in-app anonymous simulation', async () => {
    const view = await render(<MoreScreen {...moreProps()} />);

    expect(view.queryByLabelText('展开测试工具')).toBeNull();
  });

  it('shows the 小隐寺 Device Code, countdown and browser/cancel actions without credential fields', async () => {
    const onCancel = jest.fn();
    const onOpenBrowser = jest.fn();
    const pending = {
      deviceCode: 'd'.repeat(64),
      userCode: 'ABCD-2345',
      verificationUri: 'https://forum.xiaoyinsi.com/user-api-key/activate',
      verificationUriWithRequest: 'https://forum.xiaoyinsi.com/user-api-key/activate?request=safe',
      nonce: 'e'.repeat(64),
      createdAt: 1_000,
      expiresAt: 601_000,
      intervalMs: 5_000
    };
    const view = await render(
      <MoreScreen
        {...moreProps({
          account: {
            center: {
              xiaoyinsiAuth: {
                pending,
                phase: 'waiting',
                secondsRemaining: 599,
                cancel: onCancel,
                openBrowser: onOpenBrowser
              }
            }
          }
        })}
      />
    );

    expect(await view.findByLabelText('小隐寺授权验证码 ABCD-2345')).toBeTruthy();
    expect(view.getByText('剩余 09:59 · 返回阅坛后会自动继续检测')).toBeTruthy();
    expect(view.queryByPlaceholderText('账号')).toBeNull();
    expect(view.queryByPlaceholderText('密码')).toBeNull();
    expect(
      view.getByText(
        '系统浏览器只打开一次性小隐寺授权页；阅坛登录态只由独立 User API Key 维护，不读取浏览器 Cookie，也不打开登录 WebView。'
      )
    ).toBeTruthy();
    await fireEvent.press(view.getByLabelText('复制验证码并前往授权页'));
    await fireEvent.press(view.getByLabelText('取消'));
    expect(onOpenBrowser).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('[REG-XIAOYINSI-013][REG-XIAOYINSI-014] puts the level entry after authorization management for an authorized 小隐寺 account', async () => {
    const onRefreshXiaoyinsiLevel = jest.fn();
    const view = await render(
      <MoreScreen
        {...moreProps({
          account: {
            read: { sessions: authorizedXiaoyinsiSessions },
            center: { xiaoyinsiLevel: { refresh: onRefreshXiaoyinsiLevel } }
          }
        })}
      />
    );

    await fireEvent.press(view.getByLabelText('展开账号中心'));
    await fireEvent.press(view.getByTestId('account-site-xiaoyinsi'));

    expect(view.getByText('授权管理')).toBeTruthy();
    expect(view.getByText('User API Key 仅保存在本机，不读取浏览器 Cookie。')).toBeTruthy();
    expect(view.getByText('查看等级')).toBeTruthy();
    expect(view.getByLabelText('撤销授权')).toBeTruthy();
    const renderedText = collectRenderedText(view.toJSON());
    expect(renderedText.indexOf('撤销授权')).toBeLessThan(renderedText.indexOf('查看等级'));
    await fireEvent.press(view.getByText('查看等级'));
    expect(onRefreshXiaoyinsiLevel).toHaveBeenCalledTimes(1);
    expect(view.queryByTestId('xiaoyinsi-level-settled')).toBeNull();
  });

  it('[REG-TEST-005] marks only settled level outcomes and keeps an error visible until refresh', async () => {
    const onRefreshXiaoyinsiLevel = jest.fn();
    const levelProfile: NonNullable<
      ComponentProps<typeof MoreScreen>['account']['center']['xiaoyinsiLevel']['profile']
    > = {
      username: 'alice',
      currentLevel: 2,
      targetLevel: 3,
      source: 'summary',
      estimate: false,
      note: '小隐寺当前账号统计',
      requirements: [],
      activity: {
        daysVisited: 5,
        topicsEntered: 20,
        postsReadCount: 120,
        timeRead: 3660,
        likesGiven: 8,
        likesReceived: 9,
        postCount: 10,
        topicCount: 2
      },
      achievedCount: 0,
      totalCount: 0,
      fetchedAt: '2026-07-26T01:00:00.000Z'
    };
    const view = await render(
      <MoreScreen
        {...moreProps({
          account: {
            read: { sessions: authorizedXiaoyinsiSessions },
            center: {
              xiaoyinsiLevel: { error: '限制 10 秒后再试', refresh: onRefreshXiaoyinsiLevel }
            }
          }
        })}
      />
    );

    await fireEvent.press(view.getByLabelText('展开账号中心'));
    await fireEvent.press(view.getByTestId('account-site-xiaoyinsi'));
    await fireEvent.press(view.getByText('查看等级'));

    expect(view.getByTestId('xiaoyinsi-level-settled')).toBeTruthy();
    expect(view.getAllByText('限制 10 秒后再试')).not.toHaveLength(0);
    expect(onRefreshXiaoyinsiLevel).not.toHaveBeenCalled();
    await fireEvent.press(view.getByLabelText('刷新等级'));
    expect(onRefreshXiaoyinsiLevel).toHaveBeenCalledTimes(1);

    await view.rerender(
      <MoreScreen
        {...moreProps({
          account: {
            read: { sessions: authorizedXiaoyinsiSessions },
            center: {
              xiaoyinsiLevel: { busy: true, profile: levelProfile, refresh: onRefreshXiaoyinsiLevel }
            }
          }
        })}
      />
    );
    expect(view.queryByTestId('xiaoyinsi-level-settled')).toBeNull();

    await view.rerender(
      <MoreScreen
        {...moreProps({
          account: {
            read: { sessions: authorizedXiaoyinsiSessions },
            center: { xiaoyinsiLevel: { profile: levelProfile, refresh: onRefreshXiaoyinsiLevel } }
          }
        })}
      />
    );
    expect(view.getByTestId('xiaoyinsi-level-settled')).toBeTruthy();
    expect(view.queryAllByText('限制 10 秒后再试')).toHaveLength(0);
    expect(view.getAllByText('LV 2 → LV 3')).not.toHaveLength(0);
  });

  it('[REG-XIAOYINSI-005] exposes persisted revocation cleanup before any stale logged-in controls', async () => {
    const onBegin = jest.fn();
    const view = await render(
      <MoreScreen
        {...moreProps({
          account: {
            read: {
              sessions: {
                ...sessionViewModels,
                xiaoyinsi: {
                  ...sessionViewModels.xiaoyinsi,
                  isLoggedIn: true,
                  canWrite: true
                }
              }
            },
            center: {
              xiaoyinsiAuth: {
                message: '服务端授权已撤销，但本机安全材料清理未完成，请重试本机清理。',
                phase: 'cleanup',
                begin: onBegin
              }
            }
          }
        })}
      />
    );

    await fireEvent.press(await view.findByLabelText('重试本机清理'));
    expect(view.queryByLabelText('重新授权')).toBeNull();
    expect(view.queryByLabelText('撤销授权')).toBeNull();
    expect(onBegin).toHaveBeenCalledTimes(1);
  });
});
