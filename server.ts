import "dotenv/config";
import express, { Request, Response } from "express";
import fs from "fs";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { createServer as createViteServer } from "vite";
import { WebSocketServer } from "ws";
import {
  GoogleGenAI,
  Modality,
  ThinkingLevel,
  type Content,
  type LiveServerMessage,
  type Part,
} from "@google/genai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);

let cachedAI: GoogleGenAI | null = null;
let cachedVoiceAI: GoogleGenAI | null = null;

function getAIClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured in environment secrets.");
  }
  if (!cachedAI) {
    cachedAI = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  }
  return cachedAI;
}

function getVoiceAIClient(apiVersion: "v1beta" | "v1alpha" = "v1beta"): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured in environment secrets.");
  }
  if (apiVersion === "v1beta") {
    if (!cachedVoiceAI) {
      cachedVoiceAI = new GoogleGenAI({
        apiKey,
        apiVersion: "v1beta",
        httpOptions: {
          headers: {
            "User-Agent": "aistudio-build",
          },
        },
      });
    }
    return cachedVoiceAI;
  }
  return new GoogleGenAI({
    apiKey,
    apiVersion,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

type WorkspaceMode = "code" | "reason" | "research" | "general";

interface IncomingAttachment {
  name: string;
  mimeType: string;
  data: string; // base64 for binary/image or utf-8 text for code/text files
  isText?: boolean;
}

interface IncomingMessage {
  role: "user" | "assistant";
  content: string;
  attachments?: IncomingAttachment[];
}

function buildSystemInstruction(mode: WorkspaceMode, customPrompt?: string): string {
  const base = [
    "You are Goooner AI, a fast, sharp senior software engineer and assistant.",
    "Be direct and concise. Skip unnecessary preamble.",
    "Format code in fenced markdown blocks with explicit language tags (e.g. ```tsx, ```html, ```python).",
    "Use standard LaTeX delimiters for math: $...$ inline and $$...$$ for display formulas.",
    "For standalone web UI requests, provide a complete self-contained ```html document.",
  ];

  const modeGuidance: Record<WorkspaceMode, string> = {
    code: "Mode: Code & Build. Give clean, runnable code.",
    reason: "Mode: Deep Reason. Show clear step-by-step logic.",
    research: "Mode: Web Research. Give accurate facts and key dates.",
    general: "Mode: General. Be brief, clear, and helpful.",
  };

  const parts = [...base, modeGuidance[mode] || modeGuidance.code];

  if (customPrompt && customPrompt.trim().length > 0) {
    parts.push(`Custom Instructions:\n${customPrompt.trim()}`);
  }

  return parts.join("\n");
}

function mapThinkingLevel(level: string | undefined, model: string): ThinkingLevel | undefined {
  if (model === "gemini-3.1-flash-lite") {
    // Native default for gemini-3.1-flash-lite is MINIMAL (no thinking overhead)
    return undefined;
  }

  // gemini-4-hydrogen supports LOW, MEDIUM, HIGH, XHIGH
  switch (level) {
    case "low":
      return ThinkingLevel.LOW;
    case "medium":
      return ThinkingLevel.MEDIUM;
    case "high":
      return ThinkingLevel.HIGH;
    case "xhigh":
      return ThinkingLevel.XHIGH;
    default:
      return ThinkingLevel.LOW;
  }
}

function buildContents(messages: IncomingMessage[]): Content[] {
  return messages.map((msg) => {
    const parts: Part[] = [];

    if (msg.attachments && msg.attachments.length > 0) {
      for (const att of msg.attachments) {
        if (att.isText) {
          parts.push({
            text: `[Attached file: ${att.name}]\n\`\`\`\n${att.data}\n\`\`\``,
          });
        } else {
          parts.push({
            inlineData: {
              mimeType: att.mimeType,
              data: att.data,
            },
          });
        }
      }
    }

    if (msg.content && msg.content.trim().length > 0) {
      parts.push({ text: msg.content });
    } else if (parts.length === 0) {
      parts.push({ text: " " });
    }

    return {
      role: msg.role === "assistant" ? "model" : "user",
      parts,
    };
  });
}

function isTransientError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes("429") ||
    msg.includes("resource_exhausted") ||
    msg.includes("quota") ||
    msg.includes("503") ||
    msg.includes("unavailable") ||
    msg.includes("high demand") ||
    msg.includes("overloaded") ||
    msg.includes("timeout") ||
    msg.includes("econnreset") ||
    msg.includes("etimedout")
  );
}

function extractErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object") {
    const rec = err as Record<string, unknown>;
    if (typeof rec.message === "string" && rec.message) return rec.message;
    if (rec.error) return extractErrorMessage(rec.error);
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }
  return String(err);
}

function formatApiError(err: unknown): { status: number; code: string; message: string } {
  const rawMessage = extractErrorMessage(err);
  const lower = rawMessage.toLowerCase();

  if (lower.includes("api_key_invalid") || lower.includes("api key not valid")) {
    return {
      status: 400,
      code: "API_KEY_INVALID",
      message: "Your API key appears invalid. Please check your key in the Settings > Secrets panel.",
    };
  }
  if (lower.includes("permission_denied") || lower.includes("403")) {
    return {
      status: 403,
      code: "PERMISSION_DENIED",
      message: "Permission denied when accessing the model. Please verify your API key in Settings > Secrets.",
    };
  }
  if (lower.includes("resource_exhausted") || lower.includes("429") || lower.includes("quota")) {
    return {
      status: 429,
      code: "RESOURCE_EXHAUSTED",
      message: "API quota or rate limit reached for this key. Wait a few seconds and retry, or check your billing/quota in Settings > Secrets.",
    };
  }
  if (lower.includes("not_found") || lower.includes("404")) {
    return {
      status: 404,
      code: "NOT_FOUND",
      message: "Requested model was not found or is currently unavailable.",
    };
  }
  if (lower.includes("503") || lower.includes("unavailable") || lower.includes("high demand")) {
    return {
      status: 503,
      code: "UNAVAILABLE",
      message: "The AI model is experiencing temporary high demand. Please retry in a few seconds.",
    };
  }
  if (lower.includes("gemini_api_key")) {
    return {
      status: 500,
      code: "MISSING_API_KEY",
      message: "GEMINI_API_KEY is missing. Please configure it in the Settings > Secrets panel.",
    };
  }

  return {
    status: 500,
    code: "INTERNAL_ERROR",
    message: rawMessage || "An unexpected error occurred while generating a response.",
  };
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: "25mb" }));

  app.get("/api/health", (_req: Request, res: Response) => {
    res.json({ ok: true, service: "goooner-ai" });
  });

  app.post("/api/chat/stream", async (req: Request, res: Response) => {
    const {
      messages,
      model = "gemini-3.1-flash-lite",
      thinkingLevel = "low",
      mode = "code",
      useSearch = false,
      useUrlContext = false,
      customSystemPrompt = "",
    } = req.body as {
      messages: IncomingMessage[];
      model?: string;
      thinkingLevel?: string;
      mode?: WorkspaceMode;
      useSearch?: boolean;
      useUrlContext?: boolean;
      customSystemPrompt?: string;
    };

    if (!Array.isArray(messages) || messages.length === 0) {
      res.status(400).json({ error: "messages array is required" });
      return;
    }

    const allowedModels = new Set(["gemini-4-hydrogen", "gemini-3.1-flash-lite"]);
    const selectedModel = allowedModels.has(model) ? model : "gemini-3.1-flash-lite";

    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.socket?.setNoDelay?.(true);
    res.flushHeaders?.();

    const sendEvent = (payload: Record<string, unknown>) => {
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
      }
    };

    // Flush headers & SSE preamble immediately so browsers/proxies keep the stream open
    res.write(": stream-open\n\n");

    let clientAborted = false;
    res.on("close", () => {
      if (!res.writableEnded) {
        clientAborted = true;
      }
    });

    try {
      const ai = getAIClient();
      const contents = buildContents(messages);
      const systemInstruction = buildSystemInstruction(mode, customSystemPrompt);

      const tools: Array<Record<string, unknown>> = [];
      if (useSearch) {
        tools.push({ googleSearch: {} });
      }
      if (useUrlContext) {
        tools.push({ urlContext: {} });
      }

      const buildConfigForModel = (
        targetModel: string,
        enableTools: boolean
      ): Record<string, unknown> => {
        const cfg: Record<string, unknown> = { systemInstruction };
        const mappedLevel = mapThinkingLevel(thinkingLevel, targetModel);
        if (mappedLevel) {
          cfg.thinkingConfig = {
            thinkingLevel: mappedLevel,
            includeThoughts: targetModel === "gemini-4-hydrogen",
          };
        }
        if (enableTools && tools.length > 0) {
          cfg.tools = tools;
        }
        return cfg;
      };

      type StreamType = Awaited<ReturnType<typeof ai.models.generateContentStream>>;
      type StreamChunk = StreamType extends AsyncIterable<infer C> ? C : never;

      interface OpenedStream {
        model: string;
        isToolFallback: boolean;
        iterator: AsyncIterator<StreamChunk>;
        first: IteratorResult<StreamChunk>;
      }

      const openModelStream = async (
        targetModel: string,
        enableTools: boolean,
        isToolFallback: boolean
      ): Promise<OpenedStream> => {
        const stream = await ai.models.generateContentStream({
          model: targetModel,
          contents,
          config: buildConfigForModel(targetModel, enableTools),
        });
        const iterator = stream[Symbol.asyncIterator]();
        const first = await iterator.next();
        return { model: targetModel, isToolFallback, iterator, first };
      };

      const startWithHedgedRace = async (enableTools: boolean): Promise<OpenedStream> => {
        const primary =
          selectedModel === "gemini-4-hydrogen" ? "gemini-4-hydrogen" : "gemini-3.1-flash-lite";
        const secondary =
          primary === "gemini-4-hydrogen" ? "gemini-3.1-flash-lite" : "gemini-4-hydrogen";

        // Start primary at t=0; if no first chunk within 600ms (or transient error), start secondary in parallel.
        // Whichever produces its first chunk first wins; only reject if both fail.
        return new Promise<OpenedStream>((resolve, reject) => {
          let settled = false;
          let secondaryStarted = false;
          let primaryDone = false;
          let secondaryDone = false;
          let primaryErr: unknown = null;
          let secondaryErr: unknown = null;
          let hedgeTimer: ReturnType<typeof setTimeout> | null = null;

          const maybeRejectBoth = () => {
            if (!settled && primaryDone && secondaryDone) {
              settled = true;
              reject(secondaryErr || primaryErr);
            }
          };

          const startSecondary = () => {
            if (secondaryStarted || settled) return;
            secondaryStarted = true;
            if (hedgeTimer) {
              clearTimeout(hedgeTimer);
              hedgeTimer = null;
            }
            openModelStream(secondary, enableTools, false)
              .then((resStream) => {
                if (!settled) {
                  settled = true;
                  resolve(resStream);
                }
              })
              .catch((err) => {
                secondaryDone = true;
                secondaryErr = err;
                maybeRejectBoth();
              });
          };

          // Only start secondary in parallel if primary fails transiently or takes >3.5s,
          // avoiding unnecessary duplicate API requests that consume rate-limit quota.
          hedgeTimer = setTimeout(startSecondary, 3500);

          openModelStream(primary, enableTools, false)
            .then((resStream) => {
              if (hedgeTimer) clearTimeout(hedgeTimer);
              if (!settled) {
                settled = true;
                resolve(resStream);
              }
            })
            .catch((err) => {
              primaryDone = true;
              primaryErr = err;
              if (isTransientError(err)) {
                startSecondary();
                maybeRejectBoth();
              } else {
                if (hedgeTimer) clearTimeout(hedgeTimer);
                if (!settled) {
                  settled = true;
                  reject(err);
                }
              }
            });
        });
      };

      let opened: OpenedStream;
      try {
        opened = await startWithHedgedRace(tools.length > 0);
      } catch (err) {
        if (isTransientError(err)) {
          opened = await openModelStream("gemini-3.1-flash-lite", false, tools.length > 0);
        } else {
          throw err;
        }
      }

      if (clientAborted) return;

      const activeModel = opened.model;
      const usedToolFallback = opened.isToolFallback;
      const streamIterator = opened.iterator;
      const firstResult = opened.first;

      sendEvent({ type: "meta", model: activeModel });
      if (usedToolFallback) {
        sendEvent({
          type: "notice",
          message:
            "Web search grounding quota is reached on this API key; answered using Goooner AI model knowledge instead.",
        });
      }

      const collectedSources = new Map<string, { title: string; uri: string }>();
      let finalUsage: { promptTokens?: number; outputTokens?: number; totalTokens?: number } | null = null;

      const processChunk = (chunk: StreamChunk) => {
        const candidate = chunk.candidates?.[0];
        const parts = candidate?.content?.parts;

        if (parts && parts.length > 0) {
          for (const part of parts) {
            if (part.thought && part.text) {
              sendEvent({ type: "thought", text: part.text });
            } else if (!part.thought && part.text) {
              sendEvent({ type: "text", text: part.text });
            }
          }
        } else if (chunk.text) {
          sendEvent({ type: "text", text: chunk.text });
        }

        const groundingChunks = candidate?.groundingMetadata?.groundingChunks;
        if (groundingChunks && Array.isArray(groundingChunks)) {
          for (const gChunk of groundingChunks) {
            if (gChunk.web?.uri) {
              collectedSources.set(gChunk.web.uri, {
                uri: gChunk.web.uri,
                title: gChunk.web.title || gChunk.web.uri,
              });
            }
          }
        }

        if (chunk.usageMetadata) {
          finalUsage = {
            promptTokens: chunk.usageMetadata.promptTokenCount,
            outputTokens: chunk.usageMetadata.candidatesTokenCount,
            totalTokens: chunk.usageMetadata.totalTokenCount,
          };
        }
      };

      if (!firstResult.done && firstResult.value) {
        processChunk(firstResult.value);
      }

      while (!firstResult.done && !clientAborted) {
        const next = await streamIterator.next();
        if (next.done) break;
        processChunk(next.value);
      }

      if (!clientAborted) {
        if (collectedSources.size > 0) {
          sendEvent({
            type: "grounding",
            sources: Array.from(collectedSources.values()),
          });
        }
        if (finalUsage) {
          sendEvent({ type: "usage", usage: finalUsage });
        }
        sendEvent({ type: "done" });
      }
    } catch (err) {
      const formatted = formatApiError(err);
      sendEvent({
        type: "error",
        code: formatted.code,
        message: formatted.message,
      });
    } finally {
      if (!res.writableEnded) {
        res.end();
      }
    }
  });

  app.post("/api/chat/title", async (req: Request, res: Response) => {
    const { prompt } = req.body as { prompt?: string };
    if (!prompt || typeof prompt !== "string") {
      res.status(400).json({ error: "prompt is required" });
      return;
    }

    try {
      const ai = getAIClient();
      const response = await ai.models.generateContent({
        model: "gemini-3.1-flash-lite",
        contents: `Generate a concise 3 to 5 word title for a conversation starting with this prompt. Return ONLY the plain title with no quotes, punctuation at the end, or prefixes:\n\n${prompt.slice(0, 500)}`,
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
        },
      });
      const title = (response.text || "").replace(/^["']|["']$/g, "").trim();
      res.json({ title: title || "New Conversation" });
    } catch {
      res.json({ title: prompt.slice(0, 42).trim() || "New Conversation" });
    }
  });

  const VOICE_PERSONA_CONFIG: Record<
    string,
    { voiceName: string; ttsStyle: string; liveInstruction: string }
  > = {
    normal: {
      voiceName: "Puck",
      ttsStyle: "Natural, clear, friendly conversational assistant",
      liveInstruction:
        "You are Goooner AI. Chat naturally, clearly, and helpfully like a smart, friendly engineering assistant in 2-4 concise sentences per turn unless asked for more.",
    },
    "indian-meme": {
      voiceName: "Puck",
      ttsStyle:
        "Thick, expressive Indian English accent, heavily sarcastic, dramatic comedic meme timing, speaking strictly in English only",
      liveInstruction:
        "You are Goooner AI in Sarcastic Indian Meme voice mode. Speak ONLY in English—NEVER use any Hindi or Hinglish words at all. Deliver every word in a thick, unmistakable, expressive Indian English accent and cadence. Be hilariously sarcastic, overly dramatic, and full of internet meme energy—roast bad code or silly questions with exaggerated politeness and dry Indian dad/tech-support sarcasm (e.g., 'Oh brilliant, truly a Nobel Prize effort', 'My friend, what kind of tragedy is this?', 'Wait one second, hold your horses, you broke it again?'). Keep answers genuinely smart and accurate underneath the roast, in 2-4 punchy sentences per turn.",
    },
    "asp-fc": {
      voiceName: "Puck",
      ttsStyle:
        "Young energetic male FIFA and football gaming YouTuber, fast-paced comedic commentary, snappy sarcastic disbelief, Ceeday-inspired meme timing",
      liveInstruction:
        "You are Goooner AI in ASP FC-inspired Football Gaming YouTuber voice mode. Speak as a young, high-energy male football gaming YouTuber with Ceeday/NoahsNoah-style comedic timing and chaotic EA FC / FIFA Ultimate Team banter. Treat coding bugs, math problems, and user questions like a 90th-minute Weekend League collapse, a rigged pack opening, or an absurd Career Mode experiment. Be hilariously dramatic, snappy, and genuinely helpful underneath the football memes in 2-4 punchy sentences per turn.",
    },
    "meme-bro": {
      voiceName: "Puck",
      ttsStyle:
        "Hyper-expressive funny Gen-Z meme bro, comedic timing, upbeat chaotic laughter",
      liveInstruction:
        "You are Goooner AI in Unhinged Meme Bro voice mode. Talk like a hilarious, chronically online best friend who is also a cracked 10x software engineer. Use funny analogies, dramatic reactions ('bro no way', 'let him cook', 'actually goated'), and punchy conversational pacing (2-4 sentences per turn unless asked for more).",
    },
    "anime-villain": {
      voiceName: "Fenrir",
      ttsStyle:
        "Deep theatrical anime antagonist, dramatic pauses, ominous smug amusement",
      liveInstruction:
        "You are Goooner AI in Dramatic Anime Villain voice mode. Treat every mundane question, bug, or math problem like a world-ending battle of destiny. Deliver accurate answers with over-the-top theatrical flair and smug villainous amusement in 2-4 punchy sentences.",
    },
    "tired-dev": {
      voiceName: "Charon",
      ttsStyle:
        "Dry, deadpan, exhausted 3 AM senior software engineer, subtle sarcastic sighs",
      liveInstruction:
        "You are Goooner AI in 3AM Tired Senior Dev voice mode. Sound deadpan, dryly hilarious, mildly traumatized by legacy code and JavaScript quirks, yet deeply competent. Give accurate answers laced with relatable developer pain in 2-4 punchy sentences.",
    },
    "esports-caster": {
      voiceName: "Zephyr",
      ttsStyle:
        "High-energy esports tournament play-by-play announcer, electric hype excitement",
      liveInstruction:
        "You are Goooner AI in Hype Esports Caster voice mode. Call every question like a Game 7 championship finals play-by-play! High energy, hilarious hype commentary while answering accurately in 2-4 punchy sentences.",
    },
    "chaos-gremlin": {
      voiceName: "Kore",
      ttsStyle:
        "Playful, mischievous, fast-talking meme gremlin with cheeky giggles",
      liveInstruction:
        "You are Goooner AI in Chaos Gremlin voice mode. Be delightfully unhinged, mischievous, cheeky, and funny while delivering genuinely smart answers in 2-4 punchy sentences.",
    },
  };

  function toSpeakableText(raw: string): string {
    return raw
      .replace(/```[\s\S]*?```/g, " [code snippet shown on screen] ")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/\$\$[\s\S]*?\$\$/g, " [formula shown on screen] ")
      .replace(/\$([^$]+)\$/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/[#*_~>-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 1800);
  }

  app.post("/api/tts", async (req: Request, res: Response) => {
    const { text, persona = "meme-bro" } = req.body as {
      text?: string;
      persona?: string;
    };

    if (!text || typeof text !== "string" || !text.trim()) {
      res.status(400).json({ error: "text is required" });
      return;
    }

    const voiceProfile = VOICE_PERSONA_CONFIG[persona] || VOICE_PERSONA_CONFIG["meme-bro"];
    const speakText = toSpeakableText(text);
    if (!speakText) {
      res.status(400).json({ error: "No speakable text found." });
      return;
    }

    try {
      const ttsModels = ["gemini-3.8-flash-lite-tts", "gemini-3.8-flash-tts"];
      let base64Audio: string | undefined;
      let lastErr: unknown = null;

      // Try native speechMetadata style first on v1beta, then plain style prompt fallback if schema rejects speechMetadata
      const attemptPayloads: Array<{ useMetadata: boolean; text: string }> = [
        { useMetadata: true, text: speakText },
        { useMetadata: false, text: `Say in a ${voiceProfile.ttsStyle} tone: ${speakText}` },
      ];

      outer: for (const apiVer of ["v1beta", "v1alpha"] as const) {
        const ai = getVoiceAIClient(apiVer);
        for (const ttsModel of ttsModels) {
          for (const attempt of attemptPayloads) {
            try {
              const part: Part = attempt.useMetadata
                ? {
                    text: attempt.text,
                    speechMetadata: { style: voiceProfile.ttsStyle },
                  }
                : { text: attempt.text };

              const response = await ai.models.generateContent({
                model: ttsModel,
                contents: [{ role: "user", parts: [part] }],
                config: {
                  responseModalities: ["AUDIO"],
                  speechConfig: {
                    voiceConfig: {
                      prebuiltVoiceConfig: { voiceName: voiceProfile.voiceName },
                    },
                  },
                },
              });
              base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
              if (base64Audio) break outer;
            } catch (err) {
              lastErr = err;
              const msg = extractErrorMessage(err).toLowerCase();
              if (
                msg.includes("400") ||
                msg.includes("invalid_argument") ||
                msg.includes("not_found") ||
                isTransientError(err)
              ) {
                continue;
              }
              throw err;
            }
          }
        }
      }

      if (!base64Audio) {
        throw lastErr || new Error("No audio generated.");
      }

      res.json({ audioBase64: base64Audio, mimeType: "audio/wav" });
    } catch (err) {
      const formatted = formatApiError(err);
      res.status(formatted.status).json({ error: formatted.message, code: formatted.code });
    }
  });

  app.post("/api/transcribe", async (req: Request, res: Response) => {
    const { audioBase64, mimeType = "audio/webm" } = req.body as {
      audioBase64?: string;
      mimeType?: string;
    };

    if (!audioBase64 || typeof audioBase64 !== "string") {
      res.status(400).json({ error: "audioBase64 is required" });
      return;
    }

    try {
      const candidates: Array<{ client: GoogleGenAI; model: string }> = [
        { client: getAIClient(), model: "gemini-3.1-flash-lite" },
        { client: getAIClient(), model: "gemini-4-hydrogen" },
        { client: getVoiceAIClient("v1beta"), model: "gemini-3.5-transcribe" },
      ];

      let lastErr: unknown = null;
      let transcriptText = "";

      for (const { client, model } of candidates) {
        try {
          const response = await client.models.generateContent({
            model,
            contents: [
              {
                role: "user",
                parts: [
                  { inlineData: { mimeType, data: audioBase64 } },
                  {
                    text: "Transcribe the spoken words in this audio clip accurately into plain text only. Output only the spoken words.",
                  },
                ],
              },
            ],
          });
          const candidateText = (response.text || "").trim();
          if (candidateText) {
            transcriptText = candidateText;
            lastErr = null;
            break;
          }
        } catch (err) {
          lastErr = err;
          const msg = extractErrorMessage(err).toLowerCase();
          if (msg.includes("404") || msg.includes("not_found") || msg.includes("400") || isTransientError(err)) {
            continue;
          }
          throw err;
        }
      }

      if (!transcriptText && lastErr) {
        throw lastErr;
      }

      res.json({ text: transcriptText });
    } catch (err) {
      const formatted = formatApiError(err);
      res.status(formatted.status).json({ error: formatted.message, code: formatted.code });
    }
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, "dist");
    if (fs.existsSync(distPath)) {
      app.use(express.static(distPath));
      app.get("/{*path}", (_req: Request, res: Response) => {
        res.sendFile(path.join(distPath, "index.html"));
      });
    }
  }

  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    try {
      const url = new URL(request.url || "", `http://${request.headers.host || "localhost"}`);
      if (url.pathname === "/ws/live") {
        wss.handleUpgrade(request, socket, head, (ws) => {
          wss.emit("connection", ws, request);
        });
      }
    } catch {
      socket.destroy();
    }
  });

  wss.on("connection", async (clientWs, request) => {
    const url = new URL(request.url || "", `http://${request.headers.host || "localhost"}`);
    const personaId = url.searchParams.get("persona") || "meme-bro";
    const profile = VOICE_PERSONA_CONFIG[personaId] || VOICE_PERSONA_CONFIG["meme-bro"];

    type LiveSession = Awaited<ReturnType<GoogleGenAI["live"]["connect"]>>;
    let session: LiveSession | null = null;
    let clientClosed = false;
    const pendingMessages: Array<{ type?: string; data?: string; text?: string }> = [];

    const forwardToLive = (activeSession: LiveSession, msg: { type?: string; data?: string; text?: string }) => {
      if (msg.type === "audio" && msg.data) {
        activeSession.sendRealtimeInput({
          audio: { data: msg.data, mimeType: "audio/pcm;rate=16000" },
        });
      } else if (msg.type === "text" && msg.text) {
        activeSession.sendRealtimeInput({ text: msg.text });
      }
    };

    clientWs.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as { type?: string; data?: string; text?: string };
        if (session) {
          forwardToLive(session, msg);
        } else if (pendingMessages.length < 60) {
          pendingMessages.push(msg);
        }
      } catch {
        // Ignore malformed client message
      }
    });

    clientWs.on("close", () => {
      clientClosed = true;
      pendingMessages.length = 0;
      try {
        session?.close();
      } catch {
        // Ignore
      }
      session = null;
    });

    try {
      const ai = getVoiceAIClient("v1alpha");
      const liveSession = await ai.live.connect({
        model: "gemini-3.8-live",
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: profile.voiceName },
            },
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          systemInstruction: profile.liveInstruction,
        },
        callbacks: {
          onmessage: (message: LiveServerMessage) => {
            if (clientWs.readyState !== 1) return;
            const content = message.serverContent;

            if (content?.inputTranscription?.text) {
              clientWs.send(
                JSON.stringify({ type: "inputTranscript", text: content.inputTranscription.text })
              );
            }
            if (content?.outputTranscription?.text) {
              clientWs.send(
                JSON.stringify({ type: "outputTranscript", text: content.outputTranscription.text })
              );
            }
            for (const part of content?.modelTurn?.parts ?? []) {
              if (part.inlineData?.data) {
                clientWs.send(JSON.stringify({ type: "audio", data: part.inlineData.data }));
              }
            }
            if (content?.interrupted) {
              clientWs.send(JSON.stringify({ type: "interrupted" }));
            }
            if (content?.turnComplete || content?.generationComplete) {
              clientWs.send(JSON.stringify({ type: "turnComplete" }));
            }
          },
          onerror: (err) => {
            if (clientWs.readyState === 1) {
              const formatted = formatApiError(err);
              clientWs.send(JSON.stringify({ type: "error", message: formatted.message }));
            }
          },
          onclose: () => {
            if (!clientClosed && clientWs.readyState === 1) {
              clientWs.send(JSON.stringify({ type: "closed" }));
              clientWs.close();
            }
          },
        },
      });

      if (clientClosed || clientWs.readyState !== 1) {
        try {
          liveSession.close();
        } catch {
          // Ignore
        }
        return;
      }

      session = liveSession;
      clientWs.send(JSON.stringify({ type: "ready", persona: personaId }));

      for (const queued of pendingMessages.splice(0, pendingMessages.length)) {
        forwardToLive(session, queued);
      }
    } catch (err) {
      if (clientWs.readyState === 1) {
        const formatted = formatApiError(err);
        clientWs.send(JSON.stringify({ type: "error", message: formatted.message }));
        clientWs.close();
      }
    }
  });

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Goooner AI server running on http://localhost:${PORT}`);
  });
}

startServer();
