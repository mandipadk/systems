import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/db";
import { CourseReader } from "./reader";

export default async function CoursePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const course = await prisma.course.findUnique({
    where: { id },
    include: {
      sources: true,
      studyStates: true,
      comments: {
        orderBy: { createdAt: "desc" }
      },
      modules: {
        orderBy: { order: "asc" },
        include: {
          lessons: {
            orderBy: { order: "asc" },
            include: {
              qualityReview: true
            }
          }
        }
      }
    }
  });

  if (!course) notFound();

  return (
    <main className="min-h-screen px-5 py-6 sm:px-8">
      <div className="mx-auto mb-8 max-w-7xl">
        <Link href="/" className="inline-flex items-center gap-2 text-sm text-ink/60 transition hover:text-ink">
          <ArrowLeft className="h-4 w-4" />
          Library
        </Link>
      </div>
      <CourseReader course={JSON.parse(JSON.stringify(course))} />
    </main>
  );
}
