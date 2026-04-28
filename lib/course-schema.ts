import { z } from "zod";

export const sourceSchema = z.object({
  title: z.string().min(3),
  url: z.string().url(),
  publisher: z.string().optional(),
  publishedAt: z.string().optional()
});

export const dossierSchema = z.object({
  sourcePack: z.array(z.string()).min(3),
  prerequisiteGraph: z.array(z.string()).min(3),
  conceptMap: z.array(z.string()).min(5),
  terminologyGlossary: z.array(z.string()).min(5),
  commonMisconceptions: z.array(z.string()).min(4),
  canonicalExamples: z.array(z.string()).min(4),
  masteryOutcomes: z.array(z.string()).min(4)
});

export const lessonContractSchema = z.object({
  requiredExamples: z.array(z.string()).min(1),
  requiredDiagrams: z.array(z.string()).min(1),
  requiredTable: z.string().min(10),
  requiredCodeTrace: z.string().min(10),
  requiredFailureModes: z.array(z.string()).min(1),
  exerciseTargets: z.array(z.string()).min(1)
});

export const mistakeBankSchema = z.array(
  z.object({
    mistake: z.string().min(10),
    whyItTempts: z.string().min(10),
    counterexample: z.string().min(10),
    debuggingHeuristic: z.string().min(10)
  })
).min(2);

export const reviewArtifactsSchema = z.object({
  flashcards: z.array(z.string()).min(2),
  oralPrompts: z.array(z.string()).min(2),
  implementationDrills: z.array(z.string()).min(1)
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
  citations: z.array(z.number().int().nonnegative()).default([]),
  mistakeBank: mistakeBankSchema,
  reviewArtifacts: reviewArtifactsSchema
});

export const moduleSchema = z.object({
  title: z.string().min(3),
  summary: z.string().min(40),
  lessons: z.array(lessonSchema).min(1).max(4)
});

export const outlineLessonSchema = z.object({
  title: z.string().min(3),
  brief: z.string().min(40),
  contract: lessonContractSchema
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
  dossier: dossierSchema,
  modules: z.array(outlineModuleSchema).min(8).max(14),
  sources: z.array(sourceSchema).min(1)
});

export const generatedCourseSchema = z.object({
  title: z.string().min(5),
  summary: z.string().min(120),
  level: z.string().min(3),
  dossier: dossierSchema,
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
                "citations",
                "mistakeBank",
                "reviewArtifacts"
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
                },
                mistakeBank: {
                  type: "array",
                  minItems: 2,
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["mistake", "whyItTempts", "counterexample", "debuggingHeuristic"],
                    properties: {
                      mistake: { type: "string" },
                      whyItTempts: { type: "string" },
                      counterexample: { type: "string" },
                      debuggingHeuristic: { type: "string" }
                    }
                  }
                },
                reviewArtifacts: {
                  type: "object",
                  additionalProperties: false,
                  required: ["flashcards", "oralPrompts", "implementationDrills"],
                  properties: {
                    flashcards: { type: "array", minItems: 2, items: { type: "string" } },
                    oralPrompts: { type: "array", minItems: 2, items: { type: "string" } },
                    implementationDrills: { type: "array", minItems: 1, items: { type: "string" } }
                  }
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
  required: ["title", "summary", "level", "dossier", "modules", "sources"],
  properties: {
    title: { type: "string" },
    summary: { type: "string" },
    level: { type: "string" },
    dossier: {
      type: "object",
      additionalProperties: false,
      required: [
        "sourcePack",
        "prerequisiteGraph",
        "conceptMap",
        "terminologyGlossary",
        "commonMisconceptions",
        "canonicalExamples",
        "masteryOutcomes"
      ],
      properties: {
        sourcePack: { type: "array", minItems: 3, items: { type: "string" } },
        prerequisiteGraph: { type: "array", minItems: 3, items: { type: "string" } },
        conceptMap: { type: "array", minItems: 5, items: { type: "string" } },
        terminologyGlossary: { type: "array", minItems: 5, items: { type: "string" } },
        commonMisconceptions: { type: "array", minItems: 4, items: { type: "string" } },
        canonicalExamples: { type: "array", minItems: 4, items: { type: "string" } },
        masteryOutcomes: { type: "array", minItems: 4, items: { type: "string" } }
      }
    },
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
              required: ["title", "brief", "contract"],
              properties: {
                title: { type: "string" },
                brief: { type: "string" },
                contract: {
                  type: "object",
                  additionalProperties: false,
                  required: [
                    "requiredExamples",
                    "requiredDiagrams",
                    "requiredTable",
                    "requiredCodeTrace",
                    "requiredFailureModes",
                    "exerciseTargets"
                  ],
                  properties: {
                    requiredExamples: { type: "array", minItems: 1, items: { type: "string" } },
                    requiredDiagrams: { type: "array", minItems: 1, items: { type: "string" } },
                    requiredTable: { type: "string" },
                    requiredCodeTrace: { type: "string" },
                    requiredFailureModes: { type: "array", minItems: 1, items: { type: "string" } },
                    exerciseTargets: { type: "array", minItems: 1, items: { type: "string" } }
                  }
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

export const lessonJsonSchema = courseJsonSchema.properties.modules.items.properties.lessons.items;

export const sectionSchema = lessonSchema.extend({
  title: z.string().min(3)
});

export type GeneratedLesson = z.infer<typeof lessonSchema>;
export type CourseOutline = z.infer<typeof courseOutlineSchema>;
