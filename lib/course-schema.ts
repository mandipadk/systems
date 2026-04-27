import { z } from "zod";

export const sourceSchema = z.object({
  title: z.string().min(3),
  url: z.string().url(),
  publisher: z.string().optional(),
  publishedAt: z.string().optional()
});

export const lessonSchema = z.object({
  title: z.string().min(3),
  content: z.string().min(1200),
  diagram: z.string().min(20).optional(),
  diagramCaption: z.string().min(10).optional(),
  checkpoint: z.string().min(30),
  exercisePrompt: z.string().min(60),
  hint: z.string().min(30),
  solution: z.string().min(80),
  transferNote: z.string().min(60),
  citations: z.array(z.number().int().nonnegative()).default([])
});

export const moduleSchema = z.object({
  title: z.string().min(3),
  summary: z.string().min(40),
  lessons: z.array(lessonSchema).min(1).max(4)
});

export const outlineLessonSchema = z.object({
  title: z.string().min(3),
  brief: z.string().min(40)
});

export const outlineModuleSchema = z.object({
  title: z.string().min(3),
  summary: z.string().min(40),
  lessons: z.array(outlineLessonSchema).min(1).max(2)
});

export const courseOutlineSchema = z.object({
  title: z.string().min(5),
  summary: z.string().min(120),
  level: z.string().min(3),
  modules: z.array(outlineModuleSchema).min(8).max(14),
  sources: z.array(sourceSchema).min(1)
});

export const generatedCourseSchema = z.object({
  title: z.string().min(5),
  summary: z.string().min(120),
  level: z.string().min(3),
  modules: z.array(moduleSchema).min(8).max(14),
  sources: z.array(sourceSchema).min(1)
});

export type GeneratedCourse = z.infer<typeof generatedCourseSchema>;

export const courseJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["title", "summary", "level", "modules", "sources"],
  properties: {
    title: { type: "string" },
    summary: { type: "string" },
    level: { type: "string" },
    modules: {
      type: "array",
      minItems: 8,
      maxItems: 14,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "summary", "lessons"],
        properties: {
          title: { type: "string" },
          summary: { type: "string" },
          lessons: {
            type: "array",
            minItems: 1,
            maxItems: 4,
            items: {
              type: "object",
              additionalProperties: false,
              required: [
                "title",
                "content",
                "diagram",
                "diagramCaption",
                "checkpoint",
                "exercisePrompt",
                "hint",
                "solution",
                "transferNote",
                "citations"
              ],
              properties: {
                title: { type: "string" },
                content: { type: "string" },
                diagram: { type: "string" },
                diagramCaption: { type: "string" },
                checkpoint: { type: "string" },
                exercisePrompt: { type: "string" },
                hint: { type: "string" },
                solution: { type: "string" },
                transferNote: { type: "string" },
                citations: {
                  type: "array",
                  items: { type: "integer" }
                }
              }
            }
          }
        }
      }
    },
    sources: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "url", "publisher", "publishedAt"],
        properties: {
          title: { type: "string" },
          url: { type: "string" },
          publisher: { type: "string" },
          publishedAt: { type: "string" }
        }
      }
    }
  }
} as const;

export const outlineJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["title", "summary", "level", "modules", "sources"],
  properties: {
    title: { type: "string" },
    summary: { type: "string" },
    level: { type: "string" },
    modules: {
      type: "array",
      minItems: 8,
      maxItems: 14,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "summary", "lessons"],
        properties: {
          title: { type: "string" },
          summary: { type: "string" },
          lessons: {
            type: "array",
            minItems: 1,
            maxItems: 2,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["title", "brief"],
              properties: {
                title: { type: "string" },
                brief: { type: "string" }
              }
            }
          }
        }
      }
    },
    sources: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "url", "publisher", "publishedAt"],
        properties: {
          title: { type: "string" },
          url: { type: "string" },
          publisher: { type: "string" },
          publishedAt: { type: "string" }
        }
      }
    }
  }
} as const;

export const lessonJsonSchema = courseJsonSchema.properties.modules.items.properties.lessons.items;

export const sectionSchema = lessonSchema.extend({
  title: z.string().min(3)
});

export type GeneratedLesson = z.infer<typeof lessonSchema>;
export type CourseOutline = z.infer<typeof courseOutlineSchema>;
