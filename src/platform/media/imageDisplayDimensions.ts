export type CachedImageDimensions = { height: number; width: number };

const IMAGE_DIMENSIONS_CACHE_LIMIT = 512;
const imageDimensionsByIdentity = new Map<string, CachedImageDimensions>();

export function cachedImageDisplayDimensions(cacheKey: string) {
  return imageDimensionsByIdentity.get(cacheKey);
}

export function rememberImageDisplayDimensions(cacheKey: string, dimensions: CachedImageDimensions) {
  imageDimensionsByIdentity.delete(cacheKey);
  imageDimensionsByIdentity.set(cacheKey, dimensions);
  if (imageDimensionsByIdentity.size > IMAGE_DIMENSIONS_CACHE_LIMIT) {
    imageDimensionsByIdentity.delete(imageDimensionsByIdentity.keys().next().value!);
  }
}
