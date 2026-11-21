export const LINUX_DO_PACKET_ORIGIN = 'https://hb.lafi.sh';

function packetPath(url: string) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.origin !== LINUX_DO_PACKET_ORIGIN || parsed.username || parsed.password)
      return null;
    return decodeURIComponent(parsed.pathname);
  } catch {
    return null;
  }
}

// The author encodes each activity ID as a single emoji path segment.
const activityPath = /^\/🧧\/[^\p{ASCII}]+$/u;

export function isLinuxDoPacketCover(url: string) {
  const path = packetPath(url);
  const suffix = path && /\/🖼\uFE0F?(?:\.svg)?$/u.exec(path);
  return Boolean(path && suffix && activityPath.test(path.slice(0, suffix.index)));
}

export function isLinuxDoPacketPage(url: string) {
  const path = packetPath(url);
  return path === '/' || (path !== null && activityPath.test(path.replace(/\/$/, '')));
}

export function allowLinuxDoPacketNavigation(url: string) {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === 'https:' &&
      !parsed.username &&
      !parsed.password &&
      [LINUX_DO_PACKET_ORIGIN, 'https://connect.linux.do', 'https://linux.do'].includes(parsed.origin)
    );
  } catch {
    return false;
  }
}
