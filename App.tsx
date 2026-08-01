import 'react-native-gesture-handler';
import 'expo-dev-client';
import { QueryClientProvider } from '@tanstack/react-query';
import { AppRoot } from '@/app/AppRoot';
import { appQueryClient } from '@/platform/query/serverState';

export default function App() {
  return (
    <QueryClientProvider client={appQueryClient}>
      <AppRoot />
    </QueryClientProvider>
  );
}
