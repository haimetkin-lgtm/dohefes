import { privatePageMetadata } from "@/lib/public-page-metadata";

export const metadata = privatePageMetadata("דוח אפס אישי");

export default function ReportLayout({ children }: { children: React.ReactNode }) {
  return children;
}
