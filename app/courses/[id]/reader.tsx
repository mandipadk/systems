"use client";

import { MouseEvent, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
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
  contract?: {
    requiredExamples?: string[];
    requiredDiagrams?: string[];
    requiredTable?: string;
    requiredCodeTrace?: string;
    requiredFailureModes?: string[];
    exerciseTargets?: string[];
  } | null;
  mistakeBank?: Array<{
    mistake: string;
    whyItTempts: string;
    counterexample: string;
    debuggingHeuristic: string;
  }> | null;
  reviewArtifacts?: {
    flashcards?: string[];
    oralPrompts?: string[];
    implementationDrills?: string[];
  } | null;
  qualityReview?: {
    overallScore: number;
    revised: boolean;
    revisionCount: number;
    diagramStatus: string;
    exerciseDifficulty: string;
  } | null;
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

const regenerationModes = [
  {
    value: "deeper",
    label: "Deeper",
    description: "Rewrite this lesson with more detail, examples, edge cases, and connective explanation."
  },
  {
    value: "math",
    label: "Math",
    description: "Regenerate with more notation, definitions, derivations, and mathematical framing."
  },
  {
    value: "code-trace",
    label: "Code trace",
    description: "Regenerate with pseudocode, implementation details, and step-by-step state traces."
  },
  {
    value: "proof",
    label: "Proof",
    description: "Regenerate around invariants, correctness arguments, counterexamples, and proof sketches."
  },
  {
    value: "intuition",
    label: "Intuition",
    description: "Regenerate around mental models and concrete intuition before formal details."
  },
  {
    value: "interview-drills",
    label: "Interview",
    description: "Regenerate with interview patterns, traps, constraints, and practice ladders."
  }
] as const;

type RegenerationMode = (typeof regenerationModes)[number]["value"];

function Tooltip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="group/tooltip relative inline-flex">
      {children}
      <span className="pointer-events-none absolute right-0 top-full z-40 mt-2 w-64 border border-rule bg-ink px-3 py-2 text-left text-xs leading-5 text-paper opacity-0 shadow-[0_12px_30px_rgba(31,37,35,0.18)] transition group-hover/tooltip:opacity-100 group-focus-within/tooltip:opacity-100">
        {label}
      </span>
    </span>
  );
}

