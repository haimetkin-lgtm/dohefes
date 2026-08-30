import { publicPageMetadata } from "@/lib/public-page-metadata";

export const metadata = publicPageMetadata(
  "/ranking/",
  "כלי חינמי לדירוג דירות בפינוי בינוי",
  "כלי חינמי מלא לדירוג דירות בפינוי בינוי לפי קריטריונים ומשקלים, חישוב סדר בחירה ופערי ערך, כולל הורדת Excel והדפסה או PDF.",
);

export default function RankingLayout({ children }: { children: React.ReactNode }) {
  return children;
}
