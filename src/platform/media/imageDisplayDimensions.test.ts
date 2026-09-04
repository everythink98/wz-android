import { describe, expect, it } from 'vitest';
import { cachedImageDisplayDimensions, rememberImageDisplayDimensions } from './imageDisplayDimensions';

describe('image display dimensions', () => {
  it('bounds dimensions with isolated identities and committed LRU promotion', () => {
    rememberImageDisplayDimensions('nodeseek:1:https://img.example.com/shared.png', { height: 4, width: 5 });
    expect(cachedImageDisplayDimensions('nodeseek:2:https://img.example.com/shared.png')).toBeUndefined();

    for (let index = 0; index < 2_048; index += 1) {
      rememberImageDisplayDimensions(`session:lru-${index}`, { height: index + 1, width: index + 2 });
    }
    const firstDimensions = cachedImageDisplayDimensions('session:lru-0');
    expect(firstDimensions).toEqual({ height: 1, width: 2 });

    rememberImageDisplayDimensions('session:lru-overflow', { height: 9, width: 10 });

    expect(cachedImageDisplayDimensions('session:lru-0')).toBeUndefined();
    const promotedDimensions = cachedImageDisplayDimensions('session:lru-1');
    expect(promotedDimensions).toEqual({ height: 2, width: 3 });
    rememberImageDisplayDimensions('session:lru-1', promotedDimensions!);
    rememberImageDisplayDimensions('session:lru-second-overflow', { height: 11, width: 12 });

    expect(cachedImageDisplayDimensions('session:lru-1')).toEqual({ height: 2, width: 3 });
    expect(cachedImageDisplayDimensions('session:lru-2')).toBeUndefined();
  });
});
