let nextByte = 0;

export function getRandomValues<T extends Uint8Array>(values: T): T {
  for (let index = 0; index < values.length; index += 1) {
    nextByte = (nextByte + 1) & 0xff;
    values[index] = nextByte;
  }
  return values;
}
