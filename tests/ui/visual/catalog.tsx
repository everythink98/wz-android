import { useMemo } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StyleSheet, Text, View } from 'react-native';
import { createEmptyReaderData } from '@/domain/reader/readerData';
import { ReaderStyleProvider } from '@/ui/theme/ReaderStyleProvider';
import { createTheme } from '@/ui/theme/tokens';
import { accountVisualScenarios } from './scenarios/account/manifest';
import { dataVisualScenarios } from './scenarios/data/manifest';
import { feedVisualScenarios } from './scenarios/feed/manifest';
import { libraryVisualScenarios } from './scenarios/library/manifest';
import { moreVisualScenarios } from './scenarios/more/manifest';
import { navVisualScenarios } from './scenarios/nav/manifest';
import { notificationVisualScenarios } from './scenarios/notifications/manifest';
import { searchVisualScenarios } from './scenarios/search/manifest';
import { topicVisualScenarios } from './scenarios/topic/manifest';
import { userVisualScenarios } from './scenarios/user/manifest';
import { writeVisualScenarios } from './scenarios/write/manifest';
import type { VisualAppearance, VisualScenarioDefinition, VisualScenarioMeta } from './types';

const visualScenarioDefinitions: readonly VisualScenarioDefinition[] = [
  ...navVisualScenarios,
  ...feedVisualScenarios,
  ...searchVisualScenarios,
  ...topicVisualScenarios,
  ...userVisualScenarios,
  ...libraryVisualScenarios,
  ...accountVisualScenarios,
  ...notificationVisualScenarios,
  ...writeVisualScenarios,
  ...dataVisualScenarios,
  ...moreVisualScenarios
];

export const visualScenarioCatalog: readonly VisualScenarioMeta[] = visualScenarioDefinitions.map(
  ({ render: _render, ...meta }) => meta
);

export function VisualScenarioView({ appearance = {}, id }: { appearance?: VisualAppearance; id: string }) {
  const scenario = visualScenarioDefinitions.find((candidate) => candidate.id === id);
  const queryClient = useMemo(
    () =>
      new QueryClient({
        defaultOptions: {
          mutations: { retry: false },
          queries: { gcTime: Infinity, retry: false, staleTime: Infinity }
        }
      }),
    [id]
  );
  if (!scenario) {
    throw new Error(`Unknown visual scenario: ${id}`);
  }
  const settings = { ...createEmptyReaderData().settings, ...appearance };
  const theme = createTheme(settings);
  return (
    <QueryClientProvider client={queryClient}>
      <ReaderStyleProvider value={{ settings, theme }}>
        <View key={id} style={[styles.root, { backgroundColor: theme.background }]}>
          {scenario.kind === 'rendered' ? (
            scenario.render()
          ) : (
            <View style={[styles.classification, { backgroundColor: theme.surface, borderColor: theme.line }]}>
              <Text style={[styles.classificationTitle, { color: theme.ink }]}>{scenario.title}</Text>
              <Text style={[styles.classificationKind, { color: theme.primary }]}>{scenario.kind}</Text>
              <Text style={[styles.classificationNote, { color: theme.muted }]}>
                {scenario.note || '此能力没有可独立渲染的 App 界面。'}
              </Text>
            </View>
          )}
        </View>
      </ReaderStyleProvider>
    </QueryClientProvider>
  );
}

const styles = StyleSheet.create({
  classification: {
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 8,
    margin: 16,
    padding: 16
  },
  classificationKind: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase'
  },
  classificationNote: {
    fontSize: 14,
    lineHeight: 21
  },
  classificationTitle: {
    fontSize: 18,
    fontWeight: '700'
  },
  root: {
    flex: 1
  }
});
