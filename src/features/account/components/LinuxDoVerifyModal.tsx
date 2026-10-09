import { memo } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { ArrowLeft, KeyRound, LogOut, RefreshCw, ShieldCheck } from 'lucide-react-native';
import { LoginWebViewAction, LoginWebViewModal } from '@/ui/navigation/LoginWebViewModal';
import { LINUXDO_WEBVIEW_PROBE_SCRIPT } from '@/platform/network/loginWebViewScripts';
import type { SiteSessionViewModel } from '@/domain/session/siteSessionState';
import type { AccountHostStyles } from '../accountHostStyles';
import type { LinuxDoRecoveryPanel } from '../useVerificationController';
import { useLinuxDoVerificationPage, type LinuxDoVerificationPageProps } from './useLinuxDoVerificationPage';

type Props = LinuxDoVerificationPageProps & {
  recoveryPanel?: LinuxDoRecoveryPanel;
  checking: boolean;
  credentialFillPending: boolean;
  credentialSaved: boolean;
  linuxDoSession: SiteSessionViewModel;
  linuxDoWebViewError: string;
  mountLinuxDoWebView: boolean;
  styles: AccountHostStyles;
  webViewBlockMessage: string;
  onCheckLinuxDoCookie: () => void;
  onClearLinuxDoCookie: () => void;
  onRequestCredentialFill: () => void;
  onShowLinuxDoPanelChange: (value: boolean) => void;
};

