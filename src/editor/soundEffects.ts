import { saveJsonFile } from './fsApi';

const $ = (id: string) => document.getElementById(id) as HTMLElement;

const GROUPS = ['player', 'ui', 'phone', 'creature', 'street', 'elevator', 'room'] as const;
const DEFAULT_INFLUENCE = 0.55;

type ClipState = 'missing' | 'stale' | 'current';

type SoundEffect = {
  id: string;
  group: string;
  text: string;
  audio: string;
  note: string;
  loop: boolean;
  duration: number | null;
  influence: number;
  volume: number;
  recorded: boolean;
  missingFile: boolean;
  audioText: string;
  audioLoop: boolean;
  audioDuration: number | null;
  audioInfluence: number | null;
};

type RecordedClip = {
  text: string | null;
  loop: boolean | null;
  duration: number | null;
  influence: number | null;
  missingFile: boolean;
};

const sameDuration = (left: number | null, right: number | null) => {
  if (left == null && right == null) return true;
  if (left == null || right == null) return false;
  return Math.abs(left - right) < 0.05;
};

const effectState = (row: SoundEffect): ClipState => {
  if (!row.audio.trim() || row.missingFile) return 'missing';
  if (!row.recorded) return 'stale';
  const text = row.audioText.trim() === row.text.trim();
  const loop = row.audioLoop === row.loop;
  const duration = sameDuration(row.audioDuration, row.duration);
  const influence = row.audioInfluence != null && Math.abs(row.audioInfluence - row.influence) < 0.02;
  return text && loop && duration && influence ? 'current' : 'stale';
};

const clipLabel = (state: ClipState) => {
  if (state === 'missing') return 'Needs clip';
  if (state === 'stale') return 'Out of date';
  return 'Current';
};

const describe = (row: SoundEffect) => {
  const state = effectState(row);
  if (state === 'missing') {
    return row.audio.trim()
      ? `No file at ${row.audio}.`
      : 'This effect has no audio file.';
  }
  if (!row.recorded) return 'This file has no generation record, so it is out of date.';
  if (state === 'stale') return 'The description, loop, duration, or influence does not match the file.';
  const length = row.duration == null ? 'auto length' : `${row.duration}s`;
  return `Current. ${row.loop ? 'Seamless loop' : 'One-shot'}, ${length}, volume ${row.volume.toFixed(2)}.`;
};

let rows: SoundEffect[] = [];
let selected = '';
let editing = '';
let editDraft = '';
let filter = 'all';
let query = '';
let busy = false;
let preview: HTMLAudioElement | null = null;
let previewUrl = '';

const overlay = () => $('sfxOverlay');
const listEl = () => $('sfxList');
const statusEl = () => $('sfxStatus');

const needsTake = (row: SoundEffect) => effectState(row) !== 'current';

const visible = () => {
  const needle = query.trim().toLowerCase();
  return rows.filter((row) => {
    const state = effectState(row);
    if (filter === 'missing' && state !== 'missing') return false;
    if (filter === 'stale' && state !== 'stale') return false;
    if (filter === 'current' && state !== 'current') return false;
    if (GROUPS.includes(filter as typeof GROUPS[number]) && row.group !== filter) return false;
    if (!needle) return true;
    return `${row.id} ${row.group} ${row.text} ${row.audio} ${row.note}`.toLowerCase().includes(needle);
  });
};

const paintSummary = () => {
  const missing = rows.filter((row) => effectState(row) === 'missing').length;
  const stale = rows.filter((row) => effectState(row) === 'stale').length;
  const current = rows.filter((row) => effectState(row) === 'current').length;
  $('sfxSummary').textContent = `${rows.length} effects · ${current} current · ${missing} need a clip · ${stale} out of date. Double-click a description to edit it.`;
};

const readDuration = (raw: string) => {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return null;
  return Math.round(Math.min(30, Math.max(0.5, value)) * 10) / 10;
};

const readInfluence = (raw: string) => {
  const value = Number(raw);
  if (!Number.isFinite(value)) return DEFAULT_INFLUENCE;
  return Math.round(Math.min(1, Math.max(0, value)) * 100) / 100;
};

const readVolume = (raw: string) => {
  const value = Number(raw);
  if (!Number.isFinite(value)) return 1;
  return Math.round(Math.min(1, Math.max(0, value)) * 100) / 100;
};

