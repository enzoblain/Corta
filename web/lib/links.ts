export function projectHref(projectId: number | null): string {
  return projectId === null ? "/inbox" : `/project/${projectId}`;
}
