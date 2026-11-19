export type WorkspaceMode = "code" | "reason" | "research" | "general";

export type ModelId = "gemini-4-hydrogen" | "gemini-3.1-flash-lite";

export type ThinkingLevelOption = "low" | "medium" | "high" | "xhigh";

export interface Attachment {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  data: string; // base64 (for images) or utf-8 text (for code/text files)
  isText: boolean;
  previewUrl?: string;
}

export interface GroundingSource {
  title: string;
  uri: string;
}

export interface TokenUsage {
  promptTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  thoughts?: string;
  attachments?: Attachment[];
  sources?: GroundingSource[];
  usage?: TokenUsage;
  model?: ModelId;
  durationMs?: number;
  createdAt: number;
  notice?: string;
  error?: string;
}

export interface Conversation {
  id: string;
  title: string;
  mode: WorkspaceMode;
  model: ModelId;
  thinkingLevel: ThinkingLevelOption;
  useSearch: boolean;
  useUrlContext: boolean;
  messages: ChatMessage[];
  updatedAt: number;
}

export interface CanvasArtifact {
  id: string;
  title: string;
  language: string;
  code: string;
}
