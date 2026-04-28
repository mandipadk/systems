import OpenAI from "openai";
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
  qualityReview?: LessonReview & { revised: boolean };
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
- Each lesson brief must describe the concrete lesson goal, not just name a topic.
- Sequence the course like a technical book: early intuition, precise model, worked examples, implementation, pitfalls, transfer, and mastery.
- Sources must be authoritative docs, papers, books, or high-quality engineering references.
- For current topics, include current cited sources.`
      }
    ]
  } as never, { timeout: OPENAI_TIMEOUT_MS });

  return courseOutlineSchema.parse(JSON.parse(extractText(response)));
}

async function createLesson(client: OpenAI, input: {
  topic: string;
  outline: CourseOutline;
  moduleTitle: string;
  moduleSummary: string;
  lessonTitle: string;
  lessonBrief: string;
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

Allowed source indexes:
${sources}

Return one complete lesson.

Requirements:
- content must be long-form markdown, roughly 1400-2200 words.
- Use concrete examples, worked traces, small code listings when relevant, edge cases, and common mistakes.
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

  return normalizeLesson(sectionSchema.parse(JSON.parse(extractText(response))));
}

async function reviewLesson(client: OpenAI, input: {
  topic: string;
  moduleTitle: string;
  lessonBrief: string;
  lesson: GeneratedLesson;
}): Promise<LessonReview> {
  const response = await client.responses.create({
    model: process.env.OPENAI_FAST_MODEL || process.env.OPENAI_MODEL || "gpt-4.1-mini",
    max_output_tokens: 1600,
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
        content:
          "You are a severe editor for a personal technical book. Your job is to detect shallow AI writing, missing examples, weak explanations, broken structure, and content that would not help a serious learner. Be strict."
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

Lesson JSON:
${JSON.stringify(input.lesson)}

Return a strict review. Set shouldRevise true for anything below an 8.`
      }
    ]
  } as never, { timeout: OPENAI_TIMEOUT_MS });

  return JSON.parse(extractText(response)) as LessonReview;
}

async function reviseLesson(client: OpenAI, input: {
  topic: string;
  outline: CourseOutline;
  moduleTitle: string;
  moduleSummary: string;
  lessonTitle: string;
  lessonBrief: string;
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

  return normalizeLesson(sectionSchema.parse(JSON.parse(extractText(response))));
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
    const lessons: GeneratedLesson[] = [];
    for (const lesson of module.lessons) {
      const progress = 25 + Math.floor((completedLessons / Math.max(totalLessons, 1)) * 60);
      await onProgress(`writing lesson ${completedLessons + 1} of ${totalLessons}: ${lesson.title}`, progress);
      const draft = await createLesson(client, {
        topic,
        outline,
        moduleTitle: module.title,
        moduleSummary: module.summary,
        lessonTitle: lesson.title,
        lessonBrief: lesson.brief
      });
      await onProgress(`reviewing lesson ${completedLessons + 1} of ${totalLessons}: ${lesson.title}`, progress + 2);
      const review = await reviewLesson(client, {
        topic,
        moduleTitle: module.title,
        lessonBrief: lesson.brief,
        lesson: draft
      });
      const finalLesson: LessonWithQuality =
        review.shouldRevise || review.overallScore < 8
          ? await reviseLesson(client, {
              topic,
              outline,
              moduleTitle: module.title,
              moduleSummary: module.summary,
              lessonTitle: lesson.title,
              lessonBrief: lesson.brief,
              draft,
              review
            })
          : draft;
      finalLesson.qualityReview = {
        ...review,
        revised: finalLesson !== draft
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

  return generatedCourseSchema.parse({
    title: outline.title,
    summary: outline.summary,
    level: outline.level,
    sources: outline.sources,
    modules
  });
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
              qualityReview: lesson.qualityReview
                ? {
                    create: {
                      overallScore: lesson.qualityReview.overallScore,
                      shouldRevise: lesson.qualityReview.shouldRevise,
                      issues: lesson.qualityReview.issues,
                      revisionInstructions: lesson.qualityReview.revisionInstructions,
                      revised: lesson.qualityReview.revised
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

export async function regenerateLesson(lessonId: string) {
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
            "Regenerate one rigorous course lesson. Preserve the surrounding course intent. Make it clearer, deeper, and more concrete."
        },
        {
          role: "user",
          content: `Course: ${lesson.module.course.title}
Module: ${lesson.module.title}
Lesson to improve: ${lesson.title}
Previous content:
${lesson.content}

Return one complete lesson with markdown content, Mermaid diagram, checkpoint, exercise, hint, solution, transfer note, and source citation indexes.`
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
