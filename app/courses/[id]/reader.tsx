"use client";

import { MouseEvent, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import { Bookmark, Check, Loader2, MessageSquare, RefreshCcw, X } from "lucide-react";
import { Mermaid } from "@/components/Mermaid";

type Source = {
  id: string;
  title: string;
  url: string;
  publisher?: string | null;
  publishedAt?: string | null;
};

type Lesson = {
  id: string;
  order: number;
  title: string;
  content: string;
  diagram?: string | null;
  diagramCaption?: string | null;
  checkpoint: string;
  exercisePrompt: string;
  hint: string;
  solution: string;
  transferNote: string;
  citations: number[];
};

type Module = {
  id: string;
  order: number;
  title: string;
  summary: string;
  lessons: Lesson[];
};

type StudyState = {
  lessonId: string;
  completed: boolean;
  bookmarked: boolean;
  solutionRevealed: boolean;
};

type SelectionComment = {
  id: string;
  courseId: string;
  lessonId?: string | null;
  selectedText: string;
  prompt: string;
  response: string;
  createdAt: string;
};

type Course = {
  id: string;
  title: string;
  topic: string;
  summary: string;
  level: string;
  modules: Module[];
  sources: Source[];
  studyStates: StudyState[];
  comments: SelectionComment[];
};

type LocalState = Record<string, StudyState>;

type ActiveSelection = {
  text: string;
  lessonId?: string;
  top: number;
  left: number;
};

export function CourseReader({ course }: { course: Course }) {
  const router = useRouter();
  const [pendingLessonId, setPendingLessonId] = useState("");
  const [isRefreshing, startTransition] = useTransition();
  const [activeSelection, setActiveSelection] = useState<ActiveSelection | null>(null);
  const [commentPrompt, setCommentPrompt] = useState("Explain this more deeply with a concrete example.");
  const [commentPending, setCommentPending] = useState(false);
  const [comments, setComments] = useState(course.comments);
  const [state, setState] = useState<LocalState>(() => {
    return Object.fromEntries(course.studyStates.map((item) => [item.lessonId, item]));
  });

  const lessons = useMemo(() => course.modules.flatMap((module) => module.lessons), [course.modules]);
  const completed = lessons.filter((lesson) => state[lesson.id]?.completed).length;

  async function patchState(lessonId: string, patch: Partial<StudyState>) {
    const previous = state[lessonId] ?? {
      lessonId,
      completed: false,
      bookmarked: false,
      solutionRevealed: false
    };
    const next = { ...previous, ...patch };
    setState((current) => ({ ...current, [lessonId]: next }));
    await fetch("/api/study-state", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ courseId: course.id, lessonId, ...patch })
    });
  }

  async function regenerate(lessonId: string) {
    setPendingLessonId(lessonId);
    await fetch(`/api/sections/${lessonId}/regenerate`, { method: "POST" });
    setPendingLessonId("");
    startTransition(() => router.refresh());
  }

  function captureSelection(event: MouseEvent<HTMLElement>) {
    const selection = window.getSelection();
    const text = selection?.toString().trim() ?? "";
    if (!selection || selection.isCollapsed || text.length < 3) return;

    const range = selection.getRangeAt(0);
    const container =
      range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
        ? (range.commonAncestorContainer as Element)
        : range.commonAncestorContainer.parentElement;
    const reader = container?.closest("[data-course-reader]");
    if (!reader) return;

    const lessonEl = container?.closest<HTMLElement>("[data-lesson-id]");
    const rect = range.getBoundingClientRect();
    setActiveSelection({
      text: text.slice(0, 3000),
      lessonId: lessonEl?.dataset.lessonId,
      top: Math.max(12, rect.top - 58),
      left: Math.min(window.innerWidth - 380, Math.max(12, rect.left))
    });
    event.stopPropagation();
  }

  async function createComment() {
    if (!activeSelection) return;
    setCommentPending(true);
    try {
      const response = await fetch("/api/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          courseId: course.id,
          lessonId: activeSelection.lessonId,
          selectedText: activeSelection.text,
          prompt: commentPrompt
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to create explanation.");
      setComments((current) => [data.comment, ...current]);
      setActiveSelection(null);
      window.getSelection()?.removeAllRanges();
    } finally {
      setCommentPending(false);
    }
  }

  return (
    <div className="mx-auto grid max-w-6xl gap-7 lg:grid-cols-[260px_minmax(0,1fr)]">
      <aside className="lg:sticky lg:top-6 lg:h-[calc(100vh-3rem)] lg:overflow-auto">
        <div className="border-b border-rule pb-5">
          <p className="text-xs uppercase tracking-[0.2em] text-moss">{course.level}</p>
          <h1 className="mt-3 font-serif text-3xl leading-tight text-ink">{course.title}</h1>
          <p className="mt-4 text-sm leading-6 text-ink/65">{course.summary}</p>
          <div className="mt-5 h-2 bg-rule">
            <div className="h-full bg-moss" style={{ width: `${(completed / Math.max(lessons.length, 1)) * 100}%` }} />
          </div>
          <p className="mt-2 text-xs text-ink/50">
            {completed} of {lessons.length} lessons complete
          </p>
        </div>

        <nav className="mt-5 space-y-5">
          {course.modules.map((module) => (
            <div key={module.id}>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-steel">{module.title}</p>
              <div className="mt-2 space-y-1">
                {module.lessons.map((lesson) => (
                  <a
                    key={lesson.id}
                    href={`#${lesson.id}`}
                    className="block border-l border-rule py-1.5 pl-3 text-sm leading-5 text-ink/65 transition hover:border-moss hover:text-ink"
                  >
                    {lesson.title}
                  </a>
                ))}
              </div>
            </div>
          ))}
        </nav>
      </aside>

      <article data-course-reader className="bg-paper/55 pb-16" onMouseUp={captureSelection}>
        {activeSelection ? (
          <div
            className="fixed z-50 w-[360px] border border-rule bg-paper p-3 shadow-[0_18px_45px_rgba(31,37,35,0.16)]"
            style={{ top: activeSelection.top, left: activeSelection.left }}
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-steel">
                <MessageSquare className="h-3.5 w-3.5" />
                Explain selection
              </div>
              <button
                aria-label="Close explanation command"
                className="text-ink/50 transition hover:text-ink"
                onClick={() => setActiveSelection(null)}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mb-2 line-clamp-2 text-xs leading-5 text-ink/55">{activeSelection.text}</p>
            <textarea
              value={commentPrompt}
              onChange={(event) => setCommentPrompt(event.target.value)}
              className="h-20 w-full resize-none border border-rule bg-white/60 p-2 text-sm leading-5 outline-none focus:border-steel"
            />
            <button
              onClick={createComment}
              disabled={commentPending}
              className="mt-2 inline-flex min-h-9 w-full items-center justify-center gap-2 bg-ink px-3 text-sm text-paper transition hover:bg-steel disabled:opacity-50"
            >
              {commentPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageSquare className="h-4 w-4" />}
              Save explanation
            </button>
          </div>
        ) : null}

        {course.modules.map((module, moduleIndex) => (
          <section key={module.id} className="border-b border-rule px-0 pb-9 sm:px-7">
            <header className="mx-auto max-w-[760px] py-7">
              <p className="text-xs uppercase tracking-[0.18em] text-moss">Module {moduleIndex + 1}</p>
              <h2 className="mt-2 font-serif text-3xl text-ink">{module.title}</h2>
              <p className="mt-2 text-sm leading-6 text-ink/65">{module.summary}</p>
            </header>

            {module.lessons.map((lesson) => {
              const local = state[lesson.id];
              const lessonComments = comments.filter((comment) => comment.lessonId === lesson.id);
              return (
                <section
                  key={lesson.id}
                  id={lesson.id}
                  data-lesson-id={lesson.id}
                  className="mx-auto max-w-[760px] scroll-mt-8 py-5"
                >
                  <div className="mb-4 flex flex-wrap items-start justify-between gap-3 border-t border-rule pt-5">
                    <h3 className="font-serif text-2xl leading-tight text-ink">{lesson.title}</h3>
                    <div className="flex gap-2">
                      <button
                        aria-label="Bookmark lesson"
                        onClick={() => patchState(lesson.id, { bookmarked: !local?.bookmarked })}
                        className={`inline-flex h-10 w-10 items-center justify-center border transition ${
                          local?.bookmarked ? "border-moss bg-moss text-paper" : "border-rule bg-paper text-ink/60"
                        }`}
                      >
                        <Bookmark className="h-4 w-4" />
                      </button>
                      <button
                        aria-label="Mark complete"
                        onClick={() => patchState(lesson.id, { completed: !local?.completed })}
                        className={`inline-flex h-10 w-10 items-center justify-center border transition ${
                          local?.completed ? "border-moss bg-moss text-paper" : "border-rule bg-paper text-ink/60"
                        }`}
                      >
                        <Check className="h-4 w-4" />
                      </button>
                      <button
                        aria-label="Regenerate lesson"
                        onClick={() => regenerate(lesson.id)}
                        disabled={pendingLessonId === lesson.id || isRefreshing}
                        className="inline-flex h-10 w-10 items-center justify-center border border-rule bg-paper text-ink/60 transition hover:border-steel hover:text-ink disabled:opacity-50"
                      >
                        {pendingLessonId === lesson.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <RefreshCcw className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                  </div>

                  <div className="prose-book">
                    <ReactMarkdown>{lesson.content}</ReactMarkdown>
                  </div>

                  {lesson.diagram ? (
                    <figure className="my-8">
                      <Mermaid chart={lesson.diagram} />
                      {lesson.diagramCaption ? (
                        <figcaption className="mt-2 text-sm leading-6 text-ink/55">{lesson.diagramCaption}</figcaption>
                      ) : null}
                    </figure>
                  ) : null}

                  <div className="my-6 border-l-4 border-steel bg-paper p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-steel">Checkpoint</p>
                    <p className="mt-2 font-serif text-base leading-7">{lesson.checkpoint}</p>
                  </div>

                  <div className="my-6 border border-rule bg-paper p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-moss">Practice</p>
                    <p className="mt-3 font-serif text-base leading-7">{lesson.exercisePrompt}</p>
                    <details className="mt-4 border-t border-rule pt-4">
                      <summary className="cursor-pointer text-sm font-medium text-steel">Hint</summary>
                      <p className="mt-3 text-sm leading-6 text-ink/70">{lesson.hint}</p>
                    </details>
                    <button
                      onClick={() => patchState(lesson.id, { solutionRevealed: true })}
                      className="mt-4 border border-rule px-3 py-2 text-sm text-ink/70 transition hover:border-moss hover:text-ink"
                    >
                      Reveal solution
                    </button>
                    {local?.solutionRevealed ? (
                      <div className="mt-4 border-t border-rule pt-4 font-serif leading-8">{lesson.solution}</div>
                    ) : null}
                  </div>

                  <div className="my-8 border-t border-rule pt-5">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brick">Transfer</p>
                    <p className="mt-2 text-sm leading-7 text-ink/70">{lesson.transferNote}</p>
                  </div>

                  {lessonComments.length ? (
                    <div className="my-6 space-y-3 border-t border-rule pt-5">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-steel">Saved explanations</p>
                      {lessonComments.map((comment) => (
                        <div key={comment.id} className="border border-rule bg-paper p-4">
                          <blockquote className="border-l-2 border-moss pl-3 text-sm leading-6 text-ink/60">
                            {comment.selectedText}
                          </blockquote>
                          <p className="mt-3 text-xs font-semibold uppercase tracking-[0.14em] text-moss">
                            {comment.prompt}
                          </p>
                          <div className="prose-book mt-2 text-[0.98rem]">
                            <ReactMarkdown>{comment.response}</ReactMarkdown>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  {lesson.citations?.length ? (
                    <div className="mt-6 text-xs leading-6 text-ink/50">
                      Sources:{" "}
                      {lesson.citations.map((sourceIndex, index) => {
                        const source = course.sources[sourceIndex];
                        if (!source) return null;
                        return (
                          <span key={`${lesson.id}-${sourceIndex}`}>
                            <a className="underline decoration-rule underline-offset-4" href={source.url} target="_blank">
                              {source.title}
                            </a>
                            {index < lesson.citations.length - 1 ? ", " : ""}
                          </span>
                        );
                      })}
                    </div>
                  ) : null}
                </section>
              );
            })}
          </section>
        ))}

        <section className="mx-auto max-w-3xl px-0 py-10 sm:px-8">
          <h2 className="font-serif text-3xl text-ink">Course sources</h2>
          <ol className="mt-4 space-y-3">
            {course.sources.map((source) => (
              <li key={source.id} className="border-b border-rule pb-3 text-sm leading-6 text-ink/70">
                <a className="font-medium text-ink underline decoration-rule underline-offset-4" href={source.url} target="_blank">
                  {source.title}
                </a>
                {source.publisher ? <span> - {source.publisher}</span> : null}
                {source.publishedAt ? <span> ({source.publishedAt})</span> : null}
              </li>
            ))}
          </ol>
        </section>
      </article>
    </div>
  );
}
