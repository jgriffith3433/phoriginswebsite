/**
 * Sound-effect takes. ElevenLabs sound generation (eleven_text_to_sound_v2)
 * returns an mp3. ffmpeg writes the file the game already plays, at 44.1 kHz.
 * The description, loop, duration, and influence are stored on that file.
 * A wav keeps them in an `sfxm` chunk. An ogg or mp3 keeps them in an SFXMETA comment.
 * Dev Tools compares that record to the catalog. A file with no record is out of date.
 *
 * One description is one sound. Duration is omitted on a one-shot so the model
 * picks the length. Loop and a duration are sent only for a bed the game repeats.
 * The key is ELEVENLABS_API_KEY in .env.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { elevenLabsKey } from './voiceLines.mjs';

const MODEL = 'eleven_text_to_sound_v2';
const MP3_FORMAT = 'mp3_44100_128';
const CHUNK_ID = 'sfxm';

const parseMeta = (raw) => {
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed.text !== 'string') return null;
    return {
      text: parsed.text,
      loop: parsed.loop === true,
      duration: typeof parsed.duration === 'number' ? parsed.duration : null,
      influence: typeof parsed.influence === 'number' ? parsed.influence : null,
    };
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

const readMarker = (file) => {
  const marker = Buffer.from('SFXMETA=');
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

export const readSfxMeta = (file) => {
  if (!Buffer.isBuffer(file) || file.length < 12) return null;
  if (file.toString('ascii', 0, 4) === 'RIFF') {
    const chunk = readWavMeta(file);
    if (chunk) return chunk;
  }
  return readMarker(file);
};

const writeWavMeta = (wav, json) => {
  const payload = Buffer.from(json, 'utf8');
  const pad = payload.length % 2;
  const chunk = Buffer.alloc(8 + payload.length + pad);
  chunk.write(CHUNK_ID, 0);
  chunk.writeUInt32LE(payload.length, 4);
  payload.copy(chunk, 8);
  const out = Buffer.concat([wav, chunk]);
  out.writeUInt32LE(out.length - 8, 4);
  return out;
};

const explainFetch = (error) => {
  const cause = error?.cause;
  const detail = cause ? [cause.code, cause.message].filter(Boolean).join(' ') : '';
  return detail ? `${error.message} (${detail})` : error.message;
};

const elevenRequest = (url, { method, headers, body }) => new Promise((resolve, reject) => {
  const req = https.request(url, { method, headers, family: 4, timeout: 120000 }, (res) => {
    const chunks = [];
    res.on('data', (chunk) => chunks.push(chunk));
    res.on('end', () => resolve({ status: res.statusCode ?? 0, buffer: Buffer.concat(chunks) }));
  });
  req.on('timeout', () => req.destroy(new Error('ElevenLabs timed out')));
  req.on('error', reject);
  if (body) req.write(body);
  req.end();
});

const safeAssetPath = (root, relativePath) => {
  const cleaned = String(relativePath || '').replace(/\\/g, '/');
  if (!cleaned.startsWith('/assets/') || cleaned.includes('..')) return null;
  const resolved = path.normalize(path.join(root, cleaned.slice(1)));
  const allowed = path.normalize(path.join(root, 'assets'));
  if (!resolved.startsWith(allowed)) return null;
  return resolved;
};

export const inspectSoundFiles = (root, paths) => {
  const clips = [];
  for (const entry of paths) {
    const rel = String(entry || '');
    const abs = safeAssetPath(root, rel);
    if (!abs || !fs.existsSync(abs)) {
      clips.push({ path: rel, text: null, missingFile: true });
      continue;
    }
    const meta = readSfxMeta(fs.readFileSync(abs));
    clips.push({
      path: rel,
      text: meta?.text ?? null,
      loop: meta ? meta.loop : null,
      duration: meta ? meta.duration : null,
      influence: meta?.influence ?? null,
      missingFile: false,
    });
  }
  return clips;
};

const outputPathFor = (id, audio) => {
  const current = String(audio || '').replace(/\\/g, '/');
  if (current.startsWith('/assets/') && !current.includes('..')) {
    const ext = path.extname(current).toLowerCase();
    if (ext === '.ogg' || ext === '.wav' || ext === '.mp3') return current;
  }
  const safeId = String(id || '').trim().replace(/[^a-z0-9.-]/gi, '');
  if (!safeId) return null;
  return `/assets/audio/sfx/${safeId}.ogg`;
};

const clampDuration = (value) => {
  // Number(null) is 0, and a blank duration must stay blank so the model picks the length.
  if (value == null || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.round(Math.min(30, Math.max(0.5, number)) * 10) / 10;
};

const clampInfluence = (value) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0.55;
  return Math.round(Math.min(1, Math.max(0, number)) * 100) / 100;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const fileIsOpen = (error) => {
  const code = error?.code;
  return code === 'EBUSY' || code === 'EPERM' || code === 'EACCES' || code === 'UNKNOWN';
};

/** Windows will not replace a wav the game or Preview still has open. */
const replaceFile = async (dest, data) => {
  const temp = `${dest}.${process.pid}.part`;
  const backup = `${dest}.${process.pid}.old`;
  fs.writeFileSync(temp, data);
  let last = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      if (fs.existsSync(dest)) fs.renameSync(dest, backup);
      fs.renameSync(temp, dest);
      fs.rmSync(backup, { force: true });
      return;
    } catch (error) {
      last = error;
      if (fs.existsSync(backup) && !fs.existsSync(dest)) {
        try { fs.renameSync(backup, dest); } catch { /* the next attempt restores it */ }
      }
      if (!fileIsOpen(error) || attempt === 4) break;
      await sleep(200 * (attempt + 1));
    }
  }
  fs.rmSync(temp, { force: true });
  if (fileIsOpen(last)) {
    throw new Error(`${path.basename(dest)} is open in the browser, so it could not be replaced. Close the game tab, or stop Preview, and generate this one again.`);
  }
  throw last;
};

