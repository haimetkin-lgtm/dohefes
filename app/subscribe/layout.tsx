import { publicPageMetadata } from "@/lib/public-page-metadata";

export const metadata = publicPageMetadata(
  "/subscribe/",
  "מנויים שנתיים לדוחות אפס",
  "מנוי שנתי לדוחות אפס: פותחים פרויקטים בכמות, עם שמירה בקישור קבוע, ייצוא Excel, הדפסה ודוחות מעקב בנייה, בלי לשלם על כל דוח בנפרד.",
);

export default function SubscribeLayout({ children }: { children: React.ReactNode }) {
  return children;
}
