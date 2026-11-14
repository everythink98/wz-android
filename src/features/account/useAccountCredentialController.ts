import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { WebView, WebViewMessageEvent } from 'react-native-webview';
import { errorMessage } from '@/platform/network/errors';
import {
  CredentialVaultError,
  credentialVault,
  emptyCredentialSummaries,
  type CredentialSummaries
} from '@/platform/storage/credentialVault';
import type { CredentialSite } from '@/domain/session/sessionContracts';
import type { AccountCenterCommand } from '@/domain/session/accountCenter';
import {
  isTrustedLoginFormMessageSource,
  LOGIN_FORM_ADAPTERS,
  parseLoginFormMessage
} from '@/domain/session/loginFormAdapters';
import type { SessionSite } from '@/domain/session/siteSessionState';
import { useCommittedRef } from '@/ui/hooks/useCommittedRef';
import { beginDiagnosticTrace, finishDiagnosticTrace, markDiagnosticStage } from '@/platform/diagnostics/diagnostics';
import {
  normalizeDiagnosticReason,
  type DiagnosticFields,
  type DiagnosticOutcome,
  type DiagnosticTrace
} from '@/platform/diagnostics/diagnosticPolicy';
import {
  finishCredentialFillTraceForWebViewFailure,
  loadCredentialSummariesWithTrace,
  type LoginWebViewFailureReason
} from './credentialDiagnostics';
import { createCredentialFillSession } from './credentialFillSession';

type WebViewRef = RefObject<WebView | null>;
type CredentialWrite = { owner: AbortSignal };

