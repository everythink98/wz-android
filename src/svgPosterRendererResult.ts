export type SvgPosterRenderResult = Readonly<{
  documentHeight: number;
  documentWidth: number;
  height: number;
  uri: string;
  width: number;
}>;

export type BoundedSvgDocumentResult = Readonly<{
  base64: string;
}>;

export function assertSvgPosterRenderResult(result: SvgPosterRenderResult): SvgPosterRenderResult {
  if (
    !result
    || typeof result.uri !== 'string'
    || !result.uri.startsWith('file://')
    || !Number.isFinite(result.documentWidth)
    || result.documentWidth <= 0
    || !Number.isFinite(result.documentHeight)
    || result.documentHeight <= 0
    || !Number.isFinite(result.width)
    || result.width <= 0
    || !Number.isFinite(result.height)
    || result.height <= 0
  ) {
    throw new Error('SVG 海报渲染结果无效');
  }
  return result;
}
