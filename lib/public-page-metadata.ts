import type { Metadata } from "next";

const SITE_URL = "https://haimetkin-lgtm.github.io/dohefes";

export function publicPageMetadata(path: string, title: string, description: string): Metadata {
  const url = `${SITE_URL}${path}`;

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      url,
      siteName: "דוח אפס",
      locale: "he_IL",
      type: "website",
    },
    twitter: { card: "summary_large_image", title, description },
  };
}

export function privatePageMetadata(title: string): Metadata {
  return {
    title,
    robots: { index: false, follow: false, nocache: true },
    alternates: { canonical: null },
  };
}
