import type { Metadata } from "next";
import { CourseFrame } from "@/components/course-frame";
import { Exam } from "@/components/quiz/exam";
import { examQuestions } from "@/lib/quiz/exam";

export const metadata: Metadata = {
  description: "Two questions from every unit, same rule as the rest.",
  title: "The exam",
};

export default function ExamPage() {
  return (
    <CourseFrame currentSlug="exam">
      {/* Sampled here rather than in the component: see `Exam`. */}
      <Exam questions={examQuestions()} />
    </CourseFrame>
  );
}
