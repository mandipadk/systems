import { NextResponse } from "next/server";
import { regenerateLesson } from "@/lib/generation";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const lesson = await regenerateLesson(id);
    return NextResponse.json({ lesson });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to regenerate section.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
