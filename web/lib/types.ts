export type IdeaStatus = "todo" | "in_progress" | "done";

export interface Project {
  id: number;
  name: string;
  description: string | null;
  created_at: string;
}

export interface Idea {
  id: number;
  project_id: number | null; // null = Inbox
  raw_text: string;
  title: string | null;
  content: string | null;
  status: IdeaStatus;
  ai_processed: 0 | 1;
  created_at: string;
  updated_at: string;
}

export interface Tag {
  id: number;
  name: string;
}
