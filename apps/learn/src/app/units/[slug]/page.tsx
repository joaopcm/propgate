import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CourseFrame } from "@/components/course-frame";
import { Gate } from "@/components/quiz/gate";
import { Quiz } from "@/components/quiz/quiz";
import { SetupNote } from "@/components/setup-note";
import { UnitHeader } from "@/components/unit-header";
import { UNIT_CONTENT } from "@/content/units";
import { CURRICULUM, unitBySlug, unitIndex } from "@/lib/curriculum";
import { questionsFor } from "@/lib/quiz/all";

export function generateStaticParams(): { slug: string }[] {
  return CURRICULUM.map((unit) => ({ slug: unit.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const unit = unitBySlug(slug);

  if (unit === undefined) {
    return {};
  }

  return { description: unit.blurb, title: unit.title };
}

export default async function UnitPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const unit = unitBySlug(slug);
  const Content = UNIT_CONTENT[slug];

  if (unit === undefined || Content === undefined) {
    notFound();
  }

  const index = unitIndex(slug);

  return (
    <CourseFrame currentSlug={slug}>
      {/*
        The gate wraps the content rather than replacing the page, so a reader
        who takes the escape hatch sees the unit appear in place instead of
        being bounced through a navigation. See `Gate` on why this is a
        courtesy rather than a lock.
      */}
      <Gate slug={slug}>
        <article className="rise-in">
          <UnitHeader index={index} unit={unit} />
          {unit.needsFixtures ? <SetupNote /> : null}
          <Content />
        </article>
        <Quiz questions={questionsFor(slug)} slug={slug} />
      </Gate>
    </CourseFrame>
  );
}
