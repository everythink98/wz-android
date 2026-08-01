import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { WebView, WebViewMessageEvent } from 'react-native-webview';
import { errorMessage } from '@/platform/network/errors';
import {
  CredentialVaultError,
  credentialVault,
  emptyCredentialSummaries,
  type CredentialSummaries,
  CredentialSite
} from '@/platform/storage/credentialVault';
import { isTrustedLoginFormMessageSource, LOGIN_FORM_ADAPTERS, parseLoginFormMessage } from '@/loginFormAdapters';
import type { AccountCenterCommand } from '@/screens/more/AccountCenterPanel';
import type { SessionSite } from '@/domain/session/siteSessionState';
import {
  beginDiagnosticTrace,
  finishDiagnosticTrace,
  markDiagnosticStage,
  normalizeDiagnosticReason,
  type DiagnosticFields,
  type DiagnosticOutcome,
  type DiagnosticTrace
} from '@/platform/diagnostics/diagnostics';
import {
  finishCredentialFillTraceForWebViewFailure,
  loadCredentialSummariesWithTrace,
  type CredentialFillTraceState,
  type LoginWebViewFailureReason
} from './accountCredentialDiagnostics';

export type AccountCredentialFillAttempt = { site: CredentialSite; attempt: number };
type WebViewRef = RefObject<WebView | null>;

