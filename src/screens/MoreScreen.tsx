import { memo, type RefObject, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { Activity, CheckCircle, LayoutGrid, List, LogIn, Settings, Star } from 'lucide-react-native';
import type { Category } from '../types';
import type { ReaderData, ReaderSettings } from '../readerData';
import { categoryKey } from '../readerData';
import type { HealthDetail, LoginNavigationRequest } from '../appTypes';
import { LINUXDO_URL, NODESEEK_URL, YAOHUO_URL } from '../appUrls';
import { feedSources } from '../feedCategoryRail';
import { appendUnique, removeString, settingsList, sourceLabel } from '../appUtils';
import { createStyles, type ReaderTheme } from '../theme';
import { AppButton, EmptyText, InfoRow, MenuButton, PillRail, SettingRail } from '../components/AppControls';

const YAOHUO_LOGIN_URL = YAOHUO_URL + '/waplogin.aspx?siteid=1000';
const LINUXDO_VERIFY_URL = LINUXDO_URL + '/latest';
const LINUXDO_WEBVIEW_LOADING_TIMEOUT_MS = 12000;

export const NODESEEK_LOGIN_PROBE_SCRIPT = `
(() => {
  const body = document.body ? document.body.innerText : "";
  const match = body.match(/UID\s*[:：]\s*(\d+)/i);
  window.ReactNativeWebView.postMessage(JSON.stringify({
    type: "nodeseek-login",
    loggedIn: !/登录|注册|Sign in/i.test(body) || Boolean(match),
    userId: match ? Number(match[1]) : null,
    userAgent: navigator.userAgent || "",
    cookie: document.cookie || ""
  }));
})();
true;
`;

export const LINUXDO_WEBVIEW_PROBE_SCRIPT = `
(() => {
  window.ReactNativeWebView.postMessage(JSON.stringify({
    type: "linuxdo-webview",
    userAgent: navigator.userAgent || "",
    cookie: document.cookie || ""
  }));
})();
true;
`;

function MoreScreen({
  categories,
  checking,
  hasNodeSeekLoginCookie,
  hasYaohuoCookie,
  hasLinuxDoClearance,
  healthDetails,
  healthSummary,
  loginState,
  loadingLoginPage,
  loadingYaohuoLoginPage,
  loadingLinuxDoPage,
  linuxDoWebViewError,
  linuxDoWebViewKey,
  linuxDoWebViewUserAgent,
  nodeSeekWebViewUserAgent,
  favoriteCount,
  historyCount,
  settings,
  subscriptions,
  backupJson,
  showCategoriesPanel,
  showLoginPanel,
  showYaohuoLoginPanel,
  showLinuxDoPanel,
  showSettingsPanel,
  statusBusy,
  styles,
  syncing,
  theme,
  webViewRef,
  yaohuoLoginState,
  yaohuoWebViewRef,
  linuxDoCookieNames,
  linuxDoWebViewRef,
  onCheckHealth,
  onCheckIn,
  onCheckLogin,
  onRememberNodeSeekCookies,
  onCheckYaohuoLogin,
  onCheckLinuxDoCookie,
  onClearLogin,
  onClearYaohuoLogin,
  onClearLinuxDoCookie,
  handleNodeSeekLoginNavigation,
  handleYaohuoLoginNavigation,
  handleLinuxDoNavigation,
  onHandleLoginMessage,
  onHandleLinuxDoMessage,
  onImportBackup,
  onExportBackup,
  onExportBackupFile,
  onImportBackupFile,
  onExportFavoritesMarkdownFile,
  onRefreshCategories,
  onSelectCategory,
  onBackupJsonChange,
  onSetLoadingLoginPage,
  onSetLoadingYaohuoLoginPage,
  onSetLoadingLinuxDoPage,
  onSetLinuxDoWebViewError,
  onResetLinuxDoWebView,
  onShowCategoriesPanelChange,
  onShowLoginPanelChange,
  onShowYaohuoLoginPanelChange,
  onShowLinuxDoPanelChange,
  onShowSettingsPanelChange,
  onToggleSubscription,
  onUpdateSettings
}: {
  categories: Category[];
  checking: boolean;
  hasNodeSeekLoginCookie: boolean;
  hasYaohuoCookie: boolean;
  hasLinuxDoClearance: boolean;
  healthDetails: HealthDetail[];
  healthSummary: string;
  loginState: string;
  loadingLoginPage: boolean;
  loadingYaohuoLoginPage: boolean;
  loadingLinuxDoPage: boolean;
  linuxDoWebViewError: string;
  linuxDoWebViewKey: number;
  linuxDoWebViewUserAgent: string;
  nodeSeekWebViewUserAgent: string;
  favoriteCount: number;
  historyCount: number;
  settings: ReaderSettings;
  subscriptions: ReaderData['subscriptions'];
  backupJson: string;
  showCategoriesPanel: boolean;
  showLoginPanel: boolean;
  showYaohuoLoginPanel: boolean;
  showLinuxDoPanel: boolean;
  showSettingsPanel: boolean;
  statusBusy: boolean;
  styles: ReturnType<typeof createStyles>;
  syncing: boolean;
  theme: ReaderTheme;
  webViewRef: RefObject<WebView | null>;
  yaohuoLoginState: string;
  yaohuoWebViewRef: RefObject<WebView | null>;
  linuxDoCookieNames: string[];
  linuxDoWebViewRef: RefObject<WebView | null>;
  onCheckHealth: () => void;
  onCheckIn: () => void;
  onCheckLogin: () => void;
  onRememberNodeSeekCookies: (options?: { silent?: boolean }) => Promise<boolean>;
  onCheckYaohuoLogin: () => void;
  onCheckLinuxDoCookie: () => void;
  onClearLogin: () => void;
  onClearYaohuoLogin: () => void;
  onClearLinuxDoCookie: () => void;
  handleNodeSeekLoginNavigation: (request: LoginNavigationRequest) => boolean;
  handleYaohuoLoginNavigation: (request: LoginNavigationRequest) => boolean;
  handleLinuxDoNavigation: (request: LoginNavigationRequest) => boolean;
  onHandleLoginMessage: (event: WebViewMessageEvent) => void;
  onHandleLinuxDoMessage: (event: WebViewMessageEvent) => void;
  onImportBackup: () => void;
  onExportBackup: () => void;
  onExportBackupFile: () => void;
  onImportBackupFile: () => void;
  onExportFavoritesMarkdownFile: () => void;
  onRefreshCategories: () => void;
  onSelectCategory: (category: Category) => void;
  onBackupJsonChange: (value: string) => void;
  onSetLoadingLoginPage: (value: boolean) => void;
  onSetLoadingYaohuoLoginPage: (value: boolean) => void;
  onSetLoadingLinuxDoPage: (value: boolean) => void;
  onSetLinuxDoWebViewError: (value: string) => void;
  onResetLinuxDoWebView: () => void;
  onShowCategoriesPanelChange: (value: boolean) => void;
  onShowLoginPanelChange: (value: boolean) => void;
  onShowYaohuoLoginPanelChange: (value: boolean) => void;
  onShowLinuxDoPanelChange: (value: boolean) => void;
  onShowSettingsPanelChange: (value: boolean) => void;
  onToggleSubscription: (category: Category) => void;
  onUpdateSettings: (patch: Partial<ReaderSettings>) => void;
}) {
  return (
    <View style={styles.stack}>
      <Text style={styles.sectionTitle}>更多</Text>
      <View style={styles.group}>
        <InfoRow icon={Star} label="收藏" value={String(favoriteCount)} styles={styles} theme={theme} />
        <InfoRow icon={List} label="历史" value={String(historyCount)} styles={styles} theme={theme} />
        <InfoRow icon={Activity} label="关于" value="Android 本机阅读器" styles={styles} theme={theme} />
      </View>
      <MemoizedBackupRestorePanel
        backupJson={backupJson}
        syncing={syncing}
        styles={styles}
        theme={theme}
        onBackupJsonChange={onBackupJsonChange}
        onExportBackup={onExportBackup}
        onImportBackup={onImportBackup}
        onExportBackupFile={onExportBackupFile}
        onImportBackupFile={onImportBackupFile}
        onExportFavoritesMarkdownFile={onExportFavoritesMarkdownFile}
      />
      <View style={styles.group}>
        <MemoizedNodeSeekLoginPanel
          checking={checking}
          hasNodeSeekLoginCookie={hasNodeSeekLoginCookie}
          loginState={loginState}
          loadingLoginPage={loadingLoginPage}
          nodeSeekWebViewUserAgent={nodeSeekWebViewUserAgent}
          showLoginPanel={showLoginPanel}
          styles={styles}
          theme={theme}
          webViewRef={webViewRef}
          onCheckIn={onCheckIn}
          onCheckLogin={onCheckLogin}
          onClearLogin={onClearLogin}
          onHandleLoginMessage={onHandleLoginMessage}
          handleNodeSeekLoginNavigation={handleNodeSeekLoginNavigation}
          onRememberNodeSeekCookies={onRememberNodeSeekCookies}
          onSetLoadingLoginPage={onSetLoadingLoginPage}
          onShowLoginPanelChange={onShowLoginPanelChange}
        />
        <MemoizedYaohuoLoginPanel
          checking={checking}
          hasYaohuoCookie={hasYaohuoCookie}
          loadingYaohuoLoginPage={loadingYaohuoLoginPage}
          showYaohuoLoginPanel={showYaohuoLoginPanel}
          styles={styles}
          theme={theme}
          yaohuoLoginState={yaohuoLoginState}
          yaohuoWebViewRef={yaohuoWebViewRef}
          onCheckYaohuoLogin={onCheckYaohuoLogin}
          onClearYaohuoLogin={onClearYaohuoLogin}
          handleYaohuoLoginNavigation={handleYaohuoLoginNavigation}
          onSetLoadingYaohuoLoginPage={onSetLoadingYaohuoLoginPage}
          onShowYaohuoLoginPanelChange={onShowYaohuoLoginPanelChange}
        />
        <MemoizedLinuxDoVerifyPanel
          checking={checking}
          hasLinuxDoClearance={hasLinuxDoClearance}
          linuxDoCookieNames={linuxDoCookieNames}
          linuxDoWebViewError={linuxDoWebViewError}
          linuxDoWebViewKey={linuxDoWebViewKey}
          linuxDoWebViewRef={linuxDoWebViewRef}
          linuxDoWebViewUserAgent={linuxDoWebViewUserAgent}
          loadingLinuxDoPage={loadingLinuxDoPage}
          showLinuxDoPanel={showLinuxDoPanel}
          styles={styles}
          theme={theme}
          onCheckLinuxDoCookie={onCheckLinuxDoCookie}
          onClearLinuxDoCookie={onClearLinuxDoCookie}
          handleLinuxDoNavigation={handleLinuxDoNavigation}
          onHandleLinuxDoMessage={onHandleLinuxDoMessage}
          onResetLinuxDoWebView={onResetLinuxDoWebView}
          onSetLinuxDoWebViewError={onSetLinuxDoWebViewError}
          onSetLoadingLinuxDoPage={onSetLoadingLinuxDoPage}
          onShowLinuxDoPanelChange={onShowLinuxDoPanelChange}
        />
      </View>
      <MemoizedCategorySubscriptionPanel
        categories={categories}
        showCategoriesPanel={showCategoriesPanel}
        styles={styles}
        subscriptions={subscriptions}
        theme={theme}
        onRefreshCategories={onRefreshCategories}
        onSelectCategory={onSelectCategory}
        onShowCategoriesPanelChange={onShowCategoriesPanelChange}
        onToggleSubscription={onToggleSubscription}
      />
      <MemoizedAppearancePanel
        settings={settings}
        showSettingsPanel={showSettingsPanel}
        styles={styles}
        theme={theme}
        onShowSettingsPanelChange={onShowSettingsPanelChange}
        onUpdateSettings={onUpdateSettings}
      />
      <MemoizedStatusCheckPanel
        healthDetails={healthDetails}
        healthSummary={healthSummary}
        statusBusy={statusBusy}
        styles={styles}
        theme={theme}
        onCheckHealth={onCheckHealth}
      />
    </View>
  );
}

function BackupRestorePanel({
  backupJson,
  syncing,
  styles,
  theme,
  onBackupJsonChange,
  onExportBackup,
  onImportBackup,
  onExportBackupFile,
  onImportBackupFile,
  onExportFavoritesMarkdownFile
}: {
  backupJson: string;
  syncing: boolean;
  styles: ReturnType<typeof createStyles>;
  theme: ReaderTheme;
  onBackupJsonChange: (value: string) => void;
  onExportBackup: () => void;
  onImportBackup: () => void;
  onExportBackupFile: () => void;
  onImportBackupFile: () => void;
  onExportFavoritesMarkdownFile: () => void;
}) {
  return (
    <View style={styles.group}>
      <Text style={styles.panelTitle}>备份 / 恢复</Text>
      <TextInput
        style={styles.input}
        value={backupJson}
        onChangeText={onBackupJsonChange}
        placeholder="粘贴或生成阅读资料 JSON"
        placeholderTextColor={theme.muted}
        autoCapitalize="none"
        autoCorrect={false}
        multiline
      />
      <View style={styles.actions}>
        <AppButton label={syncing ? '处理中' : '生成备份'} styles={styles} disabled={syncing} onPress={onExportBackup} />
        <AppButton label={syncing ? '处理中' : '恢复备份'} variant="ghost" styles={styles} disabled={syncing} onPress={onImportBackup} />
        <AppButton label="分享 JSON" variant="ghost" styles={styles} disabled={syncing} onPress={onExportBackupFile} />
        <AppButton label="选择 JSON" variant="ghost" styles={styles} disabled={syncing} onPress={onImportBackupFile} />
        <AppButton label="导出收藏 Markdown" variant="ghost" styles={styles} disabled={syncing} onPress={onExportFavoritesMarkdownFile} />
      </View>
    </View>
  );
}

const MemoizedBackupRestorePanel = memo(BackupRestorePanel);

function NodeSeekLoginPanel({
  checking,
  hasNodeSeekLoginCookie,
  loginState,
  loadingLoginPage,
  nodeSeekWebViewUserAgent,
  showLoginPanel,
  styles,
  theme,
  webViewRef,
  onCheckIn,
  onCheckLogin,
  onClearLogin,
  onHandleLoginMessage,
  handleNodeSeekLoginNavigation,
  onRememberNodeSeekCookies,
  onSetLoadingLoginPage,
  onShowLoginPanelChange
}: {
  checking: boolean;
  hasNodeSeekLoginCookie: boolean;
  loginState: string;
  loadingLoginPage: boolean;
  nodeSeekWebViewUserAgent: string;
  showLoginPanel: boolean;
  styles: ReturnType<typeof createStyles>;
  theme: ReaderTheme;
  webViewRef: RefObject<WebView | null>;
  onCheckIn: () => void;
  onCheckLogin: () => void;
  onClearLogin: () => void;
  onHandleLoginMessage: (event: WebViewMessageEvent) => void;
  handleNodeSeekLoginNavigation: (request: LoginNavigationRequest) => boolean;
  onRememberNodeSeekCookies: (options?: { silent?: boolean }) => Promise<boolean>;
  onSetLoadingLoginPage: (value: boolean) => void;
  onShowLoginPanelChange: (value: boolean) => void;
}) {
  return (
    <>
      <MenuButton icon={LogIn} label="NodeSeek 登录 / 验证" value={loginState} styles={styles} theme={theme} onPress={() => onShowLoginPanelChange(!showLoginPanel)} />
      {hasNodeSeekLoginCookie ? <MenuButton icon={CheckCircle} label="NodeSeek 签到" value="使用本机登录 Cookie" styles={styles} theme={theme} onPress={onCheckIn} /> : null}
      {showLoginPanel ? (
        <View style={styles.loginPanel}>
          <View style={styles.actions}>
            <AppButton label={checking ? '检测中' : '检测登录'} styles={styles} disabled={checking} onPress={onCheckLogin} />
            <AppButton label="清除登录" variant="ghost" styles={styles} onPress={onClearLogin} />
            <AppButton label="刷新页面" variant="ghost" styles={styles} onPress={() => webViewRef.current?.reload()} />
          </View>
          <View style={styles.webViewShell}>
            {loadingLoginPage ? (
              <View style={styles.loading}>
                <ActivityIndicator color={theme.primary} />
                <Text style={styles.loadingText}>正在打开 NodeSeek...</Text>
              </View>
            ) : null}
            <WebView
              ref={webViewRef}
              source={{ uri: NODESEEK_URL }}
              sharedCookiesEnabled
              thirdPartyCookiesEnabled
              userAgent={nodeSeekWebViewUserAgent}
              injectedJavaScript={NODESEEK_LOGIN_PROBE_SCRIPT}
              onLoadEnd={() => {
                onSetLoadingLoginPage(false);
                webViewRef.current?.injectJavaScript(NODESEEK_LOGIN_PROBE_SCRIPT);
                void onRememberNodeSeekCookies({ silent: true });
              }}
              onLoadStart={() => onSetLoadingLoginPage(true)}
              onMessage={onHandleLoginMessage}
              onShouldStartLoadWithRequest={handleNodeSeekLoginNavigation}
            />
          </View>
        </View>
      ) : null}
    </>
  );
}

const MemoizedNodeSeekLoginPanel = memo(NodeSeekLoginPanel);

function YaohuoLoginPanel({
  checking,
  hasYaohuoCookie,
  loadingYaohuoLoginPage,
  showYaohuoLoginPanel,
  styles,
  theme,
  yaohuoLoginState,
  yaohuoWebViewRef,
  onCheckYaohuoLogin,
  onClearYaohuoLogin,
  handleYaohuoLoginNavigation,
  onSetLoadingYaohuoLoginPage,
  onShowYaohuoLoginPanelChange
}: {
  checking: boolean;
  hasYaohuoCookie: boolean;
  loadingYaohuoLoginPage: boolean;
  showYaohuoLoginPanel: boolean;
  styles: ReturnType<typeof createStyles>;
  theme: ReaderTheme;
  yaohuoLoginState: string;
  yaohuoWebViewRef: RefObject<WebView | null>;
  onCheckYaohuoLogin: () => void;
  onClearYaohuoLogin: () => void;
  handleYaohuoLoginNavigation: (request: LoginNavigationRequest) => boolean;
  onSetLoadingYaohuoLoginPage: (value: boolean) => void;
  onShowYaohuoLoginPanelChange: (value: boolean) => void;
}) {
  return (
    <>
      <MenuButton icon={LogIn} label="妖火登录" value={hasYaohuoCookie ? yaohuoLoginState : '未登录'} styles={styles} theme={theme} onPress={() => onShowYaohuoLoginPanelChange(!showYaohuoLoginPanel)} />
      {showYaohuoLoginPanel ? (
        <View style={styles.loginPanel}>
          <View style={styles.actions}>
            <AppButton label={checking ? '检测中' : '检测登录'} styles={styles} disabled={checking} onPress={onCheckYaohuoLogin} />
            <AppButton label="清除登录" variant="ghost" styles={styles} onPress={onClearYaohuoLogin} />
            <AppButton label="刷新页面" variant="ghost" styles={styles} onPress={() => yaohuoWebViewRef.current?.reload()} />
          </View>
          <View style={styles.webViewShell}>
            {loadingYaohuoLoginPage ? (
              <View style={styles.loading}>
                <ActivityIndicator color={theme.primary} />
                <Text style={styles.loadingText}>正在打开妖火...</Text>
              </View>
            ) : null}
            <WebView
              ref={yaohuoWebViewRef}
              source={{ uri: YAOHUO_LOGIN_URL }}
              sharedCookiesEnabled
              thirdPartyCookiesEnabled
              onLoadEnd={() => onSetLoadingYaohuoLoginPage(false)}
              onLoadStart={() => onSetLoadingYaohuoLoginPage(true)}
              onShouldStartLoadWithRequest={handleYaohuoLoginNavigation}
            />
          </View>
        </View>
      ) : null}
    </>
  );
}

const MemoizedYaohuoLoginPanel = memo(YaohuoLoginPanel);

function LinuxDoVerifyPanel({
  checking,
  hasLinuxDoClearance,
  linuxDoCookieNames,
  linuxDoWebViewError,
  linuxDoWebViewKey,
  linuxDoWebViewRef,
  linuxDoWebViewUserAgent,
  loadingLinuxDoPage,
  showLinuxDoPanel,
  styles,
  theme,
  onCheckLinuxDoCookie,
  onClearLinuxDoCookie,
  handleLinuxDoNavigation,
  onHandleLinuxDoMessage,
  onResetLinuxDoWebView,
  onSetLinuxDoWebViewError,
  onSetLoadingLinuxDoPage,
  onShowLinuxDoPanelChange
}: {
  checking: boolean;
  hasLinuxDoClearance: boolean;
  linuxDoCookieNames: string[];
  linuxDoWebViewError: string;
  linuxDoWebViewKey: number;
  linuxDoWebViewRef: RefObject<WebView | null>;
  linuxDoWebViewUserAgent: string;
  loadingLinuxDoPage: boolean;
  showLinuxDoPanel: boolean;
  styles: ReturnType<typeof createStyles>;
  theme: ReaderTheme;
  onCheckLinuxDoCookie: () => void;
  onClearLinuxDoCookie: () => void;
  handleLinuxDoNavigation: (request: LoginNavigationRequest) => boolean;
  onHandleLinuxDoMessage: (event: WebViewMessageEvent) => void;
  onResetLinuxDoWebView: () => void;
  onSetLinuxDoWebViewError: (value: string) => void;
  onSetLoadingLinuxDoPage: (value: boolean) => void;
  onShowLinuxDoPanelChange: (value: boolean) => void;
}) {
  useEffect(() => {
    if (!showLinuxDoPanel || !loadingLinuxDoPage) {
      return undefined;
    }
    const timeout = setTimeout(() => {
      onSetLoadingLinuxDoPage(false);
      onSetLinuxDoWebViewError('linux.do 页面打开超时：请检查模拟器网络后刷新页面。');
    }, LINUXDO_WEBVIEW_LOADING_TIMEOUT_MS);
    return () => clearTimeout(timeout);
  }, [loadingLinuxDoPage, onSetLinuxDoWebViewError, onSetLoadingLinuxDoPage, showLinuxDoPanel]);
  return (
    <>
      <MenuButton icon={LogIn} label="linux.do 验证" value={hasLinuxDoClearance ? `已保存 ${linuxDoCookieNames.join('、') || 'cf_clearance'}` : '未验证'} styles={styles} theme={theme} onPress={() => onShowLinuxDoPanelChange(!showLinuxDoPanel)} />
      {showLinuxDoPanel ? (
        <View style={styles.loginPanel}>
          <View style={styles.actions}>
            <AppButton label={checking ? '检测中' : '检测验证'} styles={styles} disabled={checking} onPress={onCheckLinuxDoCookie} />
            <AppButton label="清除验证" variant="ghost" styles={styles} onPress={onClearLinuxDoCookie} />
            <AppButton label="刷新页面" variant="ghost" styles={styles} onPress={onResetLinuxDoWebView} />
          </View>
          {linuxDoWebViewError ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{linuxDoWebViewError}</Text>
            </View>
          ) : null}
          <View style={styles.webViewShell}>
            {loadingLinuxDoPage ? (
              <View style={styles.loading}>
                <ActivityIndicator color={theme.primary} />
                <Text style={styles.loadingText}>正在打开 linux.do...</Text>
              </View>
            ) : null}
            <WebView
              key={linuxDoWebViewKey}
              ref={linuxDoWebViewRef}
              source={{ uri: LINUXDO_VERIFY_URL }}
              javaScriptEnabled
              domStorageEnabled
              cacheEnabled
              sharedCookiesEnabled
              thirdPartyCookiesEnabled
              userAgent={linuxDoWebViewUserAgent}
              injectedJavaScript={LINUXDO_WEBVIEW_PROBE_SCRIPT}
              onLoadEnd={(event) => {
                onSetLoadingLinuxDoPage(false);
                if (!('code' in event.nativeEvent)) {
                  onSetLinuxDoWebViewError('');
                }
                linuxDoWebViewRef.current?.injectJavaScript(LINUXDO_WEBVIEW_PROBE_SCRIPT);
              }}
              onLoadStart={() => {
                onSetLinuxDoWebViewError('');
                onSetLoadingLinuxDoPage(true);
              }}
              onMessage={onHandleLinuxDoMessage}
              onError={(event) => {
                onSetLoadingLinuxDoPage(false);
                onSetLinuxDoWebViewError(`linux.do 页面加载失败：${event.nativeEvent.description || '请检查模拟器网络后刷新页面。'}`);
              }}
              renderError={() => <View style={styles.webViewErrorPlaceholder} />}
              onRenderProcessGone={() => {
                onSetLoadingLinuxDoPage(false);
                onSetLinuxDoWebViewError('linux.do 验证页面已停止，请刷新页面重试。');
              }}
              onShouldStartLoadWithRequest={handleLinuxDoNavigation}
            />
          </View>
        </View>
      ) : null}
    </>
  );
}

