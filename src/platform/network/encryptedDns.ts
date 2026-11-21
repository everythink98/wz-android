const publicEncryptedDnsProviders = [
  { id: 'dnspod', label: 'DNSPod', endpoint: 'https://doh.pub/dns-query' },
  {
    id: 'cloudflare',
    label: 'Cloudflare',
    endpoint: 'https://cloudflare-dns.com/dns-query',
    bootstrap: ['1.1.1.1', '1.0.0.1', '2606:4700:4700::1111', '2606:4700:4700::1001']
  },
  {
    id: 'google',
    label: 'Google Public DNS',
    endpoint: 'https://dns.google/dns-query',
    bootstrap: ['8.8.8.8', '8.8.4.4', '2001:4860:4860::8888', '2001:4860:4860::8844']
  },
  { id: 'dnssb', label: 'DNS.SB', endpoint: 'https://doh.dns.sb/dns-query' },
  { id: '360', label: '360 安全 DNS', endpoint: 'https://doh.360.cn/dns-query' },
  { id: '18bit', label: '18bit', endpoint: 'https://doh.18bit.cn/dns-query' },
  { id: 'onedns', label: 'OneDNS 拦截版', endpoint: 'https://doh.onedns.net/dns-query' },
  {
    id: 'cfluxdo',
    label: 'CFluxDo 公共加速',
    endpoint: 'https://edge.1molchuan.top/linuxdo',
    bootstrap: ['156.239.232.8', '156.239.232.72', '203.168.131.145', '103.199.103.204']
  }
] as const;

export const encryptedDnsProviders = [
  { id: 'auto', label: '自动选择' },
  ...publicEncryptedDnsProviders,
  { id: 'custom', label: '自定义' }
] as const;

export type EncryptedDnsProvider = (typeof encryptedDnsProviders)[number]['id'];

export type EncryptedDnsSettings = {
  provider: EncryptedDnsProvider;
  policy: 'prefer' | 'strict';
  customEndpoint?: string;
  customBootstrap?: string[];
};

type EncryptedDnsEndpoint = {
  endpoint: string;
  bootstrap: readonly string[];
};

export type EncryptedDnsRoute = (
  EncryptedDnsEndpoint | { providers: readonly (EncryptedDnsEndpoint & { id: string })[] }
) & {
  allowFallback: boolean;
};

export const encryptedDnsResults = {
  encrypted: '最近使用加密 DNS 解析',
  'system-dns': '解析服务暂不可用，最近已回退系统 DNS',
  'system-proxy': '最近连接由系统代理解析',
  'proxy-conflict': '系统代理与「仅 DoH」冲突',
  'tls-failure': '解析服务的 TLS 校验失败',
  'dns-failure': '解析失败，请检查服务商或网络',
  'site-failure': '论坛 HTTPS 直连暂不可用'
} as const;

export function encryptedDnsProviderLabel(id: unknown) {
  return publicEncryptedDnsProviders.find((item) => item.id === id)?.label;
}

export function encryptedDnsResultLabel(value: unknown) {
  if (value && typeof value === 'object' && 'provider' in value) {
    const label = encryptedDnsProviderLabel(value.provider);
    if (label) return `${encryptedDnsResults.encrypted} · ${label}`;
    return undefined;
  }
  return Object.entries(encryptedDnsResults).find(([key]) => key === value)?.[1];
}

export function normalizeEncryptedDnsSettings(value: unknown): EncryptedDnsSettings {
  if (!value || typeof value !== 'object' || !('provider' in value) || !('policy' in value))
    throw new Error('请选择加密 DNS 服务商。');
  const provider = encryptedDnsProviders.find((item) => item.id === value.provider);
  if (!provider || (value.policy !== 'prefer' && value.policy !== 'strict')) {
    throw new Error('请确认加密 DNS 服务商与回退策略。');
  }
  const customEndpoint =
    'customEndpoint' in value && typeof value.customEndpoint === 'string' ? value.customEndpoint.trim() : '';
  const customBootstrap = 'customBootstrap' in value ? value.customBootstrap : undefined;
  if (customEndpoint || provider.id === 'custom') {
    let url: URL;
    try {
      url = new URL(customEndpoint);
    } catch {
      throw new Error('请输入有效的 HTTPS DNS 地址。');
    }
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      customEndpoint.includes('#') ||
      url.searchParams.has('dns') ||
      customEndpoint.length > 2048
    ) {
      throw new Error('请输入有效的 HTTPS DNS 地址。');
    }
  }
  if (
    customBootstrap !== undefined &&
    (!Array.isArray(customBootstrap) ||
      customBootstrap.length > 8 ||
      customBootstrap.some((address: unknown) => typeof address !== 'string' || !isNumericIp(address)))
  ) {
    throw new Error('引导地址只能填写 IPv4 或 IPv6，最多 8 个。');
  }
  return {
    provider: provider.id,
    policy: value.policy,
    ...(customEndpoint ? { customEndpoint } : {}),
    ...(customBootstrap?.length ? { customBootstrap: [...new Set<string>(customBootstrap)] } : {})
  };
}

function isNumericIp(value: string) {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(value)) return value.split('.').every((part) => Number(part) <= 255);
  if (!value.includes(':') || !/^[\da-f:.]+$/i.test(value)) return false;
  try {
    return Boolean(new URL(`https://[${value}]/`).hostname);
  } catch {
    return false;
  }
}

export function encryptedDnsRoute(settings: EncryptedDnsSettings): EncryptedDnsRoute {
  const allowFallback = settings.policy === 'prefer';
  if (settings.provider === 'auto') {
    const providers = publicEncryptedDnsProviders.map((provider) => ({
      id: provider.id,
      endpoint: provider.endpoint,
      bootstrap: 'bootstrap' in provider ? provider.bootstrap : []
    }));
    return { providers, allowFallback };
  }
  const provider = publicEncryptedDnsProviders.find((item) => item.id === settings.provider);
  return provider
    ? { endpoint: provider.endpoint, bootstrap: 'bootstrap' in provider ? provider.bootstrap : [], allowFallback }
    : { endpoint: settings.customEndpoint || '', bootstrap: settings.customBootstrap || [], allowFallback };
}
