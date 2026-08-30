import { publicPageMetadata } from "@/lib/public-page-metadata";

export const metadata = publicPageMetadata(
  "/sample/",
  "דוח אפס לדוגמה",
  "דוגמה לדוח אפס לבדיקת כדאיות כלכלית של מיזם נדל\"ן, עם נתוני שטחים, הכנסות, עלויות, מימון ומדדי רווחיות מפורטים.",
);

export default function SampleLayout({ children }: { children: React.ReactNode }) {
  return children;
}
