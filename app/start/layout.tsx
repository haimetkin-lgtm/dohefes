import { publicPageMetadata } from "@/lib/public-page-metadata";

export const metadata = publicPageMetadata(
  "/start/",
  "בניית דוח אפס עצמאי",
  "בחירת סוג עסקה ובניית דוח אפס עצמאי למגורים, תמ\"א 38, פינוי בינוי, קומבינציה, קבוצת רכישה או פרויקט מעורב שימושים.",
);

export default function StartLayout({ children }: { children: React.ReactNode }) {
  return children;
}
