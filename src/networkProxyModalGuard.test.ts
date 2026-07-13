import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const rootDir = path.resolve(__dirname, '..');

function readSource(...parts: string[]) {
  return readFileSync(path.join(rootDir, ...parts), 'utf8').replaceAll('\r\n', '\n');
}

describe('network proxy modal guard', () => {
  it('never renders a saved proxy password as plain text', () => {
    const source = readSource('src', 'screens', 'more', 'NetworkProxyModal.tsx');

    expect(source).toMatch(/<ProxyInput\s+label="密码"[\s\S]*?secureTextEntry/);
    expect(source).toContain('secureTextEntry={secureTextEntry}');
    expect(source).toContain("accessibilityValue={secureTextEntry ? { text: value ? '已填写' : '未填写' } : undefined}");
    expect(source).toContain("password: profile.password ? '••••••••' : ''");
    expect(source).not.toContain("password: profile.password || ''");
  });

  it('keeps latency testing on the status hit area without selecting the row', () => {
    const source = readSource('src', 'screens', 'more', 'NetworkProxyModal.tsx');

    expect(source).toContain("const canTestLatency = !selecting && testingId !== profile.id && applyStatus !== 'applying' && pendingEnabled === null;");
    expect(source).toContain("event.stopPropagation();");
    expect(source).toContain("`${status}${latency ? ` · Ping: ${latency}` : ' · 测试延迟'}`");
    expect(source).toContain('const { [draftProfile.id]: _removed, ...rest } = current;');
  });

  it('shows the saved proxy name before the address in the profile list', () => {
    const source = readSource('src', 'screens', 'more', 'NetworkProxyModal.tsx');
    const nameIndex = source.indexOf('{profile.name}</Text>');
    const addressIndex = source.indexOf('{profile.host}:{profile.port} · {statusText}</Text>');

    expect(nameIndex).toBeGreaterThanOrEqual(0);
    expect(addressIndex).toBeGreaterThan(nameIndex);
  });

  it('resets the proxy draft sheet when the Android keyboard hides', () => {
    const source = readSource('src', 'screens', 'more', 'NetworkProxyModal.tsx');

    expect(source).not.toContain('KeyboardAvoidingView');
    expect(source).toContain("const hideSubscription = Keyboard.addListener('keyboardDidHide', () => {\n      Keyboard.dismiss();\n      setDraftKeyboardInset(0);\n    });");
  });
});
