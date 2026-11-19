import React, { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, Mic, MicOff, PhoneOff, Square, Volume2, X } from "lucide-react";
import { VOICE_PERSONAS, type VoicePersonaId } from "../voicePersonas";

export interface VoiceTranscriptTurn {
  role: "user" | "assistant";
  text: string;
}

interface VoiceModeModalProps {
  open: boolean;
  personaId: VoicePersonaId;
  onPersonaChange: (id: VoicePersonaId) => void;
  unlockedOutputCtx?: AudioContext | null;
  onClose: (turns: VoiceTranscriptTurn[]) => void;
}

function resampleTo16kHz(samples: Float32Array, sourceRate: number): Float32Array {
  if (!sourceRate || sourceRate === 16000) return samples;
  const ratio = sourceRate / 16000;
  const outLength = Math.max(1, Math.floor(samples.length / ratio));
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const pos = i * ratio;
    const idx = Math.floor(pos);
    const frac = pos - idx;
    const s0 = samples[idx] ?? 0;
    const s1 = samples[Math.min(samples.length - 1, idx + 1)] ?? s0;
    out[i] = s0 + (s1 - s0) * frac;
  }
  return out;
}

function float32ToInt16Base64(float32: Float32Array): string {
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  const bytes = new Uint8Array(int16.buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64PcmToFloat32(base64: string): Float32Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const view = new DataView(bytes.buffer);
  const samples = Math.floor(bytes.byteLength / 2);
  const float32 = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    float32[i] = view.getInt16(i * 2, true) / 32768;
  }
  return float32;
}

