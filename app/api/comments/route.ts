import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { explainSelectedText } from "@/lib/generation";

const createCommentSchema = z.object({
  courseId: z.string().min(1),
  lessonId: z.string().min(1).optional(),
  selectedText: z.string().trim().min(3).max(3000),
  prompt: z.string().trim().min(3).max(800)
});

export async function POST(request: Request) {
  try {
    const body = createCommentSchema.parse(await request.json());
    const course = await prisma.course.findUnique({
      where: { id: body.courseId },
      include: {
        modules: {
          include: {
            lessons: true
          }
        }
      }
    });

    if (!course) {
      return NextResponse.json({ error: "Course not found." }, { status: 404 });
    }

    const lesson = course.modules.flatMap((module) => module.lessons).find((item) => item.id === body.lessonId);
    const response = await explainSelectedText({
      courseTitle: course.title,
      lessonTitle: lesson?.title,
      selectedText: body.selectedText,
      prompt: body.prompt
    });

    const comment = await prisma.selectionComment.create({
      data: {
        courseId: body.courseId,
        lessonId: body.lessonId,
        selectedText: body.selectedText,
        prompt: body.prompt,
        response
      }
    });

    return NextResponse.json({ comment });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create explanation.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