const MemoizedLinuxDoVerifyPanel = memo(LinuxDoVerifyPanel);

function CategorySubscriptionPanel({
  categories,
  showCategoriesPanel,
  styles,
  subscriptions,
  theme,
  onRefreshCategories,
  onSelectCategory,
  onShowCategoriesPanelChange,
  onToggleSubscription
}: {
  categories: Category[];
  showCategoriesPanel: boolean;
  styles: ReturnType<typeof createStyles>;
  subscriptions: ReaderData['subscriptions'];
  theme: ReaderTheme;
  onRefreshCategories: () => void;
  onSelectCategory: (category: Category) => void;
  onShowCategoriesPanelChange: (value: boolean) => void;
  onToggleSubscription: (category: Category) => void;
}) {
  const grouped = useMemo(() => feedSources.map((source) => ({
    source,
    items: categories.filter((category) => category.source === source)
  })), [categories]);
  return (
    <View style={styles.group}>
      <MenuButton icon={LayoutGrid} label="分类节点" value="按来源浏览节点" styles={styles} theme={theme} onPress={() => onShowCategoriesPanelChange(!showCategoriesPanel)} />
      {showCategoriesPanel ? (
        <View style={styles.stack}>
          <AppButton label="刷新分类" styles={styles} onPress={onRefreshCategories} />
          {grouped.map((group) => (
            <View key={group.source} style={styles.categoryGroup}>
              <Text style={styles.panelTitle}>{sourceLabel(group.source)}</Text>
              {group.items.length ? group.items.map((category) => (
                <View key={categoryKey(category)} style={styles.categoryItem}>
                  <Pressable accessibilityRole="button" style={styles.flex} onPress={() => onSelectCategory(category)}>
                    <Text style={styles.categoryName}>{category.name}</Text>
                    {category.description ? <Text style={styles.meta}>{category.description}</Text> : null}
                    {category.topicCount ? <Text style={styles.meta}>最近 {category.topicCount} 个主题</Text> : null}
                  </Pressable>
                  <AppButton
                    label={subscriptions[categoryKey(category)] ? '已订阅' : '订阅'}
                    variant="ghost"
                    styles={styles}
                    onPress={() => onToggleSubscription(category)}
                  />
                </View>
              )) : <EmptyText text="暂无分类" styles={styles} />}
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const MemoizedCategorySubscriptionPanel = memo(CategorySubscriptionPanel);

function AppearancePanel({
  settings,
  showSettingsPanel,
  styles,
  theme,
  onShowSettingsPanelChange,
  onUpdateSettings
}: {
  settings: ReaderSettings;
  showSettingsPanel: boolean;
  styles: ReturnType<typeof createStyles>;
  theme: ReaderTheme;
  onShowSettingsPanelChange: (value: boolean) => void;
  onUpdateSettings: (patch: Partial<ReaderSettings>) => void;
}) {
  return (
    <View style={styles.group}>
      <MenuButton icon={Settings} label="外观设置" value="字号 · 主题 · 配色 · 背景" styles={styles} theme={theme} onPress={() => onShowSettingsPanelChange(!showSettingsPanel)} />
      {showSettingsPanel ? (
        <SettingsPanel settings={settings} styles={styles} theme={theme} onUpdateSettings={onUpdateSettings} />
      ) : null}
    </View>
  );
}

const MemoizedAppearancePanel = memo(AppearancePanel);

function StatusCheckPanel({
  healthDetails,
  healthSummary,
  statusBusy,
  styles,
  theme,
  onCheckHealth
}: {
  healthDetails: HealthDetail[];
  healthSummary: string;
  statusBusy: boolean;
  styles: ReturnType<typeof createStyles>;
  theme: ReaderTheme;
  onCheckHealth: () => void;
}) {
  return (
    <View style={styles.group}>
      <MenuButton icon={Activity} label="状态 / 检查" value={statusBusy ? '检查中' : healthSummary || '来源状态'} styles={styles} theme={theme} onPress={onCheckHealth} />
      {healthDetails.length ? (
        <View style={styles.stack}>
          {healthDetails.map((item) => (
            <View key={item.label} style={styles.statusDetailRow}>
              <Text style={styles.menuLabel}>{item.label}</Text>
              <Text style={[styles.meta, item.ok ? styles.statusOk : styles.statusBad]}>{item.ok ? '可用' : '不可用'} · {item.message}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const MemoizedStatusCheckPanel = memo(StatusCheckPanel);

export const MemoizedMoreScreen = memo(MoreScreen, (previous, next) => (
  previous.categories === next.categories
  && previous.checking === next.checking
  && previous.hasNodeSeekLoginCookie === next.hasNodeSeekLoginCookie
  && previous.hasYaohuoCookie === next.hasYaohuoCookie
  && previous.hasLinuxDoClearance === next.hasLinuxDoClearance
  && previous.healthDetails === next.healthDetails
  && previous.healthSummary === next.healthSummary
  && previous.loginState === next.loginState
  && previous.loadingLoginPage === next.loadingLoginPage
  && previous.loadingYaohuoLoginPage === next.loadingYaohuoLoginPage
  && previous.loadingLinuxDoPage === next.loadingLinuxDoPage
  && previous.linuxDoWebViewError === next.linuxDoWebViewError
  && previous.linuxDoWebViewKey === next.linuxDoWebViewKey
  && previous.linuxDoWebViewUserAgent === next.linuxDoWebViewUserAgent
  && previous.nodeSeekWebViewUserAgent === next.nodeSeekWebViewUserAgent
  && previous.favoriteCount === next.favoriteCount
  && previous.historyCount === next.historyCount
  && previous.settings === next.settings
  && previous.subscriptions === next.subscriptions
  && previous.backupJson === next.backupJson
  && previous.showCategoriesPanel === next.showCategoriesPanel
  && previous.showLoginPanel === next.showLoginPanel
  && previous.showYaohuoLoginPanel === next.showYaohuoLoginPanel
  && previous.showLinuxDoPanel === next.showLinuxDoPanel
  && previous.showSettingsPanel === next.showSettingsPanel
  && previous.statusBusy === next.statusBusy
  && previous.styles === next.styles
  && previous.syncing === next.syncing
  && previous.theme === next.theme
  && previous.webViewRef === next.webViewRef
  && previous.yaohuoLoginState === next.yaohuoLoginState
  && previous.yaohuoWebViewRef === next.yaohuoWebViewRef
  && previous.linuxDoCookieNames === next.linuxDoCookieNames
  && previous.linuxDoWebViewRef === next.linuxDoWebViewRef
  && previous.onCheckHealth === next.onCheckHealth
  && previous.onCheckIn === next.onCheckIn
  && previous.onCheckLogin === next.onCheckLogin
  && previous.onRememberNodeSeekCookies === next.onRememberNodeSeekCookies
  && previous.onCheckYaohuoLogin === next.onCheckYaohuoLogin
  && previous.onCheckLinuxDoCookie === next.onCheckLinuxDoCookie
  && previous.onClearLogin === next.onClearLogin
  && previous.onClearYaohuoLogin === next.onClearYaohuoLogin
  && previous.onClearLinuxDoCookie === next.onClearLinuxDoCookie
  && previous.handleNodeSeekLoginNavigation === next.handleNodeSeekLoginNavigation
  && previous.handleYaohuoLoginNavigation === next.handleYaohuoLoginNavigation
  && previous.handleLinuxDoNavigation === next.handleLinuxDoNavigation
  && previous.onHandleLoginMessage === next.onHandleLoginMessage
  && previous.onHandleLinuxDoMessage === next.onHandleLinuxDoMessage
  && previous.onImportBackup === next.onImportBackup
  && previous.onExportBackup === next.onExportBackup
  && previous.onExportBackupFile === next.onExportBackupFile
  && previous.onImportBackupFile === next.onImportBackupFile
  && previous.onExportFavoritesMarkdownFile === next.onExportFavoritesMarkdownFile
  && previous.onRefreshCategories === next.onRefreshCategories
  && previous.onSelectCategory === next.onSelectCategory
  && previous.onBackupJsonChange === next.onBackupJsonChange
  && previous.onSetLoadingLoginPage === next.onSetLoadingLoginPage
  && previous.onSetLoadingYaohuoLoginPage === next.onSetLoadingYaohuoLoginPage
  && previous.onSetLoadingLinuxDoPage === next.onSetLoadingLinuxDoPage
  && previous.onSetLinuxDoWebViewError === next.onSetLinuxDoWebViewError
  && previous.onResetLinuxDoWebView === next.onResetLinuxDoWebView
  && previous.onShowCategoriesPanelChange === next.onShowCategoriesPanelChange
  && previous.onShowLoginPanelChange === next.onShowLoginPanelChange
  && previous.onShowYaohuoLoginPanelChange === next.onShowYaohuoLoginPanelChange
  && previous.onShowLinuxDoPanelChange === next.onShowLinuxDoPanelChange
  && previous.onShowSettingsPanelChange === next.onShowSettingsPanelChange
  && previous.onToggleSubscription === next.onToggleSubscription
  && previous.onUpdateSettings === next.onUpdateSettings
));

function SettingsPanel({
  settings,
  styles,
  theme,
  onUpdateSettings
}: {
  settings: ReaderSettings;
  styles: ReturnType<typeof createStyles>;
  theme: ReaderTheme;
  onUpdateSettings: (patch: Partial<ReaderSettings>) => void;
}) {
  const [trackedKeyword, setTrackedKeyword] = useState('');
  const [blockedKeyword, setBlockedKeyword] = useState('');
  return (
    <View style={styles.stack}>
      <SettingRail title="字号" items={[
        { value: '0.9', label: '小' },
        { value: '1', label: '标准' },
        { value: '1.15', label: '大' },
        { value: '1.25', label: '特大' }
      ]} value={String(settings.fontScale)} styles={styles} onChange={(value) => onUpdateSettings({ fontScale: Number(value) })} />
      <SettingRail title="主题" items={[
        { value: 'system', label: '系统' },
        { value: 'light', label: '浅色' },
        { value: 'dark', label: '深色' }
      ]} value={settings.theme} styles={styles} onChange={(value) => onUpdateSettings({ theme: value as ReaderSettings['theme'] })} />
      <SettingRail title="配色" items={[
        { value: 'sage', label: '豆青' },
        { value: 'coral', label: '赤陶' },
        { value: 'blue', label: '青蓝' },
        { value: 'mint', label: '森绿' },
        { value: 'berry', label: '紫莓' },
        { value: 'noir', label: '墨金' }
      ]} value={settings.palette} styles={styles} onChange={(value) => onUpdateSettings({ palette: value as ReaderSettings['palette'] })} />
      <SettingRail title="背景" items={[
        { value: 'warm', label: '暖白' },
        { value: 'white', label: '豆瓣白' },
        { value: 'gray', label: '浅灰' }
      ]} value={settings.background} styles={styles} onChange={(value) => onUpdateSettings({ background: value as ReaderSettings['background'] })} />
      <SettingRail title="列表密度" items={[
        { value: 'compact', label: '紧凑' },
        { value: 'standard', label: '标准' },
        { value: 'loose', label: '宽松' }
      ]} value={settings.listDensity} styles={styles} onChange={(value) => onUpdateSettings({ listDensity: value as ReaderSettings['listDensity'] })} />
      <SettingRail title="行距" items={[
        { value: 'compact', label: '紧凑' },
        { value: 'standard', label: '标准' },
        { value: 'loose', label: '宽松' }
      ]} value={settings.lineHeight} styles={styles} onChange={(value) => onUpdateSettings({ lineHeight: value as ReaderSettings['lineHeight'] })} />
      <SettingRail title="正文宽度" items={[
        { value: 'narrow', label: '窄' },
        { value: 'standard', label: '标准' },
        { value: 'wide', label: '宽' }
      ]} value={settings.contentWidth} styles={styles} onChange={(value) => onUpdateSettings({ contentWidth: value as ReaderSettings['contentWidth'] })} />
      <SettingRail title="字体" items={[
        { value: 'sans', label: '无衬线' },
        { value: 'serif', label: '衬线' }
      ]} value={settings.fontFamily} styles={styles} onChange={(value) => onUpdateSettings({ fontFamily: value as ReaderSettings['fontFamily'] })} />
      <View style={styles.settingGroup}>
        <Text style={styles.panelTitle}>追踪关键词</Text>
        <View style={styles.searchRow}>
          <TextInput
            style={[styles.input, styles.flex]}
            value={trackedKeyword}
            onChangeText={setTrackedKeyword}
            placeholder="关键词"
            placeholderTextColor={theme.muted}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <AppButton
            label="添加"
            styles={styles}
            onPress={() => {
              const value = trackedKeyword.trim();
              if (value) {
                onUpdateSettings({ trackedKeywords: appendUnique(settingsList(settings.trackedKeywords), value) });
                setTrackedKeyword('');
              }
            }}
          />
        </View>
        <ChipList items={settings.trackedKeywords} styles={styles} onRemove={(value) => onUpdateSettings({ trackedKeywords: removeString(settingsList(settings.trackedKeywords), value) })} />
      </View>
      <View style={styles.settingGroup}>
        <Text style={styles.panelTitle}>屏蔽关键词</Text>
        <View style={styles.searchRow}>
          <TextInput
            style={[styles.input, styles.flex]}
            value={blockedKeyword}
            onChangeText={setBlockedKeyword}
            placeholder="关键词"
            placeholderTextColor={theme.muted}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <AppButton
            label="添加"
            styles={styles}
            onPress={() => {
              const value = blockedKeyword.trim();
              if (value) {
                onUpdateSettings({ blockedKeywords: appendUnique(settingsList(settings.blockedKeywords), value) });
                setBlockedKeyword('');
              }
            }}
          />
        </View>
        <ChipList items={settings.blockedKeywords} styles={styles} onRemove={(value) => onUpdateSettings({ blockedKeywords: removeString(settingsList(settings.blockedKeywords), value) })} />
      </View>
      {settings.blockedUsers.length ? (
        <View style={styles.settingGroup}>
          <Text style={styles.panelTitle}>已屏蔽用户</Text>
          <ChipList items={settings.blockedUsers} styles={styles} onRemove={(value) => onUpdateSettings({ blockedUsers: removeString(settingsList(settings.blockedUsers), value) })} />
        </View>
      ) : null}
      {settings.blockedCategories.length ? (
        <View style={styles.settingGroup}>
          <Text style={styles.panelTitle}>已屏蔽节点</Text>
          <ChipList items={settings.blockedCategories} styles={styles} onRemove={(value) => onUpdateSettings({ blockedCategories: removeString(settingsList(settings.blockedCategories), value) })} />
        </View>
      ) : null}
    </View>
  );
}

function ChipList({
  items,
  styles,
  onRemove
}: {
  items: string[];
  styles: ReturnType<typeof createStyles>;
  onRemove: (value: string) => void;
}) {
  if (!items.length) {
    return <Text style={styles.meta}>暂无</Text>;
  }
  return (
    <View style={styles.chipWrap}>
      {items.map((item) => (
        <Pressable accessibilityRole="button" key={item} style={styles.removableChip} onPress={() => onRemove(item)}>
          <Text style={styles.pillText}>{item} ×</Text>
        </Pressable>
      ))}
    </View>
  );
}
