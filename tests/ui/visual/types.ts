import type { ReactElement } from 'react';
import type { ReaderSettings } from '@/domain/reader/readerData';

export type VisualScenarioKind = 'device-only' | 'non-visual' | 'rendered';

export type VisualAppearance = Partial<
  Pick<ReaderSettings, 'contentWidth' | 'fontFamily' | 'fontScale' | 'lineHeight' | 'listDensity' | 'theme'>
>;

type VisualScenarioBase = {
  capabilityIds: readonly string[];
  id: string;
  note?: string;
  tags: readonly string[];
  title: string;
};

export type VisualScenarioDefinition =
  | (VisualScenarioBase & {
      kind: 'rendered';
      render: () => ReactElement;
    })
  | (VisualScenarioBase & {
      kind: 'device-only' | 'non-visual';
      render?: never;
    });

export type VisualScenarioMeta = Omit<VisualScenarioDefinition, 'render'>;
