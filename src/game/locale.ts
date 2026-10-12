import catalog from '../../locales/en.json';

/**
 * Story copy lives in locales/en.json. English is the default locale.
 * Edit that file (or Dev Tools → Story lines). Do not paste the same sentence
 * back into a cutscene, phone script, or story module.
 *
 * A line id is stable: phone.voss-late.01, dialogue.apex-window.03, bark.street.cold.
 * `type` says what the line is. These types are spoken and need an audio file:
 * phone, dialogue, bark, shout. An empty `audio` on those is a missing clip.
 * text, objective, hud, item, credit, and ui stay silent.
 *
 * `speaker` is who says it. For an objective or a scene card it is the short title.
 * For an inventory line it is the item name, and `text` is the note.
 * `note` is for editors only. The game never shows it.
 * `audioText` is the sentence stored inside the wav when a take was generated.
 * `performance` is the Eleven v4 delivery. `default` sends the line with no audio tag.
 * `audioPerformance` is the delivery stored in that same wav. The game never speaks either.
 * A spoken line is out of date when the sentence or the performance does not match the file.
 * Clips made before that chunk exist count as out of date until they are generated again.
 */

export const LINE_TYPES = [
  'phone',
  'dialogue',
  'bark',
  'shout',
  'text',
  'objective',
  'hud',
  'item',
  'credit',
  'ui',
] as const;

export type LineType = (typeof LINE_TYPES)[number];

export const SPOKEN_TYPES: ReadonlySet<LineType> = new Set(['phone', 'dialogue', 'bark', 'shout']);

export type StoryLine = {
  id: string;
  type: LineType;
  speaker: string;
  text: string;
  audio: string;
  /** Sentence embedded in the clip. Empty means the file has no generation record. */
  audioText: string;
  /** Eleven v4 delivery. `default` adds no audio tag. */
  performance: string;
  /** Delivery stored in the clip. Empty means the file has no record of it. */
  audioPerformance: string;
  /** ElevenLabs voice id stored in the clip. Empty means the file has no record of it. */
  audioVoice: string;
  note: string;
};

export type LocaleFile = {
  locale: string;
  lines: StoryLine[];
};

const LOCALE_PATH = '/locales/en.json';

const normalize = (raw: Partial<StoryLine>): StoryLine => ({
  id: String(raw.id ?? '').trim(),
  type: LINE_TYPES.includes(raw.type as LineType) ? raw.type as LineType : 'dialogue',
  speaker: String(raw.speaker ?? ''),
  text: String(raw.text ?? ''),
  audio: String(raw.audio ?? ''),
  audioText: String(raw.audioText ?? ''),
  performance: raw.performance && raw.performance !== 'default' ? String(raw.performance) : 'default',
  audioPerformance: String(raw.audioPerformance ?? ''),
  audioVoice: String(raw.audioVoice ?? ''),
  note: String(raw.note ?? ''),
});

let lines: StoryLine[] = ((catalog as LocaleFile).lines ?? []).map(normalize);
let byId = index(lines);

function index(list: StoryLine[]) {
  const map = new Map<string, StoryLine>();
  for (const row of list) {
    if (row.id) map.set(row.id, row);
  }
  return map;
}

export const localePath = () => LOCALE_PATH;

export const storyLines = () => lines;

export const storyLine = (id: string) => byId.get(id);

export const lineText = (id: string, fallback = '') => storyLine(id)?.text || fallback;

export const lineAudio = (id: string, fallback = '') => storyLine(id)?.audio || fallback;

export const lineSpeaker = (id: string, fallback = '') => storyLine(id)?.speaker || fallback;

/** Phone scripts store the contact id. "Voss" and "Pierce Hawkes" both map back. */
export const phoneSpeakerId = (speaker: string) => {
  const key = speaker.trim().toLowerCase();
  if (key === 'pierce hawkes' || key === 'pierce') return 'pierce';
  if (key === 'director hale') return 'hale';
  return key;
};

export const spokenLine = (row: StoryLine) => SPOKEN_TYPES.has(row.type);

export const missingClip = (row: StoryLine) => spokenLine(row) && !row.audio.trim();

/** Spoken line whose file does not carry this sentence and performance. Voice changes are checked in the editor. */
export const staleClip = (row: StoryLine) => {
  if (!spokenLine(row) || !row.audio.trim() || !row.text.trim()) return false;
  if (row.audioText.trim() !== row.text.trim()) return true;
  const wanted = (row.performance || 'default').trim() || 'default';
  return (row.audioPerformance || '').trim() !== wanted;
};

export type ClipStatus = 'silent' | 'missing' | 'stale' | 'current';

export const clipStatus = (row: StoryLine): ClipStatus => {
  if (!spokenLine(row)) return 'silent';
  if (!row.audio.trim()) return 'missing';
  if (!row.text.trim()) return 'current';
  return staleClip(row) ? 'stale' : 'current';
};

export const replaceLocale = (file: LocaleFile) => {
  lines = file.lines.map(normalize).filter((row) => row.id);
  byId = index(lines);
};

export const localeDocument = (): LocaleFile => ({
  locale: 'en',
  lines: lines.map((row) => {
    const entry: StoryLine = {
      id: row.id,
      type: row.type,
      speaker: row.speaker,
      text: row.text,
      audio: row.audio,
      audioText: row.audioText.trim(),
      performance: row.performance.trim() || 'default',
      audioPerformance: row.audioPerformance.trim(),
      audioVoice: row.audioVoice.trim(),
      note: row.note,
    };
    const saved: Partial<StoryLine> = {
      id: entry.id,
      type: entry.type,
      speaker: entry.speaker,
      text: entry.text,
      audio: entry.audio,
    };
    if (entry.audioText) saved.audioText = entry.audioText;
    if (entry.performance !== 'default') saved.performance = entry.performance;
    if (entry.audioPerformance) saved.audioPerformance = entry.audioPerformance;
    if (entry.audioVoice) saved.audioVoice = entry.audioVoice;
    saved.note = entry.note;
    return saved as StoryLine;
  }),
});

/** Inventory name and note. `speaker` is the name, `text` is the note. */
export const carryItems = <T extends { id: string; name: string; note: string }>(bag: string, items: T[]): T[] =>
  items.map((item) => {
    const row = storyLine(`item.${bag}.${item.id}`);
    if (!row) return { ...item };
    return { ...item, name: row.speaker || item.name, note: row.text || item.note };
  });
