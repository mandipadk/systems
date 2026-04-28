import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { createGenerationRun, normalizeTopicKey } from "@/lib/generation";
import { getPath } from "@/lib/paths";

const createCourseSchema = z.object({
  topic: z.string().trim().optional(),
  pathId: z.string().trim().optional(),
  force: z.boolean().optional(),
  replaceCourseId: z.string().optional()
});

export async function GET() {
  const courses = await prisma.course.findMany({
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      title: true,
      topic: true,
      summary: true,
      level: true,
      status: true,
      updatedAt: true
    }
  });

  return NextResponse.json({ courses });
}

export async function POST(request: Request) {
  try {
    const body = createCourseSchema.parse(await request.json());
    const requestedTopic = getPath(body.pathId)?.topic ?? body.topic?.trim();
    if (!requestedTopic) {
      return NextResponse.json({ error: "A topic or path is required." }, { status: 400 });
    }

    const topicKey = normalizeTopicKey(requestedTopic);
    const existingCourses = await prisma.course.findMany({
      where: { status: "ready" },
      select: {
        id: true,
        title: true,
        topic: true,
        summary: true,
        level: true,
        updatedAt: true
      },
      orderBy: { updatedAt: "desc" }
    });
    const duplicate = existingCourses.find((course) => normalizeTopicKey(course.topic) === topicKey);

    if (duplicate && !body.force && body.replaceCourseId !== duplicate.id) {
      return NextResponse.json(
        {
          duplicate,
          error: "A course for this exact topic already exists."
        },
        { status: 409 }
      );
    }

    if (body.replaceCourseId) {
      const replacementTarget = await prisma.course.findUnique({
        where: { id: body.replaceCourseId },
        select: { id: true, topic: true }
      });
      if (!replacementTarget) {
        return NextResponse.json({ error: "The course selected for replacement no longer exists." }, { status: 404 });
      }
    }

    const run = await createGenerationRun(body);
    return NextResponse.json({ runId: run.id, status: run.status }, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create course.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
