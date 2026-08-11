import type { DiscourseActionRequest } from '@/sources/discourse/actionRequest';
import { runLinuxDoAction } from '@/sources/linuxdo/actionClient';
import type { Fetcher } from '@/platform/network/request';
import type { DiscourseSource } from '@/domain/forum/sourceCatalog';
import { runXiaoyinsiAction } from '@/sources/xiaoyinsi/actionClient';
import { currentXiaoyinsiCredentialGeneration, loadXiaoyinsiCredentials } from '@/sources/xiaoyinsi/auth';
import { errorMessage } from '@/platform/network/errors';

export type DiscourseActionRuntimeDependencies = {
  linuxDoUserAgent: () => string;
  refreshXiaoyinsiAuthorization: () => Promise<boolean | null>;
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
  credentialSource: 'managed-cookie-jar' | 'secure-store';
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
      return {
        credentialReady: true,
        credentialSource: 'managed-cookie-jar',
        csrfSource: 'session-endpoint',
        execute: (request: DiscourseActionRequest, signal?: AbortSignal) =>
          runLinuxDoAction({
            fetcher: context.fetcher,
            userAgent: context.linuxDoUserAgent(),
            request,
            signal
          }),
        recover: async (error: unknown) => {
          if (!hasFlag(error, 'loginRequired')) {
            return { loginRequired: false, phase: 'transport' as const };
          }
          const message = errorMessage(error);
          return { loginRequired: true, message, phase: 'credential' as const };
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
        ...(credentials
          ? {
              execute: (request: DiscourseActionRequest, signal?: AbortSignal) =>
                runXiaoyinsiAction({
                  credentials,
                  fetcher: context.fetcher,
                  request,
                  signal
                })
            }
          : {}),
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
            phase: authorizationCheckRequired ? ('credential' as const) : ('transport' as const)
          };
        }
      };
    }
  }
} satisfies Record<DiscourseSource, DiscourseActionRuntime>;

export function prepareDiscourseActionRuntime(
  source: DiscourseSource,
  context: DiscourseActionRuntimeContext
): Promise<PreparedDiscourseActionRuntime> {
  return discourseActionRuntimes[source].prepare(context);
}
