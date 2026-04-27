"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { ArrowRight, BookOpen, Loader2, Sparkles } from "lucide-react";
import type { LearningPath } from "@/lib/paths";

type CourseListItem = {
  id: string;
  title: string;
  topic: string;
  summary: string;
  level: string;
  updatedAt: string;
};

type RunState = {
  id: string;
  status: string;
  phase: string;
  progress: number;
  course?: { id: string; title: string } | null;
  error?: string | null;
};

function removeLeakedMermaidErrors() {
  Array.from(document.body.children).forEach((node) => {
    const text = node.textContent ?? "";
    if (text.includes("Syntax error in text") && text.includes("mermaid version")) {
      node.remove();
    }
  });
}

export function HomeClient({ paths, courses }: { paths: LearningPath[]; courses: CourseListItem[] }) {
  const router = useRouter();
  const [topic, setTopic] = useState("");
  const [run, setRun] = useState<RunState | null>(null);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);

  const canSubmit = useMemo(() => topic.trim().length > 2 && !creating && !run, [topic, creating, run]);

  useEffect(() => {
    removeLeakedMermaidErrors();
  }, []);

  async function createCourse(payload: { topic?: string; pathId?: string }) {
    setError("");
    setCreating(true);
    try {
      const response = await fetch("/api/courses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to create course.");
      setRun({ id: data.runId, status: "queued", phase: "queued", progress: 0 });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to create course.");
    } finally {
      setCreating(false);
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    await createCourse({ topic });
  }

  useEffect(() => {
    if (!run || run.status === "completed" || run.status === "failed") return;

    const interval = window.setInterval(async () => {
      try {
        const response = await fetch(`/api/generation-runs/${run.id}`);
        const data = await response.json();
        if (!response.ok) {
          setError(data.error || "Unable to read generation status.");
          window.clearInterval(interval);
          return;
        }

        setRun(data.run);
        if (data.run.status === "completed" && data.run.course?.id) {
          window.clearInterval(interval);
          router.push(`/courses/${data.run.course.id}`);
        }
        if (data.run.status === "failed") {
          window.clearInterval(interval);
        }
      } catch {
        setError("Could not reach the local server. Make sure the dev server is still running.");
        window.clearInterval(interval);
      }
    }, 1400);

    return () => window.clearInterval(interval);
  }, [router, run]);

  return (
    <main className="min-h-screen px-5 py-8 sm:px-8">
      <section className="mx-auto flex min-h-[58vh] w-full max-w-4xl flex-col justify-center">
        <div className="mb-10">
          <p className="mb-4 text-sm uppercase tracking-[0.22em] text-moss">Systems</p>
          <h1 className="max-w-3xl font-serif text-5xl leading-[1.02] text-ink sm:text-7xl">
            Learn the thing deeply enough that it becomes yours.
          </h1>
        </div>

        <form onSubmit={onSubmit} className="flex flex-col gap-3 border-b border-t border-rule py-5 sm:flex-row">
          <input
            value={topic}
            onChange={(event) => setTopic(event.target.value)}
            placeholder="BFS and DFS, transformer training, databases, probability for quant..."
            className="min-h-14 flex-1 bg-transparent text-lg text-ink outline-none placeholder:text-ink/35"
          />
          <button
            type="submit"
            disabled={!canSubmit}
            className="inline-flex min-h-12 items-center justify-center gap-2 bg-ink px-5 text-sm font-medium text-paper transition hover:bg-steel disabled:cursor-not-allowed disabled:opacity-40"
          >
            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
            Create course
          </button>
        </form>

        {run ? (
          <div className="mt-6 border border-rule bg-paper/70 p-5">
            <div className="mb-3 flex items-center gap-3 text-sm text-steel">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>{run.phase}</span>
              <span>{run.progress}%</span>
            </div>
            <div className="h-2 bg-rule">
              <div className="h-full bg-moss transition-all" style={{ width: `${run.progress}%` }} />
            </div>
            {run.error ? <p className="mt-3 text-sm text-brick">{run.error}</p> : null}
          </div>
        ) : null}

        {error ? <p className="mt-4 text-sm text-brick">{error}</p> : null}
      </section>

      <section className="mx-auto grid w-full max-w-6xl gap-10 border-t border-rule py-10 lg:grid-cols-[1.1fr_0.9fr]">
        <div>
          <div className="mb-5 flex items-center gap-2 text-sm uppercase tracking-[0.18em] text-moss">
            <Sparkles className="h-4 w-4" />
            Predefined paths
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {paths.map((path) => (
              <button
                key={path.id}
                onClick={() => createCourse({ pathId: path.id })}
                disabled={Boolean(run) || creating}
                className="border border-rule bg-paper/65 p-4 text-left transition hover:border-moss hover:bg-paper disabled:cursor-not-allowed disabled:opacity-45"
              >
                <h2 className="font-serif text-2xl text-ink">{path.title}</h2>
                <p className="mt-2 text-sm leading-6 text-ink/65">{path.description}</p>
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="mb-5 flex items-center gap-2 text-sm uppercase tracking-[0.18em] text-moss">
            <BookOpen className="h-4 w-4" />
            Library
          </div>
          <div className="space-y-3">
            {courses.length ? (
              courses.map((course) => (
                <Link
                  key={course.id}
                  href={`/courses/${course.id}`}
                  className="block border-b border-rule py-3 transition hover:border-moss"
                >
                  <h2 className="font-serif text-xl text-ink">{course.title}</h2>
                  <p className="mt-1 line-clamp-2 text-sm leading-6 text-ink/65">{course.summary}</p>
                </Link>
              ))
            ) : (
              <p className="border-b border-rule py-3 text-sm leading-6 text-ink/60">
                Generated courses will appear here and stay available between sessions.
              </p>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
