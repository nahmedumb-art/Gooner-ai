export type VoicePersonaId =
  | "normal"
  | "indian-meme"
  | "asp-fc"
  | "meme-bro"
  | "anime-villain"
  | "tired-dev"
  | "esports-caster"
  | "chaos-gremlin";

export interface VoicePersona {
  id: VoicePersonaId;
  label: string;
  tagline: string;
  voiceName: "Puck" | "Fenrir" | "Charon" | "Zephyr" | "Kore";
  ttsStyle: string;
}

export const VOICE_PERSONAS: VoicePersona[] = [
  {
    id: "normal",
    label: "Normal",
    tagline: "Natural, clear, friendly assistant voice — no meme chaos",
    voiceName: "Puck",
    ttsStyle: "Natural, clear, friendly conversational assistant",
  },
  {
    id: "indian-meme",
    label: "Indian Meme",
    tagline: "Thick Indian English accent, 100% English, brutal meme sarcasm",
    voiceName: "Puck",
    ttsStyle:
      "Thick, expressive Indian English accent, heavily sarcastic, dramatic comedic meme timing, speaking strictly in English only",
  },
  {
    id: "asp-fc",
    label: "ASP FC Vibe",
    tagline: "Male gaming YouTuber energy — FIFA meme chaos & fast commentary",
    voiceName: "Puck",
    ttsStyle:
      "Young energetic male FIFA and football gaming YouTuber, fast-paced comedic commentary, snappy sarcastic disbelief, Ceeday-inspired meme timing",
  },
  {
    id: "meme-bro",
    label: "Meme Bro",
    tagline: "Chaotic internet bro energy, funny analogies, 'let him cook'",
    voiceName: "Puck",
    ttsStyle:
      "Hyper-expressive funny Gen-Z meme bro, comedic timing, upbeat chaotic laughter",
  },
  {
    id: "anime-villain",
    label: "Anime Villain",
    tagline: "Over-the-top dramatic monologues over simple bugs",
    voiceName: "Fenrir",
    ttsStyle:
      "Deep theatrical anime antagonist, dramatic pauses, ominous smug amusement",
  },
  {
    id: "tired-dev",
    label: "3AM Dev",
    tagline: "Deadpan, overly caffeinated, dryly sarcastic senior engineer",
    voiceName: "Charon",
    ttsStyle:
      "Dry, deadpan, exhausted 3 AM senior software engineer, subtle sarcastic sighs",
  },
  {
    id: "esports-caster",
    label: "Hype Caster",
    tagline: "Game 7 championship announcer screaming play-by-play",
    voiceName: "Zephyr",
    ttsStyle:
      "High-energy esports tournament play-by-play announcer, electric hype excitement",
  },
  {
    id: "chaos-gremlin",
    label: "Chaos Gremlin",
    tagline: "Mischievous fast-talking goblin giggling at every detail",
    voiceName: "Kore",
    ttsStyle:
      "Playful, mischievous, fast-talking meme gremlin with cheeky giggles",
  },
];

export function getVoicePersona(id: string | undefined): VoicePersona {
  return VOICE_PERSONAS.find((p) => p.id === id) || VOICE_PERSONAS[0];
}
