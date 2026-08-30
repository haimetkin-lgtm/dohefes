import type { MetadataRoute } from "next";

const SITE_URL = "https://haimetkin-lgtm.github.io/dohefes";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  const paths = ["/", "/sample/", "/custom/", "/custom-sample/", "/ranking/", "/ranking-sample/", "/tracking-sample/", "/start/", "/terms/"];

  return paths.map((path) => ({
    url: `${SITE_URL}${path}`,
    changeFrequency: path === "/" ? "weekly" : "monthly",
    priority: path === "/" ? 1 : path === "/start/" ? 0.9 : 0.7,
  }));
}
