export function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