const readFields = () => {
  const row = rows.find((entry) => entry.id === selected);
  if (!row) return;
  row.group = ($('sfxGroup') as HTMLSelectElement).value || row.group;
  row.loop = ($('sfxLoop') as HTMLInputElement).checked;
  row.duration = readDuration(($('sfxDuration') as HTMLInputElement).value);
  row.influence = readInfluence(($('sfxInfluence') as HTMLInputElement).value);
  row.volume = readVolume(($('sfxVolume') as HTMLInputElement).value);
  row.audio = ($('sfxAudio') as HTMLInputElement).value.trim();
  row.note = ($('sfxNote') as HTMLInputElement).value;
  if (editing === row.id) return;
  row.text = ($('sfxText') as HTMLTextAreaElement).value;
};

const fillFields = () => {
  const row = rows.find((entry) => entry.id === selected);
  const group = $('sfxGroup') as HTMLSelectElement;
  const text = $('sfxText') as HTMLTextAreaElement;
  const audio = $('sfxAudio') as HTMLInputElement;
  const note = $('sfxNote') as HTMLInputElement;
  const loop = $('sfxLoop') as HTMLInputElement;
  const duration = $('sfxDuration') as HTMLInputElement;
  const influence = $('sfxInfluence') as HTMLInputElement;
  const volume = $('sfxVolume') as HTMLInputElement;
  const locked = !row || busy;
  group.disabled = locked;
  text.disabled = locked;
  audio.disabled = locked;
  note.disabled = locked;
  loop.disabled = locked;
  duration.disabled = locked;
  influence.disabled = locked;
  volume.disabled = locked;
  if (!row) return;
  group.value = GROUPS.includes(row.group as typeof GROUPS[number]) ? row.group : GROUPS[0];
  text.value = row.text;
  audio.value = row.audio;
  note.value = row.note;
  loop.checked = row.loop;
  duration.value = row.duration == null ? '' : String(row.duration);
  influence.value = String(row.influence);
  $('sfxInfluenceValue').textContent = row.influence.toFixed(2);
  volume.value = String(row.volume);
  $('sfxVolumeValue').textContent = row.volume.toFixed(2);
  if (preview && !preview.paused) preview.volume = row.volume;
  syncPreviewButton();
};

const documentOf = () => ({
  model: 'eleven_text_to_sound_v2',
  effects: rows.map((row) => {
    const effect: Record<string, unknown> = {
      id: row.id,
      group: row.group,
      text: row.text,
      audio: row.audio,
    };
    if (row.loop) effect.loop = true;
    if (row.duration != null) effect.duration = row.duration;
    effect.influence = row.influence;
    effect.volume = row.volume;
    if (row.note.trim()) effect.note = row.note;
    return effect;
  }),
});

const persist = () => {
  readFields();
  return saveJsonFile('/locales/sfx.json', documentOf());
};

const previewButton = () => $('sfxPreviewBtn') as HTMLButtonElement;

const syncPreviewButton = () => {
  const button = previewButton();
  const path = ($('sfxAudio') as HTMLInputElement).value.trim();
  const playing = Boolean(preview && previewUrl.startsWith(path) && path && !preview.paused);
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
  if (document.getElementById('sfxPreviewBtn')) syncPreviewButton();
};

const applyRecord = (row: SoundEffect, body: {
  audio?: string;
  audioText?: string;
  audioLoop?: boolean;
  audioDuration?: number | null;
  audioInfluence?: number;
}) => {
  row.audio = String(body.audio || row.audio);
  row.audioText = String(body.audioText || row.text);
  row.audioLoop = body.audioLoop === true;
  row.duration = typeof body.audioDuration === 'number' ? body.audioDuration : null;
  row.audioDuration = row.duration;
  row.audioInfluence = typeof body.audioInfluence === 'number' ? body.audioInfluence : row.influence;
  row.recorded = true;
  row.missingFile = false;
};

