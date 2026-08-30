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

export interface RankingValidationResult {
  blockingErrors: string[];
  warnings: string[];
}

function normalizedName(value: string): string {
  return value.trim().toLocaleLowerCase("he-IL");
}

/** Shared validation gate for both the interactive tool and its Excel export. */
export function validateRankingInputs(
  criteria: RankingCriterion[],
  oldUnits: RankingUnit[],
  newUnits: RankingUnit[],
  choices: Record<string, string>
): RankingValidationResult {
  const blockingErrors: string[] = [];
  const warnings: string[] = [];

  if (criteria.length === 0) blockingErrors.push("נדרש לפחות קריטריון דירוג אחד.");
  if (oldUnits.length === 0) blockingErrors.push("נדרשת לפחות דירה ישנה אחת לדירוג.");
  if (newUnits.length === 0) blockingErrors.push("נדרשת לפחות דירה חדשה אחת לצורך בחירה והשוואה.");

  const criterionNames = criteria.map((criterion) => normalizedName(criterion.name));
  if (criterionNames.some((name) => !name)) blockingErrors.push("לכל קריטריון חייב להיות שם.");
  if (new Set(criterionNames.filter(Boolean)).size !== criterionNames.filter(Boolean).length) {
    blockingErrors.push("שמות הקריטריונים חייבים להיות ייחודיים.");
  }

  for (const criterion of criteria) {
    if (!Number.isFinite(criterion.weight) || criterion.weight < 0 || criterion.weight > 2) {
      blockingErrors.push(`המשקל של ${criterion.name || "קריטריון ללא שם"} חייב להיות בין 0 ל־2.`);
    }
  }

  const allUnits = [...oldUnits, ...newUnits];
  const ids = allUnits.map((unit) => unit.id);
  if (ids.some((id) => !id.trim()) || new Set(ids).size !== ids.length) {
    blockingErrors.push("לכל דירה חייב להיות מזהה פנימי ייחודי.");
  }
  for (const unit of allUnits) {
    const label = unit.name.trim() || "דירה ללא שם";
    if (!unit.name.trim()) blockingErrors.push("לכל דירה חייב להיות שם.");
    if (!Number.isFinite(unit.basePriceNis) || unit.basePriceNis < 0) {
      blockingErrors.push(`שווי הבסיס של ${label} חייב להיות מספר שאינו שלילי.`);
    } else if (unit.basePriceNis === 0) {
      warnings.push(`לא הוזן שווי בסיס עבור ${label}; פער הערך לא יהיה שימושי.`);
    }
    for (const criterion of criteria) {
      const coefficient = unit.coefficients[criterion.id];
      const issue = coefficientIssue(coefficient);
      if (issue === "invalid") {
        blockingErrors.push(`המקדם ${criterion.name || "ללא שם"} של ${label} חייב להיות גדול מ־0 ועד 3.`);
      } else if (issue === "unusual") {
        warnings.push(`המקדם ${criterion.name || "ללא שם"} של ${label} מחוץ לטווח הבקרה 0.80–1.20.`);
      }
    }
  }

  const oldIds = new Set(oldUnits.map((unit) => unit.id));
  const newIds = new Set(newUnits.map((unit) => unit.id));
  const selectedNewIds: string[] = [];
  for (const [oldUnitId, newUnitId] of Object.entries(choices)) {
    if (!newUnitId) continue;
    if (!oldIds.has(oldUnitId)) blockingErrors.push("נמצאה בחירה המשויכת לדירה ישנה שאינה קיימת.");
    if (!newIds.has(newUnitId)) blockingErrors.push("נמצאה בחירה של דירה חדשה שאינה קיימת.");
    selectedNewIds.push(newUnitId);
  }
  if (new Set(selectedNewIds).size !== selectedNewIds.length) {
    blockingErrors.push("אותה דירה חדשה נבחרה עבור יותר מדייר אחד.");
  }

  return {
    blockingErrors: [...new Set(blockingErrors)],
    warnings: [...new Set(warnings)],
  };
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
