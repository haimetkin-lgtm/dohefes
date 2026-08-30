import { privatePageMetadata } from "@/lib/public-page-metadata";

export const metadata = privatePageMetadata("אישור תשלום");

export default function PaymentReturnLayout({ children }: { children: React.ReactNode }) {
  return children;
}
