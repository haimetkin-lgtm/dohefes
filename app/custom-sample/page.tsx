"use client";

import { computeProject } from "@/lib/calc/engine";
import type { ProjectInputs, UnitCategory } from "@/lib/calc/types";
import ReportView from "@/app/calculator/ReportView";
import Banner from "@/app/components/Banner";
import { downloadWorkbook } from "@/lib/report/exportExcel";
import { CUSTOM_PRICE_NIS } from "@/lib/supabase";

// דוגמה למסלול "בהתאמה אישית", בשני חלקים:
// 1. מה שהלקוח כותב, ומה שהסוכן החכם בונה מזה: שלד עם שטחים ותמהיל בלבד, בלי סכומים.
// 2. דוגמה לתוצאה הסופית, אחרי שהלקוח (לא הסוכן) השלים בעצמו את כל הנתונים הכספיים.
// נתונים בדויים לחלוטין, לצורך המחשה בלבד.

const CUSTOMER_STORY = `חלקה של 2 דונם עליה בנויים בנייני מגורים ותיקים בני למעלה מ-70 שנה. כל בניין בן 4 קומות מעל קומת עמודים מפולשת, בכל קומה 4 דירות, סה"כ 16 דירות בכל בניין, ללא מעלית.

הפרויקט הוא פרויקט פינוי בינוי, עם 2 מגדלים בני 25 קומות, עם 2 קומות מרתף משותפות לשני הבניינים לטובת מקומות חניה ומחסנים.`;

interface SkeletonUnit {
  name: string;
  category: UnitCategory;
  count: number;
  areaSqm: number;
  mamadSqm: number;
  balconySqm: number;
  roofBalconySqm: number;
  isCompensationUnit?: boolean;
}

// זה בדיוק מה שהסוכן החכם מחלץ, ורק זה: נתונים פיזיים. בלי מחיר ליחידה, בלי עלות בנייה,
// בלי שווי קרקע. השדות האלה מגיעים מהלקוח בהמשך, במחשבון.
const SKELETON_UNITS: SkeletonUnit[] = [
  { name: "דירת 3 חדרים, תמורה לדיירים קיימים", category: "residential", count: 28, areaSqm: 78, mamadSqm: 5, balconySqm: 10, roofBalconySqm: 0, isCompensationUnit: true },
  { name: "דירת 4 חדרים פרימיום", category: "residentialPremium", count: 140, areaSqm: 105, mamadSqm: 6, balconySqm: 12, roofBalconySqm: 0 },
  { name: "פנטהאוז דופלקס יוקרה", category: "residentialPremium", count: 8, areaSqm: 160, mamadSqm: 8, balconySqm: 20, roofBalconySqm: 60 },
  { name: "חנות מסחר, קומת קרקע", category: "commercial", count: 12, areaSqm: 60, mamadSqm: 0, balconySqm: 0, roofBalconySqm: 0 },
  { name: "משרד, קומות תעסוקה", category: "office", count: 20, areaSqm: 90, mamadSqm: 0, balconySqm: 6, roofBalconySqm: 0 },
  { name: "מסעדת גג יוקרתית", category: "commercial", count: 1, areaSqm: 450, mamadSqm: 0, balconySqm: 120, roofBalconySqm: 0 },
];

const CATEGORY_LABEL: Record<UnitCategory, string> = {
  residential: "מגורים (תמורה)",
  residentialPremium: "מגורים (פרימיום)",
  commercial: "מסחר",
  office: "משרדים",
};

