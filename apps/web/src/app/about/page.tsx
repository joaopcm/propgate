import { Prose, SiteFrame } from "@/components/site-frame";
import { ABOUT_BODY, ABOUT_H1 } from "@/lib/site";

export const metadata = {
  description:
    "propgate is domain verification infrastructure: DNS diagnosis with a verdict you can switch on, for products whose customers configure records.",
  title: "About propgate",
};

export default function AboutPage() {
  return (
    <SiteFrame kicker="propgate / about">
      <h1 className="mt-4 text-balance font-semibold text-3xl leading-tight tracking-tight sm:text-4xl">
        {ABOUT_H1}
      </h1>
      <Prose text={ABOUT_BODY} />
    </SiteFrame>
  );
}