const encodeFile = (mp3, dest, record) => new Promise((resolve, reject) => {
  const ext = path.extname(dest).toLowerCase();
  const json = JSON.stringify(record);
  const payload = Buffer.from(json, 'utf8').toString('base64');
  const stamp = `${process.pid}-${Date.now()}`;
  const tempIn = path.join(os.tmpdir(), `sfx-${stamp}.mp3`);
  const tempOut = path.join(os.tmpdir(), `sfx-${stamp}-out${ext === '.mp3' ? '.mp3' : ext === '.wav' ? '.wav' : '.ogg'}`);
  fs.writeFileSync(tempIn, mp3);
  const args = ['-y', '-hide_banner', '-loglevel', 'error', '-i', tempIn, '-ar', '44100'];
  if (ext === '.wav') args.push('-c:a', 'pcm_s16le', tempOut);
  else if (ext === '.mp3') args.push('-c:a', 'libmp3lame', '-b:a', '128k', '-metadata', `SFXMETA=${payload}`, tempOut);
  else args.push('-c:a', 'libvorbis', '-q:a', '6', '-metadata', `SFXMETA=${payload}`, tempOut);
  const proc = spawn('ffmpeg', args, { windowsHide: true });
  let err = '';
  proc.stderr.on('data', (chunk) => { err += chunk.toString(); });
  const cleanup = () => {
    fs.rmSync(tempIn, { force: true });
    fs.rmSync(tempOut, { force: true });
  };
  const fail = (error) => {
    cleanup();
    reject(error);
  };
  proc.on('error', (error) => {
    fail(error.code === 'ENOENT' ? new Error('ffmpeg is required to save the sound effect.') : error);
  });
  proc.on('close', (code) => {
    if (code !== 0) {
      fail(new Error((err || `ffmpeg exited ${code}`).trim().slice(-500)));
      return;
    }
    fs.readFile(tempOut, (readError, audio) => {
      if (readError) {
        fail(readError);
        return;
      }
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      const bytes = ext === '.wav' ? writeWavMeta(audio, json) : audio;
      replaceFile(dest, bytes)
        .then(() => {
          cleanup();
          resolve();
        })
        .catch((error) => fail(error));
    });
  });
});

export const synthesizeEffect = async (root, { id, text, audio, loop, duration, influence }) => {
  const description = String(text ?? '').trim();
  if (!description) throw new Error('This effect has no description.');
  const key = elevenLabsKey(root);
  if (!key) throw new Error('Set ELEVENLABS_API_KEY in .env, then restart npm run dev.');
  const relative = outputPathFor(id, audio);
  const abs = relative ? safeAssetPath(root, relative) : null;
  if (!abs) throw new Error('Could not choose a path for this sound effect.');
  const seamless = loop === true;
  const seconds = clampDuration(duration);
  const weight = clampInfluence(influence);
  const body = {
    text: description,
    model_id: MODEL,
    prompt_influence: weight,
    loop: seamless,
  };
  if (seconds != null) body.duration_seconds = seconds;

  let response;
  try {
    response = await elevenRequest(
      `https://api.elevenlabs.io/v1/sound-generation?output_format=${MP3_FORMAT}`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': key,
          'Content-Type': 'application/json',
          Accept: 'application/octet-stream',
        },
        body: JSON.stringify(body),
      },
    );
  } catch (error) {
    throw new Error(explainFetch(error));
  }
  if (response.status < 200 || response.status >= 300 || response.buffer[0] === 0x7b) {
    throw new Error(`ElevenLabs ${response.status}: ${response.buffer.toString('utf8').slice(0, 400)}`);
  }
  if (response.buffer.length < 128) throw new Error('ElevenLabs returned an empty sound effect.');
  const record = { text: description, loop: seamless, duration: seconds, influence: weight };
  await encodeFile(response.buffer, abs, record);
  return {
    audio: relative,
    audioText: description,
    audioLoop: seamless,
    audioDuration: seconds,
    audioInfluence: weight,
  };
};
