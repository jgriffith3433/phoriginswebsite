// The /feed camera's sky: where the Sun and the Moon are right now, so the Earth on the feed is lit the way it really is
// from the Moon at this minute (the day side, the night side, the terminator and the phase). Pure functions, no DOM,
// no timers: feed.js draws with them and the tests check them against known dates.
//
// Low-precision formulas from the Astronomical Almanac (Sun about 0.01 degree, Moon about 0.3 degree): plenty for a
// picture where the whole Earth is a few hundred pixels across.

import { lpad } from './util.js';

const RAD = Math.PI / 180;
const sin = (d) => Math.sin(d * RAD);
const cos = (d) => Math.cos(d * RAD);
const norm360 = (d) => ((d % 360) + 360) % 360;
const unit = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

export const EARTH_RADIUS_KM = 6371;
export const LIGHT_KM_S = 299792.458;
export const CAMERA = { id: 'LUNA-1', cam: 'CAM 01', site: 'OCEANUS PROCELLARUM', lens: 'TELE 400MM' };

/** Days since J2000.0 (2000-01-01 12:00 TT, taken as UTC: a minute off is nothing here). */
export const daysJ2000 = (ms) => ms / 86400000 + 2440587.5 - 2451545.0;

/** Greenwich mean sidereal time in degrees. */
export const gmst = (d) => norm360(280.46061837 + 360.98564736629 * d);

const obliquity = (d) => 23.439 - 0.0000004 * d;

/** Ecliptic longitude / latitude (degrees) to an equatorial unit vector. */
function eclToEq(lambda, beta, eps) {
  const x = cos(beta) * cos(lambda);
  const y = cos(eps) * cos(beta) * sin(lambda) - sin(eps) * sin(beta);
  const z = sin(eps) * cos(beta) * sin(lambda) + cos(eps) * sin(beta);
  return [x, y, z];
}

/** Equatorial (inertial) to Earth-fixed: turn by the sidereal time. */
function eqToEcef(v, theta) {
  const c = cos(theta);
  const s = sin(theta);
  return [v[0] * c + v[1] * s, -v[0] * s + v[1] * c, v[2]];
}

export function sunEcliptic(d) {
  const L = norm360(280.46 + 0.9856474 * d);
  const g = norm360(357.528 + 0.9856003 * d);
  return { lambda: norm360(L + 1.915 * sin(g) + 0.02 * sin(2 * g)), beta: 0 };
}

export function moonEcliptic(d) {
  const T = d / 36525;
  const lambda = 218.32 + 481267.881 * T
    + 6.29 * sin(135.0 + 477198.87 * T) - 1.27 * sin(259.3 - 413335.36 * T) + 0.66 * sin(235.7 + 890534.22 * T)
    + 0.21 * sin(269.9 + 954397.74 * T) - 0.19 * sin(357.5 + 35999.05 * T) - 0.11 * sin(186.5 + 966404.03 * T);
  const beta = 5.13 * sin(93.3 + 483202.02 * T) + 0.28 * sin(228.2 + 960400.89 * T)
    - 0.28 * sin(318.3 + 6003.15 * T) - 0.17 * sin(217.6 - 407332.21 * T);
  const parallax = 0.9508 + 0.0518 * cos(135.0 + 477198.87 * T) + 0.0095 * cos(259.3 - 413335.36 * T)
    + 0.0078 * cos(235.7 + 890534.22 * T) + 0.0028 * cos(269.9 + 954397.74 * T);
  return { lambda: norm360(lambda), beta, distanceKm: EARTH_RADIUS_KM / sin(parallax) };
}

const latLon = (v) => ({ lat: Math.asin(Math.max(-1, Math.min(1, v[2]))) / RAD, lon: Math.atan2(v[1], v[0]) / RAD });

/** Earth's phase as seen from the Moon: it is the Moon's phase turned inside out. */
export function phaseName(lit, waxing) {
  if (lit >= 0.97) return 'FULL';
  if (lit <= 0.03) return 'NEW';
  const side = waxing ? 'WAXING' : 'WANING';
  if (Math.abs(lit - 0.5) < 0.06) return waxing ? 'FIRST QUARTER' : 'LAST QUARTER';
  return `${side} ${lit > 0.5 ? 'GIBBOUS' : 'CRESCENT'}`;
}

/**
 * Everything the feed needs for one instant (ms since the epoch, UTC).
 * Vectors are Earth-fixed (x to 0 N 0 E, z to the north pole), unit length.
 *   sun        direction from the Earth to the Sun
 *   moon       direction from the Earth to the Moon (the camera); the sub-camera point is where it pierces the ground
 *   cam        the camera basis in Earth-fixed axes: right, up (north kept up) and back (towards the camera)
 */
