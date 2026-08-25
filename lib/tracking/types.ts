export interface TrackingItem {
  id: string;
  phase: string;
  description: string;
  quantity: number;
  unitPriceNis: number;
  actualNis: number;
}

export interface TrackingPhaseTotals {
  phase: string;
  budgetNis: number;
  actualNis: number;
  remainingNis: number;
  percentComplete: number;
}

export interface TrackingTotals {
  byPhase: TrackingPhaseTotals[];
  budgetNis: number;
  actualNis: number;
  remainingNis: number;
  percentComplete: number;
}

export function itemBudgetNis(item: TrackingItem): number {
  return item.quantity * item.unitPriceNis;
}

export function computeTrackingTotals(items: TrackingItem[]): TrackingTotals {
  const phaseOrder: string[] = [];
  const byPhaseMap = new Map<string, { budgetNis: number; actualNis: number }>();

  for (const item of items) {
    const phase = item.phase || "ללא שלב";
    if (!byPhaseMap.has(phase)) {
      byPhaseMap.set(phase, { budgetNis: 0, actualNis: 0 });
      phaseOrder.push(phase);
    }
    const entry = byPhaseMap.get(phase)!;
    entry.budgetNis += itemBudgetNis(item);
    entry.actualNis += item.actualNis;
  }

  const byPhase: TrackingPhaseTotals[] = phaseOrder.map((phase) => {
    const { budgetNis, actualNis } = byPhaseMap.get(phase)!;
    return {
      phase,
      budgetNis,
      actualNis,
      remainingNis: budgetNis - actualNis,
      percentComplete: budgetNis !== 0 ? actualNis / budgetNis : 0,
    };
  });

  const budgetNis = byPhase.reduce((sum, p) => sum + p.budgetNis, 0);
  const actualNis = byPhase.reduce((sum, p) => sum + p.actualNis, 0);

  return {
    byPhase,
    budgetNis,
    actualNis,
    remainingNis: budgetNis - actualNis,
    percentComplete: budgetNis !== 0 ? actualNis / budgetNis : 0,
  };
}
