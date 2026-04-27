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
import { createFallbackCourse } from "./fallback-course";
import { getPath } from "./paths";

const activeRuns = new Set<string>();
const OPENAI_TIMEOUT_MS = 90_000;

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

async function callOpenAIForCourse(
  topic: string,
  onProgress: (phase: string, progress: number) => Promise<void>
): Promise<GeneratedCourse> {
  const client = createOpenAIClient();

  await onProgress("researching sources and outlining course", 20);
  const outline = await createCourseOutline(client, topic);

  const totalLessons = outline.modules.reduce((sum, module) => sum + module.lessons.length, 0);
  let completedLessons = 0;
  const modules: GeneratedCourse["modules"] = [];

  for (const module of outline.modules) {
    const lessons: GeneratedLesson[] = [];
    for (const lesson of module.lessons) {
      const progress = 25 + Math.floor((completedLessons / Math.max(totalLessons, 1)) * 60);
      await onProgress(`writing lesson ${completedLessons + 1} of ${totalLessons}: ${lesson.title}`, progress);
      lessons.push(
        await createLesson(client, {
          topic,
          outline,
          moduleTitle: module.title,
          moduleSummary: module.summary,
          lessonTitle: lesson.title,
          lessonBrief: lesson.brief
        })
      );
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

async function persistCourse(runId: string, topic: string, pathId: string | null, course: GeneratedCourse) {
  const saved = await prisma.course.create({
    data: {
      topic,
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
              citations: lesson.citations
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

export async function createGenerationRun(input: { topic?: string; pathId?: string }) {
  const topic = getTopic(input.topic, input.pathId);
  if (!topic) {
    throw new Error("A topic or pathId is required.");
  }

  const run = await prisma.generationRun.create({
    data: {
      topic,
      phase: "queued",
      status: "queued",
      progress: 0
    }
  });

  queueGeneration(run.id, topic, input.pathId ?? null);
  return run;
}

export function queueGeneration(runId: string, topic: string, pathId: string | null) {
  if (activeRuns.has(runId)) return;
  activeRuns.add(runId);

  setTimeout(() => {
    generateCourseForRun(runId, topic, pathId)
      .catch(async (error: unknown) => {
        const message = error instanceof Error ? error.message : "Unknown generation error";
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

export async function generateCourseForRun(runId: string, topic: string, pathId: string | null) {
  await updateRun(runId, "researching", 15);
  const hasKey = Boolean(process.env.OPENAI_API_KEY);

  await updateRun(runId, hasKey ? "generating course with cited research" : "generating local fallback course", 35);
  const course = hasKey
    ? await callOpenAIForCourse(topic, (phase, progress) => updateRun(runId, phase, progress))
    : createFallbackCourse(topic);

  await updateRun(runId, "validating structure", 75);
  const validated = generatedCourseSchema.parse(course);

  await updateRun(runId, "saving course", 90);
  return persistCourse(runId, topic, pathId, validated);
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

  let replacement: GeneratedLesson;
  if (!process.env.OPENAI_API_KEY) {
    replacement = createFallbackCourse(`${lesson.module.course.topic}: ${lesson.title}`).modules[0].lessons[0];
  } else {
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
  }

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
  if (!process.env.OPENAI_API_KEY) {
    return `You selected: "${input.selectedText}"\n\n${input.prompt}\n\nAdd OPENAI_API_KEY to generate a deeper contextual explanation.`;
  }

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
