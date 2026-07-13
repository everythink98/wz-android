import { useEffect, useState } from 'react';
import { Dimensions } from 'react-native';

export function useAppWindowWidth() {
  const [width, setWidth] = useState(() => Dimensions.get('window').width);

  useEffect(() => {
    const subscription = Dimensions.addEventListener('change', ({ window }) => {
      setWidth((current) => current === window.width ? current : window.width);
    });
    return () => subscription.remove();
  }, []);

  return width;
}
