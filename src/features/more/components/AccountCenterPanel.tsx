import { recordUserInteraction } from '@/platform/network/userPresence';
import type { MoreScreenStyles } from '../styles';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Alert, Keyboard, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { ChevronRight, RefreshCw, Settings2 } from 'lucide-react-native';
import { Button, List } from 'react-native-paper';
import { AppTextInput as TextInput } from '@/ui/controls/InputControls';
import { CredentialVaultError } from '@/platform/storage/credentialVault';
import type { CredentialSite } from '@/domain/session/sessionContracts';
import type { AccountCenterCommand } from '@/domain/session/accountCenter';
import type { UserDetails } from '@/domain/forum/models';
import { Avatar } from '@/ui/avatar/Avatar';
import type { SessionSite, SiteSessionViewModels } from '@/domain/session/siteSessionState';
import { type ReaderStyleSettings, fontFamilyValue, type ReaderTheme } from '@/ui/theme/tokens';
import { useReaderThemeStyles } from '@/ui/theme/ReaderStyleProvider';
import { IconButton } from '@/ui/controls/ButtonControls';
import { DisclosureChevron, ExpandableContent } from '@/ui/controls/ExpandableControls';
import { ModalSheetFrame, ModalSheetHeader } from '@/ui/controls/ModalSheetFrame';
import { Portal } from '@gorhom/portal';
import { createMoreSiteSettingStyles } from '../accountStyles';
import {
  accountCenterSummary,
  createSiteAccountViews,
  type CredentialSummaries,
  type SiteAccountView
} from '../accountCenter';

type CommandHandler = (command: AccountCenterCommand) => void | Promise<void>;
type AccountCenterStyles = ReturnType<typeof createAccountCenterStyles>;

function createAccountCenterStyles(theme: ReaderTheme, settings: ReaderStyleSettings) {
  const actionColor = theme.primary;
  const fontSize = (size: number) => Math.round(size * settings.fontScale);
  return StyleSheet.create({
    header: { alignItems: 'center', flexDirection: 'row', gap: 8, minHeight: 52 },
    title: {
      flex: 1,
      color: theme.ink,
      fontFamily: fontFamilyValue(settings.fontFamily),
      fontSize: fontSize(22),
      fontWeight: '600'
    },
    selectorRow: {
      borderBottomColor: theme.line,
      borderBottomWidth: StyleSheet.hairlineWidth,
      flexDirection: 'row',
      marginBottom: 0
    },
    siteTabs: {
      flex: 1,
      flexDirection: 'row',
      minWidth: 0
    },
    settingsButton: {
      alignItems: 'center',
      flex: 1,
      flexDirection: 'row',
      gap: 6,
      justifyContent: 'center',
      minHeight: 48,
      paddingHorizontal: 8
    },
    settingsRow: {
      borderTopColor: theme.line,
      borderTopWidth: StyleSheet.hairlineWidth,
      flexDirection: 'row'
    },
    settingsBody: {
      borderTopColor: theme.line,
      borderTopWidth: StyleSheet.hairlineWidth,
      gap: 8,
      paddingTop: 8,
      paddingBottom: 8
    },
    siteTab: {
      alignItems: 'center',
      flex: 1,
      justifyContent: 'center',
      minHeight: 48,
      paddingHorizontal: 6,
      paddingVertical: 10
    },
    siteTabIndicator: {
      backgroundColor: actionColor,
      bottom: 0,
      height: 2,
      position: 'absolute',
      width: 24
    },
    siteTabText: {
      color: theme.muted,
      fontFamily: fontFamilyValue(settings.fontFamily),
      fontSize: fontSize(13),
      fontWeight: '500'
    },
    siteTabTextSelected: {
      color: theme.primary,
      fontWeight: '600'
    },
    siteDetail: {
      gap: 0,
      paddingHorizontal: 0,
      paddingTop: 0
    },
    accountPanel: {
      backgroundColor: 'transparent'
    },
    siteOverview: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 14,
      paddingHorizontal: 0,
      paddingTop: 16,
      paddingBottom: 16
    },
    siteOverviewCopy: {
      flex: 1,
      gap: 4,
      minWidth: 0
    },
    identityName: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 6,
      maxWidth: '100%'
    },
    siteTitle: {
      flexShrink: 1,
      fontSize: fontSize(20),
      fontWeight: '600',
      textAlign: 'left'
    },
    identityMeta: {
      fontSize: fontSize(12),
      lineHeight: fontSize(17),
      textAlign: 'left'
    },
    section: {
      gap: 4,
      paddingBottom: 0,
      paddingHorizontal: 0,
      paddingTop: 0
    },
    secondaryActions: {
      alignItems: 'center',
      borderTopColor: theme.line,
      borderTopWidth: StyleSheet.hairlineWidth,
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 4,
      paddingHorizontal: 4,
      paddingVertical: 2
    },
    accountFeatures: {
      borderTopColor: theme.line,
      borderTopWidth: StyleSheet.hairlineWidth,
      gap: 2,
      paddingHorizontal: 0,
      paddingVertical: 2
    },
    actionTextQuiet: {
      color: actionColor
    }
  });
}

