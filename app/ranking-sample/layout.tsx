import { publicPageMetadata } from "@/lib/public-page-metadata";

export const metadata = publicPageMetadata(
  "/ranking-sample/",
  "דוגמה לדירוג דירות בפינוי בינוי",
  "דוגמה מלאה לטבלת ניקוד ודירוג דירות בפינוי בינוי, הכוללת קריטריונים, משקלים, סדר בחירה והשוואת פערי ערך בין דירות.",
);

export default function RankingSampleLayout({ children }: { children: React.ReactNode }) {
  return children;
}
