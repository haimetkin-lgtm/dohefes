export interface RankingCriterion {
  id: string;
  name: string;
  /** Relative influence. 1 = full influence, 0.5 = half influence, 0 = ignored. */
  weight: number;
}

export interface RankingUnit {
  id: string;
  name: string;
  basePriceNis: number;
  coefficients: Record<string, number>;
}

export interface RankedUnit {
  unit: RankingUnit;
  coefficient: number;
  rank: number;
  tie: boolean;
}

export interface ValueGapBreakdown {
  oldAdjustedValueNis: number;
  newAdjustedValueNis: number;
  basePriceGapNis: number;
  coefficientGap: number;
  coefficientGapPercent: number;
  valueGapNis: number;
}

export function criterionContribution(coefficient: number, weight: number): number {
  if (!Number.isFinite(coefficient) || coefficient <= 0) return 1;
  if (!Number.isFinite(weight) || weight <= 0) return 1;
  return coefficient ** weight;
}

/** Weighted multiplicative model. With weight=1 it exactly preserves the original calculation. */
export function totalCoefficient(unit: RankingUnit, criteria: RankingCriterion[]): number {
  return criteria.reduce(
    (total, criterion) =>
      total * criterionContribution(unit.coefficients[criterion.id] ?? 1, criterion.weight),
    1
  );
}

export function rankUnits(
  units: RankingUnit[],
  criteria: RankingCriterion[],
  tieTolerance = 0.0005
): RankedUnit[] {
  const sorted = units
    .map((unit, originalIndex) => ({ unit, originalIndex, coefficient: totalCoefficient(unit, criteria) }))
    .sort((a, b) => b.coefficient - a.coefficient || a.originalIndex - b.originalIndex);

  return sorted.map((entry) => {
    const firstEqualIndex = sorted.findIndex(
      (candidate) => Math.abs(candidate.coefficient - entry.coefficient) < tieTolerance
    );
    const tieCount = sorted.filter(
      (candidate) => Math.abs(candidate.coefficient - entry.coefficient) < tieTolerance
    ).length;
    return { unit: entry.unit, coefficient: entry.coefficient, rank: firstEqualIndex + 1, tie: tieCount > 1 };
  });
}

export function calculateValueGap(
  oldUnit: RankingUnit,
  newUnit: RankingUnit,
  criteria: RankingCriterion[]
): ValueGapBreakdown {
  const oldCoefficient = totalCoefficient(oldUnit, criteria);
  const newCoefficient = totalCoefficient(newUnit, criteria);
  const oldAdjustedValueNis = oldUnit.basePriceNis * oldCoefficient;
  const newAdjustedValueNis = newUnit.basePriceNis * newCoefficient;
  return {
    oldAdjustedValueNis,
    newAdjustedValueNis,
    basePriceGapNis: newUnit.basePriceNis - oldUnit.basePriceNis,
    coefficientGap: newCoefficient - oldCoefficient,
    coefficientGapPercent: oldCoefficient ? newCoefficient / oldCoefficient - 1 : 0,
    valueGapNis: newAdjustedValueNis - oldAdjustedValueNis,
  };
}

export function coefficientIssue(value: number): "invalid" | "unusual" | null {
  if (!Number.isFinite(value) || value <= 0 || value > 3) return "invalid";
  if (value < 0.8 || value > 1.2) return "unusual";
  return null;
}

export function availableNewUnits(
  units: RankingUnit[],
  choices: Record<string, string>,
  currentChoiceId: string
): RankingUnit[] {
  const selected = new Set(Object.values(choices).filter(Boolean));
  return units.filter((unit) => !selected.has(unit.id) || unit.id === currentChoiceId);
}
