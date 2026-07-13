import { createContext, useContext, useEffect, useState, type PropsWithChildren } from 'react';
import { AppState } from 'react-native';
import { useIsFocused } from '@react-navigation/native';

const ForumMediaPlaybackContext = createContext(true);

export function ForumMediaPlaybackProvider({ active, children }: PropsWithChildren<{ active: boolean }>) {
  return <ForumMediaPlaybackContext.Provider value={active}>{children}</ForumMediaPlaybackContext.Provider>;
}

export function useForumMediaPlaybackActive() {
  const itemActive = useContext(ForumMediaPlaybackContext);
  const routeFocused = useIsFocused();
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      setAppActive(state === 'active');
    });
    return () => subscription.remove();
  }, []);

  return itemActive && routeFocused && appActive;
}
