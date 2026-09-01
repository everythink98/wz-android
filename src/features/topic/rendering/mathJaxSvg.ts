import { MathJaxNewcmFont } from '@mathjax/mathjax-newcm-font/js/svg.js';
import './mathJaxNewcmSvgRanges';
import { liteAdaptor } from '@mathjax/src/js/adaptors/liteAdaptor.js';
import { RegisterHTMLHandler } from '@mathjax/src/js/handlers/html.js';
import { TeX } from '@mathjax/src/js/input/tex.js';
import '@mathjax/src/js/input/tex/ams/AmsConfiguration.js';
import '@mathjax/src/js/input/tex/base/BaseConfiguration.js';
import '@mathjax/src/js/input/tex/newcommand/NewcommandConfiguration.js';
import '@mathjax/src/js/input/tex/noundefined/NoUndefinedConfiguration.js';
import { mathjax } from '@mathjax/src/js/mathjax.js';
import { SVG } from '@mathjax/src/js/output/svg.js';

const EM = 16;
const EX = 8;
const CONTAINER_WIDTH = EM * 80;

// Metro cannot resolve MathJax's computed import() paths. The ranges above register
// their package-local data, and this synchronous no-op lets MathJax apply that data.
mathjax.asyncLoad = async () => undefined;
mathjax.asyncIsSynchronous = true;

function createRenderer() {
  const adaptor = liteAdaptor({ fontSize: EM });
  RegisterHTMLHandler(adaptor);
  const input = new TeX({
    packages: ['base', 'ams', 'newcommand', 'noundefined'],
    formatError(_jax: unknown, error: unknown) {
      throw error instanceof Error ? error : new Error(String(error));
    }
  });
  const output = new SVG({ exFactor: EX / EM, fontCache: 'none', fontData: MathJaxNewcmFont });
  return { adaptor, document: mathjax.document('', { InputJax: input, OutputJax: output }) };
}

let rendererPromise: Promise<ReturnType<typeof createRenderer>> | undefined;

function getRenderer() {
  rendererPromise ||= Promise.resolve().then(createRenderer);
  return rendererPromise;
}

export type MathJaxSvgResult = {
  heightEx: number;
  verticalAlignEx: number;
  viewBox: string;
  widthEx: number;
  xml: string;
};

function exValue(value: unknown, label: string) {
  const match = String(value || '')
    .trim()
    .match(/^(-?(?:\d+(?:\.\d+)?|\.\d+))ex$/);
  const number = match ? Number(match[1]) : Number.NaN;
  if (!Number.isFinite(number)) throw new Error(`MathJax SVG ${label} 不正确`);
  return number;
}

function widthExValue(value: unknown) {
  const width = String(value || '').trim();
  const percentage = width.match(/^(\d+(?:\.\d+)?|\.\d+)%$/);
  return percentage ? (CONTAINER_WIDTH / EX) * (Number(percentage[1]) / 100) : exValue(width, '宽度');
}

export async function renderMathJaxSvg(source: string, display: boolean): Promise<MathJaxSvgResult> {
  const formula = source.trim();
  if (!formula) throw new Error('公式内容为空');
  const { adaptor, document } = await getRenderer();
  const container = await document.convertPromise(formula, {
    containerWidth: CONTAINER_WIDTH,
    display,
    em: EM,
    ex: EX
  });
  const svg = adaptor.firstChild(container) as Parameters<typeof adaptor.getAttribute>[0];
  if (!svg || adaptor.kind(svg) !== 'svg') throw new Error('MathJax 未生成 SVG');
  const viewBox = String(
    adaptor.getAttribute(svg, 'viewBox') || adaptor.getAttribute(svg, 'data-mjx-viewBox') || ''
  ).trim();
  if (!/^-?(?:\d+(?:\.\d+)?|\.\d+)(?: -?(?:\d+(?:\.\d+)?|\.\d+)){3}$/.test(viewBox)) {
    throw new Error('MathJax SVG viewBox 不正确');
  }
  return {
    heightEx: exValue(adaptor.getAttribute(svg, 'height'), '高度'),
    verticalAlignEx: exValue(adaptor.getStyle(svg, 'vertical-align') || '0ex', '基线'),
    viewBox,
    widthEx: widthExValue(adaptor.getAttribute(svg, 'width')),
    xml: adaptor.serializeXML(svg)
  };
}