// אותם שטחים ותמהיל בדיוק כמו השלד, רק שעכשיו כל הערכים הכספיים כבר מולאו: מחיר ליחידה,
// עלויות בנייה, קרקע, מימון, ודמי השכירות בפועל לדיירים הקיימים. זה מה שהלקוח משלים, לא הסוכן.
const FINAL_INPUTS: ProjectInputs = {
  dealType: "pinuyBinui",
  projectName: "מתחם 'אקורד הפארק', דוגמה בלבד",
  units: SKELETON_UNITS.map((u) => ({
    ...u,
    priceNis: {
      "דירת 3 חדרים, תמורה לדיירים קיימים": 3100000,
      "דירת 4 חדרים פרימיום": 4500000,
      "פנטהאוז דופלקס יוקרה": 9500000,
      "חנות מסחר, קומת קרקע": 1400000,
      "משרד, קומות תעסוקה": 1650000,
      "מסעדת גג יוקרתית": 10500000,
    }[u.name]!,
  })),
  costs: {
    balconyWeight: 0.5,
    mainConstructionCostPerSqm: 13000,
    premiumConstructionCostPerSqm: 15500,
    commercialConstructionCostPerSqm: 9200,
    officeConstructionCostPerSqm: 10200,
    undergroundConstructionCostPerSqm: 5600,
    balconyConstructionCostRatio: 0.5,
    developmentCostPerSqm: 650,
    undergroundAreaSqm: 8500,
    netPlotAreaSqm: 4200,
    demolitionFlatNis: 2800000,
    municipalFees: {
      buildingFeeRatePerSqm: 120,
      waterConnectionRatePerSqm: 50,
      sewageConnectionRatePerSqm: 40,
      roadDrainagePlotRatePerSqm: 90,
      roadDrainageBuildingRatePerSqm: 110,
      roadDrainageUndergroundRatePerSqm: 60,
    },
    relocationUnitsCount: 28,
    relocationMonths: 36,
    relocationRentPerUnitMonthlyNis: 7500,
    brokerageRate: 0.01,
    purchaseTaxRate: 0.06,
    electricConnectionPerUnitNis: 4500,
    planningFlatNis: 30000,
    planningConsultantsRate: 0.025,
    engineeringInspectionFlatNis: 950000,
    marketingRate: 0.025,
    legalRate: 0.01,
    legalRefundPerUnitNis: -5000,
    financialSupervisionFlatNis: 250000,
    overheadRate: 0.025,
    managementFeeRate: 0.06,
    contingencyRate: 0.05,
    guaranteeCommissionRate: 0.0085,
    unusedCreditCommissionRate: 0.0035,
    annualInterestRate: 0.04,
    constructionMonths: 42,
    permitMonths: 16,
    equityNis: 48000000,
    presaleRate: 0.15,
    organizerFeeNis: 0,
  },
  land: {
    landPurchaseNis: 0,
    bettermentLevyNis: 0,
    combinationOwnerShare: 0,
    combinationLandValueForTaxNis: 58000000,
  },
};