export function useAccountCredentialController({
  changeLinuxDoPanel,
  changeNodeSeekLoginPanel,
  changeScreen,
  changeYaohuoLoginPanel,
  linuxDoWebViewRef,
  notify,
  onOpenXiaoyinsiAuthorization,
  openUser,
  refreshAccountStatus,
  setYaohuoLoginPrompt,
  webViewRef,
  webViewBlockMessage,
  yaohuoWebViewRef
}: {
  changeLinuxDoPanel: (visible: boolean) => boolean;
  changeNodeSeekLoginPanel: (visible: boolean) => void;
  changeScreen: (screen: 'more') => void;
  changeYaohuoLoginPanel: (visible: boolean) => void;
  linuxDoWebViewRef: WebViewRef;
  notify: (message: string) => void;
  onOpenXiaoyinsiAuthorization: () => void;
  openUser: (user: Extract<AccountCenterCommand, { type: 'open-user' }>['user']) => Promise<unknown>;
  refreshAccountStatus: () => Promise<unknown>;
  setYaohuoLoginPrompt: (message: string) => void;
  webViewRef: WebViewRef;
  webViewBlockMessage: string;
  yaohuoWebViewRef: WebViewRef;
}) {
  const [credentialSummaries, setCredentialSummaries] = useState<CredentialSummaries>(emptyCredentialSummaries);
  const [credentialLoginSite, setCredentialLoginSite] = useState<CredentialSite | null>(null);
  const [pendingCredentialFillSite, setPendingCredentialFillSite] = useState<CredentialSite | null>(null);
  const [credentialFillAttempt, setCredentialFillAttempt] = useState<AccountCredentialFillAttempt | null>(null);
  const credentialLoginSiteRef = useRef<CredentialSite | null>(null);
  const pendingCredentialFillSiteRef = useRef<CredentialSite | null>(null);
  const credentialFillTraceRef = useRef<CredentialFillTraceState | null>(null);
  const credentialFillAttemptRef = useRef(0);
  const summaryLoadGenerationRef = useRef(0);
  const summaryRevisionRef = useRef(0);

  const reloadCredentialSummaries = useCallback(async () => {
    const generation = ++summaryLoadGenerationRef.current;
    const revision = summaryRevisionRef.current;
    const result = await loadCredentialSummariesWithTrace((site) => credentialVault.getSummary(site), {
      generation,
      isCurrent: () => summaryLoadGenerationRef.current === generation && summaryRevisionRef.current === revision
    });
    if (!result.ok) {
      if ('stale' in result) {
        return false;
      }
      setCredentialSummaries((current) => ({ ...current, ...result.summaries }));
      notify(`读取保存的登录信息失败：${errorMessage(result.error)}`);
      return false;
    }
    setCredentialSummaries(result.summaries);
    return true;
  }, [notify]);

  const finishCredentialFillTrace = useCallback(
    (
      site: CredentialSite,
      outcome: DiagnosticOutcome,
      fields: DiagnosticFields = {},
      expectedTrace?: DiagnosticTrace
    ) => {
      const current = credentialFillTraceRef.current;
      if (!current || current.site !== site || (expectedTrace && current.trace !== expectedTrace)) {
        return;
      }
      finishDiagnosticTrace(current.trace, outcome, { site, ...fields });
      credentialFillTraceRef.current = null;
    },
    []
  );

  const clearCredentialLoginIntent = useCallback(
    (site: CredentialSite) => {
      finishCredentialFillTrace(site, 'canceled', { reason: 'canceled' });
      if (credentialLoginSiteRef.current === site) {
        credentialLoginSiteRef.current = null;
        setCredentialLoginSite(null);
        setCredentialFillAttempt(null);
      }
      if (pendingCredentialFillSiteRef.current === site) {
        pendingCredentialFillSiteRef.current = null;
        setPendingCredentialFillSite(null);
      }
    },
    [finishCredentialFillTrace]
  );

  const finishCredentialFillForLoginFailure = useCallback(
    (site: CredentialSite, attempt: number, reason: LoginWebViewFailureReason) => {
      if (!finishCredentialFillTraceForWebViewFailure(credentialFillTraceRef.current, site, attempt, reason)) {
        return;
      }
      credentialFillTraceRef.current = null;
      if (pendingCredentialFillSiteRef.current === site) {
        pendingCredentialFillSiteRef.current = null;
        setPendingCredentialFillSite(null);
      }
    },
    []
  );

  useEffect(() => {
    void reloadCredentialSummaries();
  }, [reloadCredentialSummaries]);

  const openAccountLogin = useCallback(
    (site: SessionSite, fill: boolean) => {
      if (site === 'xiaoyinsi') {
        changeScreen('more');
        onOpenXiaoyinsiAuthorization();
        return;
      }
      const previousSite = credentialLoginSiteRef.current;
      if (previousSite && previousSite !== site) {
        clearCredentialLoginIntent(previousSite);
      }
      if (!fill) {
        clearCredentialLoginIntent(site);
      }
      changeScreen('more');
      let opened = true;
      if (site === 'nodeseek') {
        changeNodeSeekLoginPanel(true);
      } else if (site === 'yaohuo') {
        setYaohuoLoginPrompt('');
        changeYaohuoLoginPanel(true);
      } else {
        opened = changeLinuxDoPanel(true);
      }
      if (!opened) {
        clearCredentialLoginIntent(site);
        return;
      }
      if (!fill) {
        return;
      }

      const previousTrace = credentialFillTraceRef.current;
      if (previousTrace) {
        finishCredentialFillTrace(previousTrace.site, 'stale', { reason: 'superseded' }, previousTrace.trace);
      }
      const attempt = ++credentialFillAttemptRef.current;
      const trace = beginDiagnosticTrace('credential', 'load', {
        site,
        store: 'secure-store',
        flow: 'foreground',
        generation: attempt
      });
      markDiagnosticStage(trace, 'guard', { site, state: 'pending', generation: attempt });
      credentialFillTraceRef.current = { site, attempt, trace };
      credentialLoginSiteRef.current = site;
      pendingCredentialFillSiteRef.current = site;
      setCredentialLoginSite(site);
      setPendingCredentialFillSite(site);
      setCredentialFillAttempt({ site, attempt });
      if (webViewBlockMessage) {
        markDiagnosticStage(trace, 'guard', { site, state: 'failure', reason: 'network_error' });
        finishCredentialFillTrace(site, 'blocked', { reason: 'network_error' }, trace);
        pendingCredentialFillSiteRef.current = null;
        setPendingCredentialFillSite(null);
      }
    },
    [
      changeLinuxDoPanel,
      changeNodeSeekLoginPanel,
      changeScreen,
      changeYaohuoLoginPanel,
      clearCredentialLoginIntent,
      finishCredentialFillTrace,
      onOpenXiaoyinsiAuthorization,
      setYaohuoLoginPrompt,
      webViewBlockMessage
    ]
  );

  const handleCredentialLoginFormMessage = useCallback(
    (event: WebViewMessageEvent) => {
      const message = parseLoginFormMessage(event.nativeEvent.data);
      if (!message) {
        return false;
      }
      const site = message.site;
      if (credentialLoginSiteRef.current !== site) {
        return true;
      }
      const trustedSource = isTrustedLoginFormMessageSource(message, event.nativeEvent.url);
      const fillState = credentialFillTraceRef.current;
      if (!fillState || fillState.site !== site || fillState.attempt !== message.attempt) {
        return true;
      }
      const fillTrace = fillState.trace;
      if (message.type === 'login-form-fill') {
        const filled = message.ok && trustedSource;
        markDiagnosticStage(fillTrace, 'apply', {
          site,
          state: filled ? 'success' : 'failure',
          ...(filled ? {} : { reason: 'unsupported' })
        });
        finishCredentialFillTrace(
          site,
          filled ? 'success' : 'blocked',
          filled ? {} : { reason: 'unsupported' },
          fillTrace
        );
        notify(filled ? '已填入保存的登录信息，请完成验证后手动提交。' : '表单已变化，请手动登录。');
        return true;
      }
      if (pendingCredentialFillSiteRef.current !== site) {
        return true;
      }
      if (!message.ok || !trustedSource) {
        pendingCredentialFillSiteRef.current = null;
        setPendingCredentialFillSite(null);
        if (fillTrace) {
          markDiagnosticStage(fillTrace, 'guard', { site, state: 'failure', reason: 'unsupported' });
          finishCredentialFillTrace(site, 'blocked', { reason: 'unsupported' }, fillTrace);
        }
        notify('表单已变化，请手动登录。');
        return true;
      }

      if (fillTrace) {
        markDiagnosticStage(fillTrace, 'guard', { site, state: 'confirmed' });
        markDiagnosticStage(fillTrace, 'credential', { site, store: 'secure-store', state: 'pending' });
      }
      pendingCredentialFillSiteRef.current = null;
      setPendingCredentialFillSite(null);
      void credentialVault
        .readForFill(site)
        .then((credential) => {
          if (credentialFillTraceRef.current?.trace !== fillTrace) {
            return;
          }
          if (!credential || credentialLoginSiteRef.current !== site) {
            if (!credential) {
              markDiagnosticStage(fillTrace, 'credential', {
                site,
                store: 'secure-store',
                state: 'empty',
                reason: 'missing_credential'
              });
              finishCredentialFillTrace(site, 'blocked', { reason: 'missing_credential' }, fillTrace);
              notify('没有可用的保存登录信息，请重新保存。');
              void reloadCredentialSummaries();
            } else {
              finishCredentialFillTrace(site, 'stale', { reason: 'superseded' }, fillTrace);
            }
            return;
          }
          markDiagnosticStage(fillTrace, 'credential', { site, store: 'secure-store', state: 'loaded' });
          const target = site === 'nodeseek' ? webViewRef : site === 'yaohuo' ? yaohuoWebViewRef : linuxDoWebViewRef;
          if (!target.current) {
            markDiagnosticStage(fillTrace, 'apply', { site, state: 'failure', reason: 'not_ready' });
            finishCredentialFillTrace(site, 'blocked', { reason: 'not_ready' }, fillTrace);
            notify('登录页面尚未准备好，请重试填入。');
            return;
          }
          target.current.injectJavaScript(LOGIN_FORM_ADAPTERS[site].fillScript(credential, fillState.attempt));
          markDiagnosticStage(fillTrace, 'apply', { site, state: 'pending' });
        })
        .catch((error) => {
          if (credentialFillTraceRef.current?.trace !== fillTrace) {
            return;
          }
          markDiagnosticStage(fillTrace, 'credential', {
            site,
            store: 'secure-store',
            state: 'error',
            reason: 'storage_error'
          });
          finishCredentialFillTrace(site, 'failure', { reason: 'storage_error' }, fillTrace);
          notify(`未填入登录信息：${errorMessage(error)}`);
          void reloadCredentialSummaries();
        });
      return true;
    },
    [finishCredentialFillTrace, linuxDoWebViewRef, notify, reloadCredentialSummaries, webViewRef, yaohuoWebViewRef]
  );

  const handleAccountCenterCommand = useCallback(
    async (command: AccountCenterCommand) => {
      if (command.type === 'refresh') {
        await refreshAccountStatus();
        return;
      }
      if (command.type === 'open-user') {
        await openUser(command.user);
        return;
      }
      if (command.type === 'open-login' || command.type === 'open-login-with-fill') {
        openAccountLogin(command.site, command.type === 'open-login-with-fill');
        return;
      }

      const generation = ++summaryRevisionRef.current;
      if (command.type === 'save-credential') {
        const isAuthenticationRequired = command.allowUnprotected !== true;
        const trace = beginDiagnosticTrace('credential', 'save', {
          site: command.site,
          store: 'secure-store',
          generation,
          isAuthenticationRequired
        });
        markDiagnosticStage(trace, 'guard', { site: command.site, state: 'pending', generation });
        markDiagnosticStage(trace, 'credential', {
          site: command.site,
          state: isAuthenticationRequired ? 'pending' : 'not-required',
          isAuthenticationRequired
        });
        try {
          const summary = await credentialVault.save(command.site, {
            account: command.account,
            password: command.password,
            ...(command.allowUnprotected ? { allowUnprotected: true } : {})
          });
          const didUseBiometric = summary.protection === 'biometric';
          markDiagnosticStage(trace, 'persist', {
            site: command.site,
            store: 'secure-store',
            state: 'saved',
            didUseBiometric
          });
          setCredentialSummaries((current) => ({ ...current, [command.site]: summary }));
          markDiagnosticStage(trace, 'apply', { site: command.site, state: 'status-updated' });
          finishDiagnosticTrace(trace, 'success', { site: command.site, didUseBiometric });
          notify('登录信息已安全保存。');
          return;
        } catch (error) {
          const blocked =
            error instanceof CredentialVaultError &&
            (error.code === 'biometric-unavailable' || error.code === 'invalid-input');
          const reason = blocked ? 'unsupported' : normalizeDiagnosticReason(error);
          markDiagnosticStage(trace, blocked ? 'guard' : 'persist', {
            site: command.site,
            state: 'failure',
            reason
          });
          finishDiagnosticTrace(trace, blocked ? 'blocked' : reason === 'canceled' ? 'canceled' : 'failure', {
            site: command.site,
            reason
          });
          throw error;
        } finally {
          summaryRevisionRef.current += 1;
        }
      }

      const trace = beginDiagnosticTrace('credential', 'delete', {
        site: command.site,
        store: 'secure-store',
        generation
      });
      markDiagnosticStage(trace, 'guard', { site: command.site, state: 'confirmed', generation });
      let deleted = false;
      try {
        await credentialVault.delete(command.site);
        deleted = true;
        markDiagnosticStage(trace, 'persist', { site: command.site, store: 'secure-store', state: 'cleared' });
        const summary = await credentialVault.getSummary(command.site);
        setCredentialSummaries((current) => ({ ...current, [command.site]: summary }));
        markDiagnosticStage(trace, 'apply', { site: command.site, state: 'status-updated' });
        finishDiagnosticTrace(trace, 'success', { site: command.site });
        notify('已删除保存的登录信息，当前网站登录未受影响。');
      } catch (error) {
        markDiagnosticStage(trace, deleted ? 'apply' : 'persist', {
          site: command.site,
          state: 'error',
          reason: 'storage_error'
        });
        finishDiagnosticTrace(trace, 'failure', { site: command.site, reason: 'storage_error' });
        throw error;
      } finally {
        summaryRevisionRef.current += 1;
      }
    },
    [notify, openAccountLogin, openUser, refreshAccountStatus]
  );

  return {
    clearCredentialLoginIntent,
    credentialFillAttempt,
    credentialLoginSite,
    credentialSummaries,
    finishCredentialFillForLoginFailure,
    handleAccountCenterCommand,
    handleCredentialLoginFormMessage,
    openAccountLogin,
    pendingCredentialFillSite,
    reloadCredentialSummaries
  };
}
