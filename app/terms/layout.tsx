import { publicPageMetadata } from "@/lib/public-page-metadata";

export const metadata = publicPageMetadata(
  "/terms/",
  "תנאי שימוש והגבלת אחריות",
  "תנאי השימוש, האחריות על נתוני הקלט והבהרה כי מחולל דוח האפס הוא כלי חישוב עזר ואינו תחליף לבדיקה ולאישור של שמאי מקרקעין.",
);

export default function TermsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
