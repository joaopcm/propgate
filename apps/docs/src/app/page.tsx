import Link from "next/link";

export default function DocsHome() {
  return (
    <>
      <h1 className="mb-6 font-semibold text-3xl tracking-tight">
        propgate docs
      </h1>
      <p className="mb-4 text-muted-foreground leading-7">
        Domain onboarding and lifecycle infrastructure.
      </p>
      <ul className="list-inside list-disc text-muted-foreground leading-8">
        <li>
          <Link className="underline" href="/taxonomy">
            DNS diagnosis taxonomy
          </Link>
        </li>
      </ul>
    </>
  );
}
