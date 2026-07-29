import { Buffer } from 'buffer';
import type { ImageURISource } from 'react-native';
import { normalizeImagePreviewUrl } from './htmlImages';
import { fetchWithTimeout, type Fetcher } from './request';
import {
  fetchBoundedSvgDocument,
  renderSvgPoster,
  type SvgPosterRenderResult
} from './svgPosterRenderer';

const COMPATIBLE_SVG_ARTIFACT_CACHE_LIMIT = 32;
const COMPATIBLE_SVG_MAX_WORK_ITEMS = 32;
const COMPATIBLE_SVG_WORK_CONCURRENCY = 2;
const MAX_COMPATIBLE_SVG_BYTES = 1024 * 1024;
const COMPATIBLE_SVG_TIMEOUT_MS = 10_000;
const COMPATIBLE_SVG_TOTAL_TIMEOUT_MS = 30_000;

const compatibleSvgArtifactCache = new Map<string, CompatibleSvgArtifact>();
const compatibleSvgArtifactRequests = new Map<string, Promise<CompatibleSvgArtifact | null>>();
const compatibleSvgPosterRefreshes = new Map<string, Promise<CompatibleSvgArtifact>>();
const compatibleSvgWorkQueue: CompatibleSvgWorkItem[] = [];
let activeCompatibleSvgWorkItems = 0;
let nextPosterRevision = 1;

export type CompatibleSvgArtifact = Readonly<{
  animated: boolean;
  dimensions: Readonly<{ height: number; width: number }>;
  documentDataUri: string;
  posterRevision: number;
  posterSource: ImageURISource;
  requestIdentity: string;
}>;

type CompatibleSvgArtifactWithoutPoster = Omit<CompatibleSvgArtifact, 'posterRevision' | 'posterSource'>;

export type CompatibleSvgArtifactOptions = Readonly<{
  fetcher?: Fetcher;
  renderPoster?: (svgBase64: string, cacheKey: string, timeoutMs: number) => Promise<SvgPosterRenderResult>;
}>;

type CompatibleSvgWorkItem = Readonly<{
  deadlineAt: number;
  reject: (error: unknown) => void;
  resolve: (artifact: CompatibleSvgArtifact | null) => void;
  run: (deadlineAt: number) => Promise<CompatibleSvgArtifact | null>;
}>;

export function compatibleImageRequestIdentity(source: ImageURISource) {
  const uri = normalizeImagePreviewUrl(source.uri || '');
  const cacheKey = typeof (source as ImageURISource & { cacheKey?: unknown }).cacheKey === 'string'
    ? String((source as ImageURISource & { cacheKey?: string }).cacheKey)
    : '';
  const headers = Object.entries(source.headers || {})
    .map(([name, value]) => [name.toLowerCase(), String(value)] as const)
    .sort(([left], [right]) => left.localeCompare(right));
  return [uri, cacheKey, ...headers.map(([name, value]) => `${name}:${value}`)].join('\u0000');
}

export function cachedCompatibleSvgArtifact(source: ImageURISource) {
  const identity = compatibleImageRequestIdentity(source);
  const artifact = compatibleSvgArtifactCache.get(identity);
  if (!artifact) {
    return null;
  }
  compatibleSvgArtifactCache.delete(identity);
  compatibleSvgArtifactCache.set(identity, artifact);
  return artifact;
}

export function recoverCompatibleSvgArtifact(
  source: ImageURISource,
  options: CompatibleSvgArtifactOptions = {}
): Promise<CompatibleSvgArtifact | null> {
  const requestIdentity = compatibleImageRequestIdentity(source);
  const cached = cachedCompatibleSvgArtifact(source);
  if (cached) {
    return Promise.resolve(cached);
  }
  const pending = compatibleSvgArtifactRequests.get(requestIdentity);
  if (pending) {
    return pending;
  }
  const request = scheduleCompatibleSvgWork((deadlineAt) =>
    loadCompatibleSvgArtifact(source, requestIdentity, options, deadlineAt))
    .then((artifact) => {
      if (artifact) {
        rememberCompatibleSvgArtifact(requestIdentity, artifact);
      }
      return artifact;
    })
    .finally(() => {
      compatibleSvgArtifactRequests.delete(requestIdentity);
    });
  compatibleSvgArtifactRequests.set(requestIdentity, request);
  return request;
}

