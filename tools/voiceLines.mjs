/**
 * Spoken-line takes. ElevenLabs returns pcm, ffmpeg writes an ogg, and a
 * PHMETA comment stores the sentence, voice, and performance. Dev Tools
 * compares that record to the current line. A file with no record is out of date.
 * Older wavs still read their `phln` chunk.
 *
 * ElevenLabs runs through Hawkes Gen (C:\Projects\hawkesgen, its audio.voice
 * tool), which holds the key; start it with hawkesgen\auto-start.bat. Takes use eleven_v4.
 * Default performance sends the line alone. Any other performance prefixes an audio tag.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { HawkesGen } from './hawkesgen.mjs';
import os from 'node:os';
import path from 'node:path';

const CHUNK_ID = 'phln';

const gen = new HawkesGen({ project: 'phorigins' });

const parseMeta = (raw) => {
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed.text === 'string' ? parsed : null;
  } catch {
    return null;
  }
};

const readWavMeta = (wav) => {
  let offset = 12;
  while (offset + 8 <= wav.length) {
    const id = wav.toString('ascii', offset, offset + 4);
    const size = wav.readUInt32LE(offset + 4);
    const end = offset + 8 + size + (size % 2);
    if (size < 0 || end > wav.length) break;
    if (id === CHUNK_ID) return parseMeta(wav.subarray(offset + 8, offset + 8 + size).toString('utf8'));
    offset = end;
  }
  return null;
};

const readOggMeta = (file) => {
  const marker = Buffer.from('PHMETA=');
  const at = file.indexOf(marker);
  if (at < 0) return null;
  let end = at + marker.length;
  while (end < file.length) {
    const c = file[end];
    const ok = (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 43 || c === 47 || c === 61;
    if (!ok) break;
    end += 1;
  }
  return parseMeta(Buffer.from(file.subarray(at + marker.length, end).toString('ascii'), 'base64').toString('utf8'));
};

export const readVoiceMeta = (file) => {
  if (!Buffer.isBuffer(file) || file.length < 12) return null;
  const kind = file.toString('ascii', 0, 4);
  if (kind === 'RIFF') return readWavMeta(file);
  if (kind === 'OggS') return readOggMeta(file);
  return null;
};

const loadVoices = (root) => {
  const file = path.join(root, 'locales', 'voices.json');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
};

export const voiceForSpeaker = (root, speaker) => {
  const cast = loadVoices(root);
  const key = cast.speakers?.[String(speaker ?? '').trim().toLowerCase()];
  const voice = key ? cast.voices?.[key] : null;
  if (!voice?.voiceId) return null;
  return { voiceId: voice.voiceId, name: voice.name || key };
};

const MODEL = 'eleven_v4';
const PCM_FORMAT = 'pcm_22050';
const PCM_RATE = 22050;


/** ElevenLabs pcm_* is raw 16-bit mono. wav_44100 is limited to Pro plans. */
const pcmToWav = (pcm) => {
  const data = pcm.length % 2 === 0 ? pcm : Buffer.concat([pcm, Buffer.from([0])]);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(PCM_RATE, 24);
  header.writeUInt32LE(PCM_RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
};

const performanceTag = (root, id) => {
  const key = String(id || 'default').trim() || 'default';
  if (key === 'default') return '';
  const cast = loadVoices(root);
  const found = (cast.performances ?? []).find((item) => item.id === key);
  const tag = String(found?.tag || '').trim();
  if (!found || !tag || tag === 'default') return '';
  return tag;
};

const safeAssetPath = (root, relativePath) => {
  const cleaned = String(relativePath || '').replace(/\\/g, '/');
  if (!cleaned.startsWith('/assets/') || cleaned.includes('..')) return null;
  const resolved = path.normalize(path.join(root, cleaned.slice(1)));
  const allowed = path.normalize(path.join(root, 'assets'));
  if (!resolved.startsWith(allowed)) return null;
  return resolved;
};

export const inspectVoiceFiles = (root, paths) => {
  const clips = [];
  for (const entry of paths) {
    const rel = String(entry || '');
    const abs = safeAssetPath(root, rel);
    if (!abs || !fs.existsSync(abs)) {
      clips.push({ path: rel, text: null, missingFile: true });
      continue;
    }
    const meta = readVoiceMeta(fs.readFileSync(abs));
    clips.push({
      path: rel,
      text: meta?.text ?? null,
      performance: typeof meta?.performance === 'string' ? meta.performance : null,
      voiceId: typeof meta?.voiceId === 'string' ? meta.voiceId : null,
      missingFile: false,
    });
  }
  return clips;
};

const outputPathFor = (id, audio) => {
  const current = String(audio || '').replace(/\\/g, '/');
  if (current.startsWith('/assets/') && !current.includes('..')) {
    if (current.toLowerCase().endsWith('.ogg')) return current;
    if (current.toLowerCase().endsWith('.wav')) return current.replace(/\.wav$/i, '.ogg');
  }
  const safeId = String(id || '').trim().replace(/[^a-z0-9.-]/gi, '');
  if (!safeId) return null;
  return `/assets/audio/vo/${safeId}.ogg`;
};

const encodeOgg = (wav, dest, meta) => new Promise((resolve, reject) => {
  const payload = Buffer.from(JSON.stringify({
    text: meta.text,
    voiceId: meta.voiceId ?? '',
    performance: meta.performance || 'default',
  }), 'utf8').toString('base64');
  const wavPath = path.join(os.tmpdir(), `phln-${process.pid}-${Date.now()}.wav`);
  fs.writeFileSync(wavPath, wav);
  const proc = spawn('ffmpeg', [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-i', wavPath,
    '-c:a', 'libvorbis',
    '-ar', '22050',
    '-q:a', '3',
    '-metadata', `PHMETA=${payload}`,
    dest,
  ], { windowsHide: true });
  let err = '';
  proc.stderr.on('data', (chunk) => { err += chunk.toString(); });
  const finish = (error) => {
    fs.rmSync(wavPath, { force: true });
    if (error) reject(error);
    else resolve();
  };
  proc.on('error', (error) => {
    finish(error.code === 'ENOENT' ? new Error('ffmpeg is required to save the clip as ogg.') : error);
  });
  proc.on('close', (code) => {
    if (code === 0) finish();
    else finish(new Error((err || `ffmpeg exited ${code}`).trim().slice(-500)));
  });
});

const chosenVoice = (root, speaker, voiceId) => {
  const requested = String(voiceId || '').trim();
  if (/^[A-Za-z0-9]{8,40}$/.test(requested)) return { voiceId: requested, name: '' };
  return voiceForSpeaker(root, speaker);
};

export const listVoices = async (root) => {
  void root;
  const voices = await gen.voices();
  return voices
    .map((voice) => ({ voiceId: String(voice.id || ''), name: String(voice.name || ''), category: String(voice.category || '') }))
    .filter((voice) => voice.voiceId && voice.name)
    .sort((a, b) => a.name.localeCompare(b.name));
};

export const synthesizeLine = async (root, { id, speaker, text, audio, performance, voiceId }) => {
  const line = String(text ?? '').trim();
  if (!line) throw new Error('This line has no sentence to speak.');
  const voice = chosenVoice(root, speaker, voiceId);
  if (!voice) throw new Error(`No ElevenLabs voice for “${speaker || 'unknown'}”. Pick one in Story lines.`);
  const relative = outputPathFor(id, audio);
  const abs = relative ? safeAssetPath(root, relative) : null;
  if (!abs) throw new Error('Could not choose an ogg path for this line.');
  const tag = performanceTag(root, performance);
  const spoken = tag ? `[${tag}] ${line}` : line;
  const recorded = tag ? String(performance).trim() : 'default';

  const job = await gen.run('audio.voice', {
    params: { text: spoken, voice: voice.voiceId, model: MODEL, format: PCM_FORMAT },
    labels: { line: id, speaker },
    timeoutMs: 5 * 60 * 1000,
  });
  const response = { buffer: Buffer.from(await gen.bytes(job.outputs[0].asset)) };
  const pcm = response.buffer;
  if (pcm.length < 2) throw new Error('ElevenLabs returned an empty clip.');
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  await encodeOgg(pcmToWav(pcm), abs, { text: line, voiceId: voice.voiceId, performance: recorded });
  return { audio: relative, audioText: line, audioPerformance: recorded, audioVoice: voice.voiceId };
};
