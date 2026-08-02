import { useEffect } from 'react';
import { BackHandler } from 'react-native';
import type { Screen } from '@/ui/navigation/types';
import { beginDiagnosticTrace, finishDiagnosticTrace, markDiagnosticStage } from '@/platform/diagnostics/diagnostics';
import { isReadingSettingsScreen } from './appNavigation';

export function useAppBackHandler({
  changeScreen,
  closeTopmostAccountSurface,
  getCurrentScreen
}: {
  changeScreen: (screen: Screen) => void;
  closeTopmostAccountSurface: () => string | null;
  getCurrentScreen: () => Screen;
}) {
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      const currentScreen = getCurrentScreen();
      const trace = beginDiagnosticTrace('navigation', 'hardware-back', { screen: currentScreen });
      const closedSurface = closeTopmostAccountSurface();
      if (closedSurface) {
        markDiagnosticStage(trace, 'guard', { state: closedSurface });
        finishDiagnosticTrace(trace, 'success', { state: closedSurface });
        return true;
      }
      if (currentScreen === 'topic' || currentScreen === 'user' || isReadingSettingsScreen()) {
        finishDiagnosticTrace(trace, 'noop', { state: 'native-stack-back' });
        return false;
      }
      if (currentScreen !== 'feed') {
        changeScreen('feed');
        markDiagnosticStage(trace, 'guard', { state: 'feed-return' });
        finishDiagnosticTrace(trace, 'success', { state: 'feed-return' });
        return true;
      }
      finishDiagnosticTrace(trace, 'noop', { state: 'system-back' });
      return false;
    });
    return () => subscription.remove();
  }, [changeScreen, closeTopmostAccountSurface, getCurrentScreen]);
}
