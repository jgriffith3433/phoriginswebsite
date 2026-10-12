import voiceCast from '../../locales/voices.json';
import { saveJsonFile } from './fsApi';
import {
  LINE_TYPES,
  clipStatus,
  localeDocument,
  localePath,
  replaceLocale,
  type ClipStatus,
  type LineType,
  type StoryLine,
} from '../game/locale';

const $ = (id: string) => document.getElementById(id) as HTMLElement;

const performanceOptions = voiceCast.performances?.length
  ? voiceCast.performances
  : [{ id: 'default', label: 'Default', tag: '' }];

const performanceOf = (row: StoryLine) => row.performance?.trim() || 'default';

type VoiceFile = {
  model: string;
  performances: { id: string; label: string; tag: string }[];
  voices: Record<string, { name: string; voiceId: string }>;
  speakers: Record<string, string>;
};

type LibraryVoice = { voiceId: string; name: string; category: string };

const cast = JSON.parse(JSON.stringify(voiceCast)) as VoiceFile;
let library: LibraryVoice[] = [];

const voiceIdFor = (speaker: string) => {
  const id = cast.speakers[speaker.trim().toLowerCase()];
  return id ? cast.voices[id]?.voiceId ?? '' : '';
};

const lineState = (row: StoryLine): ClipStatus => {
  const state = clipStatus(row);
  if (state !== 'current') return state;
  const wanted = voiceIdFor(row.speaker);
  if (wanted && row.audioVoice !== wanted) return 'stale';
  return state;
};

const voiceSelect = () => $('storyVoice') as HTMLSelectElement;

const titleCase = (name: string) => name.replace(/(^|\s)[a-z]/g, (letter) => letter.toUpperCase());

const paintVoiceHint = (speaker: string) => {
  const hint = $('storyVoiceHint');
  const who = speaker.trim();
  if (!who) {
    hint.textContent = 'Speaker is the name on the subtitle. Voice is the Eleven v4 voice that character uses.';
    return;
  }
  const key = who.toLowerCase();
  const id = cast.speakers[key];
  const others = id
    ? Object.entries(cast.speakers)
      .filter(([name, voice]) => voice === id && name !== key)
      .map(([name]) => titleCase(name))
    : [];
  const shared = others.length ? ` ${others.join(' and ')} use this voice too.` : '';
  hint.textContent = `${who} is the name on the subtitle. This is the Eleven v4 voice they speak with.${shared}`;
};

const fillVoiceSelect = () => {
  const select = voiceSelect();
  const row = rows.find((entry) => entry.id === selected);
  const wanted = row ? voiceIdFor(row.speaker) : '';
  const seen = new Set<string>();
  const options = [document.createElement('option')];
  options[0].value = '';
  options[0].textContent = library.length ? 'Choose a voice' : 'Loading voices…';
  for (const voice of library) {
    if (seen.has(voice.voiceId)) continue;
    seen.add(voice.voiceId);
    const option = document.createElement('option');
    option.value = voice.voiceId;
    option.textContent = voice.category ? `${voice.name} · ${voice.category}` : voice.name;
    options.push(option);
  }
  if (wanted && !seen.has(wanted)) {
    const option = document.createElement('option');
    option.value = wanted;
    option.textContent = 'Assigned voice';
    options.push(option);
  }
  select.replaceChildren(...options);
  select.value = wanted;
  select.disabled = !row || busy;
  paintVoiceHint(row?.speaker ?? '');
};

const assignVoice = async (speaker: string, voiceId: string) => {
  const key = speaker.trim().toLowerCase();
  if (!key || !voiceId) return false;
  let id = cast.speakers[key];
  if (!id || !cast.voices[id]) {
    id = key.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'speaker';
    if (cast.voices[id] && cast.voices[id].voiceId !== voiceId) id = `${id}-voice`;
    cast.speakers[key] = id;
    cast.voices[id] = { name: speaker.trim(), voiceId };
  } else {
    cast.voices[id].voiceId = voiceId;
  }
  return saveJsonFile('/locales/voices.json', cast);
};

const previewButton = () => $('storyPreviewBtn') as HTMLButtonElement;

const syncPreviewButton = () => {
  const button = previewButton();
  const path = ($('storyAudio') as HTMLInputElement).value.trim();
  const playing = Boolean(preview && previewUrl === path && !preview.paused);
  button.disabled = !path;
  button.textContent = playing ? 'Stop' : 'Preview';
};

