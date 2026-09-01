import { describe, expect, it } from 'vitest';

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
});
