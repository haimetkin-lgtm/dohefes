import { privatePageMetadata } from "@/lib/public-page-metadata";

export const metadata = privatePageMetadata("האזור האישי");

export default function AccountLayout({ children }: { children: React.ReactNode }) {
  return children;
}
