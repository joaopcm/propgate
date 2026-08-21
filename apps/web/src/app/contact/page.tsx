import { Prose, SiteFrame } from "@/components/site-frame";
import { CONTACT_BODY, CONTACT_H1 } from "@/lib/site";

export const metadata = {
  description:
    "Contact propgate via GitHub. API docs, OpenAPI, CLI, SDK and webhooks are linked from here so agents can find them by name.",
  title: "Contact propgate",
};

export default function ContactPage() {
  return (
    <SiteFrame kicker="propgate / contact">
      <h1 className="mt-4 text-balance font-semibold text-3xl leading-tight tracking-tight sm:text-4xl">
        {CONTACT_H1}
      </h1>
      <Prose text={CONTACT_BODY} />
    </SiteFrame>
  );
}
