import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const run = await prisma.generationRun.findUnique({
    where: { id },
    include: {
      course: {
        select: {
          id: true,
          title: true
        }
      }
    }
  });

  if (!run) {
    return NextResponse.json({ error: "Generation run not found." }, { status: 404 });
  }

  const isStale =
    run.status === "running" && Date.now() - new Date(run.updatedAt).getTime() > 10 * 60 * 1000;

  if (isStale) {
    const failedRun = await prisma.generationRun.update({
      where: { id },
      data: {
        status: "failed",
        phase: "failed",
        error: "Generation was interrupted. Restart the dev server and create the course again."
      },
      include: {
        course: {
          select: {
            id: true,
            title: true
          }
        }
      }
    });

    return NextResponse.json({ run: failedRun });
  }

  return NextResponse.json({ run });
}