export function refreshCompatibleSvgPoster(
  artifact: CompatibleSvgArtifact,
  options: Pick<CompatibleSvgArtifactOptions, 'renderPoster'> = {}
): Promise<CompatibleSvgArtifact> {
  const pending = compatibleSvgPosterRefreshes.get(artifact.requestIdentity);
  if (pending) {
    return pending;
  }
  const request = scheduleCompatibleSvgWork(async (deadlineAt) => {
    const svgBase64 = svgBase64FromDocumentDataUri(artifact.documentDataUri);
    const remainingMs = remainingCompatibleSvgTime(deadlineAt);
    if (remainingMs <= 0) {
      return null;
    }
    const poster = await (options.renderPoster || renderSvgPoster)(
      svgBase64,
      stableSvgPosterKey(artifact.requestIdentity),
      remainingMs
    );
    return artifactWithPoster(artifact, poster);
  }).then((refreshed) => {
    if (!refreshed) {
      throw new Error('SVG 海报重建超时');
    }
    rememberCompatibleSvgArtifact(artifact.requestIdentity, refreshed);
    return refreshed;
  }).finally(() => {
    compatibleSvgPosterRefreshes.delete(artifact.requestIdentity);
  });
  compatibleSvgPosterRefreshes.set(artifact.requestIdentity, request);
  return request;
}

async function loadCompatibleSvgArtifact(
  source: ImageURISource,
  requestIdentity: string,
  options: CompatibleSvgArtifactOptions,
  deadlineAt: number
): Promise<CompatibleSvgArtifact | null> {
  const uri = normalizeImagePreviewUrl(source.uri || '');
  if (!/^https?:\/\//i.test(uri)) {
    return null;
  }
  const headers = {
    ...(source.headers || {}),
    Accept: 'image/svg+xml,image/*,*/*;q=0.8'
  };
  const fetchTimeoutMs = Math.min(
    COMPATIBLE_SVG_TIMEOUT_MS,
    remainingCompatibleSvgTime(deadlineAt)
  );
  if (fetchTimeoutMs <= 0) {
    return null;
  }
  const nativeDocument = options.fetcher
    ? undefined
    : await fetchBoundedSvgDocument(uri, headers, fetchTimeoutMs);
  const bytes = nativeDocument === undefined
    ? await fetchCompatibleSvgBytes(uri, headers, options.fetcher || fetch, fetchTimeoutMs)
    : nativeDocument && Buffer.from(nativeDocument.base64, 'base64');
  if (!bytes || bytes.length > MAX_COMPATIBLE_SVG_BYTES) {
    return null;
  }
  const svg = bytes.toString('utf8');
  if (!/<svg[\s>]/i.test(svg)) {
    return null;
  }
  const svgBase64 = bytes.toString('base64');
  const remainingMs = remainingCompatibleSvgTime(deadlineAt);
  if (remainingMs <= 0) {
    return null;
  }
  const poster = await (options.renderPoster || renderSvgPoster)(
    svgBase64,
    stableSvgPosterKey(requestIdentity),
    remainingMs
  );
  return artifactWithPoster({
    animated: isAnimatedSvg(svg),
    dimensions: { height: poster.documentHeight, width: poster.documentWidth },
    documentDataUri: `data:image/svg+xml;base64,${svgBase64}`,
    requestIdentity
  }, poster);
}

async function fetchCompatibleSvgBytes(
  uri: string,
  headers: Record<string, string>,
  fetcher: Fetcher,
  timeoutMs: number
) {
  const response = await fetchWithTimeout(uri, { headers }, {
    fetcher,
    timeoutMs
  });
  if (!response.ok || !isSvgContentType(response.headers.get('content-type'))) {
    return null;
  }
  const contentLength = positiveHeaderNumber(response.headers.get('content-length'));
  if (contentLength > MAX_COMPATIBLE_SVG_BYTES) {
    return null;
  }
  return boundedResponseBytes(response);
}

function artifactWithPoster(
  artifact: CompatibleSvgArtifactWithoutPoster | CompatibleSvgArtifact,
  poster: SvgPosterRenderResult
): CompatibleSvgArtifact {
  const posterRevision = nextPosterRevision;
  nextPosterRevision += 1;
  return {
    ...artifact,
    dimensions: { height: poster.documentHeight, width: poster.documentWidth },
    posterRevision,
    posterSource: {
      cacheKey: `wz-svg-poster:${poster.uri}:${posterRevision}`,
      height: poster.height,
      uri: poster.uri,
      width: poster.width
    } as ImageURISource
  };
}

function scheduleCompatibleSvgWork(
  run: CompatibleSvgWorkItem['run']
): Promise<CompatibleSvgArtifact | null> {
  if (activeCompatibleSvgWorkItems + compatibleSvgWorkQueue.length >= COMPATIBLE_SVG_MAX_WORK_ITEMS) {
    return Promise.reject(new Error('SVG 兼容队列已满'));
  }
  return new Promise((resolve, reject) => {
    compatibleSvgWorkQueue.push({
      deadlineAt: Date.now() + COMPATIBLE_SVG_TOTAL_TIMEOUT_MS,
      reject,
      resolve,
      run
    });
    drainCompatibleSvgWorkQueue();
  });
}

