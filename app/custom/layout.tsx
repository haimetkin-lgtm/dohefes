import { publicPageMetadata } from "@/lib/public-page-metadata";

export const metadata = publicPageMetadata(
  "/custom/",
  "דוח אפס בהתאמה אישית",
  "מסלול דוח אפס בהתאמה אישית: מתארים את פרויקט הנדל\"ן ומעלים מסמכים, והמערכת בונה שלד דוח מותאם להשלמת הנתונים הכספיים.",
);

export default function CustomLayout({ children }: { children: React.ReactNode }) {
  return children;
}
