import { publicPageMetadata } from "@/lib/public-page-metadata";

export const metadata = publicPageMetadata(
  "/tracking-sample/",
  "דוח מעקב תקציבי לבנייה – דוגמה",
  "דוגמה לדוח מעקב תקציבי לפרויקט בנייה: השוואת תקציב מול ביצוע בפועל לפי שלבים וסעיפים, יתרות, שיעורי ביצוע וזיהוי חריגות.",
);

export default function TrackingSampleLayout({ children }: { children: React.ReactNode }) {
  return children;
}
