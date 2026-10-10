import { privatePageMetadata } from "@/lib/public-page-metadata";

export const metadata = privatePageMetadata("כניסת מנויים");

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
