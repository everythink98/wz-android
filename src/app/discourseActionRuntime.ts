import type { DiscourseActionRequest } from '../discourseActions';
import { runLinuxDoAction } from '../linuxdoActionClient';
import {
  currentLinuxDoAccessGeneration,
  linuxDoAccessSummary,
  loadLinuxDoAccess
} from '../linuxdoCookieBridge';
import type { Fetcher } from '../request';
import type { DiscourseSource } from '../sourceCatalog';
import type { SiteSessionEvent } from '../siteSessionState';
import { runXiaoyinsiAction } from '../xiaoyinsiActionClient';
import { currentXiaoyinsiCredentialGeneration, loadXiaoyinsiCredentials } from '../xiaoyinsiAuth';
import { errorMessage } from '../appUtils';
import { clearExpiredLinuxDoLogin } from './topicActionHelpers';

export type DiscourseActionRuntimeDependencies = {
  linuxDoUserAgent: () => string;
  refreshXiaoyinsiAuthorization: () => Promise<boolean | null>;
  resetLinuxDoLevelState: () => void;
  updateLinuxDoSession: (event: SiteSessionEvent) => void;
};

export type DiscourseActionRuntimeContext = DiscourseActionRuntimeDependencies & {
  fetcher: Fetcher;
};

export type DiscourseActionRuntimeRecovery = {
  loginRequired: boolean;
  message?: string;
  phase: 'credential' | 'transport';
  stale?: boolean;
};

export type PreparedDiscourseActionRuntime = {
  credentialReady: boolean;
  credentialSource: 'secure-store';
  csrfSource: 'none' | 'session-endpoint';
  execute?: (request: DiscourseActionRequest, signal?: AbortSignal) => Promise<unknown>;
  isCredentialCurrent?: () => boolean;
  onMissingCredential?: () => void;
  recover: (error: unknown) => Promise<DiscourseActionRuntimeRecovery>;
};

type DiscourseActionRuntime = {
  prepare: (context: DiscourseActionRuntimeContext) => Promise<PreparedDiscourseActionRuntime>;
};

function hasFlag(error: unknown, key: 'authorizationCheckRequired' | 'loginRequired') {
  return Boolean(error && typeof error === 'object' && (error as Record<string, unknown>)[key]);
}

const discourseActionRuntimes = {
  linuxdo: {
    prepare: async (context) => {
      const generation = currentLinuxDoAccessGeneration();
      const isCredentialCurrent = () => currentLinuxDoAccessGeneration() === generation;
      const access = await loadLinuxDoAccess();
      const credentialReady = Boolean(access?.cookieHeader && linuxDoAccessSummary(access).loggedIn);
      return {
        credentialReady,
        credentialSource: 'secure-store',
        csrfSource: 'session-endpoint',
        isCredentialCurrent,
        ...(!credentialReady ? {
          onMissingCredential: () => context.updateLinuxDoSession({
            type: 'login-expired',
            message: 'linux.do 登录状态已失效'
          })
        } : {
          execute: (request: DiscourseActionRequest, signal?: AbortSignal) => runLinuxDoAction({
            cookieHeader: access!.cookieHeader,
            fetcher: context.fetcher,
            userAgent: access!.userAgent || context.linuxDoUserAgent(),
            request,
            signal
          })
        }),
        recover: async (error: unknown) => {
          if (!isCredentialCurrent()) {
            return { loginRequired: false, phase: 'credential' as const, stale: true };
          }
          if (!hasFlag(error, 'loginRequired')) {
            return { loginRequired: false, phase: 'transport' as const };
          }
          let recovered: boolean | undefined;
          try {
            recovered = await clearExpiredLinuxDoLogin({
              error,
              generation,
              cookieHeader: access?.cookieHeader,
              resetLinuxDoLevelState: context.resetLinuxDoLevelState,
              updateLinuxDoSession: context.updateLinuxDoSession
            });
          } catch {
            if (!isCredentialCurrent()) {
              return { loginRequired: false, phase: 'credential' as const, stale: true };
            }
            return {
              loginRequired: true,
              message: `${errorMessage(error)} 本机 Cookie 清理未完成，请重试。`,
              phase: 'credential' as const
            };
          }
          if (!recovered || !isCredentialCurrent()) {
            return { loginRequired: false, phase: 'credential' as const, stale: true };
          }
          return { loginRequired: true, phase: 'credential' as const };
        }
      };
    }
  },
  xiaoyinsi: {
    prepare: async (context) => {
      const generation = currentXiaoyinsiCredentialGeneration();
      const isCredentialCurrent = () => currentXiaoyinsiCredentialGeneration() === generation;
      const credentials = await loadXiaoyinsiCredentials();
      return {
        credentialReady: Boolean(credentials),
        credentialSource: 'secure-store',
        csrfSource: 'none',
        isCredentialCurrent,
        ...(credentials ? {
          execute: (request: DiscourseActionRequest, signal?: AbortSignal) => runXiaoyinsiAction({
            credentials,
            fetcher: context.fetcher,
            request,
            signal
          })
        } : {}),
        recover: async (error: unknown) => {
          if (!isCredentialCurrent()) {
            return { loginRequired: false, phase: 'credential' as const, stale: true };
          }
          const authorizationCheckRequired = hasFlag(error, 'authorizationCheckRequired');
          let authorizationStillValid: boolean | null | undefined;
          if (authorizationCheckRequired) {
            authorizationStillValid = await context.refreshXiaoyinsiAuthorization();
            if (authorizationStillValid === null) {
              throw new Error('小隐寺授权状态复核未完成');
            }
          }
          if (!isCredentialCurrent()) {
            return { loginRequired: false, phase: 'credential' as const, stale: true };
          }
          return {
            loginRequired: hasFlag(error, 'loginRequired') || authorizationStillValid === false,
            phase: authorizationCheckRequired ? 'credential' as const : 'transport' as const
          };
        }
      };
    }
  }
} satisfies Record<DiscourseSource, DiscourseActionRuntime>;

export const discourseActionRuntimeSources = Object.keys(discourseActionRuntimes) as DiscourseSource[];

export function prepareDiscourseActionRuntime(
  source: DiscourseSource,
  context: DiscourseActionRuntimeContext
): Promise<PreparedDiscourseActionRuntime> {
  return discourseActionRuntimes[source].prepare(context);
}
