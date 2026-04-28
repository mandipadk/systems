import OpenAI from "openai";
import type { Prisma } from "@prisma/client";
import { prisma } from "./db";
import {
  courseOutlineSchema,
  generatedCourseSchema,
  lessonJsonSchema,
  outlineJsonSchema,
  sectionSchema,
  type CourseOutline,
  type GeneratedCourse,
  type GeneratedLesson
} from "./course-schema";
import { getPath } from "./paths";

const activeRuns = new Set<string>();
const OPENAI_TIMEOUT_MS = 180_000;
const lessonReviewJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["overallScore", "shouldRevise", "issues", "revisionInstructions"],
  properties: {
    overallScore: { type: "integer", minimum: 1, maximum: 10 },
    shouldRevise: { type: "boolean" },
    issues: {
      type: "array",
      items: { type: "string" }
    },
    revisionInstructions: { type: "string" }
  }
} as const;

type LessonReview = {
  overallScore: number;
  shouldRevise: boolean;
  issues: string[];
  revisionInstructions: string;
};

type LessonWithQuality = GeneratedLesson & {
  contract?: CourseOutline["modules"][number]["lessons"][number]["contract"];
  qualityReview?: LessonReview & {
    revised: boolean;
    revisionCount: number;
    dimensions: Record<string, number>;
    sourceCoverage: number;
    exerciseDifficulty: string;
    diagramStatus: string;
    checks: Record<string, unknown>;
  };
};

type CourseWithQuality = Omit<GeneratedCourse, "modules"> & {
  modules: Array<Omit<GeneratedCourse["modules"][number], "lessons"> & {
    lessons: LessonWithQuality[];
  }>;
};

export function normalizeTopicKey(topic: string) {
  return topic.trim().toLocaleLowerCase();
}

function getTopic(topic?: string | null, pathId?: string | null) {
  const selectedPath = getPath(pathId);
  return selectedPath?.topic ?? topic?.trim() ?? "";
}

async function updateRun(runId: string, phase: string, progress: number, status = "running") {
  await prisma.generationRun.update({
    where: { id: runId },
    data: { phase, progress, status }
  });
}

function extractText(response: unknown) {
  const maybe = response as { output_text?: string };
  if (maybe.output_text) return maybe.output_text;
  return JSON.stringify(response);
}

function parseResponseJson<T>(response: unknown, context: string): T {
  const maybe = response as {
    output_text?: string;
    status?: string;
    incomplete_details?: unknown;
  };

  if (maybe.status === "incomplete") {
    throw new Error(
      `${context} returned an incomplete response. Details: ${JSON.stringify(maybe.incomplete_details ?? {})}`
    );
  }

  const text = extractText(response).trim();
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `${context} returned malformed JSON. ${detail}. Response prefix: ${text.slice(0, 500)}`
    );
  }
}

function toInputJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function normalizeDiagram(diagram?: string) {
  if (!diagram) return undefined;
  const cleaned = diagram
    .replace(/^```(?:mermaid)?/i, "")
    .replace(/```$/i, "")
    .replace(/\r\n/g, "\n")
    .trim();
  const supported = /^(flowchart|graph|sequenceDiagram|stateDiagram-v2|stateDiagram|classDiagram|erDiagram|mindmap|timeline)\b/i;
  return supported.test(cleaned) ? cleaned : undefined;
}

function normalizeLesson(lesson: GeneratedLesson): GeneratedLesson {
  const diagram = normalizeDiagram(lesson.diagram);
  return {
    ...lesson,
    diagram,
    diagramCaption: diagram ? lesson.diagramCaption : undefined
  };
}