export function LinuxDoVerifyModal(props: Props) {
  const {
    recoveryPanel,
    checking,
    credentialFillPending,
    credentialSaved,
    loginFormMode,
    linuxDoSession,
    linuxDoWebViewError,
    linuxDoWebViewKey,
    linuxDoWebViewRef,
    mountLinuxDoWebView,
    loadingLinuxDoPage,
    showLinuxDoPanel,
    styles,
    webViewBlockMessage,
    onCheckLinuxDoCookie,
    onClearLinuxDoCookie,
    onRequestCredentialFill,
    onShowLinuxDoPanelChange
  } = props;
  const recovery = recoveryPanel && recoveryPanel.phase !== 'idle' ? recoveryPanel : undefined;
  const web = !recovery || recovery.phase === 'web';
  const page = useLinuxDoVerificationPage({ ...props, dedicated: recovery?.dedicated ?? false, web });
  const verifying = !!recovery || page.stage !== 'account';
  const busy = checking || recovery?.phase === 'checking';
  const result = recovery?.phase === 'result';
  const canRetry = recovery?.results.some(
    ({ outcome }) => outcome === 'pending' || outcome === 'verification-required'
  );
  const blocked = recovery?.results.some(({ outcome }) => outcome === 'verification-required');
  const needsReopen = page.needsRemount || (!mountLinuxDoWebView && !!linuxDoWebViewError);
  const close = () => onShowLinuxDoPanelChange(false);
  const primaryLabel = busy
    ? '正在检测…'
    : result
      ? canRetry
        ? '重新验证'
        : '返回原页面'
      : needsReopen
        ? verifying
          ? '重新打开验证'
          : '重新打开登录页'
        : verifying
          ? '检测并继续'
          : '检测登录';
  const primaryAction = result
    ? canRetry
      ? page.openChallenge
      : close
    : needsReopen
      ? page.refresh
      : onCheckLinuxDoCookie;

  return (
    <LoginWebViewModal
      visible={showLinuxDoPanel}
      title={verifying ? 'linux.do 安全验证' : 'linux.do 登录'}
      subtitle={
        recovery
          ? recovery.results.some(({ kind }) => kind === 'page')
            ? '恢复页面访问'
            : '恢复阅读记录同步'
          : verifying
            ? '验证完成后自动检测访问状态'
            : linuxDoSession.summaryLabel === '匿名可用'
              ? '匿名可用，登录后内容更完整'
              : linuxDoSession.summaryLabel
      }
      loading={web && !busy && !webViewBlockMessage && loadingLinuxDoPage}
      loadingText={page.stage === 'returning' ? '正在返回主站…' : verifying ? '正在打开验证页面…' : '正在打开登录页面…'}
      error={web && !busy ? webViewBlockMessage || linuxDoWebViewError : ''}
      onClose={close}
      actions={
        !recovery && page.stage === 'account' ? (
          <>
            {credentialSaved ? (
              <LoginWebViewAction
                icon={KeyRound}
                label="填入已保存登录信息"
                displayLabel="填入"
                disabled={busy || credentialFillPending || !mountLinuxDoWebView}
                onPress={onRequestCredentialFill}
              />
            ) : null}
            {!loginFormMode ? (
              <LoginWebViewAction icon={ShieldCheck} label="网站验证" disabled={busy} onPress={page.openChallenge} />
            ) : null}
            <LoginWebViewAction icon={LogOut} label="清除登录" danger disabled={busy} onPress={onClearLinuxDoCookie} />
          </>
        ) : undefined
      }
      footer={
        web && verifying && !busy ? (
          <Text style={styles.verificationHint} accessibilityLiveRegion="polite">
            {page.stage === 'challenge'
              ? '请完成网页中的验证，无需登录。完成后会自动检测。'
              : page.stage === 'returning'
                ? '正在确认主站访问；若未自动继续，可点击下方检测。'
                : '完成网页验证后，点击下方检测并继续。'}
          </Text>
        ) : undefined
      }
      primaryAction={
        <LoginWebViewAction
          icon={result && !canRetry ? ArrowLeft : ShieldCheck}
          primary
          label={primaryLabel}
          loading={busy}
          onPress={primaryAction}
        />
      }
      refreshAction={
        web ? (
          <LoginWebViewAction
            icon={RefreshCw}
            label="刷新页面"
            displayLabel=""
            disabled={busy}
            onPress={page.refresh}
          />
        ) : undefined
      }
    >
      {busy ? (
        <View style={styles.verificationStatus} accessibilityLiveRegion="polite">
          <Text style={styles.verificationTitle}>正在确认{recovery ? '访问是否恢复' : '登录状态'}</Text>
          <Text style={styles.verificationBody}>
            {recovery ? '验证结果正在交回原请求，请稍候。' : '正在检查主站会话，请稍候。'}
          </Text>
          <Text style={styles.verificationHint}>可以随时关闭并返回原页面。</Text>
        </View>
      ) : result ? (
        <ScrollView
          overScrollMode="never"
          contentContainerStyle={styles.verificationStatus}
          accessibilityLiveRegion="polite"
        >
          <Text style={styles.verificationTitle}>
            {blocked ? '还需要一次验证' : canRetry ? '等待继续检测' : '本次检测已结束'}
          </Text>
          {blocked ? <Text style={styles.verificationBody}>站点仍在拦截请求，可以重新验证后再试。</Text> : null}
          {recovery.results.map((entry, index) => (
            <View key={index} style={styles.verificationResult}>
              <Text style={styles.verificationResultLabel}>{entry.kind === 'page' ? '页面访问' : '阅读记录'}</Text>
              <Text style={styles.verificationBody}>
                {entry.outcome === 'completed'
                  ? entry.kind === 'page'
                    ? '已恢复'
                    : '已同步'
                  : entry.error ||
                    (entry.outcome === 'verification-required'
                      ? '仍被站点拦截'
                      : entry.outcome === 'stale'
                        ? '请求已过期，请返回原页面重试。'
                        : entry.outcome === 'pending'
                          ? '等待检测'
                          : '恢复失败，请返回原页面重试。')}
              </Text>
            </View>
          ))}
        </ScrollView>
      ) : web && showLinuxDoPanel && mountLinuxDoWebView && !webViewBlockMessage && !page.needsRemount ? (
        <WebView
          key={linuxDoWebViewKey}
          ref={linuxDoWebViewRef}
          source={page.webViewProps.source}
          androidLayerType="software"
          javaScriptEnabled
          javaScriptCanOpenWindowsAutomatically={false}
          domStorageEnabled
          cacheEnabled
          sharedCookiesEnabled
          thirdPartyCookiesEnabled
          setSupportMultipleWindows={false}
          injectedJavaScript={LINUXDO_WEBVIEW_PROBE_SCRIPT}
          onLoadProgress={page.webViewProps.onLoadProgress}
          onLoadStart={page.webViewProps.onLoadStart}
          onLoadEnd={page.webViewProps.onLoadEnd}
          onMessage={page.webViewProps.onMessage}
          onError={page.webViewProps.onError}
          onHttpError={page.webViewProps.onHttpError}
          onRenderProcessGone={page.webViewProps.onRenderProcessGone}
          onShouldStartLoadWithRequest={page.webViewProps.onShouldStartLoadWithRequest}
          style={styles.flex}
          renderError={() => <View style={styles.webViewErrorPlaceholder} />}
        />
      ) : null}
    </LoginWebViewModal>
  );
}

export const MemoizedLinuxDoVerifyModal = memo(LinuxDoVerifyModal);
