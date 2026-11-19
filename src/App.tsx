import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUp,
  AudioLines,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  ExternalLink,
  FileCode2,
  Globe,
  Link2,
  Loader2,
  Menu,
  Mic,
  Paperclip,
  PanelRight,
  RotateCcw,
  Square,
  Volume2,
  X,
} from "lucide-react";
import { BrandMark } from "./components/BrandMark";
import { CanvasPanel } from "./components/CanvasPanel";
import { MarkdownRenderer } from "./components/MarkdownRenderer";
import { Sidebar } from "./components/Sidebar";
import { SystemPromptModal } from "./components/SystemPromptModal";
import { VoiceModeModal, type VoiceTranscriptTurn } from "./components/VoiceModeModal";
import { VOICE_PERSONAS, type VoicePersonaId } from "./voicePersonas";
import type {
  Attachment,
  CanvasArtifact,
  ChatMessage,
  Conversation,
  GroundingSource,
  ModelId,
  ThinkingLevelOption,
  TokenUsage,
  WorkspaceMode,
} from "./types";

const STORAGE_KEY = "goooner_ai_conversations_v1";
const THEME_KEY = "goooner_ai_theme_v1";
const SYSTEM_PROMPT_KEY = "goooner_ai_custom_prompt_v1";
const VOICE_PERSONA_KEY = "goooner_ai_voice_persona_v1";

function createId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function deriveThreadTitle(prompt: string): string {
  const cleaned = prompt.replace(/\s+/g, " ").trim();
  if (!cleaned) return "New Thread";
  const words = cleaned.split(" ").slice(0, 6).join(" ");
  return words.length > 44 ? `${words.slice(0, 41).trim()}...` : words;
}

function createEmptyConversation(): Conversation {
  return {
    id: createId(),
    title: "New Thread",
    mode: "code",
    model: "gemini-3.1-flash-lite",
    thinkingLevel: "low",
    useSearch: false,
    useUrlContext: false,
    messages: [],
    updatedAt: Date.now(),
  };
}

const MODE_OPTIONS: Array<{ id: WorkspaceMode; label: string }> = [
  { id: "code", label: "Code & Build" },
  { id: "reason", label: "Deep Reason" },
  { id: "research", label: "Web Research" },
  { id: "general", label: "General" },
];

const MODEL_OPTIONS: Array<{ id: ModelId; label: string }> = [
  { id: "gemini-4-hydrogen", label: "Goooner Core" },
  { id: "gemini-3.1-flash-lite", label: "Goooner Swift" },
];

const THINKING_OPTIONS: Array<{ id: ThinkingLevelOption; label: string }> = [
  { id: "low", label: "Low" },
  { id: "medium", label: "Med" },
  { id: "high", label: "High" },
  { id: "xhigh", label: "Max" },
];

const STARTER_PROMPTS: Array<{
  title: string;
  description: string;
  prompt: string;
  mode: WorkspaceMode;
  useSearch?: boolean;
}> = [
  {
    title: "Interactive SaaS Pricing Calculator",
    description: "Generate a complete, responsive HTML and Tailwind widget ready for live preview.",
    prompt:
      "Build a clean, interactive SaaS pricing calculator in a single self-contained HTML file using Tailwind CSS CDN with monthly/annual billing toggle and seat slider.",
    mode: "code",
  },
  {
    title: "TypeScript Rate Limiter Middleware",
    description: "Design a production sliding-window rate limiter for Express with clean types.",
    prompt:
      "Write a sliding-window rate limiter middleware for Express in TypeScript with per-IP tracking, standard RateLimit response headers, and unit test examples.",
    mode: "code",
  },
  {
    title: "Debug React Race Conditions",
    description: "Walk through cancellation patterns for async effects and stale closures.",
    prompt:
      "Explain why async fetch calls inside React useEffect cause race conditions and show the cleanest cancellation patterns using AbortController and custom hooks.",
    mode: "reason",
  },
  {
    title: "Live Web Engineering Briefing",
    description: "Query recent web sources for current Node.js LTS and TypeScript updates.",
    prompt:
      "Search for the latest Node.js LTS release highlights and TypeScript compiler performance improvements, and summarize the key takeaways with links.",
    mode: "research",
    useSearch: true,
  },
];

