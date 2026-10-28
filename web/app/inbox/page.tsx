import { ProjectView } from "@/components/project-view";

export const dynamic = "force-dynamic";

export default async function InboxPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <ProjectView projectId={null} searchParams={await searchParams} />;
}
