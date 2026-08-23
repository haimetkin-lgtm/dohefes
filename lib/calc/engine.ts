import type { ProjectInputs, AreaSummary, RevenueSummary, CostBreakdown, ProfitabilitySummary, ProjectResult } from "./types";

// מנוע החישוב המשותף. מבוסס על שרשרת הליבה שתועדה בשישה מפרטי הנוסחאות
// (Dropbox/2026/קלוד קוד - מיזמים/דוחות אפס/מפרט נוסחאות/), ומאמת שהיא זהה
// בין תמ"א 38 וקומבינציה בעין למעט שלוש נקודות: תמורת הקרקע, בסיס מס הרכישה,
// וחלק היזם בהכנסות. הנוסחאות המדויקות (עלויות עקיפות, עמלות, בנייה ישירה) מתועדות
// שם בפירוט מלא, כולל דוגמאות מספריות מהאקסל המקורי לאימות.
//
// פישוט מכוון ל-MVP (שלב 1): מודל המימון והעמלות (ערבות חוק מכר, אי ניצול אשראי)
// מוחלף כאן בקירוב סטטי במקום סימולציית תזרים רבעונית מלאה. ראו הערה ליד financing.
// זו לא טעות, זו החלטת היקף מתועדת ב-01-תמא-38.md: "אפשר וכדאי להתחיל MVP עם גרסה
// מפושטת... ולשדרג לגרסה המדויקת בשלב מאוחר יותר".

const VAT_FACTOR = 1.17;

export function computeAreas(inputs: ProjectInputs): AreaSummary {
  const { units, costs } = inputs;
  let totalMainAreaSqm = 0;
  let totalMamadSqm = 0;
  let totalBalconySqm = 0;
  let totalRoofBalconySqm = 0;
  let unitCount = 0;

  for (const u of units) {
    totalMainAreaSqm += u.count * u.areaSqm;
    totalMamadSqm += u.count * u.mamadSqm;
    totalBalconySqm += u.count * u.balconySqm;
    totalRoofBalconySqm += u.count * u.roofBalconySqm;
    unitCount += u.count;
  }

  const totalMarketableAreaSqm =
    totalMainAreaSqm +
    totalMamadSqm +
    (totalBalconySqm + totalRoofBalconySqm) * costs.balconyWeight;

  return { totalMainAreaSqm, totalMamadSqm, totalBalconySqm, totalRoofBalconySqm, totalMarketableAreaSqm, unitCount };
}

export function computeRevenue(inputs: ProjectInputs, areas: AreaSummary): RevenueSummary {
  let totalRevenueInclVatNis = 0;
  for (const u of units_(inputs)) {
    totalRevenueInclVatNis += u.count * u.priceNis;
  }
  const totalRevenueExclVatNis = totalRevenueInclVatNis / VAT_FACTOR;

  const developerShare =
    inputs.dealType === "kombinatsia" ? 1 - inputs.land.combinationOwnerShare : 1;
  const developerRevenueExclVatNis = totalRevenueExclVatNis * developerShare;

  const averagePricePerSqmNis =
    areas.totalMarketableAreaSqm > 0 ? totalRevenueInclVatNis / areas.totalMarketableAreaSqm : 0;

  return { totalRevenueInclVatNis, totalRevenueExclVatNis, developerRevenueExclVatNis, averagePricePerSqmNis };
}

function units_(inputs: ProjectInputs) {
  return inputs.units;
}

