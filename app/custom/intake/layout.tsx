import { privatePageMetadata } from "@/lib/public-page-metadata";

export const metadata = privatePageMetadata("מסירת פרטי פרויקט");

export default function CustomIntakeLayout({ children }: { children: React.ReactNode }) {
  return children;
}