export default function CustomSamplePage() {
  const result = computeProject(FINAL_INPUTS);

  return (
    <main className="max-w-3xl mx-auto px-4 py-8">
      <div className="print:hidden mb-6">
        <Banner />
      </div>
      <div className="print:hidden mb-6 text-center">
        <h1 className="text-lg font-bold text-[#14502F] mb-1">דוגמת תוצר, מסלול בהתאמה אישית</h1>
        <p className="text-sm text-gray-500 max-w-xl mx-auto">
          נתונים בדויים לחלוטין, לצורך המחשה בלבד. כך זה עובד: אתם כותבים חופשי, הסוכן החכם בונה שלד
          (שטחים ותמהיל בלבד, בלי סכומים), ואתם משלימים את הנתונים הכספיים כדי לקבל את הדוח המלא.
        </p>
      </div>

      {/* חלק 1: מה שהלקוח כותב */}
      <section className="print:hidden bg-white border border-gray-200 rounded-xl p-5 shadow-sm mb-5">
        <div className="text-xs font-bold text-gray-500 mb-2">1. מה שהלקוח כותב, תיאור חופשי</div>
        <p className="text-sm text-gray-700 whitespace-pre-line leading-relaxed">{CUSTOMER_STORY}</p>
      </section>

      {/* חלק 2: השלד שבונה הסוכן החכם */}
      <section className="print:hidden bg-[#FAFAF5] border border-[#E3DCC5] rounded-xl p-5 mb-8">
        <div className="text-xs font-bold text-gray-500 mb-1">2. השלד שהסוכן החכם בונה מהתיאור</div>
        <p className="text-xs text-gray-500 mb-4">
          רק נתונים פיזיים: סוג עסקה, שטחים ותמהיל יחידות, ומספר יחידות/משך לדמי שכירות לדיירים
          הקיימים. שום סכום כספי לא נקבע כאן, זה תמיד הלקוח.
        </p>

        <div className="flex flex-wrap gap-2 mb-4">
          <span className="text-xs font-medium bg-white border border-[#BFE0CC] text-[#14502F] rounded-full px-3 py-1">
            סוג עסקה: פינוי בינוי
          </span>
          <span className="text-xs font-medium bg-white border border-gray-200 text-gray-600 rounded-full px-3 py-1">
            2 בניינים קיימים, 16 יח&quot;ד כל אחד, ללא מעלית
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-[560px]">
            <thead>
              <tr className="text-gray-500 text-right border-b border-gray-200">
                <th className="py-1.5 pl-2">טיפוס</th>
                <th className="py-1.5 pl-2">קטגוריה</th>
                <th className="py-1.5 pl-2">תמורה</th>
                <th className="py-1.5 pl-2">כמות</th>
                <th className="py-1.5 pl-2">שטח עיקרי</th>
                <th className="py-1.5 pl-2">ממ&quot;ד</th>
                <th className="py-1.5 pl-2">מרפסת</th>
                <th className="py-1.5 pl-2">מרפסת גג</th>
                <th className="py-1.5 pl-2 text-gray-300">מחיר ליחידה</th>
              </tr>
            </thead>
            <tbody>
              {SKELETON_UNITS.map((u, i) => (
                <tr key={i} className="border-b border-gray-100">
                  <td className="py-1.5 pl-2">{u.name}</td>
                  <td className="py-1.5 pl-2">{CATEGORY_LABEL[u.category]}</td>
                  <td className="py-1.5 pl-2">{u.isCompensationUnit ? "כן" : "—"}</td>
                  <td className="py-1.5 pl-2">{u.count}</td>
                  <td className="py-1.5 pl-2">{u.areaSqm}</td>
                  <td className="py-1.5 pl-2">{u.mamadSqm}</td>
                  <td className="py-1.5 pl-2">{u.balconySqm}</td>
                  <td className="py-1.5 pl-2">{u.roofBalconySqm}</td>
                  <td className="py-1.5 pl-2 text-gray-300">להשלמה</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-4 text-xs text-gray-600 bg-white border border-gray-200 rounded-lg px-3 py-2">
          דמי שכירות לדיירים קיימים: <strong>28 יחידות</strong> × <strong>36 חודשים</strong> ×{" "}
          <span className="text-gray-300">₪ לחודש ליחידה, להשלמה</span>
        </div>

        <div className="mt-4">
          <div className="text-xs font-bold text-gray-500 mb-1.5">יתר הסעיפים, ממתינים למילוי הלקוח</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 text-xs text-gray-400">
            {["עלויות בנייה למ\"ר", "היטל השבחה", "מימון והון עצמי", "מיסים ועלויות עקיפות", "מחיר ליחידה", "אגרות והיטלים"].map((s) => (
              <div key={s} className="border border-dashed border-gray-300 rounded-lg px-2 py-1.5">
                {s}
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="print:hidden text-center mb-6">
        <div className="inline-block text-xs font-bold text-gray-400 tracking-wide">↓ ולהלן, לשם ההמחשה בלבד ↓</div>
        <h2 className="text-base font-bold text-[#14502F] mt-1">
          3. התוצאה הסופית, אחרי שהלקוח (לא הסוכן) השלים בעצמו את כל הנתונים הכספיים
        </h2>
      </div>

      <ReportView inputs={FINAL_INPUTS} result={result} />

      <div className="print:hidden flex flex-col sm:flex-row gap-2 mt-4">
        <button
          onClick={() => downloadWorkbook(FINAL_INPUTS, result)}
          className="flex-1 bg-[#1D6F42] hover:bg-[#14502F] text-white font-medium text-sm px-4 py-2.5 rounded-lg transition-colors"
        >
          הורדת קובץ Excel
        </button>
        <button
          onClick={() => window.print()}
          className="flex-1 bg-white border border-[#1D6F42] text-[#1D6F42] hover:bg-[#EAF3EC] font-medium text-sm px-4 py-2.5 rounded-lg transition-colors"
        >
          הדפסה / שמירה כ-PDF
        </button>
      </div>

      <div className="print:hidden mt-6 text-center">
        <a
          href="/dohefes/custom/"
          className="inline-block bg-[#1D6F42] hover:bg-[#14502F] text-white font-bold px-6 py-3 rounded-lg transition-colors"
        >
          מעבר לרכישה ותשלום - {CUSTOM_PRICE_NIS.toLocaleString("he-IL")} ₪
        </a>
      </div>
    </main>
  );
}