export function computeCosts(inputs: ProjectInputs, areas: AreaSummary, revenue: RevenueSummary): CostBreakdown {
  const { costs, land, dealType } = inputs;

  // A. קרקע. תמ"א 38: תשלום במזומן. קומבינציה: תמיד 0, התמורה גלומה בפער בין
  // עלות בניית 100% מהבניין להכרה בהכנסה מחלק היזם בלבד (ר' מפרט 05-קומבינציה-בעין.md).
  const landNis = dealType === "tama38" ? land.landPurchaseNis + land.bettermentLevyNis : 0;

  // D. בנייה ישירה, תמיד על 100% מהבניין, ללא קשר לחלוקת קומבינציה.
  const balconyCostPerSqm = costs.mainConstructionCostPerSqm * costs.balconyConstructionCostRatio;
  const directConstructionNis =
    areas.totalMainAreaSqm * costs.mainConstructionCostPerSqm +
    costs.undergroundAreaSqm * costs.undergroundConstructionCostPerSqm +
    (areas.totalBalconySqm + areas.totalRoofBalconySqm) * balconyCostPerSqm +
    (costs.netPlotAreaSqm / 2) * costs.developmentCostPerSqm +
    costs.demolitionFlatNis;

  // B. עלויות עקיפות. בסיס הכנסות = חלק היזם בלבד (developerRevenueExclVatNis),
  // תואם לשני המודלים כי ב-תמ"א 38 developerRevenueExclVatNis = 100% ההכנסה ממילא.
  const purchaseTaxBasis =
    dealType === "tama38" ? land.landPurchaseNis : land.combinationLandValueForTaxNis;
  const brokerageNis = landNis > 0 ? landNis * costs.brokerageRate : 0;
  const purchaseTaxNis = purchaseTaxBasis * costs.purchaseTaxRate;
  const electricNis = areas.unitCount * costs.electricConnectionPerUnitNis;
  const engineeringSupervisionNis = directConstructionNis * costs.engineeringSupervisionRate;
  const marketingNis = revenue.developerRevenueExclVatNis * costs.marketingRate;
  const legalNis = revenue.developerRevenueExclVatNis * VAT_FACTOR * costs.legalRate;
  const legalRefundNis = areas.unitCount * costs.legalRefundPerUnitNis;
  const overheadNis = directConstructionNis * costs.overheadRate;
  const contingencyNis = directConstructionNis * costs.contingencyRate;

  const indirectNis =
    costs.municipalFeesNis +
    brokerageNis +
    purchaseTaxNis +
    electricNis +
    costs.planningFlatNis +
    engineeringSupervisionNis +
    marketingNis +
    legalNis +
    legalRefundNis +
    costs.financialSupervisionFlatNis +
    overheadNis +
    contingencyNis;

  // C. עמלות מימון, מפושט. במקור מחושבות מתוך סימולציית תזרים רבעונית מלאה
  // (ר' 01-תמא-38.md סעיף 5). כאן: אחוז מהכנסה/ממסגרת, כפול 0.5 כקירוב לבסיס
  // מצטבר ממוצע לאורך תקופת הבנייה, במקום אינטגרציה רבעונית מדויקת.
  const guaranteeCommissionNis = revenue.totalRevenueInclVatNis * costs.guaranteeCommissionRate * 0.5;

  const totalDirectAndIndirect = directConstructionNis + indirectNis + landNis;
  const presaleInflowNis = revenue.developerRevenueExclVatNis * VAT_FACTOR * costs.presaleRate;
  const creditFacilityNis = Math.max(0, totalDirectAndIndirect - costs.equityNis - presaleInflowNis);
  const unusedCreditCommissionNis = creditFacilityNis * costs.unusedCreditCommissionRate * 0.5;

  const commissionsNis = guaranteeCommissionNis + unusedCreditCommissionNis;

  // F. מימון, מפושט: ריבית פשוטה על יתרת חוב ממוצעת (הנחת פריסה ליניארית),
  // במקום סימולציית ריבית רבעונית מצטברת על יתרה בפועל.
  const debtPortionNis = creditFacilityNis;
  const avgOutstandingBalanceNis = debtPortionNis / 2;
  const financingNis =
    avgOutstandingBalanceNis * costs.annualInterestRate * (costs.constructionMonths / 12);

  const totalExclFinancingNis = landNis + indirectNis + commissionsNis + directConstructionNis;
  const totalInclFinancingNis = totalExclFinancingNis + financingNis;

  return {
    landNis,
    indirectNis,
    commissionsNis,
    directConstructionNis,
    financingNis,
    totalExclFinancingNis,
    totalInclFinancingNis,
  };
}

export function computeProfitability(revenue: RevenueSummary, costs: CostBreakdown): ProfitabilitySummary {
  const revenueNis = revenue.developerRevenueExclVatNis;
  const totalCostNis = costs.totalInclFinancingNis;
  const currentProfitNis = revenueNis - totalCostNis;
  const profitToCostRatio = totalCostNis !== 0 ? currentProfitNis / totalCostNis : 0;
  return { revenueNis, totalCostNis, currentProfitNis, profitToCostRatio };
}

export function computeProject(inputs: ProjectInputs): ProjectResult {
  const warnings: string[] = [];

  if (inputs.units.length === 0) {
    warnings.push("לא הוזנו יחידות דיור.");
  }
  if (inputs.dealType === "kombinatsia" && inputs.land.combinationOwnerShare <= 0) {
    warnings.push("אחוז הקומבינציה לבעל הקרקע הוא 0 או לא הוזן, כדאי לבדוק.");
  }
  if (inputs.dealType === "tama38" && inputs.land.landPurchaseNis <= 0) {
    warnings.push("לא הוזנה עלות רכישת קרקע.");
  }

  const areas = computeAreas(inputs);
  const revenue = computeRevenue(inputs, areas);
  const costs = computeCosts(inputs, areas, revenue);
  const profitability = computeProfitability(revenue, costs);

  return { areas, revenue, costs, profitability, warnings };
}
