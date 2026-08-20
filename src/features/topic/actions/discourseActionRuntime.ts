import type { DiscourseActionRequest } from '@/sources/discourse/actionRequest';
import { runLinuxDoAction } from '@/sources/linuxdo/actionClient';
import type { Fetcher } from '@/platform/network/request';
import type { DiscourseSource } from '@/domain/forum/sourceCatalog';
import { errorMessage } from '@/platform/network/errors';

export type DiscourseActionRuntimeDependencies = {
  linuxDoUserAgent: () => string;
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

function hasFlag(error: unknown, key: 'loginRequired') {
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
  }
} satisfies Record<DiscourseSource, DiscourseActionRuntime>;

export function prepareDiscourseActionRuntime(
  source: DiscourseSource,
  context: DiscourseActionRuntimeContext
): Promise<PreparedDiscourseActionRuntime> {
  return discourseActionRuntimes[source].prepare(context);
}
