import { describe, expect, it } from 'vitest';

import { textContentFromHtml } from './localHtml';

describe('Android local HTML helpers', () => {
  it('extracts visible text without script or style contents', () => {
    expect(textContentFromHtml('<style>.x{color:red}</style><p>A&nbsp;B<br>C</p><script>alert(1)</script>')).toBe('A B C');
  });
});
