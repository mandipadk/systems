export type LearningPath = {
  id: string;
  title: string;
  description: string;
  topic: string;
};

export const learningPaths: LearningPath[] = [
  {
    id: "google-new-grad",
    title: "Google new-grad readiness",
    description: "Data structures, algorithms, communication, and pattern fluency from first principles.",
    topic:
      "Google new-grad software engineering interview preparation: data structures, algorithms, problem solving patterns, implementation fluency, and explanation practice"
  },
  {
    id: "dsa-first-principles",
    title: "Data structures and algorithms",
    description: "Arrays, graphs, dynamic programming, trees, heaps, tries, and proof-minded problem solving.",
    topic:
      "Data structures and algorithms from first principles for interviews and real systems"
  },
  {
    id: "systems-core",
    title: "Computer systems core",
    description: "Operating systems, networking, databases, distributed systems, reliability, and cloud design.",
    topic:
      "Computer systems from operating systems and networking through databases, distributed systems, reliability, and cloud architecture"
  },
  {
    id: "ml-systems",
    title: "ML systems bridge",
    description: "Tensors, transformers, training loops, inference, scaling laws, and paper-grounded architectures.",
    topic:
      "Machine learning systems bridge: tensors, transformers, distributed training, inference systems, and frontier open model architectures"
  }
];

export function getPath(pathId?: string | null) {
  if (!pathId) return undefined;
  return learningPaths.find((path) => path.id === pathId);
}