function drainCompatibleSvgWorkQueue() {
  while (
    activeCompatibleSvgWorkItems < COMPATIBLE_SVG_WORK_CONCURRENCY
    && compatibleSvgWorkQueue.length > 0
  ) {
    const item = compatibleSvgWorkQueue.shift();
    if (!item) {
      return;
    }
    if (remainingCompatibleSvgTime(item.deadlineAt) <= 0) {
      item.resolve(null);
      continue;
    }
    activeCompatibleSvgWorkItems += 1;
    void item.run(item.deadlineAt)
      .then(item.resolve, item.reject)
      .finally(() => {
        activeCompatibleSvgWorkItems -= 1;
        drainCompatibleSvgWorkQueue();
      });
  }
}

function remainingCompatibleSvgTime(deadlineAt: number) {
  return Math.max(0, deadlineAt - Date.now());
}

async function boundedResponseBytes(response: Response) {
  const blob = await response.blob();
  try {
    if (blob.size > MAX_COMPATIBLE_SVG_BYTES) {
      return null;
    }
    return Buffer.from(await readBlobArrayBuffer(blob));
  } finally {
    (blob as Blob & { close?: () => void }).close?.();
  }
}

function readBlobArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  const directReader = (blob as Blob & { arrayBuffer?: () => Promise<ArrayBuffer> }).arrayBuffer;
  if (typeof directReader === 'function') {
    return directReader.call(blob);
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) {
        resolve(reader.result);
      } else {
        reject(new Error('SVG 响应读取失败'));
      }
    };
    reader.onerror = () => reject(reader.error || new Error('SVG 响应读取失败'));
    reader.onabort = () => reject(new Error('SVG 响应读取已取消'));
    reader.readAsArrayBuffer(blob);
  });
}

function svgBase64FromDocumentDataUri(value: string) {
  const prefix = 'data:image/svg+xml;base64,';
  const encoded = value.startsWith(prefix) ? value.slice(prefix.length) : '';
  if (!encoded || !/^[a-z0-9+/]+={0,2}$/i.test(encoded)) {
    throw new Error('SVG artifact 内容无效');
  }
  return encoded;
}

function rememberCompatibleSvgArtifact(identity: string, artifact: CompatibleSvgArtifact) {
  compatibleSvgArtifactCache.delete(identity);
  if (compatibleSvgArtifactCache.size >= COMPATIBLE_SVG_ARTIFACT_CACHE_LIMIT) {
    const oldestIdentity = compatibleSvgArtifactCache.keys().next().value;
    if (oldestIdentity) {
      compatibleSvgArtifactCache.delete(oldestIdentity);
    }
  }
  compatibleSvgArtifactCache.set(identity, artifact);
}

function isAnimatedSvg(svg: string) {
  const animationSource = svg
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  if (/<(?:[A-Za-z_][\w.-]*:)?(?:animate(?:color|motion|transform)?|discard|set)(?=[\s/>])/i.test(animationSource)) {
    return true;
  }
  const cssAnimation = /(?:^|[;{"'])\s*(?:-\w+-)?(animation(?:-name)?)\s*:\s*([^;}"']*)/gim;
  for (const declaration of animationSource.matchAll(cssAnimation)) {
    const property = declaration[1].toLowerCase();
    const value = declaration[2].trim().replace(/\s*!important\s*$/i, '');
    if (property.endsWith('-name')) {
      if (value.split(',').some((name) => !CSS_ANIMATION_NAME_RESET_TOKENS.has(name.trim().toLowerCase()))) {
        return true;
      }
      continue;
    }
    const withoutTimingFunctions = value.replace(/\b(?:cubic-bezier|linear|scroll|steps|view)\([^)]*\)/gi, ' ');
    const withoutNumbers = withoutTimingFunctions.replace(
      /(^|[\s,(])[-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?(?:ms|s)?(?=$|[\s,)])/gi,
      '$1'
    );
    const identifiers = withoutNumbers.match(/-?[A-Za-z_][\w-]*/g) || [];
    if (identifiers.some((identifier) => !CSS_ANIMATION_NON_NAME_TOKENS.has(identifier.toLowerCase()))) {
      return true;
    }
  }
  return false;
}

const CSS_ANIMATION_NAME_RESET_TOKENS = new Set([
  'inherit', 'initial', 'none', 'revert', 'revert-layer', 'unset'
]);

const CSS_ANIMATION_NON_NAME_TOKENS = new Set([
  'accumulate', 'add', 'alternate', 'alternate-reverse', 'auto', 'backwards', 'both',
  'ease', 'ease-in', 'ease-in-out', 'ease-out', 'forwards',
  'infinite', 'inherit', 'initial',
  'linear', 'none', 'normal', 'paused', 'replace', 'reverse', 'revert', 'revert-layer',
  'running', 'step-end', 'step-start', 'unset'
]);

function stableSvgPosterKey(value: string) {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
  }
  return `svg-${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0).toString(16).padStart(8, '0')}`;
}

function isSvgContentType(value: string | null) {
  return /(?:^|;|\s)(?:image|application)\/svg\+xml(?:;|\s|$)/i.test(value || '');
}

function positiveHeaderNumber(value: string | null) {
  const parsed = value ? Number(value) : 0;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}