export function ephemeris(ms) {
  const d = daysJ2000(ms);
  const eps = obliquity(d);
  const theta = gmst(d);
  const s = sunEcliptic(d);
  const m = moonEcliptic(d);
  const sun = unit(eqToEcef(eclToEq(s.lambda, s.beta, eps), theta));
  const moon = unit(eqToEcef(eclToEq(m.lambda, m.beta, eps), theta));
  const back = moon; // the camera looks from the Moon along -moon
  const north = [0, 0, 1];
  const up = unit([north[0] - dot(north, back) * back[0], north[1] - dot(north, back) * back[1], north[2] - dot(north, back) * back[2]]);
  const right = cross(up, back); // right-handed: right x up = back (towards the viewer)
  const lit = (1 + dot(sun, moon)) / 2;
  const elong = norm360(m.lambda - s.lambda); // the Moon east of the Sun: the Moon waxes, so the Earth (from the Moon) wanes
  const waxing = elong > 180;
  const rangeKm = m.distanceKm;
  return {
    ms, d, gmst: theta, sun, moon, cam: { right, up, back },
    subSun: latLon(sun), subCam: latLon(moon),
    lit, waxing, phase: phaseName(lit, waxing), rangeKm,
    lightSeconds: rangeKm / LIGHT_KM_S,
    // the Sun seen from the camera, in camera axes (x right, y up, z towards the viewer)
    sunCam: [dot(sun, right), dot(sun, up), dot(sun, back)],
  };
}

// ---- the burned-in text of the feed (an OSD on the video, like a broadcast camera's)

const two = (n) => String(n).padStart(2, '0');
export function utcStamp(ms) {
  const t = new Date(ms);
  return `${t.getUTCFullYear()}-${two(t.getUTCMonth() + 1)}-${two(t.getUTCDate())}  ${two(t.getUTCHours())}:${two(t.getUTCMinutes())}:${two(t.getUTCSeconds())}.${Math.floor(t.getUTCMilliseconds() / 100)} UTC`;
}
const fmtLat = (v) => `${Math.abs(v).toFixed(1)}${v >= 0 ? 'N' : 'S'}`;
const fmtLon = (v) => `${Math.abs(v).toFixed(1)}${v >= 0 ? 'E' : 'W'}`;
export const clockOf = (secs) => `${two(Math.floor(secs / 3600))}:${two(Math.floor(secs / 60) % 60)}:${two(Math.floor(secs) % 60)}`;

/**
 * The four corners of the OSD for one frame. `now` is the wall clock; the frame on screen left the Moon one light-time
 * ago, so its stamp is that much earlier. `sig` is the link's signal numbers (feed.js walks them a little).
 */
export function hudText(now, eph, { elapsed = 0, sig = { dbm: -97.4, snr: 18.6, mbps: 2.2 }, narrow = false } = {}) {
  const shot = now - eph.lightSeconds * 1000;
  const tl = narrow
    ? ['HAWKES BIOMEDICAL', `${CAMERA.id} ${CAMERA.cam}  EARTH`]
    : ['HAWKES BIOMEDICAL  //  PH ORIGINS', `${CAMERA.id}  ${CAMERA.cam}  EARTH  ${CAMERA.lens}`];
  const tr = ['LIVE', `REC ${clockOf(elapsed)}`];
  const bl = [utcStamp(shot), `SUB-CAM ${fmtLat(eph.subCam.lat)} ${fmtLon(eph.subCam.lon)}`];
  const br = narrow
    ? [`DLY ${eph.lightSeconds.toFixed(3)} S`, `SNR ${sig.snr.toFixed(1)} DB`]
    : [`RNG ${Math.round(eph.rangeKm).toLocaleString('en-US')} KM  DLY ${eph.lightSeconds.toFixed(3)} S`, `SIG ${sig.dbm.toFixed(1)} DBM  SNR ${sig.snr.toFixed(1)} DB  ${sig.mbps.toFixed(2)} MB/S`];
  const mid = `EARTH ${Math.round(eph.lit * 100)}% LIT  ${eph.phase}`;
  return { tl, tr, bl, br, mid };
}

/** The lines /feed prints before the picture comes up (timed steps, no timers here). */
export function connectScript(ms, { backendHash = null, fresh = false } = {}) {
  const e = ephemeris(ms);
  const rows = [
    [0, `patching into ${CAMERA.id}: the first live camera on the Moon`, 'head'],
    [260, `  backend ......... ${fresh ? 'brought online: 10 services' : '10 services online'}${backendHash ? ` (build ${backendHash})` : ''}`, 'ok'],
    [260, '  relay ........... DSN Canberra 70 m, carrier locked', 'ok'],
    [260, `  range ........... ${lpad(Math.round(e.rangeKm).toLocaleString('en-US'), 7)} km   light time ${e.lightSeconds.toFixed(3)} s`, ''],
    [240, `  site ............ ${CAMERA.site}, ${CAMERA.cam} (${CAMERA.lens})`, ''],
    [240, `  earth ........... ${Math.round(e.lit * 100)}% lit, ${e.phase.toLowerCase()}`, ''],
    [240, '  video ........... 30 fps, monitor 2 (CRT)', ''],
    [320, 'signal acquired. that is home.', 'ok'],
    [120, '(Esc, q or the disconnect button to come back)', 'dim'],
  ];
  let at = 0;
  return rows.map(([wait, text, cls]) => { at += wait; return { at, text, cls }; });
}

/** What the log says when the feed closes. */
export function closingLines({ seconds = 0, mode = 'webgl' } = {}) {
  const deg = (seconds * 360) / 86164; // the Earth turns once a sidereal day
  return [
    { text: `feed closed after ${clockOf(seconds)}. the Earth turned ${deg.toFixed(deg < 1 ? 2 : 1)} degrees while you watched.`, cls: 'ok' },
    ...(mode === '2d' ? [{ text: '(this screen has no WebGL, so you saw the still frame.)', cls: 'dim' }] : []),
  ];
}
