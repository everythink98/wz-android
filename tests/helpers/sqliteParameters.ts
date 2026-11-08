export function sqliteParameters(args: unknown[]) {
  return (Array.isArray(args[0]) ? args[0] : args) as (string | number | null)[];
}
