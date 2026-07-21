import 'react-native-gesture-handler';
import 'expo-dev-client';
import { QueryClientProvider } from '@tanstack/react-query';
import { AppRoot } from './src/app/AppRoot';
import { appQueryClient } from './src/app/serverState';

export default function App() {
  return (
    <QueryClientProvider client={appQueryClient}>
      <AppRoot />
    </QueryClientProvider>
  );
}
