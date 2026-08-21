import { Prose, SiteFrame } from "@/components/site-frame";
import { PRIVACY_BODY, PRIVACY_H1 } from "@/lib/site";

export const metadata = {
  description:
    "What propgate collects: the public checker stores nothing. Accounts store the email you proved, hashed keys, and the domains you ask us to remember.",
  title: "Privacy — propgate",
};

export default function PrivacyPage() {
  return (
    <SiteFrame kicker="propgate / privacy">
      <h1 className="mt-4 text-balance font-semibold text-3xl leading-tight tracking-tight sm:text-4xl">
        {PRIVACY_H1}
      </h1>
      <Prose text={PRIVACY_BODY} />
    </SiteFrame>
  );
}
