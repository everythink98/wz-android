import { NativeModules } from 'react-native';
import {
  assertSvgPosterRenderResult,
  type BoundedSvgDocumentResult,
  type SvgPosterRenderResult
} from './svgPosterRendererResult';

type SvgRendererNativeModule = {
  fetchSvgDocument?: (
    url: string,
    headers: Record<string, string>,
    timeoutMs: number
  ) => Promise<BoundedSvgDocumentResult | null>;
  renderPoster?: (svgBase64: string, cacheKey: string, timeoutMs: number) => Promise<SvgPosterRenderResult>;
};

export async function fetchBoundedSvgDocument(
  url: string,
  headers: Record<string, string>,
  timeoutMs: number
): Promise<BoundedSvgDocumentResult | null> {
  const module = NativeModules.SvgRendererModule as SvgRendererNativeModule | undefined;
  if (typeof module?.fetchSvgDocument !== 'function') {
    throw new Error('SVG 有界读取器不可用');
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error('SVG 读取时限无效');
  }
  const result = await module.fetchSvgDocument(url, headers, timeoutMs);
  if (!result) {
    return null;
  }
  if (
    typeof result.base64 !== 'string' ||
    result.base64.length > 1_398_104 ||
    !/^[a-z0-9+/]+={0,2}$/i.test(result.base64)
  ) {
    throw new Error('SVG 有界读取结果无效');
  }
  return result;
}

export async function renderSvgPoster(
  svgBase64: string,
  cacheKey: string,
  timeoutMs: number
): Promise<SvgPosterRenderResult> {
  const module = NativeModules.SvgRendererModule as SvgRendererNativeModule | undefined;
  if (typeof module?.renderPoster !== 'function') {
    throw new Error('SVG 海报渲染器不可用');
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error('SVG 海报渲染时限无效');
  }
  return assertSvgPosterRenderResult(await module.renderPoster(svgBase64, cacheKey, timeoutMs));
}

export type { SvgPosterRenderResult } from './svgPosterRendererResult';