function messageFromError(error: unknown) {
  return error instanceof Error ? error.message : '操作失败，请重试。';
}

function CredentialEditor({
  active,
  site,
  view,
  accountStyles,
  styles,
  theme,
  onCommand
}: {
  active: boolean;
  site: CredentialSite;
  view: SiteAccountView;
  accountStyles: AccountCenterStyles;
  styles: MoreScreenStyles;
  theme: ReaderTheme;
  onCommand: CommandHandler;
}) {
  const { height } = useWindowDimensions();
  const { styles: settingStyles } = useReaderThemeStyles(createMoreSiteSettingStyles);
  const [editing, setEditing] = useState(false);
  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [keyboardAvoidingEnabled, setKeyboardAvoidingEnabled] = useState(false);
  const savingRef = useRef(false);
  const openEditor = () => {
    recordUserInteraction();
    setEditing(true);
  };

  const clearDraft = () => {
    setAccount('');
    setPassword('');
  };

  useEffect(() => {
    if (!active) {
      setKeyboardAvoidingEnabled(false);
      clearDraft();
      setEditing(false);
    }
  }, [active]);

  useEffect(() => {
    if (!editing) {
      return;
    }
    const showSubscription = Keyboard.addListener('keyboardDidShow', () => setKeyboardAvoidingEnabled(true));
    const hideSubscription = Keyboard.addListener('keyboardDidHide', () => setKeyboardAvoidingEnabled(false));
    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, [editing]);

  const closeEditor = () => {
    if (busy || savingRef.current) {
      return;
    }
    setKeyboardAvoidingEnabled(false);
    Keyboard.dismiss();
    clearDraft();
    setEditing(false);
  };

  const persist = async (allowUnprotected = false) => {
    if (savingRef.current) {
      return;
    }
    savingRef.current = true;
    setKeyboardAvoidingEnabled(false);
    Keyboard.dismiss();
    setBusy(true);
    try {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      await onCommand({
        type: 'save-credential',
        site,
        account,
        password,
        ...(allowUnprotected ? { allowUnprotected: true } : {})
      });
      clearDraft();
      setEditing(false);
    } catch (error) {
      if (error instanceof CredentialVaultError && error.code === 'biometric-unavailable' && !allowUnprotected) {
        Alert.alert('无法使用用户身份认证', '继续后将使用 Android 本机加密保存，但填入时不会再次进行用户身份认证。', [
          { text: '取消', style: 'cancel' },
          {
            text: '继续保存',
            onPress: () => {
              void persist(true);
            }
          }
        ]);
      } else {
        Alert.alert('无法保存登录信息', messageFromError(error));
      }
    } finally {
      savingRef.current = false;
      setBusy(false);
    }
  };

  const confirmDelete = () => {
    Alert.alert('删除已保存登录信息？', '只删除保存的账号密码，不会退出当前网站登录。', [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          setBusy(true);
          void Promise.resolve(onCommand({ type: 'delete-credential', site }))
            .then(() => {
              clearDraft();
              setEditing(false);
            })
            .catch((error) => Alert.alert('无法删除登录信息', messageFromError(error)))
            .finally(() => setBusy(false));
        }
      }
    ]);
  };

  return (
    <View style={accountStyles.section}>
      <List.Item
        title="自动填入"
        accessible={false}
        onPress={openEditor}
        description={
          view.credential.state === 'invalidated'
            ? '需要重新设置'
            : view.credential.hasCredential
              ? `已设置 · ${view.credential.protection === 'biometric' ? '用户身份认证' : 'Android 本机加密'}`
              : '未设置，登录失效时可快速填入'
        }
        style={settingStyles.row}
        containerStyle={settingStyles.rowContainer}
        contentStyle={settingStyles.rowContent}
        titleStyle={settingStyles.title}
        descriptionStyle={settingStyles.description}
        descriptionNumberOfLines={2}
        right={
          !editing
            ? () => (
                <Button
                  compact
                  icon={({ color, size }) => <ChevronRight color={color} size={size} />}
                  style={settingStyles.button}
                  contentStyle={settingStyles.buttonContent}
                  labelStyle={settingStyles.buttonLabel}
                  onPress={openEditor}
                >
                  {view.credential.state === 'invalidated'
                    ? '重新设置'
                    : view.credential.hasCredential
                      ? '管理'
                      : '设置'}
                </Button>
              )
            : undefined
        }
      />
      <ModalSheetFrame
        backdropLabel={`关闭${view.label}自动填入设置`}
        keyboardAvoidingEnabled={keyboardAvoidingEnabled}
        visible={editing}
        onRequestClose={closeEditor}
      >
        <ModalSheetHeader
          title={
            view.credential.state === 'missing'
              ? '设置自动填入'
              : view.credential.state === 'invalidated'
                ? '重新设置自动填入'
                : '管理自动填入'
          }
          subtitle={view.label}
          closeLabel="关闭自动填入编辑"
          closeDisabled={busy}
          onClose={closeEditor}
        />
        <ScrollView
          overScrollMode="never"
          style={[styles.searchFilterBody, { maxHeight: Math.max(320, Math.round(height * 0.58)) }]}
          contentContainerStyle={styles.searchFilterBodyInner}
          keyboardShouldPersistTaps="always"
        >
          <View style={styles.stack}>
            <TextInput
              variant="outlined"
              label="账号 / 邮箱"
              accessibilityLabel={`${view.label} 登录账号`}
              aria-label={`${view.label} 登录账号`}
              autoCapitalize="none"
              autoComplete="off"
              autoCorrect={false}
              placeholder="账号 / 邮箱"
              placeholderTextColor={theme.muted}
              style={settingStyles.input}
              value={account}
              onFocus={() => setKeyboardAvoidingEnabled(true)}
              onChange={recordUserInteraction}
              onChangeText={setAccount}
            />
          </View>
          <View style={styles.stack}>
            <TextInput
              variant="outlined"
              label="密码"
              accessibilityLabel={`${view.label} 登录密码`}
              aria-label={`${view.label} 登录密码`}
              autoCapitalize="none"
              autoComplete="off"
              autoCorrect={false}
              placeholder="密码"
              placeholderTextColor={theme.muted}
              secureTextEntry
              style={settingStyles.input}
              value={password}
              onFocus={() => setKeyboardAvoidingEnabled(true)}
              onChange={recordUserInteraction}
              onChangeText={setPassword}
            />
          </View>
        </ScrollView>
        <View style={styles.searchFilterActions}>
          {view.credential.state !== 'missing' ? (
            <Button
              compact
              accessibilityLabel="删除"
              textColor={theme.danger}
              style={settingStyles.button}
              contentStyle={settingStyles.buttonContent}
              labelStyle={settingStyles.buttonLabel}
              disabled={busy}
              onPress={() => {
                recordUserInteraction();
                confirmDelete();
              }}
            >
              删除
            </Button>
          ) : null}
          <View style={styles.flex} />
          <Button
            compact
            accessibilityLabel="取消"
            style={settingStyles.button}
            contentStyle={settingStyles.buttonContent}
            labelStyle={settingStyles.buttonLabel}
            disabled={busy}
            onPress={() => {
              recordUserInteraction();
              closeEditor();
            }}
          >
            取消
          </Button>
          <Button
            compact
            mode="contained"
            accessibilityLabel={busy ? '保存中' : '保存'}
            style={settingStyles.button}
            contentStyle={settingStyles.buttonContent}
            labelStyle={settingStyles.buttonLabel}
            disabled={busy || !account.trim() || !password}
            onPress={() => {
              recordUserInteraction();
              void persist();
            }}
          >
            {busy ? '保存中' : '保存'}
          </Button>
        </View>
      </ModalSheetFrame>
    </View>
  );
}