function formatDuration(ms?: number): string {
  if (!ms || ms <= 0) return "";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatModelLabel(model?: ModelId): string {
  if (model === "gemini-3.1-flash-lite") return "Goooner Swift";
  return "Goooner Core";
}

function extractFirstCodeBlock(markdown: string): CanvasArtifact | null {
  const regex = /```([\w-]+)?\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  let best: CanvasArtifact | null = null;

  while ((match = regex.exec(markdown)) !== null) {
    const lang = (match[1] || "text").toLowerCase();
    const code = match[2].trim();
    if (!code) continue;
    if (lang === "html" || lang === "htm" || lang === "svg") {
      return {
        id: `${lang}-${code.length}`,
        title: `Preview (${lang.toUpperCase()})`,
        language: lang,
        code,
      };
    }
    if (!best && code.split("\n").length >= 6) {
      best = {
        id: `${lang}-${code.length}`,
        title: `Snippet (${lang})`,
        language: lang,
        code,
      };
    }
  }

  return best;
}

export default function App() {
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    try {
      const saved = localStorage.getItem(THEME_KEY);
      if (saved === "light" || saved === "dark") return saved;
    } catch {
      // Ignore storage error
    }
    return "dark";
  });

  const [conversations, setConversations] = useState<Conversation[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Conversation[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
    } catch {
      // Ignore storage error
    }
    return [createEmptyConversation()];
  });

  const [activeId, setActiveId] = useState<string>(() => conversations[0]?.id || "");
  const [customSystemPrompt, setCustomSystemPrompt] = useState<string>(() => {
    try {
      return localStorage.getItem(SYSTEM_PROMPT_KEY) || "";
    } catch {
      return "";
    }
  });

  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingMsgId, setStreamingMsgId] = useState<string | null>(null);
  const [expandedThoughts, setExpandedThoughts] = useState<Record<string, boolean>>({});
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [systemModalOpen, setSystemModalOpen] = useState(false);
  const [voiceModalOpen, setVoiceModalOpen] = useState(false);
  const [voicePersona, setVoicePersona] = useState<VoicePersonaId>(() => {
    try {
      const saved = localStorage.getItem(VOICE_PERSONA_KEY) as VoicePersonaId | null;
      if (saved && VOICE_PERSONAS.some((p) => p.id === saved)) return saved;
    } catch {
      // Ignore storage error
    }
    return "indian-meme";
  });
  const [speakingMsgId, setSpeakingMsgId] = useState<string | null>(null);
  const [loadingSpeechMsgId, setLoadingSpeechMsgId] = useState<string | null>(null);
  const [voiceNotice, setVoiceNotice] = useState<string | null>(null);
  const [isRecordingDictation, setIsRecordingDictation] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);

  const [canvasArtifact, setCanvasArtifact] = useState<CanvasArtifact | null>(null);
  const [canvasTab, setCanvasTab] = useState<"code" | "preview">("code");
  const [canvasOpen, setCanvasOpen] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const speakAudioCtxRef = useRef<AudioContext | null>(null);
  const speakSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const liveOutputCtxRef = useRef<AudioContext | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const dictationChunksRef = useRef<Blob[]>([]);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const activeConversation = useMemo(() => {
    return conversations.find((c) => c.id === activeId) || conversations[0];
  }, [conversations, activeId]);

  // Sync theme class on <html>
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      // Ignore storage error
    }
  }, [theme]);

  // Persist conversations (skip synchronous serialization mid-stream to keep token rendering at 60fps)
  useEffect(() => {
    if (isStreaming) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations));
    } catch {
      // Ignore quota errors
    }
  }, [conversations, isStreaming]);

  useEffect(() => {
    try {
      localStorage.setItem(SYSTEM_PROMPT_KEY, customSystemPrompt);
    } catch {
      // Ignore storage errors
    }
  }, [customSystemPrompt]);

  useEffect(() => {
    try {
      localStorage.setItem(VOICE_PERSONA_KEY, voicePersona);
    } catch {
      // Ignore storage errors
    }
  }, [voicePersona]);

  // Auto-scroll on message updates while streaming or sending
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeConversation?.messages.length, isStreaming]);

  // Auto-resize composer textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [input]);

  const updateActiveConversation = useCallback(
    (updater: (conv: Conversation) => Conversation) => {
      setConversations((prev) =>
        prev.map((c) => (c.id === activeConversation.id ? updater(c) : c))
      );
    },
    [activeConversation?.id]
  );

  const handleNewChat = () => {
    if (isStreaming) {
      abortRef.current?.abort();
      setIsStreaming(false);
      setStreamingMsgId(null);
    }
    const fresh = createEmptyConversation();
    setConversations((prev) => [fresh, ...prev]);
    setActiveId(fresh.id);
    setCanvasOpen(false);
    setCanvasArtifact(null);
    setInput("");
    setAttachments([]);
  };

  const handleDeleteConversation = (id: string) => {
    setConversations((prev) => {
      const remaining = prev.filter((c) => c.id !== id);
      if (remaining.length === 0) {
        const fresh = createEmptyConversation();
        setActiveId(fresh.id);
        return [fresh];
      }
      if (id === activeId) {
        setActiveId(remaining[0].id);
      }
      return remaining;
    });
  };

  const handleOpenCanvas = (artifact: CanvasArtifact, tab: "code" | "preview" = "code") => {
    setCanvasArtifact(artifact);
    setCanvasTab(tab);
    setCanvasOpen(true);
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    const newAttachments: Attachment[] = [];

    for (const file of files.slice(0, 5)) {
      if (file.size > 10 * 1024 * 1024) continue;

      const isImage = file.type.startsWith("image/");
      if (isImage) {
        const dataUrl = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ""));
          reader.readAsDataURL(file);
        });
        const base64 = dataUrl.split(",")[1] || "";
        newAttachments.push({
          id: createId(),
          name: file.name,
          mimeType: file.type || "image/png",
          size: file.size,
          data: base64,
          isText: false,
          previewUrl: dataUrl,
        });
      } else {
        const text = await file.text();
        newAttachments.push({
          id: createId(),
          name: file.name,
          mimeType: file.type || "text/plain",
          size: file.size,
          data: text.slice(0, 120000),
          isText: true,
        });
      }
    }

    setAttachments((prev) => [...prev, ...newAttachments]);
    e.target.value = "";
  };

  const generateThreadTitle = (convId: string, firstPrompt: string) => {
    const title = deriveThreadTitle(firstPrompt);
    setConversations((prev) =>
      prev.map((c) => (c.id === convId ? { ...c, title } : c))
    );
  };

  const runCompletion = async (
    convSnapshot: Conversation,
    historyMessages: ChatMessage[],
    assistantMsgId: string
  ) => {
    const controller = new AbortController();
    abortRef.current = controller;
    setIsStreaming(true);
    setStreamingMsgId(assistantMsgId);
    const startedAt = Date.now();

    try {
      const payloadMessages = historyMessages.map((m) => ({
        role: m.role,
        content: m.content,
        attachments: m.attachments?.map((a) => ({
          name: a.name,
          mimeType: a.mimeType,
          data: a.data,
          isText: a.isText,
        })),
      }));

      const response = await fetch("/api/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: payloadMessages,
          model: convSnapshot.model,
          thinkingLevel: convSnapshot.thinkingLevel,
          mode: convSnapshot.mode,
          useSearch: convSnapshot.useSearch || convSnapshot.mode === "research",
          useUrlContext: convSnapshot.useUrlContext,
          customSystemPrompt,
        }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        throw new Error(`Server returned status ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let accumulatedText = "";
      let accumulatedThoughts = "";
      let respondedModel: ModelId | undefined = convSnapshot.model;
      let notice: string | undefined;
      let sources: GroundingSource[] | undefined;
      let usage: TokenUsage | undefined;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() || "";

        for (const rawEvent of events) {
          const line = rawEvent.trim();
          if (!line.startsWith("data:")) continue;
          const jsonStr = line.slice(5).trim();
          if (!jsonStr) continue;

          let parsed: {
            type: string;
            text?: string;
            model?: ModelId;
            sources?: GroundingSource[];
            usage?: TokenUsage;
            message?: string;
          };
          try {
            parsed = JSON.parse(jsonStr);
          } catch {
            continue;
          }

          if (parsed.type === "meta" && parsed.model) {
            respondedModel = parsed.model;
          } else if (parsed.type === "notice" && parsed.message) {
            notice = parsed.message;
          } else if (parsed.type === "thought" && parsed.text) {
            accumulatedThoughts += parsed.text;
            setConversations((prev) =>
              prev.map((c) =>
                c.id === convSnapshot.id
                  ? {
                      ...c,
                      messages: c.messages.map((m) =>
                        m.id === assistantMsgId ? { ...m, thoughts: accumulatedThoughts } : m
                      ),
                    }
                  : c
              )
            );
          } else if (parsed.type === "text" && parsed.text) {
            accumulatedText += parsed.text;
            setConversations((prev) =>
              prev.map((c) =>
                c.id === convSnapshot.id
                  ? {
                      ...c,
                      messages: c.messages.map((m) =>
                        m.id === assistantMsgId ? { ...m, content: accumulatedText } : m
                      ),
                    }
                  : c
              )
            );
          } else if (parsed.type === "grounding" && parsed.sources) {
            sources = parsed.sources;
          } else if (parsed.type === "usage" && parsed.usage) {
            usage = parsed.usage;
          } else if (parsed.type === "error") {
            throw new Error(parsed.message || "Model generation failed.");
          }
        }
      }

      if (!accumulatedText.trim()) {
        throw new Error("No response text was received from the model. Please retry.");
      }

      const durationMs = Date.now() - startedAt;

      setConversations((prev) =>
        prev.map((c) =>
          c.id === convSnapshot.id
            ? {
                ...c,
                updatedAt: Date.now(),
                messages: c.messages.map((m) =>
                  m.id === assistantMsgId
                    ? {
                        ...m,
                        model: respondedModel,
                        content: accumulatedText,
                        thoughts: accumulatedThoughts || undefined,
                        notice,
                        sources,
                        usage,
                        durationMs,
                      }
                    : m
                ),
              }
            : c
        )
      );

      // Update active canvas automatically if an HTML artifact was generated
      const maybeArtifact = extractFirstCodeBlock(accumulatedText);
      if (maybeArtifact && (maybeArtifact.language === "html" || maybeArtifact.language === "svg")) {
        setCanvasArtifact(maybeArtifact);
        setCanvasTab("preview");
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        setConversations((prev) =>
          prev.map((c) =>
            c.id === convSnapshot.id
              ? {
                  ...c,
                  messages: c.messages.map((m) =>
                    m.id === assistantMsgId
                      ? { ...m, durationMs: Date.now() - startedAt }
                      : m
                  ),
                }
              : c
          )
        );
      } else {
        const message = err instanceof Error ? err.message : "Failed to generate response.";
        setConversations((prev) =>
          prev.map((c) =>
            c.id === convSnapshot.id
              ? {
                  ...c,
                  messages: c.messages.map((m) =>
                    m.id === assistantMsgId ? { ...m, error: message } : m
                  ),
                }
              : c
          )
        );
      }
    } finally {
      abortRef.current = null;
      setIsStreaming(false);
      setStreamingMsgId(null);
    }
  };

  const handleSend = async (
    overridePrompt?: string,
    overrideMode?: WorkspaceMode,
    overrideSearch?: boolean
  ) => {
    if (isStreaming) return;

    const text = (overridePrompt ?? input).trim();
    if (!text && attachments.length === 0) return;

    const isFirstMessage = activeConversation.messages.length === 0;
    const effectiveMode = overrideMode ?? activeConversation.mode;
    const effectiveSearch = overrideSearch ?? activeConversation.useSearch;

    const userMsg: ChatMessage = {
      id: createId(),
      role: "user",
      content: text,
      attachments: attachments.length > 0 ? [...attachments] : undefined,
      createdAt: Date.now(),
    };

    const assistantMsg: ChatMessage = {
      id: createId(),
      role: "assistant",
      content: "",
      model: activeConversation.model,
      createdAt: Date.now(),
    };

    const nextHistory = [...activeConversation.messages, userMsg];
    const snapshot: Conversation = {
      ...activeConversation,
      mode: effectiveMode,
      useSearch: effectiveSearch,
      title: isFirstMessage ? text.slice(0, 44) || "New Thread" : activeConversation.title,
      messages: [...nextHistory, assistantMsg],
      updatedAt: Date.now(),
    };

    setConversations((prev) =>
      prev.map((c) => (c.id === activeConversation.id ? snapshot : c))
    );

    if (!overridePrompt) {
      setInput("");
      setAttachments([]);
    }

    if (isFirstMessage && text) {
      generateThreadTitle(snapshot.id, text);
    }

    await runCompletion(snapshot, nextHistory, assistantMsg.id);
  };

  const handleRegenerate = async () => {
    if (isStreaming || activeConversation.messages.length < 2) return;

    const msgs = [...activeConversation.messages];
    const last = msgs[msgs.length - 1];
    if (last.role !== "assistant") return;

    const historyWithoutLast = msgs.slice(0, -1);
    const freshAssistant: ChatMessage = {
      id: createId(),
      role: "assistant",
      content: "",
      model: activeConversation.model,
      createdAt: Date.now(),
    };

    const snapshot: Conversation = {
      ...activeConversation,
      messages: [...historyWithoutLast, freshAssistant],
      updatedAt: Date.now(),
    };

    setConversations((prev) =>
      prev.map((c) => (c.id === activeConversation.id ? snapshot : c))
    );

    await runCompletion(snapshot, historyWithoutLast, freshAssistant.id);
  };

  const handleStop = () => {
    abortRef.current?.abort();
  };

  const handleCopyMessage = async (msg: ChatMessage) => {
    try {
      await navigator.clipboard.writeText(msg.content);
      setCopiedMsgId(msg.id);
      setTimeout(() => setCopiedMsgId(null), 1800);
    } catch {
      // Ignore clipboard error
    }
  };

  const handleExportThread = () => {
    if (!activeConversation || activeConversation.messages.length === 0) return;
    const md = activeConversation.messages
      .map((m) => `### ${m.role === "user" ? "User" : "Goooner AI"}\n\n${m.content}`)
      .join("\n\n---\n\n");
    const blob = new Blob([`# ${activeConversation.title}\n\n${md}`], {
      type: "text/markdown;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${activeConversation.title.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "goooner-thread"}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const stopAudioPlayback = useCallback(() => {
    if (speakSourceRef.current) {
      try {
        speakSourceRef.current.onended = null;
        speakSourceRef.current.stop();
      } catch {
        // Ignore already stopped source
      }
      speakSourceRef.current = null;
    }
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
      audioRef.current = null;
    }
    setSpeakingMsgId(null);
    setLoadingSpeechMsgId(null);
  }, []);

  const handleSpeakMessage = async (msg: ChatMessage) => {
    setVoiceNotice(null);
    if (speakingMsgId === msg.id || loadingSpeechMsgId === msg.id) {
      stopAudioPlayback();
      return;
    }

    stopAudioPlayback();
    setLoadingSpeechMsgId(msg.id);

    // Synchronously create & resume AudioContext inside the click gesture so Safari/iframes don't block playback after fetch
    let ctx = speakAudioCtxRef.current;
    if (!ctx || ctx.state === "closed") {
      ctx = new AudioContext();
      speakAudioCtxRef.current = ctx;
    }
    if (ctx.state === "suspended") {
      void ctx.resume();
    }

    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: msg.content, persona: voicePersona }),
      });
      const data = (await res.json()) as {
        audioBase64?: string;
        mimeType?: string;
        error?: string;
      };
      if (!res.ok || !data.audioBase64) {
        throw new Error(data.error || "Failed to generate voice audio.");
      }

      const binary = atob(data.audioBase64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }

      if (ctx.state === "suspended") {
        await ctx.resume();
      }

      try {
        const audioBuffer = await ctx.decodeAudioData(bytes.buffer.slice(0));
        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(ctx.destination);
        speakSourceRef.current = source;
        setLoadingSpeechMsgId(null);
        setSpeakingMsgId(msg.id);
        source.onended = () => {
          if (speakSourceRef.current === source) {
            speakSourceRef.current = null;
            setSpeakingMsgId(null);
          }
        };
        source.start(0);
      } catch {
        const audio = new Audio(
          `data:${data.mimeType || "audio/wav"};base64,${data.audioBase64}`
        );
        audioRef.current = audio;
        setLoadingSpeechMsgId(null);
        setSpeakingMsgId(msg.id);
        audio.onended = () => {
          if (audioRef.current === audio) {
            audioRef.current = null;
            setSpeakingMsgId(null);
          }
        };
        audio.onerror = () => {
          if (audioRef.current === audio) {
            audioRef.current = null;
            setSpeakingMsgId(null);
            setVoiceNotice("Could not play voice audio in this browser.");
          }
        };
        await audio.play();
      }
    } catch (err) {
      setLoadingSpeechMsgId(null);
      setSpeakingMsgId(null);
      setVoiceNotice(err instanceof Error ? err.message : "Voice playback failed.");
    }
  };

  const handleToggleDictation = async () => {
    setVoiceNotice(null);
    if (isRecordingDictation && mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      setIsRecordingDictation(false);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      dictationChunksRef.current = [];
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) dictationChunksRef.current.push(ev.data);
      };

      recorder.onstop = async () => {
        for (const t of stream.getTracks()) t.stop();
        const blob = new Blob(dictationChunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });
        if (blob.size < 200) return;

        setIsTranscribing(true);
        try {
          const dataUrl = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ""));
            reader.readAsDataURL(blob);
          });
          const audioBase64 = dataUrl.split(",")[1] || "";
          const res = await fetch("/api/transcribe", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              audioBase64,
              mimeType: blob.type || "audio/webm",
            }),
          });
          const json = (await res.json()) as { text?: string; error?: string };
          if (!res.ok) throw new Error(json.error || "Transcription failed.");
          if (json.text) {
            setInput((prev) => (prev ? `${prev} ${json.text}` : json.text!));
            textareaRef.current?.focus();
          }
        } catch (err) {
          setVoiceNotice(err instanceof Error ? err.message : "Could not transcribe audio.");
        } finally {
          setIsTranscribing(false);
        }
      };

      recorder.start();
      setIsRecordingDictation(true);
    } catch {
      setVoiceNotice("Microphone permission is required for voice input.");
    }
  };

  const handleCloseVoiceModal = (turns: VoiceTranscriptTurn[]) => {
    setVoiceModalOpen(false);
    if (turns.length === 0) return;

    const now = Date.now();
    const newMsgs: ChatMessage[] = turns.map((t, idx) => ({
      id: createId(),
      role: t.role,
      content: t.text,
      createdAt: now + idx,
    }));

    updateActiveConversation((c) => {
      const firstUser = turns.find((t) => t.role === "user")?.text;
      const shouldRename = c.messages.length === 0 && firstUser;
      return {
        ...c,
        title: shouldRename ? deriveThreadTitle(firstUser) : c.title,
        messages: [...c.messages, ...newMsgs],
        updatedAt: Date.now(),
      };
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-white dark:bg-[#0B0F17] text-slate-900 dark:text-slate-100">
      <Sidebar
        conversations={conversations}
        activeId={activeConversation.id}
        onSelect={(id) => {
          setActiveId(id);
          setCanvasOpen(false);
        }}
        onNewChat={handleNewChat}
        onDelete={handleDeleteConversation}
        theme={theme}
        onToggleTheme={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
        hasCustomPrompt={customSystemPrompt.trim().length > 0}
        onOpenSystemPrompt={() => setSystemModalOpen(true)}
        mobileOpen={mobileSidebarOpen}
        onCloseMobile={() => setMobileSidebarOpen(false)}
      />

      <div className="flex-1 flex flex-col min-w-0 h-full">
        {/* Top Bar Contract: Single row with breadcrumb on left, primary actions on right */}
        <header className="flex items-center justify-between gap-6 px-4 sm:px-6 h-14 border-b border-slate-200 dark:border-slate-800/90 shrink-0 bg-white dark:bg-[#0B0F17]">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileSidebarOpen(true)}
              className="lg:hidden p-2 -ml-2 rounded-lg text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              aria-label="Open sidebar"
            >
              <Menu className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-2 lg:hidden shrink-0">
              <BrandMark className="w-5 h-5" />
              <span className="font-display text-sm font-bold tracking-tight whitespace-nowrap">
                Goooner AI
              </span>
            </div>

            <div className="hidden lg:flex items-center gap-2 text-sm min-w-0">
              <span className="text-slate-500 dark:text-slate-400 whitespace-nowrap shrink-0">
                Threads
              </span>
              <span className="text-slate-400 dark:text-slate-600" aria-hidden="true">
                /
              </span>
              <h1 className="font-medium text-slate-900 dark:text-slate-100 truncate">
                {activeConversation.title}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {activeConversation.messages.length > 0 && (
              <button
                type="button"
                onClick={handleExportThread}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Export</span>
              </button>
            )}

            {canvasArtifact && (
              <button
                type="button"
                onClick={() => setCanvasOpen((o) => !o)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  canvasOpen
                    ? "bg-blue-600 border-blue-600 text-white"
                    : "text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800"
                }`}
              >
                <PanelRight className="w-3.5 h-3.5" />
                <span>Canvas</span>
              </button>
            )}
          </div>
        </header>

        {/* Main Workspace Split Area */}
        <div className="flex-1 flex min-h-0 overflow-hidden">
          <div className="flex-1 flex flex-col min-w-0 h-full">
            {/* Workspace Control Strip */}
            <div className="border-b border-slate-200 dark:border-slate-800/80 bg-slate-50/60 dark:bg-[#0D121C]/70 px-4 sm:px-6 py-2.5 flex flex-wrap items-center justify-between gap-3 shrink-0">
              <div
                className="flex items-center gap-1 p-1 rounded-lg bg-slate-200/70 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-x-auto max-w-full"
                role="tablist"
                aria-label="Workspace mode"
              >
                {MODE_OPTIONS.map((opt) => {
                  const active = activeConversation.mode === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() =>
                        updateActiveConversation((c) => ({ ...c, mode: opt.id }))
                      }
                      className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        active
                          ? "bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs"
                          : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-200/70 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                  {MODEL_OPTIONS.map((m) => {
                    const active = activeConversation.model === m.id;
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() =>
                          updateActiveConversation((c) => ({ ...c, model: m.id }))
                        }
                        className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                          active
                            ? "bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs"
                            : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
                        }`}
                      >
                        {m.label}
                      </button>
                    );
                  })}
                </div>

                {activeConversation.model === "gemini-4-hydrogen" && (
                  <div
                    className="flex items-center gap-1 p-1 rounded-lg bg-slate-200/70 dark:bg-slate-900 border border-slate-200 dark:border-slate-800"
                    aria-label="Reasoning depth"
                  >
                    {THINKING_OPTIONS.map((lvl) => {
                      const active = activeConversation.thinkingLevel === lvl.id;
                      return (
                        <button
                          key={lvl.id}
                          type="button"
                          onClick={() =>
                            updateActiveConversation((c) => ({
                              ...c,
                              thinkingLevel: lvl.id,
                            }))
                          }
                          className={`px-2 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                            active
                              ? "bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs"
                              : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
                          }`}
                        >
                          {lvl.label}
                        </button>
                      );
                    })}
                  </div>
                )}

                <label className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-200/70 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs text-slate-700 dark:text-slate-300">
                  <Volume2 className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                  <select
                    value={voicePersona}
                    onChange={(e) => setVoicePersona(e.target.value as VoicePersonaId)}
                    aria-label="Voice persona"
                    className="bg-transparent text-xs font-medium text-slate-800 dark:text-slate-200 focus:outline-none cursor-pointer"
                  >
                    {VOICE_PERSONAS.map((p) => (
                      <option
                        key={p.id}
                        value={p.id}
                        className="bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
                      >
                        {p.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>

            {/* Chat Scroll Area */}
            <main className="flex-1 overflow-y-auto px-4 sm:px-6">
              {activeConversation.messages.length === 0 ? (
                <div className="max-w-3xl mx-auto py-12 sm:py-16">
                  <div className="mb-10">
                    <div className="flex items-center gap-3 mb-4">
                      <BrandMark className="w-9 h-9" />
                      <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-100 text-balance">
                        Goooner AI
                      </h2>
                    </div>
                    <p className="text-base text-slate-600 dark:text-slate-400 max-w-2xl leading-relaxed">
                      Your full-stack engineering, reasoning, and live web research workspace. Ask a question, paste code, attach screenshots, or launch a live HTML preview in the Canvas.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    {STARTER_PROMPTS.map((item) => (
                      <button
                        key={item.title}
                        type="button"
                        onClick={() =>
                          handleSend(item.prompt, item.mode, Boolean(item.useSearch))
                        }
                        className="group text-left p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-[#111827]/70 hover:bg-slate-100 dark:hover:bg-[#161F30] hover:border-slate-300 dark:hover:border-slate-700 transition-colors cursor-pointer"
                      >
                        <div className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-1.5">
                          {item.title}
                        </div>
                        <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                          {item.description}
                        </p>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="max-w-3xl mx-auto py-8 space-y-8">
                  {activeConversation.messages.map((msg, idx) => {
                    const isLast = idx === activeConversation.messages.length - 1;
                    const isThisStreaming = isStreaming && msg.id === streamingMsgId;

                    if (msg.role === "user") {
                      return (
                        <div key={msg.id} className="flex justify-end">
                          <div className="max-w-[85%] sm:max-w-[78%] space-y-2.5">
                            {msg.attachments && msg.attachments.length > 0 && (
                              <div className="flex flex-wrap justify-end gap-2">
                                {msg.attachments.map((att) =>
                                  att.previewUrl ? (
                                    <img
                                      key={att.id}
                                      src={att.previewUrl}
                                      alt={att.name}
                                      referrerPolicy="no-referrer"
                                      className="max-h-44 rounded-lg border border-slate-200 dark:border-slate-800 object-cover"
                                    />
                                  ) : (
                                    <div
                                      key={att.id}
                                      className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-800/80 text-xs font-mono text-slate-700 dark:text-slate-300"
                                    >
                                      <FileCode2 className="w-3.5 h-3.5 shrink-0" />
                                      <span className="truncate max-w-48">{att.name}</span>
                                    </div>
                                  )
                                )}
                              </div>
                            )}
                            {msg.content && (
                              <div className="px-4 py-3 rounded-2xl bg-slate-900 dark:bg-[#1A2233] text-white dark:text-slate-100 text-[15px] leading-relaxed whitespace-pre-wrap border border-slate-800/80">
                                {msg.content}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    }

                    const showThoughts = Boolean(msg.thoughts);
                    const isThoughtsOpen = Boolean(expandedThoughts[msg.id]);

                    return (
                      <article key={msg.id} className="space-y-3">
                        <div className="flex items-center gap-2.5">
                          <BrandMark className="w-5 h-5 shrink-0" />
                          <span className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                            Goooner AI
                          </span>
                          {!isThisStreaming && (msg.durationMs || msg.usage?.totalTokens) && (
                            <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                              {[
                                formatModelLabel(msg.model),
                                formatDuration(msg.durationMs),
                                msg.usage?.totalTokens
                                  ? `${msg.usage.totalTokens.toLocaleString()} tokens`
                                  : "",
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                            </span>
                          )}
                        </div>

                        {showThoughts && (
                          <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-[#0D131F] overflow-hidden">
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedThoughts((prev) => ({
                                  ...prev,
                                  [msg.id]: !prev[msg.id],
                                }))
                              }
                              className="w-full flex items-center justify-between px-3.5 py-2 text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 cursor-pointer"
                            >
                              <span className="flex items-center gap-1.5">
                                {isThoughtsOpen ? (
                                  <ChevronDown className="w-3.5 h-3.5" />
                                ) : (
                                  <ChevronRight className="w-3.5 h-3.5" />
                                )}
                                <span>Reasoning process</span>
                              </span>
                            </button>
                            {isThoughtsOpen && (
                              <div className="px-3.5 pb-3 pt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-400 whitespace-pre-wrap border-t border-slate-200/70 dark:border-slate-800/70">
                                {msg.thoughts}
                              </div>
                            )}
                          </div>
                        )}

                        {msg.notice && (
                          <div className="px-3 py-2 rounded-lg border border-amber-200 dark:border-amber-900/50 bg-amber-50/70 dark:bg-amber-950/20 text-xs text-amber-800 dark:text-amber-300">
                            {msg.notice}
                          </div>
                        )}

                        {msg.error ? (
                          <div className="p-4 rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50/70 dark:bg-red-950/30 text-sm text-red-700 dark:text-red-300 space-y-2.5">
                            <p>{msg.error}</p>
                            {isLast && !isStreaming && (
                              <button
                                type="button"
                                onClick={handleRegenerate}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-red-600 hover:bg-red-700 text-white transition-colors cursor-pointer"
                              >
                                <RotateCcw className="w-3.5 h-3.5" />
                                <span>Retry</span>
                              </button>
                            )}
                          </div>
                        ) : msg.content ? (
                          <MarkdownRenderer
                            content={msg.content}
                            onOpenCanvas={handleOpenCanvas}
                          />
                        ) : isThisStreaming ? (
                          <div className="py-2 text-sm text-slate-500 dark:text-slate-400">
                            {msg.thoughts ? "Synthesizing response..." : "Thinking..."}
                          </div>
                        ) : null}

                        {msg.sources && msg.sources.length > 0 && (
                          <div className="pt-2 border-t border-slate-200/70 dark:border-slate-800/70">
                            <div className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">
                              Sources
                            </div>
                            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              {msg.sources.map((src, sIdx) => (
                                <li key={`${src.uri}-${sIdx}`}>
                                  <a
                                    href={src.uri}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#111827] hover:border-slate-300 dark:hover:border-slate-700 text-xs text-slate-700 dark:text-slate-300 transition-colors"
                                  >
                                    <span className="truncate">{src.title}</span>
                                    <ExternalLink className="w-3 h-3 shrink-0 text-slate-400" />
                                  </a>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {!isThisStreaming && msg.content && (
                          <div className="flex items-center gap-2 pt-1 flex-wrap">
                            <button
                              type="button"
                              onClick={() => handleSpeakMessage(msg)}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                            >
                              {loadingSpeechMsgId === msg.id ? (
                                <>
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                  <span>Generating voice...</span>
                                </>
                              ) : speakingMsgId === msg.id ? (
                                <>
                                  <Square className="w-3.5 h-3.5 fill-current text-blue-600 dark:text-blue-400" />
                                  <span>Stop voice</span>
                                </>
                              ) : (
                                <>
                                  <Volume2 className="w-3.5 h-3.5" />
                                  <span>Speak</span>
                                </>
                              )}
                            </button>

                            <button
                              type="button"
                              onClick={() => handleCopyMessage(msg)}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                            >
                              {copiedMsgId === msg.id ? (
                                <>
                                  <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                                  <span>Copied</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="w-3.5 h-3.5" />
                                  <span>Copy</span>
                                </>
                              )}
                            </button>

                            {isLast && (
                              <button
                                type="button"
                                onClick={handleRegenerate}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                              >
                                <RotateCcw className="w-3.5 h-3.5" />
                                <span>Regenerate</span>
                              </button>
                            )}
                          </div>
                        )}
                      </article>
                    );
                  })}
                  <div ref={messagesEndRef} />
                </div>
              )}
            </main>

            {/* Composer */}
            <div className="px-4 sm:px-6 pb-4 pt-2 shrink-0 bg-white dark:bg-[#0B0F17]">
              <div className="max-w-3xl mx-auto">
                {voiceNotice && (
                  <div className="mb-2 flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-amber-200 dark:border-amber-900/50 bg-amber-50/70 dark:bg-amber-950/20 text-xs text-amber-800 dark:text-amber-300">
                    <span>{voiceNotice}</span>
                    <button
                      type="button"
                      onClick={() => setVoiceNotice(null)}
                      className="p-0.5 hover:opacity-75 cursor-pointer"
                      aria-label="Dismiss voice notice"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}

                <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-[#111827] focus-within:border-blue-500 dark:focus-within:border-blue-500 transition-colors">
                  {attachments.length > 0 && (
                    <div className="flex flex-wrap gap-2 px-3.5 pt-3">
                      {attachments.map((att) => (
                        <div
                          key={att.id}
                          className="relative group flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
                        >
                          {att.previewUrl ? (
                            <img
                              src={att.previewUrl}
                              alt={att.name}
                              referrerPolicy="no-referrer"
                              className="w-7 h-7 rounded object-cover"
                            />
                          ) : (
                            <FileCode2 className="w-4 h-4 text-slate-500" />
                          )}
                          <span className="max-w-36 truncate text-slate-700 dark:text-slate-300">
                            {att.name}
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              setAttachments((prev) => prev.filter((a) => a.id !== att.id))
                            }
                            className="p-0.5 rounded text-slate-400 hover:text-slate-900 dark:hover:text-white cursor-pointer"
                            aria-label={`Remove ${att.name}`}
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  <textarea
                    ref={textareaRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    rows={1}
                    placeholder="Ask Goooner AI to build, debug, reason, or research..."
                    aria-label="Message Goooner AI"
                    className="w-full px-4 pt-3.5 pb-2 bg-transparent text-[15px] text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none resize-none"
                  />

                  <div className="flex items-center justify-between gap-2 px-3 pb-2.5 pt-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        accept="image/*,.ts,.tsx,.js,.jsx,.py,.json,.md,.html,.css,.txt,.csv,.sql,.yml,.yaml"
                        onChange={handleFileSelect}
                        className="hidden"
                      />
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="inline-flex items-center gap-1.5 h-9 px-2.5 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-200/60 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                        title="Attach image or code file"
                      >
                        <Paperclip className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">Attach</span>
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          updateActiveConversation((c) => ({
                            ...c,
                            useSearch: !c.useSearch,
                          }))
                        }
                        aria-pressed={activeConversation.useSearch}
                        className={`inline-flex items-center gap-1.5 h-9 px-2.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                          activeConversation.useSearch
                            ? "bg-blue-600/15 text-blue-700 dark:text-blue-300 border border-blue-500/30"
                            : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-200/60 dark:hover:bg-slate-800"
                        }`}
                      >
                        <Globe className="w-3.5 h-3.5" />
                        <span>Search</span>
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          updateActiveConversation((c) => ({
                            ...c,
                            useUrlContext: !c.useUrlContext,
                          }))
                        }
                        aria-pressed={activeConversation.useUrlContext}
                        className={`inline-flex items-center gap-1.5 h-9 px-2.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                          activeConversation.useUrlContext
                            ? "bg-blue-600/15 text-blue-700 dark:text-blue-300 border border-blue-500/30"
                            : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-200/60 dark:hover:bg-slate-800"
                        }`}
                      >
                        <Link2 className="w-3.5 h-3.5" />
                        <span>URLs</span>
                      </button>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={handleToggleDictation}
                        disabled={isTranscribing}
                        className={`inline-flex items-center justify-center w-10 h-10 rounded-xl border transition-colors shrink-0 cursor-pointer ${
                          isRecordingDictation
                            ? "bg-red-600 border-red-600 text-white"
                            : "border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800"
                        }`}
                        title={isRecordingDictation ? "Stop dictation" : "Dictate with microphone"}
                        aria-label={isRecordingDictation ? "Stop dictation" : "Dictate message"}
                      >
                        {isTranscribing ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : isRecordingDictation ? (
                          <Square className="w-3.5 h-3.5 fill-current" />
                        ) : (
                          <Mic className="w-4 h-4" />
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          if (!liveOutputCtxRef.current || liveOutputCtxRef.current.state === "closed") {
                            liveOutputCtxRef.current = new AudioContext({ sampleRate: 24000 });
                          }
                          if (liveOutputCtxRef.current.state === "suspended") {
                            void liveOutputCtxRef.current.resume();
                          }
                          setVoiceModalOpen(true);
                        }}
                        className="inline-flex items-center gap-1.5 h-10 px-3.5 rounded-xl bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 hover:bg-slate-800 dark:hover:bg-white text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                        title="Start live voice conversation"
                      >
                        <AudioLines className="w-4 h-4" />
                        <span>Voice</span>
                      </button>

                      {isStreaming ? (
                        <button
                          type="button"
                          onClick={handleStop}
                          className="inline-flex items-center gap-1.5 h-10 px-4 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                        >
                          <Square className="w-3.5 h-3.5 fill-current" />
                          <span>Stop</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleSend()}
                          disabled={!input.trim() && attachments.length === 0}
                          className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 dark:disabled:bg-slate-800 disabled:text-slate-500 text-white transition-colors shrink-0 cursor-pointer disabled:cursor-not-allowed"
                          aria-label="Send message"
                        >
                          <ArrowUp className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Code & Live Preview Canvas Split Pane */}
          {canvasOpen && canvasArtifact && (
            <div className="fixed inset-0 z-40 lg:static lg:z-auto lg:w-[46%] xl:w-[48%] h-full shrink-0">
              <CanvasPanel
                artifact={canvasArtifact}
                activeTab={canvasTab}
                onTabChange={setCanvasTab}
                onClose={() => setCanvasOpen(false)}
              />
            </div>
          )}
        </div>
      </div>

      <SystemPromptModal
        open={systemModalOpen}
        value={customSystemPrompt}
        onSave={setCustomSystemPrompt}
        onClose={() => setSystemModalOpen(false)}
      />

      <VoiceModeModal
        open={voiceModalOpen}
        personaId={voicePersona}
        onPersonaChange={setVoicePersona}
        unlockedOutputCtx={liveOutputCtxRef.current}
        onClose={handleCloseVoiceModal}
      />
    </div>
  );
}
