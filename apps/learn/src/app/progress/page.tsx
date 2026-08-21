import type { Metadata } from "next";
import { CourseFrame } from "@/components/course-frame";
import { ProgressNote } from "@/components/progress-note";

export const metadata: Metadata = {
  description:
    "Where this course keeps what you have finished, and how to move it.",
  title: "Your progress",
};

export default function ProgressPage() {
  return (
    <CourseFrame>
      <ProgressNote />
    </CourseFrame>
  );
}
