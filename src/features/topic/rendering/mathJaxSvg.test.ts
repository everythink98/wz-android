import { HTMLHandler } from '@mathjax/src/js/handlers/html/HTMLHandler.js';
import { describe, expect, it, vi } from 'vitest';

import { renderMathJaxSvg } from './mathJaxSvg';

describe('MathJax SVG rendering', () => {
  it('renders the live formulas and common TeX ranges through one offline renderer', async () => {
    const formulas = [
      '(3362 - 2) \\times 24 = 80{,}640',
      '(3362 - 2) \\times 24 + (8 \\times 24) = 80{,}832',
      '\\frac{\\mathbb{R} + \\mathcal{L}}{\\alpha} \\longrightarrow \\begin{bmatrix}1&2\\\\3&4\\end{bmatrix}',
      '\\mathsf{ABC}',
      '\\mathtt{ABC}',
      'x=1\\tag{1}'
    ];

    const results = await Promise.all(formulas.map((formula) => renderMathJaxSvg(formula, true)));

    for (const result of results) {
      expect(result.xml).toMatch(/^<svg\b/);
      expect(result.xml).toContain('<path');
      expect(result.viewBox).toMatch(/^[-\d.]+ [-\d.]+ [\d.]+ [\d.]+$/);
      expect(result.widthEx).toBeGreaterThan(0);
      expect(result.heightEx).toBeGreaterThan(0);
    }
    expect(new Set(results.map((result) => result.xml)).size).toBe(formulas.length);
  });

  it('keeps inline baseline metrics and rejects malformed TeX', async () => {
    const inline = await renderMathJaxSvg('x^2 + y^2', false);

    expect(inline.verticalAlignEx).toBeLessThanOrEqual(0);
    await expect(renderMathJaxSvg('\\frac{', true)).rejects.toThrow();
  });

  it('keeps macro definitions local to each formula, including a formula that fails', async () => {
    const before = await renderMathJaxSvg('\\readerterm', false);
    const [defined, following] = await Promise.all([
      renderMathJaxSvg('\\newcommand{\\readerterm}{x}\\readerterm', false),
      renderMathJaxSvg('\\readerterm', false)
    ]);
    expect(defined.viewBox).toBe((await renderMathJaxSvg('x', false)).viewBox);
    expect(defined.viewBox).not.toBe(before.viewBox);
    expect(following.xml).toBe(before.xml);

    await expect(renderMathJaxSvg('\\def\\readerterm{y}\\frac{', false)).rejects.toThrow();
    expect((await renderMathJaxSvg('\\readerterm', false)).xml).toBe(before.xml);
  });

  it('retries a failed initialization on the next conversion', async () => {
    vi.resetModules();
    const { renderMathJaxSvg: render } = await import('./mathJaxSvg');
    const create = vi.spyOn(HTMLHandler.prototype, 'create').mockImplementationOnce(() => {
      throw new Error('Initialization failed');
    });
    try {
      await expect(render('x', false)).rejects.toThrow('Initialization failed');
      expect((await render('x', false)).xml).toContain('<path');
    } finally {
      create.mockRestore();
    }
  });
});
