export function isNodeSeekHost(hostname: string) {
  const host = hostname.toLowerCase();
  return host === 'nodeseek.com' || host.endsWith('.nodeseek.com');
}
