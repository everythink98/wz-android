import type { BoundedSvgDocumentResult, SvgPosterRenderResult } from './svgPosterRendererResult';

export async function fetchBoundedSvgDocument(
  _url: string,
  _headers: Record<string, string>,
  _timeoutMs: number
): Promise<BoundedSvgDocumentResult | null | undefined> {
  return undefined;
}

export async function renderSvgPoster(
  _svgBase64: string,
  _cacheKey: string,
  _timeoutMs: number
): Promise<SvgPosterRenderResult> {
  throw new Error('SVG 海报渲染器不可用');
}

export type { SvgPosterRenderResult } from './svgPosterRendererResult';
