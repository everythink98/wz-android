export function sameMediaSequence<T>(left: readonly T[], right: readonly T[]) {
  return left === right || (left.length === right.length && left.every((item, index) => item === right[index]));
}
