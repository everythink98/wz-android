export type SourceDiagnosticSummary = {
  parserVariant: string;
  candidateCount: number;
  validCount: number;
  droppedCount: number;
  partialErrorCount: number;
  missingFloorCount: number;
  missingTitleCount?: number;
  hasDegradation: boolean;
  hasRepeatedCursor: boolean;
  isExpectedEmpty: boolean;
  isParseEmpty: boolean;
};

type SourceDiagnosticSummaryInput = Partial<SourceDiagnosticSummary> & Pick<SourceDiagnosticSummary, 'parserVariant'>;

const summaries = new WeakMap<object, SourceDiagnosticSummary>();

function count(value: number | undefined) {
  return Number.isFinite(value) && Number(value) > 0 ? Math.floor(Number(value)) : 0;
}

function normalizedSummary(input: SourceDiagnosticSummaryInput): SourceDiagnosticSummary {
  const validCount = count(input.validCount);
  const candidateCount = Math.max(validCount, count(input.candidateCount));
  const droppedCount = Math.max(count(input.droppedCount), candidateCount - validCount);
  const partialErrorCount = count(input.partialErrorCount);
  const missingFloorCount = count(input.missingFloorCount);
  const missingTitleCount = count(input.missingTitleCount);
  const hasRepeatedCursor = input.hasRepeatedCursor === true;
  const isExpectedEmpty = input.isExpectedEmpty === true;
  const isParseEmpty = input.isParseEmpty === true || (!isExpectedEmpty && candidateCount > 0 && validCount === 0);
  return {
    parserVariant: input.parserVariant,
    candidateCount,
    validCount,
    droppedCount,
    partialErrorCount,
    missingFloorCount,
    ...(input.missingTitleCount === undefined ? {} : { missingTitleCount }),
    hasDegradation:
      input.hasDegradation === true ||
      partialErrorCount > 0 ||
      missingFloorCount > 0 ||
      missingTitleCount > 0 ||
      hasRepeatedCursor ||
      isParseEmpty,
    hasRepeatedCursor,
    isExpectedEmpty,
    isParseEmpty
  };
}

export function annotateSourceDiagnosticSummary<T extends object>(result: T, input: SourceDiagnosticSummaryInput): T {
  summaries.set(result, normalizedSummary(input));
  return result;
}

export function sourceDiagnosticSummary(result: unknown) {
  return result && typeof result === 'object' ? summaries.get(result) : undefined;
}

export function copySourceDiagnosticSummary<T extends object>(result: T, source: unknown): T {
  const summary = sourceDiagnosticSummary(source);
  if (summary) {
    summaries.set(result, summary);
  }
  return result;
}

export function mergeSourceDiagnosticSummaries<T extends object>(
  result: T,
  parserVariant: string,
  sources: unknown[],
  overrides: Partial<SourceDiagnosticSummary> = {}
): T {
  const values = sources.map(sourceDiagnosticSummary).filter(Boolean) as SourceDiagnosticSummary[];
  const hasMissingTitleCount = values.some((value) => value.missingTitleCount !== undefined);
  return annotateSourceDiagnosticSummary(result, {
    parserVariant,
    candidateCount: values.reduce((total, value) => total + value.candidateCount, 0),
    validCount: values.reduce((total, value) => total + value.validCount, 0),
    droppedCount: values.reduce((total, value) => total + value.droppedCount, 0),
    partialErrorCount: values.reduce((total, value) => total + value.partialErrorCount, 0),
    missingFloorCount: values.reduce((total, value) => total + value.missingFloorCount, 0),
    ...(hasMissingTitleCount
      ? { missingTitleCount: values.reduce((total, value) => total + (value.missingTitleCount || 0), 0) }
      : {}),
    hasDegradation: values.some((value) => value.hasDegradation),
    hasRepeatedCursor: values.some((value) => value.hasRepeatedCursor),
    isExpectedEmpty: values.length > 0 && values.every((value) => value.isExpectedEmpty),
    isParseEmpty: values.some((value) => value.isParseEmpty),
    ...overrides
  });
}
