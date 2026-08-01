import type { PropsWithChildren } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { appQueryClient } from '@/platform/query/serverState';

export function QueryTestWrapper({ children }: PropsWithChildren) {
  return <QueryClientProvider client={appQueryClient}>{children}</QueryClientProvider>;
}