export const VoiceModeModal: React.FC<VoiceModeModalProps> = ({
  open,
  personaId,
  onPersonaChange,
  unlockedOutputCtx,
  onClose,
}) => {
  const [status, setStatus] = useState<"connecting" | "listening" | "speaking" | "error">(
    "connecting"
  );
  const [muted, setMuted] = useState(false);
  const [micWarning, setMicWarning] = useState<string | null>(null);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [turns, setTurns] = useState<VoiceTranscriptTurn[]>([]);
  const [liveUserText, setLiveUserText] = useState("");
  const [liveAiText, setLiveAiText] = useState("");
  const [audioLevel, setAudioLevel] = useState(0);
  const [textDraft, setTextDraft] = useState("");

  const wsRef = useRef<WebSocket | null>(null);
  const inputCtxRef = useRef<AudioContext | null>(null);
  const outputCtxRef = useRef<AudioContext | null>(null);
  const ownsOutputCtxRef = useRef(false);
  const streamRef = useRef<MediaStream | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const mutedRef = useRef(false);
  const readyRef = useRef(false);
  const greetedRef = useRef(false);
  const nextStartTimeRef = useRef(0);
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const turnsRef = useRef<VoiceTranscriptTurn[]>([]);
  const liveUserRef = useRef("");
  const liveAiRef = useRef("");
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);
  const statusRef = useRef(status);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  useEffect(() => {
    if (open) {
      setTurns([]);
      turnsRef.current = [];
      greetedRef.current = false;
    }
  }, [open]);

  useEffect(() => {
    turnsRef.current = turns;
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns, liveUserText, liveAiText]);

  const stopPlaybackQueue = useCallback(() => {
    for (const src of activeSourcesRef.current) {
      try {
        src.onended = null;
        src.stop();
      } catch {
        // Ignore already stopped source
      }
    }
    activeSourcesRef.current.clear();
    nextStartTimeRef.current = 0;
    setStatus((prev) => (prev === "error" ? prev : "listening"));
  }, []);

  const cleanupSession = useCallback(() => {
    readyRef.current = false;
    stopPlaybackQueue();

    if (processorRef.current) {
      try {
        processorRef.current.disconnect();
      } catch {
        // Ignore
      }
      processorRef.current.onaudioprocess = null;
      processorRef.current = null;
    }

    if (sourceRef.current) {
      try {
        sourceRef.current.disconnect();
      } catch {
        // Ignore
      }
      sourceRef.current = null;
    }

    if (gainRef.current) {
      try {
        gainRef.current.disconnect();
      } catch {
        // Ignore
      }
      gainRef.current = null;
    }

    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }

    if (inputCtxRef.current) {
      inputCtxRef.current.close().catch(() => {});
      inputCtxRef.current = null;
    }

    if (outputCtxRef.current && ownsOutputCtxRef.current) {
      outputCtxRef.current.close().catch(() => {});
    }
    outputCtxRef.current = null;
    ownsOutputCtxRef.current = false;

    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch {
        // Ignore
      }
      wsRef.current = null;
    }
  }, [stopPlaybackQueue]);

  useEffect(() => {
    if (!open) {
      cleanupSession();
      return;
    }

    let cancelled = false;
    readyRef.current = false;
    setStatus("connecting");
    setErrorMsg(null);
    setMicWarning(null);
    setAudioBlocked(false);

    if (liveUserRef.current.trim()) {
      const pendingU = liveUserRef.current.trim();
      setTurns((prev) => [...prev, { role: "user", text: pendingU }]);
    }
    if (liveAiRef.current.trim()) {
      const pendingA = liveAiRef.current.trim();
      setTurns((prev) => [...prev, { role: "assistant", text: pendingA }]);
    }
    setLiveUserText("");
    setLiveAiText("");
    liveUserRef.current = "";
    liveAiRef.current = "";

    const startVoiceSession = async () => {
      try {
        let outputCtx: AudioContext;
        if (unlockedOutputCtx && unlockedOutputCtx.state !== "closed") {
          outputCtx = unlockedOutputCtx;
          ownsOutputCtxRef.current = false;
        } else {
          outputCtx = new AudioContext({ sampleRate: 24000 });
          ownsOutputCtxRef.current = true;
        }
        outputCtxRef.current = outputCtx;

        if (outputCtx.state === "suspended") {
          try {
            await outputCtx.resume();
          } catch {
            // Browser blocked autoplay until tap
          }
          if (outputCtx.state === "suspended" && !cancelled) {
            setAudioBlocked(true);
          }
        }

        // Try microphone capture; if blocked/unavailable, continue in type-to-voice mode
        let micStream: MediaStream | null = null;
        try {
          micStream = await navigator.mediaDevices.getUserMedia({
            audio: {
              channelCount: 1,
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            },
          });
        } catch {
          if (!cancelled) {
            setMicWarning("Microphone blocked or unavailable — type below and I will speak back.");
          }
        }

        if (cancelled) {
          if (micStream) {
            for (const t of micStream.getTracks()) t.stop();
          }
          return;
        }

        let inputCtx: AudioContext | null = null;
        if (micStream) {
          streamRef.current = micStream;
          inputCtx = new AudioContext({ sampleRate: 16000 });
          inputCtxRef.current = inputCtx;
          if (inputCtx.state === "suspended") {
            await inputCtx.resume().catch(() => {});
          }
        }

        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        const wsUrl = `${protocol}//${window.location.host}/ws/live?persona=${encodeURIComponent(personaId)}`;
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          if (cancelled || !micStream || !inputCtx) return;

          const source = inputCtx.createMediaStreamSource(micStream);
          const processor = inputCtx.createScriptProcessor(2048, 1, 1);
          const silentGain = inputCtx.createGain();
          silentGain.gain.value = 0;

          sourceRef.current = source;
          processorRef.current = processor;
          gainRef.current = silentGain;

          source.connect(processor);
          processor.connect(silentGain);
          silentGain.connect(inputCtx.destination);

          const nativeRate = inputCtx.sampleRate || 16000;
          processor.onaudioprocess = (event) => {
            if (!readyRef.current || mutedRef.current || ws.readyState !== WebSocket.OPEN) {
              if (statusRef.current === "listening") setAudioLevel(0);
              return;
            }
            const rawChannel = event.inputBuffer.getChannelData(0);
            let sum = 0;
            for (let i = 0; i < rawChannel.length; i++) {
              sum += rawChannel[i] * rawChannel[i];
            }
            const rms = Math.sqrt(sum / rawChannel.length);
            if (statusRef.current === "listening") {
              setAudioLevel(Math.min(1, rms * 8));
            }

            const resampled = resampleTo16kHz(rawChannel, nativeRate);
            const base64Audio = float32ToInt16Base64(resampled);
            ws.send(JSON.stringify({ type: "audio", data: base64Audio }));
          };
        };

        ws.onmessage = (event) => {
          if (cancelled) return;
          let msg: {
            type: string;
            data?: string;
            text?: string;
            message?: string;
          };
          try {
            msg = JSON.parse(String(event.data));
          } catch {
            return;
          }

          if (msg.type === "ready") {
            readyRef.current = true;
            setStatus("listening");
            if (!greetedRef.current && ws.readyState === WebSocket.OPEN) {
              greetedRef.current = true;
              ws.send(
                JSON.stringify({
                  type: "text",
                  text: "Say a quick 1-sentence hello in character and ask what we are working on today.",
                })
              );
            }
          } else if (msg.type === "audio" && msg.data && outputCtxRef.current) {
            const ctx = outputCtxRef.current;
            if (ctx.state === "suspended") {
              ctx.resume()
                .then(() => setAudioBlocked(false))
                .catch(() => setAudioBlocked(true));
            }

            const samples = base64PcmToFloat32(msg.data);
            if (samples.length === 0) return;

            let sum = 0;
            for (let i = 0; i < samples.length; i += 8) {
              sum += samples[i] * samples[i];
            }
            const rms = Math.sqrt(sum / Math.max(1, samples.length / 8));
            setAudioLevel(Math.min(1, rms * 5));
            setStatus("speaking");

            const buffer = ctx.createBuffer(1, samples.length, 24000);
            buffer.getChannelData(0).set(samples);

            const src = ctx.createBufferSource();
            src.buffer = buffer;
            src.connect(ctx.destination);

            const now = ctx.currentTime;
            const startAt = Math.max(now + 0.02, nextStartTimeRef.current);
            nextStartTimeRef.current = startAt + buffer.duration;

            activeSourcesRef.current.add(src);
            src.onended = () => {
              activeSourcesRef.current.delete(src);
              if (activeSourcesRef.current.size === 0) {
                setStatus((prev) => (prev === "error" ? prev : "listening"));
                setAudioLevel(0);
              }
            };
            src.start(startAt);
          } else if (msg.type === "interrupted") {
            stopPlaybackQueue();
            if (liveAiRef.current.trim()) {
              const committed = liveAiRef.current.trim();
              liveAiRef.current = "";
              setLiveAiText("");
              setTurns((prev) => [...prev, { role: "assistant", text: committed }]);
            }
          } else if (msg.type === "inputTranscript" && msg.text) {
            liveUserRef.current = `${liveUserRef.current} ${msg.text}`.trim();
            setLiveUserText(liveUserRef.current);
          } else if (msg.type === "outputTranscript" && msg.text) {
            if (liveUserRef.current.trim()) {
              const userText = liveUserRef.current.trim();
              liveUserRef.current = "";
              setLiveUserText("");
              setTurns((prev) => [...prev, { role: "user", text: userText }]);
            }
            liveAiRef.current = `${liveAiRef.current}${msg.text}`;
            setLiveAiText(liveAiRef.current);
          } else if (msg.type === "turnComplete") {
            if (liveUserRef.current.trim()) {
              const u = liveUserRef.current.trim();
              liveUserRef.current = "";
              setLiveUserText("");
              setTurns((prev) => [...prev, { role: "user", text: u }]);
            }
            if (liveAiRef.current.trim()) {
              const a = liveAiRef.current.trim();
              liveAiRef.current = "";
              setLiveAiText("");
              setTurns((prev) => [...prev, { role: "assistant", text: a }]);
            }
          } else if (msg.type === "error") {
            setStatus("error");
            setErrorMsg(msg.message || "Live voice session encountered an error.");
          } else if (msg.type === "closed") {
            if (!cancelled && statusRef.current !== "error") {
              setStatus("error");
              setErrorMsg("Live voice session closed. Switch persona or reopen Voice to reconnect.");
            }
          }
        };

        ws.onerror = () => {
          if (!cancelled) {
            setStatus("error");
            setErrorMsg("Could not connect to the live voice stream.");
          }
        };

        ws.onclose = () => {
          if (!cancelled && statusRef.current !== "error") {
            setStatus("error");
            setErrorMsg("Live voice connection closed. Reopen Voice or pick a persona to reconnect.");
          }
        };
      } catch (err) {
        if (!cancelled) {
          const msg =
            err instanceof Error ? err.message : "Could not start live voice session.";
          setStatus("error");
          setErrorMsg(msg);
        }
      }
    };

    startVoiceSession();

    return () => {
      cancelled = true;
      cleanupSession();
    };
  }, [open, personaId, unlockedOutputCtx, cleanupSession, stopPlaybackQueue]);

  if (!open) return null;

  const unlockAudio = async () => {
    if (outputCtxRef.current && outputCtxRef.current.state === "suspended") {
      try {
        await outputCtxRef.current.resume();
        setAudioBlocked(false);
      } catch {
        // Ignore
      }
    }
  };

  const handleSendTextToVoice = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    await unlockAudio();
    const trimmed = textDraft.trim();
    if (!trimmed || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    setTurns((prev) => [...prev, { role: "user", text: trimmed }]);
    wsRef.current.send(JSON.stringify({ type: "text", text: trimmed }));
    setTextDraft("");
  };

  const handleEndCall = () => {
    const finalTurns = [...turnsRef.current];
    if (liveUserRef.current.trim()) {
      finalTurns.push({ role: "user", text: liveUserRef.current.trim() });
    }
    if (liveAiRef.current.trim()) {
      finalTurns.push({ role: "assistant", text: liveAiRef.current.trim() });
    }
    cleanupSession();
    onClose(finalTurns);
  };

  const activePersona = VOICE_PERSONAS.find((p) => p.id === personaId) || VOICE_PERSONAS[0];
  const orbScale = 1 + audioLevel * 0.32;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="voice-mode-title"
    >
      <div className="w-full max-w-xl rounded-2xl bg-white dark:bg-[#0D131F] border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-5 h-14 border-b border-slate-200 dark:border-slate-800 shrink-0">
          <div className="flex items-center gap-2.5">
            <Volume2 className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            <h2
              id="voice-mode-title"
              className="font-display text-base font-semibold text-slate-900 dark:text-slate-100"
            >
              Goooner Voice Chat
            </h2>
          </div>
          <button
            type="button"
            onClick={handleEndCall}
            className="p-2 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
            aria-label="Close voice mode"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Persona Selector */}
        <div className="px-5 py-3 border-b border-slate-200 dark:border-slate-800/80 bg-slate-50 dark:bg-[#111827]/70 shrink-0">
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
            {VOICE_PERSONAS.map((persona) => {
              const active = persona.id === personaId;
              return (
                <button
                  key={persona.id}
                  type="button"
                  onClick={() => {
                    void unlockAudio();
                    onPersonaChange(persona.id);
                  }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    active
                      ? "bg-blue-600 text-white"
                      : "bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800"
                  }`}
                >
                  {persona.label}
                </button>
              );
            })}
          </div>
          <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400 truncate">
            {activePersona.tagline}
          </p>
        </div>

        {/* Audio-Reactive Voice Orb */}
        <div className="flex flex-col items-center justify-center py-6 px-6 shrink-0">
          <div className="relative flex items-center justify-center w-32 h-32">
            <div
              className="absolute inset-0 rounded-full border border-blue-500/30 dark:border-blue-400/25 transition-transform duration-100"
              style={{ transform: `scale(${orbScale * 1.12})` }}
            />
            <div
              className={`w-24 h-24 rounded-full flex items-center justify-center transition-transform duration-100 ${
                status === "speaking"
                  ? "bg-blue-600 text-white"
                  : status === "error"
                    ? "bg-red-600 text-white"
                    : "bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900"
              }`}
              style={{ transform: `scale(${orbScale})` }}
            >
              {muted || micWarning ? (
                <MicOff className="w-7 h-7" />
              ) : status === "speaking" ? (
                <Volume2 className="w-7 h-7" />
              ) : (
                <Mic className="w-7 h-7" />
              )}
            </div>
          </div>

          <div className="mt-3 text-sm font-medium text-slate-800 dark:text-slate-200">
            {status === "connecting" && "Connecting live voice..."}
            {status === "listening" &&
              (micWarning
                ? "Ready — type below for voice reply"
                : muted
                  ? "Microphone muted"
                  : "Listening — speak naturally")}
            {status === "speaking" && `${activePersona.label} is speaking...`}
            {status === "error" && "Voice connection unavailable"}
          </div>

          {audioBlocked && (
            <button
              type="button"
              onClick={unlockAudio}
              className="mt-2.5 px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium cursor-pointer"
            >
              Tap to enable speaker audio
            </button>
          )}

          {micWarning && !errorMsg && (
            <div className="mt-2.5 px-3 py-1.5 rounded-lg border border-amber-200 dark:border-amber-900/50 bg-amber-50/70 dark:bg-amber-950/20 text-xs text-amber-800 dark:text-amber-300 text-center max-w-md">
              {micWarning}
            </div>
          )}

          {errorMsg && (
            <div className="mt-3 px-3.5 py-2.5 rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 text-xs text-red-700 dark:text-red-300 text-center max-w-md">
              {errorMsg}
            </div>
          )}
        </div>

        {/* Live Transcript Log */}
        {(turns.length > 0 || liveUserText || liveAiText) && (
          <div className="flex-1 min-h-0 overflow-y-auto px-5 pb-4 space-y-2.5 border-t border-slate-200 dark:border-slate-800/80 pt-3">
            {turns.map((turn, idx) => (
              <div
                key={idx}
                className={`text-xs leading-relaxed ${
                  turn.role === "user"
                    ? "text-slate-600 dark:text-slate-400"
                    : "text-slate-900 dark:text-slate-100 font-medium"
                }`}
              >
                <span className="font-semibold mr-1.5">
                  {turn.role === "user" ? "You:" : "Goooner AI:"}
                </span>
                <span>{turn.text}</span>
              </div>
            ))}
            {liveUserText && (
              <div className="text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                <span className="font-semibold mr-1.5">You:</span>
                <span>{liveUserText}</span>
              </div>
            )}
            {liveAiText && (
              <div className="text-xs leading-relaxed text-slate-900 dark:text-slate-100 font-medium">
                <span className="font-semibold mr-1.5">Goooner AI:</span>
                <span>{liveAiText}</span>
              </div>
            )}
            <div ref={transcriptEndRef} />
          </div>
        )}

        {/* Quick Text-to-Voice Prompt Input */}
        <form
          onSubmit={handleSendTextToVoice}
          className="flex items-center gap-2 px-4 py-2.5 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D131F] shrink-0"
        >
          <input
            type="text"
            value={textDraft}
            onChange={(e) => setTextDraft(e.target.value)}
            placeholder="Or type here and Goooner AI will reply out loud..."
            className="flex-1 h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-blue-500"
          />
          <button
            type="submit"
            disabled={!textDraft.trim() || status === "connecting" || status === "error"}
            className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 dark:disabled:bg-slate-800 text-white transition-colors shrink-0 cursor-pointer disabled:cursor-not-allowed"
            aria-label="Send message to voice AI"
          >
            <ArrowUp className="w-4 h-4" />
          </button>
        </form>

        {/* Controls */}
        <div className="flex items-center justify-center gap-4 px-5 py-3.5 border-t border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-[#111827] shrink-0">
          {!micWarning && (
            <button
              type="button"
              onClick={() => {
                void unlockAudio();
                setMuted((m) => !m);
              }}
              className={`inline-flex items-center justify-center w-11 h-11 rounded-full border transition-colors cursor-pointer ${
                muted
                  ? "bg-amber-600 border-amber-600 text-white"
                  : "bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700"
              }`}
              aria-label={muted ? "Unmute microphone" : "Mute microphone"}
              title={muted ? "Unmute" : "Mute"}
            >
              {muted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
            </button>
          )}

          {status === "speaking" && (
            <button
              type="button"
              onClick={stopPlaybackQueue}
              className="inline-flex items-center gap-2 h-11 px-4 rounded-full bg-slate-200 dark:bg-slate-800 text-slate-800 dark:text-slate-200 text-xs font-medium hover:bg-slate-300 dark:hover:bg-slate-700 transition-colors cursor-pointer"
            >
              <Square className="w-3.5 h-3.5 fill-current" />
              <span>Interrupt</span>
            </button>
          )}

          <button
            type="button"
            onClick={handleEndCall}
            className="inline-flex items-center gap-2 h-11 px-5 rounded-full bg-red-600 hover:bg-red-700 text-white text-sm font-medium transition-colors cursor-pointer"
            aria-label="End voice call"
          >
            <PhoneOff className="w-4 h-4" />
            <span>End Call</span>
          </button>
        </div>
      </div>
    </div>
  );
};
