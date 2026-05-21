// Pure predicate for the empty-state onboarding card.
//
// Triggers ONLY when both lists have been successfully fetched (counts
// are numbers, not null) AND both are zero. `null` for either count
// means "fetch still pending" — we hold off rendering anything to avoid
// a flash of guidance during initial load.

export interface OnboardingInput {
  tagCount: number | null;
  questionTotal: number | null;
}

export function shouldShowOnboarding({
  tagCount,
  questionTotal,
}: OnboardingInput): boolean {
  if (tagCount === null || questionTotal === null) return false;
  return tagCount === 0 && questionTotal === 0;
}
