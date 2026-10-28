import { notFound } from "next/navigation";
import { ProjectView } from "@/components/project-view";
import { getDb } from "@/lib/db";
import { getProject } from "@/lib/db/queries";

export const dynamic = "force-dynamic";

export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  if (!/^\d+$/.test(id) || !getProject(getDb(), Number(id))) notFound();
  return <ProjectView projectId={Number(id)} searchParams={await searchParams} />;
}
