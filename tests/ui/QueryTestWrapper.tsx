import type { PropsWithChildren } from 'react';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { appQueryClient } from '@/platform/query/serverState';

export function createQueryTestWrapper(client: QueryClient) {
  return function QueryTestWrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

export const QueryTestWrapper = createQueryTestWrapper(appQueryClient);
