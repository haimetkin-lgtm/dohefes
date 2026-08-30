import { privatePageMetadata } from "@/lib/public-page-metadata";

export const metadata = privatePageMetadata("דוח מעקב אישי");

export default function TrackingLayout({ children }: { children: React.ReactNode }) {
  return children;
}