export function CourseReader({ course }: { course: Course }) {
  const router = useRouter();
  const [pendingLessonId, setPendingLessonId] = useState("");
  const [isRefreshing, startTransition] = useTransition();
  const [activeSelection, setActiveSelection] = useState<ActiveSelection | null>(null);
  const [commentPrompt, setCommentPrompt] = useState("Explain this more deeply with a concrete example.");
  const [commentPending, setCommentPending] = useState(false);
  const [regenerateMode, setRegenerateMode] = useState<RegenerationMode>("deeper");
  const [comments, setComments] = useState(course.comments);
  const [state, setState] = useState<LocalState>(() => {
    return Object.fromEntries(course.studyStates.map((item) => [item.lessonId, item]));
  });

  const lessons = useMemo(() => course.modules.flatMap((module) => module.lessons), [course.modules]);
  const completed = lessons.filter((lesson) => state[lesson.id]?.completed).length;
  const selectedMode = regenerationModes.find((mode) => mode.value === regenerateMode) ?? regenerationModes[0];

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
    await fetch(`/api/sections/${lessonId}/regenerate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: regenerateMode })
    });
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
                title="Close this explanation command without saving a note."
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
              title="Ask AI to explain the selected text and save the answer under this lesson."
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
                      <Tooltip
                        label={`Regeneration mode: ${selectedMode.description} Changing this does not regenerate by itself; click the reload button next.`}
                      >
                        <select
                          aria-label={`Regeneration mode. ${selectedMode.description}`}
                          title={`Regeneration mode: ${selectedMode.description}`}
                          value={regenerateMode}
                          onChange={(event) => setRegenerateMode(event.target.value as RegenerationMode)}
                          className="h-10 border border-rule bg-paper px-2 text-xs text-ink/70 outline-none"
                        >
                          {regenerationModes.map((mode) => (
                            <option key={mode.value} value={mode.value} title={mode.description}>
                              {mode.label}
                            </option>
                          ))}
                        </select>
                      </Tooltip>
                      <Tooltip label={local?.bookmarked ? "Remove this lesson from your bookmarks." : "Bookmark this lesson so it is easy to return to later."}>
                        <button
                          aria-label={local?.bookmarked ? "Remove bookmark" : "Bookmark lesson"}
                          title={local?.bookmarked ? "Remove bookmark" : "Bookmark this lesson"}
                          onClick={() => patchState(lesson.id, { bookmarked: !local?.bookmarked })}
                          className={`inline-flex h-10 w-10 items-center justify-center border transition ${
                            local?.bookmarked ? "border-moss bg-moss text-paper" : "border-rule bg-paper text-ink/60"
                          }`}
                        >
                          <Bookmark className="h-4 w-4" />
                        </button>
                      </Tooltip>
                      <Tooltip label={local?.completed ? "Mark this lesson as not completed." : "Mark this lesson complete and update course progress."}>
                        <button
                          aria-label={local?.completed ? "Mark lesson incomplete" : "Mark lesson complete"}
                          title={local?.completed ? "Mark incomplete" : "Mark complete"}
                          onClick={() => patchState(lesson.id, { completed: !local?.completed })}
                          className={`inline-flex h-10 w-10 items-center justify-center border transition ${
                            local?.completed ? "border-moss bg-moss text-paper" : "border-rule bg-paper text-ink/60"
                          }`}
                        >
                          <Check className="h-4 w-4" />
                        </button>
                      </Tooltip>
                      <Tooltip
                        label={`Regenerate this lesson using ${selectedMode.label} mode. This replaces only this lesson after the AI finishes.`}
                      >
                        <button
                          aria-label={`Regenerate lesson using ${selectedMode.label} mode`}
                          title={`Regenerate lesson using ${selectedMode.label} mode`}
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
                      </Tooltip>
                    </div>
                  </div>

                  <div className="prose-book">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{lesson.content}</ReactMarkdown>
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
                      title="Reveal and persist the solution for this practice question."
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

                  {lesson.mistakeBank?.length ? (
                    <div className="my-6 border border-rule bg-paper p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brick">Mistake bank</p>
                      <div className="mt-3 space-y-3">
                        {lesson.mistakeBank.map((item, index) => (
                          <div key={`${lesson.id}-mistake-${index}`} className="border-t border-rule pt-3 first:border-t-0 first:pt-0">
                            <p className="text-sm font-semibold text-ink">{item.mistake}</p>
                            <p className="mt-1 text-sm leading-6 text-ink/65">Why it tempts: {item.whyItTempts}</p>
                            <p className="mt-1 text-sm leading-6 text-ink/65">Counterexample: {item.counterexample}</p>
                            <p className="mt-1 text-sm leading-6 text-ink/65">Debugging heuristic: {item.debuggingHeuristic}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {lesson.reviewArtifacts ? (
                    <div className="my-6 grid gap-3 border border-rule bg-paper p-4 md:grid-cols-3">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-moss">Flashcards</p>
                        <ul className="mt-2 space-y-2 text-sm leading-6 text-ink/65">
                          {(lesson.reviewArtifacts.flashcards ?? []).map((item, index) => (
                            <li key={`${lesson.id}-flashcard-${index}`}>{item}</li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-moss">Oral prompts</p>
                        <ul className="mt-2 space-y-2 text-sm leading-6 text-ink/65">
                          {(lesson.reviewArtifacts.oralPrompts ?? []).map((item, index) => (
                            <li key={`${lesson.id}-oral-${index}`}>{item}</li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-moss">Drills</p>
                        <ul className="mt-2 space-y-2 text-sm leading-6 text-ink/65">
                          {(lesson.reviewArtifacts.implementationDrills ?? []).map((item, index) => (
                            <li key={`${lesson.id}-drill-${index}`}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  ) : null}

                  {lesson.qualityReview ? (
                    <div className="mt-6 border-t border-rule pt-4 text-xs leading-6 text-ink/45">
                      Quality: {lesson.qualityReview.overallScore}/10
                      {lesson.qualityReview.revised ? `, revised ${lesson.qualityReview.revisionCount}x` : ""}
                      {lesson.qualityReview.diagramStatus ? `, diagram ${lesson.qualityReview.diagramStatus}` : ""}
                    </div>
                  ) : null}

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
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>{comment.response}</ReactMarkdown>
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
