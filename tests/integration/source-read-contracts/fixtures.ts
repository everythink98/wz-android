import { vi } from 'vitest';
import type { SessionSource } from '@/domain/forum/sourceCatalog';
import type { SessionRuntimeSnapshot } from '@/domain/session/writableSessionGate';
import { createReadGateway as createProductionReadGateway } from '@/sources/readGateway';
import type { Fetcher } from '@/platform/network/request';

export function publicSessionSnapshot(source: SessionSource): SessionRuntimeSnapshot {
  return {
    source,
    authenticated: false,
    authSurfaceOpen: false,
    identityKey: `${source}:anonymous`,
    identityTrust: 'none',
    sessionEpoch: 0,
    sourceEnabled: true
  };
}

export function createReadGateway(
  dependencies: Omit<Parameters<typeof createProductionReadGateway>[0], 'readSessionRuntimeSnapshot'> & {
    readSessionRuntimeSnapshot?: (source: SessionSource) => SessionRuntimeSnapshot;
  }
) {
  return createProductionReadGateway({
    ...dependencies,
    readSessionRuntimeSnapshot: dependencies.readSessionRuntimeSnapshot || publicSessionSnapshot
  });
}

export function json(value: unknown) {
  return new Response(JSON.stringify(value), {
    headers: { 'content-type': 'application/json' }
  });
}

export function html(value: string) {
  return new Response(value, {
    headers: { 'content-type': 'text/html' }
  });
}

export function htmlAt(value: string, url: string) {
  const response = html(value);
  Object.defineProperty(response, 'url', { value: url });
  return response;
}

type Route = readonly [
  match: string | RegExp | { exact: string } | ((url: string, init?: RequestInit) => boolean),
  respond: Response | ((url: string, init?: RequestInit) => Response | Promise<Response>)
];

export function routeFetcher(routes: readonly Route[]) {
  const fetcher: Fetcher = async (input, init) => {
    const url = String(input);
    for (const [match, respond] of routes) {
      const matches =
        typeof match === 'function'
          ? match(url, init)
          : typeof match === 'string'
            ? url.includes(match)
            : match instanceof RegExp
              ? match.test(url)
              : url === match.exact;
      if (matches) {
        return typeof respond === 'function' ? respond(url, init) : respond.clone();
      }
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  return vi.fn(fetcher);
}

export const nodeSeekPayload = Buffer.from(
  JSON.stringify({
    rotateTopics: [
      {
        postId: 101,
        titleText: 'NodeSeek topic',
        titleLink: '/post-101-1',
        op: { name: 'alice', avatar: '/avatar.png' },
        category: { key: 'tech', name: '技术' },
        time: { createdDate: '2026-05-20T00:00:00.000Z' },
        updatedDate: '2026-05-20T01:00:00.000Z',
        comments: 2,
        views: '1.2k',
        content: 'NodeSeek body'
      }
    ],
    allCategory: [
      { key: 'tech', cn_text: '技术' },
      { key: 'admin', cn_text: '管理', adminOnly: true }
    ]
  })
).toString('base64');
