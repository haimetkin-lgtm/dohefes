"use client";

import { useSession } from "@/lib/subscriptions";
import { SITE_PATHS } from "@/lib/site";

// שני הכפתורים: רכישת מנוי וכניסת מנויים (למי שמחובר: האזור האישי)
export default function SubscriberLinks({ variant }: { variant: "header" | "hero" }) {
  const { session, loading } = useSession();
  const loggedIn = !loading && !!session;
  const enterHref = loggedIn ? SITE_PATHS.account : SITE_PATHS.login;
  const enterLabel = loggedIn ? "האזור האישי" : "כניסת מנויים";

  if (variant === "header") {
    return (
      <>
        <a href={enterHref} className="hover:text-gray-800 transition-colors">
          {enterLabel}
        </a>
        <a
          href={SITE_PATHS.subscribe}
          className="bg-[#1D6F42] text-white px-2.5 py-1.5 rounded-md font-medium hover:bg-[#14502F] transition-colors"
        >
          רכישת מנוי
        </a>
      </>
    );
  }

  return (
    <div className="mt-4 flex flex-col sm:flex-row gap-3 justify-center">
      <a
        href={SITE_PATHS.subscribe}
        className="inline-block bg-[#1D6F42] hover:bg-[#14502F] text-white font-bold px-6 py-3 rounded-lg transition-colors"
      >
        רכישת מנוי
      </a>
      <a
        href={enterHref}
        className="inline-block border-2 border-[#1D6F42] text-[#14502F] hover:bg-[#EAF3EC] font-bold px-6 py-3 rounded-lg transition-colors"
      >
        {enterLabel}
      </a>
    </div>
  );
}
