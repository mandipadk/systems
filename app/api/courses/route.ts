import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { createGenerationRun } from "@/lib/generation";

const createCourseSchema = z.object({
  topic: z.string().trim().optional(),
  pathId: z.string().trim().optional()
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
    const run = await createGenerationRun(body);
    return NextResponse.json({ runId: run.id, status: run.status }, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create course.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