function countWords(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function validateMarkdownTables(markdown: string) {
  const lines = markdown.split("\n");
  return lines.some((line, index) => {
    const next = lines[index + 1] ?? "";
    return line.includes("|") && /^\s*\|?\s*:?-{3,}:?\s*\|/.test(next);
  });
}

function extractCodeFenceLanguages(markdown: string) {
  return Array.from(markdown.matchAll(/```([a-zA-Z0-9_-]*)\n[\s\S]*?```/g)).map((match) => match[1] || "plain");
}

function validateLessonArtifacts(lesson: GeneratedLesson, sourceCount: number) {
  const citations = lesson.citations ?? [];
  const validCitations = citations.every((index) => Number.isInteger(index) && index >= 0 && index < sourceCount);
  const uniqueCitationCount = new Set(citations).size;
  const hasTable = validateMarkdownTables(lesson.content);
  const codeFenceLanguages = extractCodeFenceLanguages(lesson.content);
  const hasBalancedCodeFences = (lesson.content.match(/```/g) ?? []).length % 2 === 0;
  const diagramStatus = lesson.diagram ? "present-normalized" : "missing-or-invalid";

  return {
    wordCount: countWords(lesson.content),
    validCitations,
    citationCount: citations.length,
    uniqueCitationCount,
    sourceCoverage: sourceCount ? uniqueCitationCount / sourceCount : 0,
    hasTable,
    codeFenceCount: codeFenceLanguages.length,
    codeFenceLanguages,
    hasBalancedCodeFences,
    diagramStatus,
    mistakeBankCount: lesson.mistakeBank?.length ?? 0,
    flashcardCount: lesson.reviewArtifacts?.flashcards?.length ?? 0,
    oralPromptCount: lesson.reviewArtifacts?.oralPrompts?.length ?? 0,
    implementationDrillCount: lesson.reviewArtifacts?.implementationDrills?.length ?? 0
  };
}

function lessonReviewExcerpt(lesson: GeneratedLesson) {
  return {
    title: lesson.title,
    contentExcerpt: lesson.content.slice(0, 7000),
    checkpoint: lesson.checkpoint,
    exercisePrompt: lesson.exercisePrompt,
    solutionExcerpt: lesson.solution.slice(0, 1200),
    transferNote: lesson.transferNote,
    citationCount: lesson.citations.length,
    hasDiagram: Boolean(lesson.diagram),
    mistakeBankCount: lesson.mistakeBank?.length ?? 0,
    reviewArtifacts: {
      flashcardCount: lesson.reviewArtifacts?.flashcards?.length ?? 0,
      oralPromptCount: lesson.reviewArtifacts?.oralPrompts?.length ?? 0,
      implementationDrillCount: lesson.reviewArtifacts?.implementationDrills?.length ?? 0
    }
  };
}

function localReviewLesson(input: {
  perspective: "technical-correctness" | "pedagogy" | "interview-transfer" | "anti-laziness";
  lesson: GeneratedLesson;
  sourceCount: number;
  error?: unknown;
}): LessonReview {
  const checks = validateLessonArtifacts(input.lesson, input.sourceCount);
  const issues: string[] = [];
  let score = 9;

  if (checks.wordCount < 1100) {
    score -= 2;
    issues.push(`Content is short for a book-like lesson (${checks.wordCount} words).`);
  }
  if (!checks.validCitations || checks.citationCount === 0) {
    score -= 1;
    issues.push("Citations are missing or invalid.");
  }
  if (!checks.hasTable) {
    score -= 1;
    issues.push("No valid GitHub-flavored Markdown table was detected.");
  }
  if (checks.codeFenceCount === 0) {
    score -= 1;
    issues.push("No code or pseudocode block was detected.");
  }
  if (!checks.hasBalancedCodeFences) {
    score -= 1;
    issues.push("Code fences appear unbalanced.");
  }
  if (checks.diagramStatus !== "present-normalized") {
    score -= 1;
    issues.push("No valid normalized Mermaid diagram was detected.");
  }
  if (checks.mistakeBankCount < 2) {
    score -= 1;
    issues.push("Mistake bank is too thin.");
  }
  if (checks.implementationDrillCount < 1) {
    score -= 1;
    issues.push("No implementation drill was detected.");
  }
  if (input.error) {
    score = Math.min(score, 7);
    const message = input.error instanceof Error ? input.error.message : String(input.error);
    issues.push(`Model reviewer failed, so deterministic local review was used. ${message.slice(0, 240)}`);
  }

  const boundedScore = Math.max(1, Math.min(10, score));
  return {
    overallScore: boundedScore,
    shouldRevise: boundedScore < 8,
    issues,
    revisionInstructions:
      issues.length > 0
        ? `Address these ${input.perspective} issues directly: ${issues.join(" ")}`
        : `No major ${input.perspective} issues detected by deterministic checks.`
  };
}

function createOpenAIClient() {
  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    timeout: OPENAI_TIMEOUT_MS,
    maxRetries: 1
  });
}

function requireOpenAIKey() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured. Add it to .env and restart the dev server before generating a course.");
  }
}

async function formatGenerationError(error: unknown, runId: string) {
  const run = await prisma.generationRun.findUnique({
    where: { id: runId },
    select: { phase: true }
  });
  const phase = run?.phase || "generation";
  const raw = error instanceof Error ? error.message : String(error);
  const name = error instanceof Error ? error.name : "";
  const lower = `${name} ${raw}`.toLowerCase();

  if (lower.includes("timeout") || lower.includes("timed out")) {
    return `The OpenAI request timed out while ${phase}. This usually means the lesson request was too large or the model/tool call took too long. Nothing was saved for this failed run. Try again, or narrow the topic slightly. The app now uses longer per-request timeouts, but frontier/long-form topics can still occasionally need a retry.`;
  }

  if (lower.includes("rate limit") || lower.includes("429")) {
    return `OpenAI rate-limited the request while ${phase}. Wait a bit and retry. Nothing was saved for this failed run.`;
  }

  if (lower.includes("401") || lower.includes("api key") || lower.includes("authentication")) {
    return `OpenAI authentication failed while ${phase}. Check OPENAI_API_KEY in .env, then restart the dev server.`;
  }

  if (lower.includes("json") || lower.includes("zod") || lower.includes("parse")) {
    return `The model returned malformed structured content while ${phase}. This is a content-format failure, not your fault. Try regenerating; the pipeline will ask for stricter structured output again. Technical detail: ${raw}`;
  }

  return `Generation failed while ${phase}. Nothing was saved for this failed run. Technical detail: ${raw}`;
}

async function createCourseOutline(client: OpenAI, topic: string): Promise<CourseOutline> {
  const response = await client.responses.create({
    model: process.env.OPENAI_FAST_MODEL || process.env.OPENAI_MODEL || "gpt-4.1-mini",
    max_output_tokens: 5000,
    tools: [{ type: "web_search_preview" }],
    text: {
      format: {
        type: "json_schema",
        name: "course_outline",
        schema: outlineJsonSchema,
        strict: true
      }
    },
    input: [
      {
        role: "system",
        content:
          "You are a research planner for rigorous computer science courses. Use web search for current and authoritative sources. Return only the requested structured outline."
      },
      {
        role: "user",
        content: `Create a serious course outline for: ${topic}.

Requirements:
- Exactly 10 modules.
- Exactly 1 lesson per module.
- Build the dossier first: source pack, prerequisite graph, concept map, terminology glossary, common misconceptions, canonical examples, and mastery outcomes.
- Each lesson must include a chapter contract that specifies required examples, diagram, table, code trace, failure modes, and exercise targets.
- Each lesson brief must describe the concrete lesson goal, not just name a topic.
- Sequence the course like a technical book: early intuition, precise model, worked examples, implementation, pitfalls, transfer, and mastery.
- Sources must be authoritative docs, papers, books, or high-quality engineering references.
- For current topics, include current cited sources.`
      }
    ]
  } as never, { timeout: OPENAI_TIMEOUT_MS });

  return courseOutlineSchema.parse(parseResponseJson(response, "course outline generation"));
}

async function createLesson(client: OpenAI, input: {
  topic: string;
  outline: CourseOutline;
  moduleTitle: string;
  moduleSummary: string;
  lessonTitle: string;
  lessonBrief: string;
  contract: CourseOutline["modules"][number]["lessons"][number]["contract"];
}): Promise<GeneratedLesson> {
  const sources = input.outline.sources
    .map((source, index) => `${index}. ${source.title} - ${source.url}`)
    .join("\n");

  const response = await client.responses.create({
    model: process.env.OPENAI_MODEL || "gpt-4.1",
    max_output_tokens: 9000,
    tools: [{ type: "web_search_preview" }],
    text: {
      format: {
        type: "json_schema",
        name: "course_lesson",
        schema: lessonJsonSchema,
        strict: true
      }
    },
    input: [
      {
        role: "system",
        content:
          "You write rigorous lessons for a personal computer science learning platform. Write like a patient senior engineer and technical author. Avoid motivational filler. The lesson must feel like a serious technical book chapter: dense enough to study, but clear enough to keep reading. Use tools for current facts when needed."
      },
      {
        role: "user",
        content: `Course topic: ${input.topic}
Course title: ${input.outline.title}
Module: ${input.moduleTitle}
Module summary: ${input.moduleSummary}
Lesson title: ${input.lessonTitle}
Lesson goal: ${input.lessonBrief}
Chapter contract:
${JSON.stringify(input.contract)}

Course dossier:
${JSON.stringify(input.outline.dossier)}

Allowed source indexes:
${sources}

Return one complete lesson.

Requirements:
- content must be long-form markdown, roughly 1400-2200 words.
- Use concrete examples, worked traces, small code listings when relevant, edge cases, and common mistakes.
- Satisfy every item in the chapter contract explicitly.
- Prefer compact sections with meaningful headings. Avoid one-sentence paragraphs.
- Include at least one of: a step-by-step trace, a comparison table, a code walkthrough, or a miniature design review.
- If you include a table, use valid GitHub-flavored Markdown table syntax with a header separator row.
- Include a valid Mermaid diagram when it helps. Prefer simple flowchart TD syntax like A["label"] --> B["label"]. Do not wrap the diagram in markdown fences.
- checkpoint must test the core invariant or mental model.
- exercisePrompt must be solvable without feeling impossible.
- hint must move the learner one step forward.
- solution must be complete and explanatory.
- transferNote must connect the lesson to interviews and real systems.
- citations must use indexes from the allowed source list.`
      }
    ]
  } as never, { timeout: OPENAI_TIMEOUT_MS });

  return normalizeLesson(sectionSchema.parse(parseResponseJson(response, `lesson generation for ${input.lessonTitle}`)));
}

async function reviewLesson(client: OpenAI, input: {
  topic: string;
  moduleTitle: string;
  lessonBrief: string;
  lesson: GeneratedLesson;
  sourceCount: number;
  perspective: "technical-correctness" | "pedagogy" | "interview-transfer" | "anti-laziness";
}): Promise<LessonReview> {
  try {
    const response = await client.responses.create({
      model: process.env.OPENAI_FAST_MODEL || process.env.OPENAI_MODEL || "gpt-4.1-mini",
      max_output_tokens: 3000,
      text: {
        format: {
          type: "json_schema",
          name: "lesson_review",
          schema: lessonReviewJsonSchema,
          strict: true
        }
      },
      input: [
        {
          role: "system",
          content: `You are a severe ${input.perspective} editor for a personal technical book. Your job is to detect shallow AI writing, missing examples, weak explanations, broken structure, and content that would not help a serious learner. Be strict.`
        },
        {
          role: "user",
          content: `Review this generated lesson for the Systems learning platform.

Topic: ${input.topic}
Module: ${input.moduleTitle}
Lesson goal: ${input.lessonBrief}

Standards:
- Must feel like a carefully curated technical book chapter, not a blog summary.
- Must include concrete examples, worked traces or code walkthroughs, edge cases, common mistakes, and a comparison table when useful.
- Must teach from first principles before interview/system transfer.
- Must avoid vague paragraphs, listicle filler, motivational fluff, and generic advice.
- Practice must be approachable but non-trivial.
- Diagram must be simple enough for Mermaid to parse.

Lesson excerpt and metadata:
${JSON.stringify(lessonReviewExcerpt(input.lesson))}

Return a strict review. Set shouldRevise true for anything below an 8.`
        }
      ]
    } as never, { timeout: OPENAI_TIMEOUT_MS });

    return parseResponseJson(response, `${input.perspective} lesson review`);
  } catch (error) {
    return localReviewLesson({
      perspective: input.perspective,
      lesson: input.lesson,
      sourceCount: input.sourceCount,
      error
    });
  }
}

async function reviseLesson(client: OpenAI, input: {
  topic: string;
  outline: CourseOutline;
  moduleTitle: string;
  moduleSummary: string;
  lessonTitle: string;
  lessonBrief: string;
  contract: CourseOutline["modules"][number]["lessons"][number]["contract"];
  draft: GeneratedLesson;
  review: LessonReview;
}): Promise<GeneratedLesson> {
  const sources = input.outline.sources
    .map((source, index) => `${index}. ${source.title} - ${source.url}`)
    .join("\n");

  const response = await client.responses.create({
    model: process.env.OPENAI_MODEL || "gpt-4.1",
    max_output_tokens: 9500,
    text: {
      format: {
        type: "json_schema",
        name: "revised_course_lesson",
        schema: lessonJsonSchema,
        strict: true
      }
    },
    input: [
      {
        role: "system",
        content:
          "You revise technical lessons into serious book-quality chapters. Address every editor issue directly. Preserve correctness, add concrete substance, and remove generic filler."
      },
      {
        role: "user",
        content: `Course topic: ${input.topic}
Course title: ${input.outline.title}
Module: ${input.moduleTitle}
Module summary: ${input.moduleSummary}
Lesson title: ${input.lessonTitle}
Lesson goal: ${input.lessonBrief}
Chapter contract:
${JSON.stringify(input.contract)}

Allowed source indexes:
${sources}

Editor score: ${input.review.overallScore}/10
Editor issues:
${input.review.issues.map((issue) => `- ${issue}`).join("\n")}

Revision instructions:
${input.review.revisionInstructions}

Draft lesson:
${JSON.stringify(input.draft)}

Return the full revised lesson JSON. Make the content denser, more concrete, and more book-like. Include GFM tables where comparison clarifies the concept. Mermaid diagrams must be valid and not wrapped in code fences.`
      }
    ]
  } as never, { timeout: OPENAI_TIMEOUT_MS });

  return normalizeLesson(sectionSchema.parse(parseResponseJson(response, `lesson revision for ${input.lessonTitle}`)));
}

function combineReviews(reviews: Array<LessonReview & { perspective: string }>, checks: ReturnType<typeof validateLessonArtifacts>) {
  const dimensions = Object.fromEntries(reviews.map((review) => [review.perspective, review.overallScore]));
  const overallScore = Math.round(reviews.reduce((sum, review) => sum + review.overallScore, 0) / reviews.length);
  const issues = reviews.flatMap((review) => review.issues.map((issue) => `${review.perspective}: ${issue}`));
  const shouldRevise =
    reviews.some((review) => review.shouldRevise || review.overallScore < 8) ||
    !checks.validCitations ||
    !checks.hasBalancedCodeFences ||
    checks.wordCount < 1100 ||
    checks.mistakeBankCount < 2 ||
    checks.implementationDrillCount < 1;

  return {
    overallScore,
    shouldRevise,
    issues,
    revisionInstructions: reviews.map((review) => `${review.perspective}: ${review.revisionInstructions}`).join("\n\n"),
    dimensions
  };
}

async function callOpenAIForCourse(
  topic: string,
  onProgress: (phase: string, progress: number) => Promise<void>
): Promise<CourseWithQuality> {
  requireOpenAIKey();
  const client = createOpenAIClient();

  await onProgress("researching sources and outlining course", 20);
  const outline = await createCourseOutline(client, topic);

  const totalLessons = outline.modules.reduce((sum, module) => sum + module.lessons.length, 0);
  let completedLessons = 0;
  const modules: CourseWithQuality["modules"] = [];

  for (const module of outline.modules) {
    const lessons: LessonWithQuality[] = [];
    for (const lesson of module.lessons) {
      const progress = 25 + Math.floor((completedLessons / Math.max(totalLessons, 1)) * 60);
      await onProgress(`writing lesson ${completedLessons + 1} of ${totalLessons}: ${lesson.title}`, progress);
      const draft = await createLesson(client, {
        topic,
        outline,
          moduleTitle: module.title,
          moduleSummary: module.summary,
          lessonTitle: lesson.title,
          lessonBrief: lesson.brief,
          contract: lesson.contract
        });
      await onProgress(`reviewing lesson ${completedLessons + 1} of ${totalLessons}: ${lesson.title}`, progress + 2);
      const perspectives = ["technical-correctness", "pedagogy", "interview-transfer", "anti-laziness"] as const;
      const reviews = await Promise.all(
        perspectives.map(async (perspective) => ({
          ...(await reviewLesson(client, {
            topic,
            moduleTitle: module.title,
            lessonBrief: lesson.brief,
            lesson: draft,
            sourceCount: outline.sources.length,
            perspective
          })),
          perspective
        }))
      );
      const draftChecks = validateLessonArtifacts(draft, outline.sources.length);
      const review = combineReviews(reviews, draftChecks);
      let revisionFailed = false;
      const finalLesson: LessonWithQuality =
        review.shouldRevise || review.overallScore < 8
          ? await reviseLesson(client, {
              topic,
              outline,
              moduleTitle: module.title,
              moduleSummary: module.summary,
              lessonTitle: lesson.title,
              lessonBrief: lesson.brief,
              contract: lesson.contract,
              draft,
              review
            }).catch((error: unknown) => {
              revisionFailed = true;
              const message = error instanceof Error ? error.message : String(error);
              review.issues.push(`revision: Model revision failed; keeping reviewed draft. ${message.slice(0, 240)}`);
              review.shouldRevise = false;
              review.overallScore = Math.min(review.overallScore, 7);
              return draft;
            })
          : draft;
      const finalChecks = validateLessonArtifacts(finalLesson, outline.sources.length);
      finalLesson.contract = lesson.contract;
      finalLesson.qualityReview = {
        ...review,
        revised: finalLesson !== draft && !revisionFailed,
        revisionCount: finalLesson !== draft && !revisionFailed ? 1 : 0,
        sourceCoverage: finalChecks.sourceCoverage,
        exerciseDifficulty: "moderate",
        diagramStatus: finalChecks.diagramStatus,
        checks: finalChecks
      };
      lessons.push(finalLesson);
      completedLessons += 1;
    }
    modules.push({
      title: module.title,
      summary: module.summary,
      lessons
    });
  }

  const validated = generatedCourseSchema.parse({
    title: outline.title,
    summary: outline.summary,
    level: outline.level,
    dossier: outline.dossier,
    sources: outline.sources,
    modules
  });

  return {
    ...validated,
    modules
  };
}

async function persistCourse(runId: string, topic: string, pathId: string | null, course: CourseWithQuality) {
  const saved = await prisma.course.create({
    data: {
      topic,
      topicKey: normalizeTopicKey(topic),
      pathId,
      title: course.title,
      summary: course.summary,
      level: course.level,
      dossier: toInputJson(course.dossier),
      status: "ready",
      generationRun: {
        connect: { id: runId }
      },
      sources: {
        create: course.sources.map((source) => ({
          title: source.title,
          url: source.url,
          publisher: source.publisher,
          publishedAt: source.publishedAt
        }))
      },
      modules: {
        create: course.modules.map((module, moduleIndex) => ({
          order: moduleIndex,
          title: module.title,
          summary: module.summary,
          lessons: {
            create: module.lessons.map((lesson, lessonIndex) => ({
              order: lessonIndex,
              title: lesson.title,
              content: lesson.content,
              diagram: lesson.diagram,
              diagramCaption: lesson.diagramCaption,
              checkpoint: lesson.checkpoint,
              exercisePrompt: lesson.exercisePrompt,
              hint: lesson.hint,
              solution: lesson.solution,
              transferNote: lesson.transferNote,
              citations: lesson.citations,
              contract: lesson.contract ? toInputJson(lesson.contract) : undefined,
              mistakeBank: toInputJson(lesson.mistakeBank),
              reviewArtifacts: toInputJson(lesson.reviewArtifacts),
              qualityReview: lesson.qualityReview
                ? {
                    create: {
                      overallScore: lesson.qualityReview.overallScore,
                      shouldRevise: lesson.qualityReview.shouldRevise,
                      dimensions: toInputJson(lesson.qualityReview.dimensions),
                      issues: toInputJson(lesson.qualityReview.issues),
                      revisionInstructions: lesson.qualityReview.revisionInstructions,
                      revised: lesson.qualityReview.revised,
                      revisionCount: lesson.qualityReview.revisionCount,
                      sourceCoverage: lesson.qualityReview.sourceCoverage,
                      exerciseDifficulty: lesson.qualityReview.exerciseDifficulty,
                      diagramStatus: lesson.qualityReview.diagramStatus,
                      checks: toInputJson(lesson.qualityReview.checks)
                    }
                  }
                : undefined
            }))
          }
        }))
      }
    }
  });

  await prisma.generationRun.update({
    where: { id: runId },
    data: {
      courseId: saved.id,
      status: "completed",
      phase: "completed",
      progress: 100
    }
  });

  return saved.id;
}

export async function createGenerationRun(input: { topic?: string; pathId?: string; replaceCourseId?: string }) {
  const topic = getTopic(input.topic, input.pathId);
  if (!topic) {
    throw new Error("A topic or pathId is required.");
  }
  requireOpenAIKey();

  const run = await prisma.generationRun.create({
    data: {
      topic,
      replaceCourseId: input.replaceCourseId,
      phase: "queued",
      status: "queued",
      progress: 0
    }
  });

  queueGeneration(run.id, topic, input.pathId ?? null, input.replaceCourseId);
  return run;
}

export function queueGeneration(runId: string, topic: string, pathId: string | null, replaceCourseId?: string | null) {
  if (activeRuns.has(runId)) return;
  activeRuns.add(runId);

  setTimeout(() => {
    generateCourseForRun(runId, topic, pathId, replaceCourseId ?? null)
      .catch(async (error: unknown) => {
        const message = await formatGenerationError(error, runId);
        await prisma.generationRun.update({
          where: { id: runId },
          data: { status: "failed", phase: "failed", error: message }
        });
      })
      .finally(() => {
        activeRuns.delete(runId);
      });
  }, 10);
}

export async function generateCourseForRun(runId: string, topic: string, pathId: string | null, replaceCourseId?: string | null) {
  await updateRun(runId, "researching", 15);

  await updateRun(runId, "generating course with cited research", 35);
  const course = await callOpenAIForCourse(topic, (phase, progress) => updateRun(runId, phase, progress));

  await updateRun(runId, "validating structure", 75);
  const validated = generatedCourseSchema.parse(course);

  await updateRun(runId, "saving course", 90);
  const savedId = await persistCourse(runId, topic, pathId, { ...validated, modules: course.modules });
  if (replaceCourseId && replaceCourseId !== savedId) {
    await updateRun(runId, "replacing previous course", 96);
    await prisma.course.delete({ where: { id: replaceCourseId } }).catch(() => null);
  }
  return savedId;
}

export async function regenerateLesson(
  lessonId: string,
  mode: "deeper" | "math" | "code-trace" | "proof" | "intuition" | "interview-drills" = "deeper"
) {
  const lesson = await prisma.lesson.findUnique({
    where: { id: lessonId },
    include: {
      module: {
        include: {
          course: {
            include: { sources: true }
          }
        }
      }
    }
  });

  if (!lesson) throw new Error("Lesson not found.");

  requireOpenAIKey();
  let replacement: GeneratedLesson;
  const client = createOpenAIClient();
  const response = await client.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-4.1",
      max_output_tokens: 7000,
      tools: [{ type: "web_search_preview" }],
      text: {
        format: {
          type: "json_schema",
          name: "regenerated_lesson",
          schema: lessonJsonSchema,
          strict: true
        }
      },
      input: [
        {
          role: "system",
          content:
            "Regenerate one rigorous course lesson. Preserve the surrounding course intent. Make it clearer, deeper, more concrete, and more useful for serious study."
        },
        {
          role: "user",
          content: `Course: ${lesson.module.course.title}
Module: ${lesson.module.title}
Lesson to improve: ${lesson.title}
Previous content:
${lesson.content}

Targeted regeneration mode: ${mode}

Mode guidance:
- deeper: expand the chapter with denser explanation, examples, failure modes, and connective tissue.
- math: add formal definitions, notation, derivations, and proof sketches where appropriate.
- code-trace: add executable-looking pseudocode/code walkthroughs and state traces.
- proof: emphasize invariants, correctness arguments, and counterexamples.
- intuition: rebuild the lesson around mental models and concrete analogies without becoming fluffy.
- interview-drills: add pattern recognition, constraints, traps, and practice ladders.

Return one complete lesson with markdown content, Mermaid diagram, checkpoint, exercise, hint, solution, transfer note, source citation indexes, mistakeBank, and reviewArtifacts.`
        }
      ]
  } as never, { timeout: OPENAI_TIMEOUT_MS });
  replacement = normalizeLesson(sectionSchema.parse(JSON.parse(extractText(response))));

  return prisma.lesson.update({
    where: { id: lessonId },
    data: {
      title: replacement.title,
      content: replacement.content,
      diagram: replacement.diagram,
      diagramCaption: replacement.diagramCaption,
      checkpoint: replacement.checkpoint,
      exercisePrompt: replacement.exercisePrompt,
      hint: replacement.hint,
      solution: replacement.solution,
      transferNote: replacement.transferNote,
      citations: replacement.citations
    }
  });
}

export async function explainSelectedText(input: {
  courseTitle: string;
  lessonTitle?: string | null;
  selectedText: string;
  prompt: string;
}) {
  requireOpenAIKey();
  const client = createOpenAIClient();
  const response = await client.responses.create({
    model: process.env.OPENAI_FAST_MODEL || process.env.OPENAI_MODEL || "gpt-4.1-mini",
    max_output_tokens: 1400,
    input: [
      {
        role: "system",
        content:
          "You explain selected text from a rigorous computer science lesson. Be concrete, patient, and technical. Use examples, invariants, or small traces when useful. Do not be fluffy."
      },
      {
        role: "user",
        content: `Course: ${input.courseTitle}
Lesson: ${input.lessonTitle ?? "Unknown"}
Selected text:
${input.selectedText}

Learner request:
${input.prompt}

Write a compact but deep explanation that can be saved as a margin note.`
      }
    ]
  }, { timeout: OPENAI_TIMEOUT_MS });

  return extractText(response).trim();
}