const stopPreview = () => {
  if (preview) {
    preview.pause();
    preview.src = '';
    preview = null;
  }
  previewUrl = '';
  if (document.getElementById('storyPreviewBtn')) syncPreviewButton();
};

const clipLabel = (state: ClipStatus) => {
  if (state === 'missing') return 'Needs clip';
  if (state === 'stale') return 'Out of date';
  if (state === 'current') return 'Current';
  return 'Silent';
};

let rows: StoryLine[] = [];
let selected = '';
let editing = '';
let editDraft = '';
let filter = 'all';
let query = '';
let busy = false;
let preview: HTMLAudioElement | null = null;
let previewUrl = '';

const overlay = () => $('storyOverlay');
const listEl = () => $('storyList');
const statusEl = () => $('storyStatus');

const needsTake = (row: StoryLine) => {
  const state = lineState(row);
  return state === 'missing' || state === 'stale';
};

const visible = () => {
  const needle = query.trim().toLowerCase();
  return rows.filter((row) => {
    const state = lineState(row);
    if (filter === 'missing' && state !== 'missing') return false;
    if (filter === 'stale' && state !== 'stale') return false;
    if (filter === 'current' && state !== 'current') return false;
    if (filter === 'silent' && state !== 'silent') return false;
    if (filter !== 'all' && filter !== 'missing' && filter !== 'stale' && filter !== 'current' && filter !== 'silent' && row.type !== filter) return false;
    if (!needle) return true;
    return `${row.id} ${row.speaker} ${row.text} ${row.audio} ${row.note}`.toLowerCase().includes(needle);
  });
};

const paintSummary = () => {
  const missing = rows.filter((row) => lineState(row) === 'missing').length;
  const stale = rows.filter((row) => lineState(row) === 'stale').length;
  const current = rows.filter((row) => lineState(row) === 'current').length;
  $('storySummary').textContent = `${rows.length} lines · ${current} current · ${missing} need a clip · ${stale} out of date. Double-click a line to edit it.`;
};

const readFields = () => {
  const row = rows.find((entry) => entry.id === selected);
  if (!row) return;
  const chosen = ($('storyPerformance') as HTMLSelectElement).value || 'default';
  row.performance = performanceOptions.some((item) => item.id === chosen) ? chosen : 'default';
  if (editing === row.id) return;
  row.type = ($('storyType') as HTMLSelectElement).value as LineType;
  row.speaker = ($('storySpeaker') as HTMLInputElement).value;
  row.text = ($('storyText') as HTMLTextAreaElement).value;
  row.audio = ($('storyAudio') as HTMLInputElement).value.trim();
  row.note = ($('storyNote') as HTMLInputElement).value;
};

const fillFields = () => {
  const row = rows.find((entry) => entry.id === selected);
  const type = $('storyType') as HTMLSelectElement;
  const speaker = $('storySpeaker') as HTMLInputElement;
  const text = $('storyText') as HTMLTextAreaElement;
  const audio = $('storyAudio') as HTMLInputElement;
  const note = $('storyNote') as HTMLInputElement;
  const performance = $('storyPerformance') as HTMLSelectElement;
  const locked = !row;
  type.disabled = locked || busy;
  speaker.disabled = locked || busy;
  text.disabled = locked || busy;
  audio.disabled = locked || busy;
  note.disabled = locked || busy;
  performance.disabled = locked || busy;
  if (!row) {
    type.value = 'dialogue';
    speaker.value = '';
    text.value = '';
    audio.value = '';
    note.value = '';
    performance.value = 'default';
    fillVoiceSelect();
    syncPreviewButton();
    return;
  }
  type.value = row.type;
  speaker.value = row.speaker;
  text.value = row.text;
  audio.value = row.audio;
  note.value = row.note;
  performance.value = performanceOptions.some((item) => item.id === performanceOf(row)) ? performanceOf(row) : 'default';
  fillVoiceSelect();
  if (preview && previewUrl !== row.audio.trim()) stopPreview();
  else syncPreviewButton();
};

