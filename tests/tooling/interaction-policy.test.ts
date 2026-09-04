import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function productionSources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return productionSources(target);
    return /\.(?:css|tsx?)$/.test(entry.name) && !/\.test\.[^.]+$/.test(entry.name) ? [target] : [];
  });
}

describe('ordinary interaction policy', () => {
  it('keeps production presses free of library-added feedback', () => {
    const offenders = productionSources(path.join(process.cwd(), 'src')).filter((file) =>
      /android_ripple|\bandroidRipple\b|expo-haptics|pressWithFeedback|triggerPressFeedback|\(\{\s*pressed\s*\}\)\s*=>/.test(
        readFileSync(file, 'utf8')
      )
    );

    expect(offenders.map((file) => path.relative(process.cwd(), file))).toEqual([]);
    expect(JSON.parse(readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')).dependencies).not.toHaveProperty(
      'expo-haptics'
    );

    const navigator = readFileSync(path.join(process.cwd(), 'src/app/AppNavigator.tsx'), 'utf8');
    expect(navigator).toContain('tabBarButton: QuietTabBarButton');
    expect(navigator).toContain('headerLeft:');
  });

  it('keeps Composer pointer state changes immediate and quiet', () => {
    const css = readFileSync(path.join(process.cwd(), 'src/ui/composer/editorRuntime.css'), 'utf8');

    expect(css).not.toMatch(/:hover|:active|\btransition:|\banimation:|@keyframes/);
  });
});
