export type ReviewProofCheck = (markStage: (stage: string) => void) => Promise<void>;

type CheckDetails = { name: string; metrics?: Record<string, unknown> };
export type ReviewProofCheckResult = CheckDetails &
  (
    | { passed: true; error?: never; stack?: never; stage?: never }
    | { passed: false; error: string; stack?: string; stage?: string }
  );

export async function runReviewProofCheck(
  name: string,
  task: ReviewProofCheck,
  metrics?: Record<string, unknown>
): Promise<ReviewProofCheckResult> {
  let stage: string | undefined;
  const details = { name, ...(metrics ? { metrics } : {}) };
  try {
    await task((next) => {
      stage = next;
    });
    return { ...details, passed: true };
  } catch (error) {
    return {
      ...details,
      passed: false,
      error: error instanceof Error ? error.message : String(error),
      ...(error instanceof Error ? { stack: error.stack } : {}),
      ...(stage ? { stage } : {})
    };
  }
}