const describe = (row: StoryLine) => {
  const state = lineState(row);
  if (state === 'missing') return 'No audio file yet.';
  if (state === 'stale') {
    const sentence = row.audioText.trim() === row.text.trim();
    const performance = (row.audioPerformance || '').trim() === performanceOf(row);
    const wantedVoice = voiceIdFor(row.speaker);
    if (sentence && performance && wantedVoice && row.audioVoice !== wantedVoice) {
      return 'This character’s voice changed since this clip was generated.';
    }
    if (sentence) return 'The performance changed since this clip was generated.';
    return row.audioText.trim()
      ? 'The sentence changed since this clip was generated.'
      : 'This clip has no record of the sentence it was made from.';
  }
  if (state === 'silent') return 'This type stays silent.';
  return row.audio;
};

const persist = async () => {
  readFields();
  replaceLocale({ locale: 'en', lines: rows });
  return saveJsonFile(localePath(), localeDocument());
};

const generateRow = async (row: StoryLine) => {
  const response = await fetch('/api/voice/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: row.id,
      speaker: row.speaker,
      text: row.text,
      audio: row.audio,
      performance: performanceOf(row),
      voiceId: voiceIdFor(row.speaker),
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Generate failed (${response.status})`);
  row.audio = String(body.audio || row.audio);
  row.audioText = String(body.audioText || row.text);
  row.audioPerformance = String(body.audioPerformance || performanceOf(row));
  row.audioVoice = String(body.audioVoice || voiceIdFor(row.speaker));
};

const generateOne = async (id: string) => {
  if (busy) return;
  readFields();
  const row = rows.find((entry) => entry.id === id);
  if (!row || !row.text.trim()) return;
  busy = true;
  editing = '';
  selected = id;
  statusEl().textContent = `Generating ${row.id}…`;
  paintList();
  try {
    await generateRow(row);
    fillFields();
    const saved = await persist();
    statusEl().textContent = saved
      ? `Generated ${row.id}. Saved locales/en.json. Reload the game to hear it.`
      : `Generated ${row.id}, but the catalog did not save.`;
  } catch (error) {
    statusEl().textContent = error instanceof Error ? error.message : 'Generate failed';
  } finally {
    busy = false;
    fillFields();
    paintList();
  }
};

const generatePending = async () => {
  if (busy) return;
  readFields();
  const queue = rows.filter((row) => needsTake(row) && row.text.trim());
  if (!queue.length) {
    statusEl().textContent = 'Nothing to generate.';
    return;
  }
  const proceed = window.confirm(`Generate ${queue.length} lines with ElevenLabs? This uses credits and replaces those clips.`);
  if (!proceed) return;
  busy = true;
  editing = '';
  let done = 0;
  try {
    for (const row of queue) {
      statusEl().textContent = `Generating ${done + 1} of ${queue.length} · ${row.id}`;
      paintList();
      await generateRow(row);
      done += 1;
      fillFields();
      await persist();
    }
    statusEl().textContent = `Generated ${done} lines. Reload the game to hear them.`;
  } catch (error) {
    statusEl().textContent = error instanceof Error
      ? `Stopped after ${done}. ${error.message}`
      : `Stopped after ${done}.`;
  } finally {
    busy = false;
    fillFields();
    paintList();
  }
};

const paintList = () => {
  const shown = visible();
  listEl().replaceChildren(...shown.map((row) => {
    const state = lineState(row);
    const rowEl = document.createElement('div');
    rowEl.className = `story-row${row.id === selected ? ' selected' : ''}`;
    const id = document.createElement('span');
    id.className = 'story-id';
    id.textContent = row.id;
    id.title = row.id;
    rowEl.append(id);

    if (editing === row.id) {
      const field = document.createElement('textarea');
      field.className = 'story-inline';
      field.value = row.text;
      field.addEventListener('click', (event) => event.stopPropagation());
      field.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
          row.text = editDraft;
          editing = '';
          fillFields();
          paintList();
        } else if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          field.blur();
        }
      });
      field.addEventListener('input', () => {
        row.text = field.value;
        if (selected === row.id) ($('storyText') as HTMLTextAreaElement).value = row.text;
        const pill = rowEl.querySelector('.story-pill');
        const next = lineState(row);
        if (pill) {
          pill.className = `story-pill ${next}`;
          pill.textContent = `${row.type} · ${clipLabel(next)}`;
        }
        const gen = rowEl.querySelector('.story-gen') as HTMLButtonElement | null;
        if (gen) gen.disabled = !row.text.trim();
        paintSummary();
      });
      field.addEventListener('blur', (event) => {
        if (editing !== row.id) return;
        editing = '';
        const next = event.relatedTarget;
        fillFields();
        if (next instanceof HTMLElement && next.classList.contains('story-gen')) return;
        paintList();
      });
      rowEl.append(field);
      queueMicrotask(() => {
        if (editing === row.id) field.focus();
      });
    } else {
      const copy = document.createElement('span');
      copy.className = 'story-copy';
      copy.textContent = `${row.speaker ? `${row.speaker}: ` : ''}${row.text || row.note || row.type}`;
      copy.title = 'Double-click to edit';
      copy.addEventListener('dblclick', (event) => {
        event.stopPropagation();
        if (busy) return;
        readFields();
        selected = row.id;
        editing = row.id;
        editDraft = row.text;
        fillFields();
        paintList();
      });
      rowEl.append(copy);
    }

    const pill = document.createElement('span');
    pill.className = `story-pill ${state}`;
    pill.textContent = `${row.type} · ${clipLabel(state)}`;
    rowEl.append(pill);

    if (needsTake(row)) {
      const gen = document.createElement('button');
      gen.type = 'button';
      gen.className = 'story-gen';
      gen.textContent = 'Generate';
      gen.disabled = busy || !row.text.trim();
      gen.title = row.text.trim() ? 'Generate this take with ElevenLabs' : 'Write the line first';
      gen.addEventListener('click', (event) => {
        event.stopPropagation();
        void generateOne(row.id);
      });
      rowEl.append(gen);
    } else {
      rowEl.append(document.createElement('span'));
    }

    rowEl.addEventListener('click', () => {
      if (busy || editing === row.id) return;
      readFields();
      selected = row.id;
      fillFields();
      statusEl().textContent = describe(row);
      paintList();
    });
    return rowEl;
  }));
  paintSummary();
  const batch = $('storyGenerateBtn') as HTMLButtonElement;
  batch.disabled = busy;
};

const bindFields = () => {
  for (const id of ['storyType', 'storySpeaker', 'storyText', 'storyAudio', 'storyNote', 'storyPerformance']) {
    $(id).addEventListener('input', () => {
      readFields();
      if (id === 'storySpeaker') fillVoiceSelect();
      if (id === 'storyAudio') {
        const path = ($('storyAudio') as HTMLInputElement).value.trim();
        if (preview && previewUrl !== path) stopPreview();
        else syncPreviewButton();
      }
      paintList();
    });
  }
};

const fillTypeSelect = () => {
  const performance = $('storyPerformance') as HTMLSelectElement;
  performance.replaceChildren(...performanceOptions.map((item) => {
    const option = document.createElement('option');
    option.value = item.id;
    option.textContent = item.label;
    return option;
  }));
  const type = $('storyType') as HTMLSelectElement;
  type.replaceChildren(...LINE_TYPES.map((name) => {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    return option;
  }));
  const filterEl = $('storyFilter') as HTMLSelectElement;
  const options: [string, string][] = [
    ['all', 'All'],
    ['missing', 'Needs clip'],
    ['stale', 'Out of date'],
    ['current', 'Current'],
    ['silent', 'Silent'],
    ...LINE_TYPES.map((name) => [name, name] as [string, string]),
  ];
  filterEl.replaceChildren(...options.map(([value, label]) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    return option;
  }));
};

const readClipMeta = async () => {
  const paths = [...new Set(rows.map((row) => row.audio.trim()).filter(Boolean))];
  if (!paths.length) return;
  const response = await fetch('/api/voice/inspect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paths }),
  });
  if (!response.ok) return;
  const body = await response.json();
  const recorded = new Map<string, { text: string | null; performance: string | null; voiceId: string | null }>();
  for (const clip of body.clips ?? []) {
    recorded.set(clip.path, {
      text: typeof clip.text === 'string' ? clip.text : null,
      performance: typeof clip.performance === 'string' ? clip.performance : null,
      voiceId: typeof clip.voiceId === 'string' ? clip.voiceId : null,
    });
  }
  for (const row of rows) {
    if (!row.audio.trim()) continue;
    const clip = recorded.get(row.audio);
    row.audioText = clip?.text ?? '';
    row.audioPerformance = clip?.performance ?? '';
    row.audioVoice = clip?.voiceId ?? '';
  }
};

const loadLibrary = async () => {
  const response = await fetch('/api/voice/list');
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'Could not list voices');
  library = Array.isArray(body.voices) ? body.voices : [];
  fillVoiceSelect();
};

export const openStoryLines = async () => {
  overlay().hidden = false;
  statusEl().textContent = 'Loading…';
  try {
    const response = await fetch(localePath(), { cache: 'no-store' });
    if (!response.ok) throw new Error(String(response.status));
    const file = await response.json();
    replaceLocale(file);
    rows = localeDocument().lines.map((row) => ({
      ...row,
      audioText: row.audioText || '',
      performance: row.performance || 'default',
      audioPerformance: row.audioPerformance || '',
      audioVoice: row.audioVoice || '',
    }));
  } catch {
    rows = localeDocument().lines.map((row) => ({
      ...row,
      audioText: row.audioText || '',
      performance: row.performance || 'default',
      audioPerformance: row.audioPerformance || '',
      audioVoice: row.audioVoice || '',
    }));
    statusEl().textContent = 'Could not reload the file. Showing the copy bundled with this page.';
  }
  if (!rows.some((row) => row.id === selected)) selected = rows[0]?.id ?? '';
  fillFields();
  paintList();
  statusEl().textContent = 'Reading clip metadata…';
  let loadError = '';
  try {
    await Promise.all([readClipMeta(), loadLibrary()]);
  } catch (error) {
    loadError = error instanceof Error
      ? error.message
      : 'Could not read clip metadata. Restart npm run dev if Generate is new.';
  }
  fillFields();
  paintList();
  const row = rows.find((entry) => entry.id === selected);
  statusEl().textContent = loadError || (row ? describe(row) : '');
};

const playPreview = () => {
  readFields();
  const path = ($('storyAudio') as HTMLInputElement).value.trim();
  if (!path) {
    statusEl().textContent = 'This line has no audio file.';
    syncPreviewButton();
    return;
  }
  if (preview && previewUrl === path && !preview.paused) {
    stopPreview();
    return;
  }
  stopPreview();
  const audio = new Audio(path);
  preview = audio;
  previewUrl = path;
  syncPreviewButton();
  audio.addEventListener('ended', stopPreview);
  audio.addEventListener('error', () => {
    stopPreview();
    statusEl().textContent = `Could not play ${path}`;
  });
  void audio.play().catch(() => {
    stopPreview();
    statusEl().textContent = `Could not play ${path}`;
  });
};

const closeStoryLines = () => {
  editing = '';
  stopPreview();
  overlay().hidden = true;
};

const saveStoryLines = async () => {
  if (busy) return;
  statusEl().textContent = 'Saving…';
  const ok = await persist();
  statusEl().textContent = ok
    ? 'Saved locales/en.json. Reload the game to hear the new lines.'
    : 'Save failed. Story lines save while npm run dev is running.';
  paintList();
};

export const bindStoryLines = () => {
  fillTypeSelect();
  bindFields();
  voiceSelect().addEventListener('change', () => {
    if (busy) return;
    readFields();
    const row = rows.find((entry) => entry.id === selected);
    const voiceId = voiceSelect().value;
    if (!row || !voiceId) return;
    void assignVoice(row.speaker, voiceId).then((ok) => {
      paintVoiceHint(row.speaker);
      paintList();
      statusEl().textContent = ok
        ? describe(row)
        : 'The voice list did not save. Story lines save while npm run dev is running.';
    });
  });
  $('storyLinesBtn').addEventListener('click', () => {
    void openStoryLines();
  });
  $('storyCloseBtn').addEventListener('click', closeStoryLines);
  $('storySaveBtn').addEventListener('click', () => {
    void saveStoryLines();
  });
  $('storyGenerateBtn').addEventListener('click', () => {
    void generatePending();
  });
  $('storyPreviewBtn').addEventListener('click', () => playPreview());
  overlay().querySelector('.story-modal')?.addEventListener('click', (event) => event.stopPropagation());
  overlay().addEventListener('click', (event) => {
    if (event.target === overlay()) closeStoryLines();
  });
  ($('storySearch') as HTMLInputElement).addEventListener('input', (event) => {
    query = (event.target as HTMLInputElement).value;
    paintList();
  });
  ($('storyFilter') as HTMLSelectElement).addEventListener('change', (event) => {
    filter = (event.target as HTMLSelectElement).value;
    paintList();
  });
};
