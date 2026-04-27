import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";

const studyStateSchema = z.object({
  courseId: z.string().min(1),
  lessonId: z.string().min(1),
  completed: z.boolean().optional(),
  bookmarked: z.boolean().optional(),
  solutionRevealed: z.boolean().optional()
});

export async function PATCH(request: Request) {
  try {
    const body = studyStateSchema.parse(await request.json());
    const state = await prisma.studyState.upsert({
      where: {
        courseId_lessonId: {
          courseId: body.courseId,
          lessonId: body.lessonId
        }
      },
      create: {
        courseId: body.courseId,
        lessonId: body.lessonId,
        completed: body.completed ?? false,
        bookmarked: body.bookmarked ?? false,
        solutionRevealed: body.solutionRevealed ?? false
      },
      update: {
        completed: body.completed,
        bookmarked: body.bookmarked,
        solutionRevealed: body.solutionRevealed
      }
    });

    return NextResponse.json({ state });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to save study state.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
