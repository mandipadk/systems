import type { GeneratedCourse } from "./course-schema";

const diagram = (topic: string) => `flowchart TD
  A[Raw intuition about ${topic}] --> B[Precise mental model]
  B --> C[Core invariants]
  C --> D[Worked examples]
  D --> E[Practice questions]
  E --> F[Transfer to interviews and systems]`;

function lesson(topic: string, moduleIndex: number, lessonIndex: number, title: string) {
  const angle = [
    "intuition",
    "representation",
    "invariants",
    "implementation",
    "failure modes",
    "transfer"
  ][(moduleIndex + lessonIndex) % 6];

  return {
    title,
    content: `### The point of this lesson

This lesson studies **${topic}** through ${angle}. Do not treat the idea as a definition to memorize. Treat it as a tool with a shape: what information it keeps, what it throws away, what operation it makes cheap, and what operation it makes expensive.

Start with the smallest possible example. If the topic is an algorithm, write down the state before the first step, after the first step, and after the second step. If the topic is a system design idea, write down the request, the boundary it crosses, the state it mutates, and the thing that can fail. The important move is to make the invisible state visible.

### Mental model

A strong learner asks three questions. First, what is the object I am manipulating? Second, what invariant must remain true after each move? Third, what evidence would prove that my solution is not just working on the example but working for the class of problems? These questions make ${topic} feel less like a bag of tricks and more like engineering.

For interview preparation, the invariant matters more than the code. Code is the final expression of an idea. If the invariant is weak, the code becomes a collection of patches. If the invariant is strong, the code usually becomes short because every branch has a reason to exist.

### Worked example

Take a concrete input and name every piece of state. Before solving, predict the first wrong approach someone might try. Then explain why it fails. That failure is not wasted time; it tells you which constraint is doing real work. Now build the correct approach by preserving the constraint explicitly.

When you finish, ask what changes if the input is empty, duplicated, cyclic, disconnected, extremely large, or adversarial. These edge cases are not trivia. They reveal whether your representation matches the problem.

### How to study this

Read once for shape. Re-read with pencil or editor open. Then close the text and reconstruct the idea from memory in five sentences. If you cannot reconstruct it, the next step is not another video. The next step is a smaller example and a slower trace.`,
    diagram: diagram(topic),
    diagramCaption: `A reusable learning loop for turning ${topic} from passive reading into usable skill.`,
    checkpoint: `Before moving on, explain the invariant behind this part of ${topic} without using memorized wording.`,
    exercisePrompt: `Create a small example for ${topic}, trace the state after each step, then identify one edge case that would break a naive solution.`,
    hint: `Start with the smallest input where the idea does something non-trivial. Name the state before writing any code.`,
    solution: `A good answer states the representation, the invariant, the transition rule, and one edge case. For an algorithm, that might mean naming the data structure, explaining what it contains after each iteration, and showing why no valid candidate is lost. For a system, it means naming the boundary, state owner, failure mode, and recovery behavior.`,
    transferNote: `In an interview, use this lesson to move from example tracing to a general invariant. In system design, use it to explain ownership, tradeoffs, and failure behavior instead of listing components.`,
    citations: [0]
  };
}

export function createFallbackCourse(topic: string): GeneratedCourse {
  const modules = [
    "Orientation and motivation",
    "Representations and mental models",
    "Core operations and invariants",
    "Complexity and tradeoffs",
    "Implementation patterns",
    "Debugging and failure modes",
    "Practice ladder",
    "Interview transfer",
    "Systems transfer",
    "Mastery review"
  ].map((title, moduleIndex) => ({
    title,
    summary: `A focused stage for learning ${topic}: ${title.toLowerCase()} with examples, questions, and transfer notes.`,
    lessons: [
      lesson(topic, moduleIndex, 0, `${title}: first principles`),
      lesson(topic, moduleIndex, 1, `${title}: worked application`)
    ]
  }));

  return {
    title: `${topic}: from first principles to mastery`,
    summary:
      "This local fallback course is generated without an OpenAI API key. It preserves the intended learning structure: long-form lessons, diagrams, checkpoints, practice, and transfer notes. Add OPENAI_API_KEY to generate topic-specific researched courses with citations.",
    level: "Beginner to advanced",
    modules,
    sources: [
      {
        title: "Local fallback generator",
        url: "https://platform.openai.com/docs",
        publisher: "Local app",
        publishedAt: "Generated offline"
      }
    ]
  };
}
