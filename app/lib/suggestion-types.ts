export type SuggestionStatus =
  | "open"
  | "planned"
  | "completed"
  | "declined";

export type StatusFilter = "all" | SuggestionStatus;

export type SuggestionAttachment = {
  id: string;
  filename: string;
  content_type: "image/png" | "image/jpeg";
  size_bytes: number;
};

export type Suggestion = {
  id: string;
  title: string;
  description: string;
  author: string;
  status: SuggestionStatus;
  vote_count: number;
  created_at: string;
  attachments: SuggestionAttachment[];
  viewer_has_voted: boolean;
};
