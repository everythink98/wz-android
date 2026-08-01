import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const rootDir = path.resolve(__dirname, '../..');

function readSource(...parts: string[]) {
  return readFileSync(path.join(rootDir, ...parts), 'utf8').replaceAll('\r\n', '\n');
}

describe('network proxy modal guard', () => {
  it('[REG-PROXY-005] keeps connectivity testing on the status hit area without selecting the row', () => {
    const source = readSource('src', 'features', 'more', 'components', 'NetworkProxyModal.tsx');

    expect(source).toMatch(
      /const canTestLatency\s*=\s*!selecting\s*&&\s*testingId !== profile\.id\s*&&\s*applyStatus !== 'applying'\s*&&\s*pendingEnabled === null;/
    );
    expect(source).toContain('event.stopPropagation();');
    expect(source).toContain("`${status}${latency ? ` · 连通性: ${latency}` : ' · 连通性测试'}`");
    expect(source).toContain('const { [draftProfile.id]: _removed, ...rest } = current;');
  });

  it('shows the saved proxy name before the address in the profile list', () => {
    const source = readSource('src', 'features', 'more', 'components', 'NetworkProxyModal.tsx');
    const nameIndex = source.search(/\{profile\.name\}\s*<\/Text>/);
    const addressIndex = source.search(/\{profile\.host\}:\{profile\.port\} · \{statusText\}\s*<\/Text>/);

    expect(nameIndex).toBeGreaterThanOrEqual(0);
    expect(addressIndex).toBeGreaterThan(nameIndex);
  });

  it('resets the proxy draft sheet when the Android keyboard hides', () => {
    const source = readSource('src', 'features', 'more', 'components', 'NetworkProxyModal.tsx');

    expect(source).not.toContain('KeyboardAvoidingView');
    expect(source).toContain(
      "const hideSubscription = Keyboard.addListener('keyboardDidHide', () => {\n      Keyboard.dismiss();\n      setDraftKeyboardInset(0);\n    });"
    );
  });
});