function primaryCommand(view: SiteAccountView): AccountCenterCommand | null {
  if (view.primaryAction === 'open-user' && view.user) {
    return { type: 'open-user', user: view.user };
  }
  if (view.primaryAction === 'open-login') {
    return { type: 'open-login', site: view.site };
  }
  if (view.primaryAction === 'open-login-with-fill') {
    return { type: 'open-login-with-fill', site: view.site };
  }
  return null;
}

export function AccountCenterPanel({
  credentials,
  enabledSessionSources,
  active,
  forcedSite,
  headerHostName,
  pendingFillSite,
  selectedSite,
  profile,
  renderOverview,
  nodeSeekUserId,
  sessions,
  siteContent,
  siteSettings,
  statusBusy,
  styles,
  theme,
  onCommand,
  onSelectedSiteChange
}: {
  credentials: CredentialSummaries;
  enabledSessionSources: readonly SessionSite[];
  active: boolean;
  forcedSite?: SessionSite | null;
  headerHostName?: string;
  pendingFillSite?: SessionSite | null;
  selectedSite?: SessionSite;
  profile?: UserDetails;
  renderOverview?: (settingsAction: ReactNode) => ReactNode;
  nodeSeekUserId: number | null;
  sessions: SiteSessionViewModels;
  siteContent: Partial<Record<SessionSite, ReactNode>>;
  siteSettings?: Partial<Record<SessionSite, (active: boolean) => ReactNode>>;
  statusBusy: boolean;
  styles: MoreScreenStyles;
  theme: ReaderTheme;
  onCommand: CommandHandler;
  onSelectedSiteChange?: (site: SessionSite) => void;
}) {
  const [expandedSite, setExpandedSite] = useState<SessionSite>('nodeseek');
  const [settingsState, setSettingsState] = useState<{
    owner: string;
    phase: 'expanded' | 'collapsed';
  } | null>(null);
  const availableViews = useMemo(
    () => createSiteAccountViews(sessions, credentials, nodeSeekUserId),
    [credentials, nodeSeekUserId, sessions]
  );
  const views = useMemo(() => {
    const viewsBySite = new Map(availableViews.map((view) => [view.site, view]));
    return enabledSessionSources
      .map((site) => viewsBySite.get(site))
      .filter((view): view is SiteAccountView => Boolean(view));
  }, [availableViews, enabledSessionSources]);
  const { styles: accountStyles } = useReaderThemeStyles(createAccountCenterStyles);
  const { styles: settingStyles } = useReaderThemeStyles(createMoreSiteSettingStyles);
  const selectedView = views.find((view) => view.site === (selectedSite ?? expandedSite)) ?? views[0];
  const settingsOwner = selectedView ? `${selectedView.site}:${selectedView.user?.id ?? 'anonymous'}` : '';
  const settingsVisited = settingsState?.owner === settingsOwner;
  const settingsExpanded = settingsVisited && settingsState.phase === 'expanded';
  if (settingsState !== null && settingsState.owner !== settingsOwner) setSettingsState(null);
  const headerContent = (
    <View style={[accountStyles.header, styles.morePageInset]}>
      <Text style={accountStyles.title}>我的</Text>
      {views.length ? <Text style={styles.meta}>{accountCenterSummary(views)}</Text> : null}
      {views.length ? (
        <IconButton
          ghost
          iconOnly
          iconSize={18}
          icon={RefreshCw}
          label={statusBusy ? '刷新中' : '刷新账号'}
          loading={statusBusy}
          onPress={() => void onCommand({ type: 'refresh' })}
        />
      ) : null}
    </View>
  );

  const header = headerHostName ? <Portal hostName={headerHostName}>{headerContent}</Portal> : headerContent;

  useEffect(() => {
    if (selectedSite !== undefined) return;
    const requestedSite = forcedSite ?? pendingFillSite;
    const nextView = requestedSite ? (views.find((view) => view.site === requestedSite) ?? views[0]) : selectedView;
    if (nextView && nextView.site !== expandedSite) {
      setExpandedSite(nextView.site);
      onSelectedSiteChange?.(nextView.site);
    }
  }, [expandedSite, forcedSite, pendingFillSite, selectedSite, selectedView, views, onSelectedSiteChange]);

  if (!selectedView) {
    return (
      <View testID="my-account">
        {header}
        <View style={[accountStyles.siteDetail, styles.morePageInset]}>
          <View style={accountStyles.accountPanel}>
            <View style={accountStyles.siteOverview}>
              <View style={accountStyles.siteOverviewCopy}>
                <Text style={styles.menuLabel}>尚未启用账号站点</Text>
                <Text style={styles.meta}>请在“内容源”面板启用支持账号的站点。</Text>
              </View>
            </View>
          </View>
        </View>
      </View>
    );
  }

  const primary = primaryCommand(selectedView);
  const waitingForForm = pendingFillSite === selectedView.site;
  const loggedIn = selectedView.isLoggedIn;
  const levelLabel = profile?.levelLabel || selectedView.user?.levelLabel;
  const renderSettings = siteSettings?.[selectedView.site];
  const primaryLabel = waitingForForm
    ? '等待登录表单'
    : selectedView.primaryAction === 'open-user'
      ? '查看主页'
      : selectedView.primaryLabel;
  const settingsAction = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="站点设置"
      accessibilityHint={`${settingsExpanded ? '收起' : '展开'}${selectedView.label}的登录信息与设置`}
      accessibilityState={{ expanded: settingsExpanded }}
      style={accountStyles.settingsButton}
      onPress={() =>
        setSettingsState((current) => ({
          owner: settingsOwner,
          phase: current?.owner === settingsOwner && current.phase === 'expanded' ? 'collapsed' : 'expanded'
        }))
      }
    >
      <Settings2 size={16} color={theme.muted} strokeWidth={1.8} />
      <Text style={styles.meta}>站点设置</Text>
      <DisclosureChevron expanded={settingsExpanded} color={theme.muted} size={14} />
    </Pressable>
  );

  return (
    <View testID="my-account">
      {header}
      <View style={accountStyles.selectorRow}>
        <View style={accountStyles.siteTabs}>
          {views.map((view) => {
            const selected = selectedView.site === view.site;
            return (
              <Pressable
                key={view.site}
                testID={`account-site-${view.site}`}
                accessibilityRole="tab"
                accessibilityLabel={`${view.label}，${view.statusLabel}${selected ? '，已选择' : ''}`}
                accessibilityState={{ selected }}
                style={accountStyles.siteTab}
                onPress={() => {
                  if (selected) return;
                  if (selectedSite === undefined) setExpandedSite(view.site);
                  onSelectedSiteChange?.(view.site);
                  setSettingsState(null);
                }}
              >
                <Text
                  numberOfLines={1}
                  style={[accountStyles.siteTabText, selected && accountStyles.siteTabTextSelected]}
                >
                  {view.label}
                </Text>
                {selected ? <View style={accountStyles.siteTabIndicator} /> : null}
              </Pressable>
            );
          })}
        </View>
      </View>
      <Pressable
        accessibilityRole={primary ? 'button' : undefined}
        accessibilityLabel={primary ? primaryLabel : undefined}
        accessibilityHint={primary ? `${selectedView.identityLabel}，${selectedView.statusLabel}` : undefined}
        accessibilityState={{ disabled: !primary || selectedView.primaryDisabled || waitingForForm }}
        disabled={!primary || selectedView.primaryDisabled || waitingForForm}
        style={[accountStyles.siteOverview, styles.morePageInset]}
        onPress={() => {
          if (primary) void onCommand(primary);
        }}
      >
        <Avatar
          key={settingsOwner}
          large
          contentSource={selectedView.site}
          name={profile?.displayName || selectedView.identityLabel}
          uri={profile?.avatar || selectedView.user?.avatar}
        />
        <View style={accountStyles.siteOverviewCopy}>
          <View style={accountStyles.identityName}>
            <Text numberOfLines={2} style={[styles.menuLabel, accountStyles.siteTitle]}>
              {selectedView.user ? profile?.displayName || selectedView.identityLabel : selectedView.label}
            </Text>
            {primary ? <ChevronRight size={15} color={theme.muted} strokeWidth={1.8} /> : null}
          </View>
          <Text style={[styles.meta, accountStyles.identityMeta]}>
            {selectedView.statusLabel}
            {levelLabel ? ` · ${levelLabel}` : ''}
          </Text>
          {primary && selectedView.primaryAction !== 'open-user' ? (
            <Text style={[styles.buttonText, accountStyles.actionTextQuiet]}>{primaryLabel}</Text>
          ) : null}
        </View>
      </Pressable>
      {renderOverview ? (
        <View style={accountStyles.section}>{renderOverview(settingsAction)}</View>
      ) : (
        <View style={[accountStyles.settingsRow, styles.morePageInset]}>{settingsAction}</View>
      )}
      {settingsVisited ? (
        <ExpandableContent expanded={settingsExpanded}>
          <View testID="account-site-settings" style={[accountStyles.settingsBody, styles.morePageInset]}>
            <CredentialEditor
              key={settingsOwner}
              active={active && settingsExpanded && forcedSite !== selectedView.site}
              site={selectedView.site}
              view={selectedView}
              accountStyles={accountStyles}
              styles={styles}
              theme={theme}
              onCommand={onCommand}
            />
            {loggedIn ? (
              <View style={accountStyles.secondaryActions}>
                <Button
                  compact
                  accessibilityLabel="检测或重新登录"
                  icon={({ color, size }) => <ChevronRight color={color} size={size} />}
                  style={settingStyles.button}
                  contentStyle={settingStyles.buttonContent}
                  labelStyle={settingStyles.buttonLabel}
                  onPress={() => {
                    recordUserInteraction();
                    setSettingsState(null);
                    void onCommand({ type: 'open-login', site: selectedView.site });
                  }}
                >
                  检测或重新登录
                </Button>
                {selectedView.credential.hasCredential ? (
                  <Button
                    compact
                    accessibilityLabel="自动填入"
                    style={settingStyles.button}
                    contentStyle={settingStyles.buttonContent}
                    labelStyle={settingStyles.buttonLabel}
                    disabled={waitingForForm}
                    onPress={() => {
                      recordUserInteraction();
                      setSettingsState(null);
                      void onCommand({ type: 'open-login-with-fill', site: selectedView.site });
                    }}
                  >
                    自动填入
                  </Button>
                ) : null}
              </View>
            ) : null}
            {renderSettings ? (
              <View style={accountStyles.accountFeatures}>{renderSettings(active && settingsExpanded)}</View>
            ) : null}
          </View>
        </ExpandableContent>
      ) : null}
      <View style={[accountStyles.siteDetail, styles.morePageInset]}>
        <View style={accountStyles.accountPanel}>
          {siteContent[selectedView.site] ? (
            <View style={accountStyles.accountFeatures}>{siteContent[selectedView.site]}</View>
          ) : null}
        </View>
      </View>
    </View>
  );
}
