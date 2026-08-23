import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('react-native inline image events patch', () => {
  it('forwards the standard image events without patching ReactAndroid', () => {
    const patch = readFileSync(join(process.cwd(), 'patches', 'react-native+0.81.5.patch'), 'utf8');

    for (const handler of ['onLoadStart', 'onProgress', 'onLoad', 'onError', 'onLoadEnd']) {
      expect(patch).toContain(`${handler}={${handler}}`);
    }
    for (const event of ['topLoadStart', 'topProgress', 'topLoad', 'topError', 'topLoadEnd']) {
      expect(patch).toContain(event);
    }
    expect(patch).toContain('shouldNotifyLoadEvents={');
    expect(patch).not.toContain('ReactAndroid/');
  });
});
