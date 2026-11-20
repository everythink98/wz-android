import { useContext, useEffect } from 'react';
import { NavigationContext } from '@react-navigation/native';
import { BackHandler } from 'react-native';

export function useCloseOnBack(enabled: boolean, setOpen: (open: false) => void) {
  const navigation = useContext(NavigationContext);
  useEffect(() => {
    if (!enabled) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (navigation?.isFocused() === false) return false;
      setOpen(false);
      return true;
    });
    return () => subscription.remove();
  }, [enabled, navigation, setOpen]);
}