export function useAccountCredentialController({
  changeLinuxDoPanel,
  changeNodeSeekLoginPanel,
  changeYaohuoLoginPanel,
  linuxDoWebViewRef,
  notify,
  refreshAccountStatus,
  setYaohuoLoginPrompt,
  webViewRef,
  webViewBlockMessage,
  yaohuoWebViewRef
}: {
  changeLinuxDoPanel: (visible: boolean) => boolean;
  changeNodeSeekLoginPanel: (visible: boolean) => void;
  changeYaohuoLoginPanel: (visible: boolean) => void;
  linuxDoWebViewRef: WebViewRef;
  notify: (message: string) => void;
  refreshAccountStatus: () => Promise<unknown>;
  setYaohuoLoginPrompt: (message: string) => void;
  webViewRef: WebViewRef;
  webViewBlockMessage: string;
  yaohuoWebViewRef: WebViewRef;
}) {
  const [credentialSummaries, setCredentialSummaries] = useState<CredentialSummaries>(emptyCredentialSummaries);
  const [fillSession] = useState(createCredentialFillSession);
  const [fillSnapshot, setFillSnapshot] = useState(fillSession.snapshot);
  const { attempt: credentialFillAttempt, pendingSite: pendingCredentialFillSite } = fillSnapshot;
  const publishFill = useCallback(() => setFillSnapshot(fillSession.snapshot), [fillSession]);
  const credentialFillAttemptRef = useRef(0);
  const summaryLoadGenerationRef = useRef(0);
  const summaryRevisionRef = useRef(0);
  const lifetimeRef = useRef(new AbortController());
  const pendingWritesRef = useRef(new Set<CredentialWrite>());
  const notifyRef = useCommittedRef(notify);

  useLayoutEffect(() => {
    if (lifetimeRef.current.signal.aborted) lifetimeRef.current = new AbortController();
    const lifetime = lifetimeRef.current;
    const owner = lifetime.signal;
    // Strict effect reconstruction keeps the same logical fill and dispatched writes.
    fillSession.adopt(owner);
    for (const write of pendingWritesRef.current) write.owner = owner;
    return () => lifetime.abort();
  }, [fillSession]);

  const reloadCredentialSummaries = useCallback(async () => {
    const owner = lifetimeRef.current.signal;
    if (owner.aborted) return false;
    const generation = ++summaryLoadGenerationRef.current;
    const revision = summaryRevisionRef.current;
    const result = await loadCredentialSummariesWithTrace((site) => credentialVault.getSummary(site), {
      generation,
      isCurrent: () =>
        !owner.aborted &&
        lifetimeRef.current.signal === owner &&
        summaryLoadGenerationRef.current === generation &&
        summaryRevisionRef.current === revision
    });
    if (!result.ok) {
      if ('stale' in result) {
        return false;
      }
      setCredentialSummaries((current) => ({ ...current, ...result.summaries }));
      notifyRef.current(`读取保存的登录信息失败：${errorMessage(result.error)}`);
      return false;
    }
    setCredentialSummaries(result.summaries);
    return true;
  }, [notifyRef]);

  const finishCredentialFillTrace = useCallback(
    (
      site: CredentialSite,
      outcome: DiagnosticOutcome,
      fields: DiagnosticFields = {},
      expectedTrace?: DiagnosticTrace
    ) => {
      const current = fillSession.active;
      if (!current || current.site !== site || (expectedTrace && current.trace !== expectedTrace)) {
        return;
      }
      finishDiagnosticTrace(current.trace, outcome, { site, ...fields });
      fillSession.finishTrace(current);
    },
    [fillSession]
  );

  const clearCredentialLoginIntent = useCallback(
    (site: CredentialSite) => {
      finishCredentialFillTrace(site, 'canceled', { reason: 'canceled' });
      fillSession.close(site);
      publishFill();
    },
    [fillSession, finishCredentialFillTrace, publishFill]
  );

  const finishCredentialFillForLoginFailure = useCallback(
    (site: CredentialSite, attempt: number, reason: LoginWebViewFailureReason) => {
      const fill = fillSession.active;
      if (!fill || !finishCredentialFillTraceForWebViewFailure(fill, site, attempt, reason)) return;
      fillSession.finishTrace(fill);
      fillSession.consumeForm(site);
      publishFill();
    },
    [fillSession, publishFill]
  );

  useEffect(() => {
    void reloadCredentialSummaries();
  }, [reloadCredentialSummaries]);

  const openAccountLogin = useCallback(
    (site: SessionSite, fill: boolean) => {
      if (lifetimeRef.current.signal.aborted) return;
      const previousSite = fillSession.site;
      if (previousSite && previousSite !== site) {
        clearCredentialLoginIntent(previousSite);
      }
      if (!fill) {
        clearCredentialLoginIntent(site);
      }
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

      const previousTrace = fillSession.active;
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
      fillSession.begin({ site, attempt, trace, owner: lifetimeRef.current.signal });
      publishFill();
      if (webViewBlockMessage) {
        markDiagnosticStage(trace, 'guard', { site, state: 'failure', reason: 'network_error' });
        finishCredentialFillTrace(site, 'blocked', { reason: 'network_error' }, trace);
        fillSession.consumeForm(site);
        publishFill();
      }
    },
    [
      changeLinuxDoPanel,
      changeNodeSeekLoginPanel,
      changeYaohuoLoginPanel,
      clearCredentialLoginIntent,
      fillSession,
      finishCredentialFillTrace,
      publishFill,
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
      if (lifetimeRef.current.signal.aborted) return true;
      const site = message.site;
      if (fillSession.site !== site) {
        return true;
      }
      const trustedSource = isTrustedLoginFormMessageSource(message, event.nativeEvent.url);
      const fillState = fillSession.active;
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
        notifyRef.current(filled ? '已填入保存的登录信息，请完成验证后手动提交。' : '表单已变化，请手动登录。');
        return true;
      }
      if (fillSession.pendingSite !== site) {
        return true;
      }
      if (!message.ok || !trustedSource) {
        fillSession.consumeForm(site);
        publishFill();
        if (fillTrace) {
          markDiagnosticStage(fillTrace, 'guard', { site, state: 'failure', reason: 'unsupported' });
          finishCredentialFillTrace(site, 'blocked', { reason: 'unsupported' }, fillTrace);
        }
        notifyRef.current('表单已变化，请手动登录。');
        return true;
      }

      if (fillTrace) {
        markDiagnosticStage(fillTrace, 'guard', { site, state: 'confirmed' });
        markDiagnosticStage(fillTrace, 'credential', { site, store: 'secure-store', state: 'pending' });
      }
      fillSession.consumeForm(site);
      publishFill();
      void credentialVault
        .readForFill(site)
        .then((credential) => {
          if (
            fillState.owner.aborted ||
            lifetimeRef.current.signal !== fillState.owner ||
            fillSession.active !== fillState
          ) {
            return;
          }
          if (!credential || fillSession.site !== site) {
            if (!credential) {
              markDiagnosticStage(fillTrace, 'credential', {
                site,
                store: 'secure-store',
                state: 'empty',
                reason: 'missing_credential'
              });
              finishCredentialFillTrace(site, 'blocked', { reason: 'missing_credential' }, fillTrace);
              notifyRef.current('没有可用的保存登录信息，请重新保存。');
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
            notifyRef.current('登录页面尚未准备好，请重试填入。');
            return;
          }
          target.current.injectJavaScript(LOGIN_FORM_ADAPTERS[site].fillScript(credential, fillState.attempt));
          markDiagnosticStage(fillTrace, 'apply', { site, state: 'pending' });
        })
        .catch((error) => {
          if (
            fillState.owner.aborted ||
            lifetimeRef.current.signal !== fillState.owner ||
            fillSession.active !== fillState
          ) {
            return;
          }
          markDiagnosticStage(fillTrace, 'credential', {
            site,
            store: 'secure-store',
            state: 'error',
            reason: 'storage_error'
          });
          finishCredentialFillTrace(site, 'failure', { reason: 'storage_error' }, fillTrace);
          notifyRef.current(`未填入登录信息：${errorMessage(error)}`);
          void reloadCredentialSummaries();
        });
      return true;
    },
    [
      fillSession,
      finishCredentialFillTrace,
      linuxDoWebViewRef,
      notifyRef,
      publishFill,
      reloadCredentialSummaries,
      webViewRef,
      yaohuoWebViewRef
    ]
  );

  const handleAccountCenterCommand = useCallback(
    async (command: Exclude<AccountCenterCommand, { type: 'open-user' }>) => {
      if (lifetimeRef.current.signal.aborted) return;
      if (command.type === 'refresh') {
        await refreshAccountStatus();
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
        const write = { owner: lifetimeRef.current.signal };
        pendingWritesRef.current.add(write);
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
          if (write.owner.aborted || lifetimeRef.current.signal !== write.owner) {
            finishDiagnosticTrace(trace, 'stale', { site: command.site, reason: 'canceled' });
            return;
          }
          setCredentialSummaries((current) => ({ ...current, [command.site]: summary }));
          markDiagnosticStage(trace, 'apply', { site: command.site, state: 'status-updated' });
          finishDiagnosticTrace(trace, 'success', { site: command.site, didUseBiometric });
          notifyRef.current('登录信息已安全保存。');
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
          pendingWritesRef.current.delete(write);
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
      const write = { owner: lifetimeRef.current.signal };
      pendingWritesRef.current.add(write);
      try {
        await credentialVault.delete(command.site);
        deleted = true;
        markDiagnosticStage(trace, 'persist', { site: command.site, store: 'secure-store', state: 'cleared' });
        const summary = await credentialVault.getSummary(command.site);
        if (write.owner.aborted || lifetimeRef.current.signal !== write.owner) {
          finishDiagnosticTrace(trace, 'stale', { site: command.site, reason: 'canceled' });
          return;
        }
        setCredentialSummaries((current) => ({ ...current, [command.site]: summary }));
        markDiagnosticStage(trace, 'apply', { site: command.site, state: 'status-updated' });
        finishDiagnosticTrace(trace, 'success', { site: command.site });
        notifyRef.current('已删除保存的登录信息，当前网站登录未受影响。');
      } catch (error) {
        markDiagnosticStage(trace, deleted ? 'apply' : 'persist', {
          site: command.site,
          state: 'error',
          reason: 'storage_error'
        });
        finishDiagnosticTrace(trace, 'failure', { site: command.site, reason: 'storage_error' });
        throw error;
      } finally {
        pendingWritesRef.current.delete(write);
        summaryRevisionRef.current += 1;
      }
    },
    [notifyRef, openAccountLogin, refreshAccountStatus]
  );

  return {
    clearCredentialLoginIntent,
    credentialFillAttempt,
    credentialLoginSite: credentialFillAttempt?.site ?? null,
    credentialSummaries,
    finishCredentialFillForLoginFailure,
    handleAccountCenterCommand,
    handleCredentialLoginFormMessage,
    openAccountLogin,
    pendingCredentialFillSite,
    reloadCredentialSummaries
  };
}
