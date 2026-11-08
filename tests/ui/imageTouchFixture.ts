import type { MeasureOnSuccessCallback } from 'react-native';

export function createImageTouch() {
  const target = { measure: (callback: MeasureOnSuccessCallback) => callback(0, 0, 320, 240, 0, 0) };
  const touch = (x: number, count: number) => {
    const point = (identifier: number) => ({ identifier, pageX: x, pageY: 60 + identifier * 40 });
    return {
      currentTarget: target,
      target,
      persist: () => undefined,
      stopPropagation: () => undefined,
      nativeEvent: {
        ...point(0),
        touches: Array.from({ length: count }, (_, index) => point(index)),
        changedTouches: [point(count === 2 ? 1 : 0)]
      }
    };
  };
  return { target, touch };
}
