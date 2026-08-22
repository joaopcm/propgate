import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CURRICULUM } from "@/lib/curriculum";
import { allQuestions, coveredSlugs, questionsFor } from "./all";
import { examQuestions } from "./exam";

const REPO_ROOT = join(process.cwd(), "../..");
const MINIMUM_PER_UNIT = 4;

describe("the quiz registry", () => {
  it("has an entry for every unit in the curriculum", () => {
    for (const unit of CURRICULUM) {
      expect(coveredSlugs(), `${unit.slug} is missing from all.ts`).toContain(
        unit.slug
      );
    }
  });

  it("has no entry the curriculum does not list", () => {
    const slugs = new Set(CURRICULUM.map((unit) => unit.slug));

    for (const slug of coveredSlugs()) {
      expect(
        slugs.has(slug),
        `${slug} is in all.ts but not the curriculum`
      ).toBe(true);
    }
  });

  it("gives every unit enough questions to be worth gating on", () => {
    for (const unit of CURRICULUM) {
      expect(
        questionsFor(unit.slug).length,
        `${unit.slug} has too few questions`
      ).toBeGreaterThanOrEqual(MINIMUM_PER_UNIT);
    }
  });

  it("has globally unique question ids", () => {
    const ids = allQuestions().map((question) => question.id);

    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("every question", () => {
  it("offers at least three options", () => {
    for (const question of allQuestions()) {
      expect(question.options.length, question.id).toBeGreaterThanOrEqual(3);
    }
  });

  it("has distinct options", () => {
    for (const question of allQuestions()) {
      expect(new Set(question.options).size, question.id).toBe(
        question.options.length
      );
    }
  });

  it("points at an option that exists", () => {
    for (const question of allQuestions()) {
      expect(question.correct, question.id).toBeGreaterThanOrEqual(0);
      expect(question.correct, question.id).toBeLessThan(
        question.options.length
      );
    }
  });

  it("explains itself", () => {
    for (const question of allQuestions()) {
      expect(question.explanation.length, question.id).toBeGreaterThan(20);
    }
  });

  it("ends its prompt with a question mark", () => {
    for (const question of allQuestions()) {
      expect(question.prompt.trimEnd().endsWith("?"), question.id).toBe(true);
    }
  });

  it("cites a file that exists in this repository", () => {
    for (const question of allQuestions()) {
      expect(
        existsSync(join(REPO_ROOT, question.source)),
        `${question.id} cites ${question.source}`
      ).toBe(true);
    }
  });
});

describe("the exam", () => {
  it("draws from every unit", () => {
    const ids = new Set(examQuestions().map((question) => question.id));

    for (const unit of CURRICULUM) {
      const drawn = questionsFor(unit.slug).some((question) =>
        ids.has(question.id)
      );

      expect(drawn, `nothing from ${unit.slug}`).toBe(true);
    }
  });

  it("asks nothing twice", () => {
    const ids = examQuestions().map((question) => question.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it("is the same exam on every build", () => {
    expect(examQuestions().map((question) => question.id)).toEqual(
      examQuestions().map((question) => question.id)
    );
  });
});
