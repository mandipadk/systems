import { NextResponse } from "next/server";
import { z } from "zod";
import { regenerateLesson } from "@/lib/generation";

const regenerateSchema = z.object({
  mode: z
    .enum(["deeper", "math", "code-trace", "proof", "intuition", "interview-drills"])
    .optional()
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body = regenerateSchema.parse(await request.json().catch(() => ({})));
    const lesson = await regenerateLesson(id, body.mode);
    return NextResponse.json({ lesson });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to regenerate section.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