const generateRow = async (row: SoundEffect) => {
  const response = await fetch('/api/sfx/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: row.id,
      text: row.text,
      audio: row.audio,
      loop: row.loop,
      duration: row.duration,
      influence: row.influence,
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Generate failed (${response.status})`);
  applyRecord(row, body);
};

const generateOne = async (id: string) => {
  if (busy) return;
  readFields();
  const row = rows.find((entry) => entry.id === id);
  if (!row || !row.text.trim()) return;
  busy = true;
  editing = '';
  selected = id;
  stopPreview();
  statusEl().textContent = `Generating ${row.id}…`;
  paintList();
  try {
    await generateRow(row);
    fillFields();
    const saved = await persist();
    statusEl().textContent = saved
      ? `Generated ${row.id}. Saved locales/sfx.json.`
      : `Generated ${row.id}, but the catalog did not save.`;
  } catch (error) {
    statusEl().textContent = error instanceof Error ? error.message : 'Generate failed';
  } finally {
    busy = false;
    fillFields();
    paintList();
  }
};

const generateQueue = async (queue: SoundEffect[], label: string) => {
  if (busy) return;
  readFields();
  if (!queue.length) {
    statusEl().textContent = 'Nothing to generate.';
    return;
  }
  const proceed = window.confirm(`${label} ${queue.length} sound effects with ElevenLabs? This uses credits and replaces those clips.`);
  if (!proceed) return;
  busy = true;
  editing = '';
  stopPreview();
  let done = 0;
  const failed: string[] = [];
  try {
    for (const row of queue) {
      statusEl().textContent = `Generating ${done + failed.length + 1} of ${queue.length} · ${row.id}`;
      paintList();
      try {
        await generateRow(row);
        done += 1;
        fillFields();
        await persist();
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Generate failed';
        failed.push(`${row.id}: ${message}`);
      }
    }
    statusEl().textContent = failed.length
      ? `Generated ${done}. ${failed.length} failed. ${failed.join(' ')}`
      : `Generated ${done} sound effects.`;
  } finally {
    busy = false;
    fillFields();
    paintList();
  }
};

const paintList = () => {
  const shown = visible();
  listEl().replaceChildren(...shown.map((row) => {
    const state = effectState(row);
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
        if (selected === row.id) ($('sfxText') as HTMLTextAreaElement).value = row.text;
        const pill = rowEl.querySelector('.story-pill');
        const next = effectState(row);
        if (pill) {
          pill.className = `story-pill ${next}`;
          pill.textContent = `${row.group} · ${clipLabel(next)}`;
        }
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
      copy.textContent = row.text || row.note || row.group;
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
    pill.textContent = `${row.group} · ${clipLabel(state)}`;
    rowEl.append(pill);

    if (needsTake(row)) {
      const gen = document.createElement('button');
      gen.type = 'button';
      gen.className = 'story-gen';
      gen.textContent = 'Generate';
      gen.disabled = busy || !row.text.trim();
      gen.title = row.text.trim() ? 'Generate this sound effect' : 'Write the description first';
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
  ($('sfxGenerateBtn') as HTMLButtonElement).disabled = busy;
  ($('sfxRegenerateBtn') as HTMLButtonElement).disabled = busy;
  ($('sfxGenerateOneBtn') as HTMLButtonElement).disabled = busy || !rows.find((row) => row.id === selected)?.text.trim();
};

const bindFields = () => {
  for (const id of ['sfxGroup', 'sfxText', 'sfxAudio', 'sfxNote', 'sfxLoop', 'sfxDuration', 'sfxInfluence', 'sfxVolume']) {
    $(id).addEventListener('input', () => {
      readFields();
      if (id === 'sfxInfluence') {
        const row = rows.find((entry) => entry.id === selected);
        $('sfxInfluenceValue').textContent = (row?.influence ?? DEFAULT_INFLUENCE).toFixed(2);
      }
      if (id === 'sfxVolume') {
        const row = rows.find((entry) => entry.id === selected);
        $('sfxVolumeValue').textContent = (row?.volume ?? 1).toFixed(2);
        if (preview && !preview.paused) preview.volume = row?.volume ?? 1;
      }
      if (id === 'sfxAudio') {
        const path = ($('sfxAudio') as HTMLInputElement).value.trim();
        if (preview && !previewUrl.startsWith(path)) stopPreview();
        else syncPreviewButton();
      }
      paintList();
    });
  }
};

const fillSelects = () => {
  const group = $('sfxGroup') as HTMLSelectElement;
  group.replaceChildren(...GROUPS.map((name) => {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    return option;
  }));
  const filterEl = $('sfxFilter') as HTMLSelectElement;
  const options: [string, string][] = [
    ['all', 'All'],
    ['missing', 'Needs clip'],
    ['stale', 'Out of date'],
    ['current', 'Current'],
    ...GROUPS.map((name) => [name, name] as [string, string]),
  ];
  filterEl.replaceChildren(...options.map(([value, label]) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    return option;
  }));
};

const asEffect = (raw: Record<string, unknown>): SoundEffect => ({
  id: String(raw.id || ''),
  group: String(raw.group || 'player'),
  text: String(raw.text || ''),
  audio: String(raw.audio || ''),
  note: String(raw.note || ''),
  loop: raw.loop === true,
  duration: typeof raw.duration === 'number' ? raw.duration : null,
  influence: typeof raw.influence === 'number' ? raw.influence : DEFAULT_INFLUENCE,
  volume: typeof raw.volume === 'number' ? Math.max(0, Math.min(1, raw.volume)) : 1,
  recorded: false,
  missingFile: false,
  audioText: '',
  audioLoop: false,
  audioDuration: null,
  audioInfluence: null,
});

const readClipMeta = async () => {
  const paths = [...new Set(rows.map((row) => row.audio.trim()).filter(Boolean))];
  if (!paths.length) return;
  const response = await fetch('/api/sfx/inspect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paths }),
  });
  if (!response.ok) throw new Error('Could not read sound-effect metadata.');
  const body = await response.json();
  const recorded = new Map<string, RecordedClip>();
  for (const clip of body.clips ?? []) {
    recorded.set(clip.path, {
      text: typeof clip.text === 'string' ? clip.text : null,
      loop: typeof clip.loop === 'boolean' ? clip.loop : null,
      duration: typeof clip.duration === 'number' ? clip.duration : null,
      influence: typeof clip.influence === 'number' ? clip.influence : null,
      missingFile: clip.missingFile === true,
    });
  }
  for (const row of rows) {
    const clip = recorded.get(row.audio);
    row.missingFile = !row.audio.trim() || !clip || clip.missingFile;
    row.recorded = Boolean(clip && !clip.missingFile && clip.text != null);
    row.audioText = clip?.text ?? '';
    row.audioLoop = clip?.loop === true;
    row.audioDuration = clip?.duration ?? null;
    row.audioInfluence = clip?.influence ?? null;
  }
};

export const openSoundEffects = async () => {
  overlay().hidden = false;
  statusEl().textContent = 'Loading…';
  try {
    const response = await fetch('/locales/sfx.json', { cache: 'no-store' });
    if (!response.ok) throw new Error(String(response.status));
    const file = await response.json();
    rows = (Array.isArray(file.effects) ? file.effects : []).map(asEffect).filter((row: SoundEffect) => row.id);
  } catch {
    rows = [];
    statusEl().textContent = 'Could not load locales/sfx.json.';
    fillFields();
    paintList();
    return;
  }
  if (!rows.some((row) => row.id === selected)) selected = rows[0]?.id ?? '';
  fillFields();
  paintList();
  statusEl().textContent = 'Reading clip metadata…';
  try {
    await readClipMeta();
  } catch (error) {
    fillFields();
    paintList();
    statusEl().textContent = error instanceof Error
      ? error.message
      : 'Could not read clip metadata. Restart npm run dev if Generate is new.';
    return;
  }
  fillFields();
  paintList();
  const row = rows.find((entry) => entry.id === selected);
  statusEl().textContent = row ? describe(row) : '';
};

const playPreview = () => {
  readFields();
  const path = ($('sfxAudio') as HTMLInputElement).value.trim();
  if (!path) {
    statusEl().textContent = 'This effect has no audio file.';
    syncPreviewButton();
    return;
  }
  if (preview && previewUrl.startsWith(path) && !preview.paused) {
    stopPreview();
    return;
  }
  stopPreview();
  const row = rows.find((entry) => entry.id === selected);
  const audio = new Audio(`${path}?v=${Date.now()}`);
  audio.loop = row?.loop === true;
  audio.volume = row?.volume ?? 1;
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

const closeSoundEffects = () => {
  editing = '';
  stopPreview();
  overlay().hidden = true;
};

const saveSoundEffects = async () => {
  if (busy) return;
  statusEl().textContent = 'Saving…';
  const ok = await persist();
  statusEl().textContent = ok
    ? 'Saved locales/sfx.json.'
    : 'Save failed. Sound effects save while npm run dev is running.';
  paintList();
};

export const bindSoundEffects = () => {
  fillSelects();
  bindFields();
  $('soundEffectsBtn').addEventListener('click', () => {
    void openSoundEffects();
  });
  $('sfxCloseBtn').addEventListener('click', closeSoundEffects);
  $('sfxSaveBtn').addEventListener('click', () => {
    void saveSoundEffects();
  });
  $('sfxGenerateBtn').addEventListener('click', () => {
    readFields();
    const queue = rows.filter((row) => needsTake(row) && row.text.trim());
    void generateQueue(queue, 'Generate');
  });
  $('sfxRegenerateBtn').addEventListener('click', () => {
    readFields();
    const queue = rows.filter((row) => row.text.trim());
    void generateQueue(queue, 'Regenerate all');
  });
  $('sfxGenerateOneBtn').addEventListener('click', () => {
    if (selected) void generateOne(selected);
  });
  $('sfxPreviewBtn').addEventListener('click', () => playPreview());
  overlay().querySelector('.story-modal')?.addEventListener('click', (event) => event.stopPropagation());
  overlay().addEventListener('click', (event) => {
    if (event.target === overlay()) closeSoundEffects();
  });
  ($('sfxSearch') as HTMLInputElement).addEventListener('input', (event) => {
    query = (event.target as HTMLInputElement).value;
    paintList();
  });
  ($('sfxFilter') as HTMLSelectElement).addEventListener('change', (event) => {
    filter = (event.target as HTMLSelectElement).value;
    paintList();
  });
};
