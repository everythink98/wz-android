import { describe, expect, it } from 'vitest';
import {
  assertComposerClosed,
  assertComposerFullscreen,
  assertComposerReceipt,
  composerSafeTop,
  composerCases
} from '../../scripts/run-composer-device-proof.mjs';

describe('composer device evidence', () => {
  const expected = { token: 'run-a', buildId: 'build-a', closed: true };
  const receipt = {
    ...expected,
    isHermes: true,
    isDev: false,
    visible: false,
    content: '',
    busy: false,
    keyboardShown: false,
    confirmations: 1,
    requests: 1
  };
  const screen = { width: 10, height: 20, data: Buffer.alloc(10 * 20 * 4, 255) };
  it('requires the current run, Release Hermes, one confirmation and complete settlement', () => {
    expect(() => assertComposerReceipt(receipt, expected)).not.toThrow();
    for (const change of [
      { token: 'old' },
      { buildId: 'old' },
      { isDev: true },
      { isHermes: false },
      { visible: true },
      { content: 'old' },
      { busy: true },
      { keyboardShown: true },
      { confirmations: 0 },
      { requests: 2 }
    ])
      expect(() => assertComposerReceipt({ ...receipt, ...change }, expected)).toThrow();
  });
  it('rejects visible native residue or a remaining backdrop independently of settlement', () => {
    expect(() => assertComposerClosed([], screen, screen)).not.toThrow();
    expect(() => assertComposerClosed([{ label: 'Bottom Sheet', rect: { height: 9 } }], screen, screen)).toThrow();
    expect(() => assertComposerClosed([], screen, { ...screen, data: Buffer.alloc(screen.data.length, 0) })).toThrow();
  });
  it('rejects a top gap, unsafe toolbar or discontinuous status-bar background', () => {
    const nodes = [
      { label: 'Bottom Sheet', rect: { y: 0 } },
      { label: '收起回复', rect: { y: 3 } }
    ];
    expect(() => assertComposerFullscreen(nodes, screen, 3)).not.toThrow();
    expect(() => assertComposerFullscreen([{ ...nodes[0], rect: { y: 1 } }, nodes[1]], screen, 3)).toThrow();
    expect(() => assertComposerFullscreen(nodes, screen, 4)).toThrow();
    const image = { ...screen, data: Buffer.from(screen.data) };
    image.data[(1 * image.width + image.width - 2) * 4] = 0;
    expect(() => assertComposerFullscreen(nodes, image, 3)).toThrow();
  });
  it('uses effective cutout Insets and rejects an enabled overlay without a larger safe area', () => {
    const flat = 'type=statusBars frame=[0,0][1080,63]\nmDisplayCutout=DisplayCutout{insets=Rect(0, 0 - 0, 0)}';
    expect(composerSafeTop(flat)).toBe(63);
    expect(() => composerSafeTop(flat, true)).toThrow('no effective safe inset');
    expect(composerSafeTop(flat.replace('Rect(0, 0 -', 'Rect(0, 180 -'), true)).toBe(180);
    expect(composerSafeTop(flat.replace('[1080,63]', '[1080,180]').replace('Rect(0, 0 -', 'Rect(0, 180 -'), true)).toBe(
      180
    );
    expect(() => composerSafeTop('')).toThrow('geometry unavailable');
  });
  it('enumerates all sixteen structured reply success combinations', () => {
    const matrix = composerCases.filter((scenario) =>
      /^(nodeseek|linuxdo)-(rich|source)-(sheet|fullscreen)-(shown|hidden)$/.test(scenario.id)
    );
    expect(matrix).toHaveLength(16);
    expect(new Set(matrix.map((scenario) => scenario.id)).size).toBe(16);
  });
});
