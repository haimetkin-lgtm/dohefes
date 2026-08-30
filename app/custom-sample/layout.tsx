import { publicPageMetadata } from "@/lib/public-page-metadata";

export const metadata = publicPageMetadata(
  "/custom-sample/",
  "דוח אפס בהתאמה אישית – דוגמה",
  "דוגמת תוצר של דוח אפס בהתאמה אישית, הנבנה מתיאור הפרויקט ומקבצים קיימים ומרכז את שלד הנתונים והחישובים לבדיקת כדאיות.",
);

export default function CustomSampleLayout({ children }: { children: React.ReactNode }) {
  return children;
}
