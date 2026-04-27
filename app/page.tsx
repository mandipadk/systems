import { prisma } from "@/lib/db";
import { learningPaths } from "@/lib/paths";
import { HomeClient } from "./home-client";

export default async function Home() {
  const courses = await prisma.course.findMany({
    orderBy: { updatedAt: "desc" },
    take: 8,
    select: {
      id: true,
      title: true,
      topic: true,
      summary: true,
      level: true,
      updatedAt: true
    }
  });

  return <HomeClient paths={learningPaths} courses={JSON.parse(JSON.stringify(courses))} />;
}
