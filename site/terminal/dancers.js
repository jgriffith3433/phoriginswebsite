// The two dancers of the /build show, hand drawn in ASCII. Pure data: no DOM, no timers. Every frame is FRAME_H rows
// (the feet stand on the last row) of FRAME_W columns, centred on column CENTER. Rows are written after a `|` marker so
// the leading spaces survive, on this ruler (the centre is column 8; the frame adds a margin each side for sparkles):
//
//      |01234567890123456
//
// A frame is a head (HEAD_ROWS rows) plus a body (BODY_ROWS rows). Frames face right; flip() mirrors one to face left.
// ASCII only, so every cell is exactly one monospace glyph wide.
// Names stay as in the existing show: Jackson (the fedora and the sequined glove) and Jordan (the jersey and the ball).

export const FRAME_W = 23;
export const FRAME_H = 16;
export const CENTER = 11;
const MARGIN = 3;
const HEAD_ROWS = 5;
const BODY_ROWS = FRAME_H - HEAD_ROWS;

const rows = (list) => list.map((r) => {
  if (r[0] !== '|') throw new Error(`row without a marker: ${r}`);
  const body = ' '.repeat(MARGIN) + r.slice(1);
  if (body.length > FRAME_W) throw new Error(`row wider than ${FRAME_W} (${body.length}): ${r}`);
  return body.padEnd(FRAME_W, ' ');
});

/**
 * A frame: a head and a body, each a list of `|` rows. Trailing empty rows are dropped and the figure is bottom-aligned
 * (the feet stand on the last row), so a short frame is simply a short figure; the scene lifts it when it should be in the air.
 */
const F = (head, body) => {
  if (head.length !== HEAD_ROWS) throw new Error(`head has ${head.length} rows`);
  const all = [...head, ...body];
  while (all.length && all[all.length - 1].trim() === '|') all.pop();
  if (all.length > FRAME_H) throw new Error(`frame has ${all.length} rows: ${all[0]}`);
  const blank = '|';
  return rows([...Array(FRAME_H - all.length).fill(blank), ...all]);
};

const MIRROR = { '/': '\\', '\\': '/', '(': ')', ')': '(', '<': '>', '>': '<', '[': ']', ']': '[', '{': '}', '}': '{', '`': '\'', '\'': '`' };

/** The same frame facing the other way. Runs of digits and capitals (a jersey number) keep their reading order. */
export function flip(frame) {
  return frame.map((r) => {
    const s = [...r].reverse().map((c) => MIRROR[c] ?? c).join('');
    return s.replace(/[0-9A-Z]{2,}/g, (m) => [...m].reverse().join(''));
  });
}

// =====================================================================================================================
// Jackson. The fedora, the jacket, one sequined glove ([*]), white socks, black loafers.
// =====================================================================================================================
const HAT = ['|       ___', '|     _/___\\_', '|  .-\'-------\'-.', '|      ( . )', '|       `-\''];
const HAT_BACK = ['|       ___', '|     _/___\\_', '|  .-\'-------\'-.', '|      (   )', '|       `-\''];
const LEGS = ['|       | |', '|       | |', '|       | |', '|       | |', '|      _| |_', '|    (__) (__)'];

export const JACKSON = {
  // easy standing, the glove at his side
  stand: F(HAT, [
    '|      _/|\\_', '|     / /|\\ \\', '|    / / | \\ \\', '|   [*]  |   o', '|       |_|', ...LEGS,
  ]),
  // the glove up, pointing at the lights
  point: F(['|       ___      *', '|     _/___\\_  * |', '|  .-\'-------\'-.\\|/', '|      ( . )  [*]', '|       `-\'  /'], [
    '|      _/|\\_/', '|     / /|\\ /', '|    / / | \\', '|   o    |', '|       |_|', ...LEGS,
  ]),
  // two fingers to the brim, the other hand out
  hatTip: F(['|       ___', '|     _/___\\_', '|  .-\'-------\'-.', '|      ( . )  /', '|       `-\'  /'], [
    '|      _/|\\_/', '|     / /|\\ |', '|    / / | \\|', '|   o    |', '|       |_|', ...LEGS,
  ]),
  // the moonwalk: the front foot slides back flat while the other rises onto its toe. Four frames.
  mw1: F(HAT, [
    '|      _/|\\_', '|     / /|\\ \\', '|    / / | \\ \\', '|   [*]  |   o', '|       |_|',
    '|       | |', '|       | |', '|       | |', '|       / |', '|      /  |_', '|    _/  (__)',
  ]),
  mw2: F(HAT, [
    '|      _/|\\_', '|     / /|\\ \\', '|    / / | \\ \\', '|   o    |   [*]', '|       |_|',
    '|       | |', '|       | |', '|       | |', '|       | |', '|       | |', '|     __| |__',
  ]),
  mw3: F(HAT, [
    '|      _/|\\_', '|     / /|\\ \\', '|    / / | \\ \\', '|   [*]  |   o', '|       |_|',
    '|       | |', '|       | |', '|       | |', '|       | \\', '|      _|  \\_', '|    (__)  (__)',
  ]),
  mw4: F(HAT, [
    '|      _/|\\_', '|     / /|\\ \\', '|    / / | \\ \\', '|   o    |   [*]', '|       |_|',
    '|       | |', '|       | |', '|       | |', '|       | |', '|       / |', '|      (_ _)',
  ]),
  // the spin, four frames: broad, edge on, from behind, edge on
  spinA: F(HAT, [
    '|      _/|\\_', '|   [*]/|\\ \\', '|      /|\\|  o', '|       |_|', '|       | |',
    '|       | |', '|       | |', '|       | |', '|       | |', '|      _| |_', '|    (__) (__)',
  ]),
  spinB: F(['|        _', '|      _/_\\_', '|    .-\'---\'-.', '|       (.)', '|        `'], [
    '|        |', '|       /|\\', '|       |||', '|       |||', '|       |||',
    '|       |||', '|       |||', '|       |||', '|       |||', '|      _|_|_', '|     (_) (_)',
  ]),
  spinC: F(HAT_BACK, [
    '|      _/|\\_', '|     / /|\\ \\', '|  o  \\/ | \\/ [*]', '|      \\|_|/', '|       | |',
    '|       | |', '|       | |', '|       | |', '|       | |', '|      _| |_', '|    (__) (__)',
  ]),
  spinD: F(['|        _', '|      _/_\\_', '|    .-\'---\'-.', '|       (.)', '|        `'], [
    '|        |', '|      [*]|\\', '|       |||', '|       |||', '|       |||',
    '|       |||', '|       |||', '|       |||', '|       |||', '|      _|_|_', '|     (_) (_)',
  ]),
  // up on the toes, long and tall, both arms thrown up: the toe stand. The heels are off the floor (shoes are `^`).
  toe: F(['|   \\   ___   /', '|    \\_/___\\_/', '|  .-\'-------\'-.', '|      ( . )', '|       `-\''], [
    '|      _/|\\_', '|     / /|\\ \\', '|    [*] | o', '|       |_|', '|       | |',
    '|       | |', '|       | |', '|       | |', '|       | |', '|      ^| |^', '|',
  ]),
  // the lean: forward at forty-five degrees, hat low, arms swung back, feet planted
  lean: F(['|         ___', '|       _/___\\_', '|    .-\'-------\'-.', '|        ( . )', '|         `-\''], [
    '|      .-"|\\_', '|     /  /|\\ \\', '|  [*]  / | \\ \\', '|      /  |   o', '|     /  /|',
    '|    /  / |', '|       | |', '|       | |', '|       | |', '|      _| |_', '|    (__) (__)',
  ]),
  leanB: F(['|          ___', '|        _/___\\_', '|     .-\'-------\'-.', '|         ( . )', '|          `-\''], [
    '|      .-"|\\_', '|     /  /|\\ \\', '|  o   / | \\ \\', '|      /  |  [*]', '|     /  /|',
    '|    /  / |', '|       | |', '|       | |', '|       | |', '|      _| |_', '|    (__) (__)',
  ]),
  // the sparkle glove: raised and shown to the crowd, two frames of waving; the stars are the shine
  gloveA: F(['|       ___   * .', '|     _/___\\_ .  *', '|  .-\'-------\'-.  *', '|      ( . )  {*}', '|       `-\'  /'], [
    '|      _/|\\_/', '|     / /|\\ /', '|    / / | \\', '|   o    |', '|       |_|', ...LEGS,
  ]),
  gloveB: F(['|       ___ *    .', '|     _/___\\_  *', '|  .-\'-------\'-. .  *', '|      ( . ) \\ | /', '|       `-\'   [*]'], [
    '|      _/|\\_ /', '|     / /|\\ /', '|    / / | \\', '|   o    |', '|       |_|', ...LEGS,
  ]),
  // the freeze: one knee up, hat low, the glove thrown out, the other hand on the hip
  freeze: F(HAT, [
    '|    ,-_/|\\_', '|   /  / /|\\ \\--[*]', '|  |   \\/ | |', '|   \\   /|_|', '|    `-\' | |',
    '|       | |', '|       | /', '|       |/', '|      _|  ', '|    (__)', '|',
  ]),
  // a hand on the hip, hat tilted back, the cool-down pose
  hip: F(HAT, [
    '|      _/|\\_', '|    ,/ /|\\ \\,', '|   ( / / | \\ )', '|    \\/   |  \\/', '|       |_|', ...LEGS,
  ]),
};

// =====================================================================================================================
// Jordan. Bald head, the red jersey with the 23, black shorts, high-tops, and the ball. In the ball frames the ball is
// part of the art ((@)); in the dribble frames the ball is drawn on its own, so it can bounce.
// =====================================================================================================================
const HEAD = ['|      .---.', '|     /     \\', '|    |  . .  |', '|     \\  -  /', "|      '---'"];
const HEAD_TONGUE = ['|      .---.', '|     /     \\', '|    |  o o  |', '|     \\ =P= /', "|      '---'"];
const HEAD_UP = ['|      .---.', "|     /  ' \\", '|    |  ^ ^  |', '|     \\  -  /', "|      '---'"];
const J0 = '|     _/---\\_';
const J1 = '|    / /|23|\\ \\';
const J2 = '|   / / |  | \\ \\';
const J3 = '|   o   |__|   o';
const JERSEY = [J0, J1, J2, J3];
// shorts and legs, standing: the waist, the shorts, three shins, the ankles, the shoes
const STAND_LEGS = ['|      |===|', '|      |/ \\|', '|       | |', '|       | |', '|       | |', '|      _| |_', '|     (=) (=)'];
// bent knees: lower and wider, so the figure is shorter
const CROUCH_LEGS = ['|      |===|', '|     /|   |\\', '|    / |   | \\', '|   (=)     (=)'];
const STRIDE_LEGS = ['|      |===|', '|      |/ \\\\_', '|      / |   \\_', '|     /  |     \\', '|    (=)  |    (=)'];
const SPLIT_LEGS = ['|      |===|', '|     _/   \\_', '|   _/       \\_', '|  /           \\', '| (=)         (=)'];
const TUCK_LEGS = ['|      |===|', '|      |/ \\|', '|       / |', '|      /  |', '|     (=) (=)'];

export const JORDAN = {
  // the ready stance for the dribble: knees bent, low and wide, a hand out for the ball
  ready: F(HEAD, [J0, J1, '|   /  /|  |\\  \\', '|  o  / |__| \\  o', ...CROUCH_LEGS]),
  // the dribble: the ball hand low on one side (the ball itself is drawn by the scene); dribL is its mirror
  dribR: F(HEAD, [J0, J1, '|   / / |  |  \\ \\', '|   o   |__|    \\', '|      |===|', '|     /|   |\\', '|    / |   | \\', '|   (=)     (=)'].map((r, i) => (i === 3 ? '|   o   |__|    \\o' : r))),
  // the crossover: low hips, the shoulder dropped, the ball hand across the body
  cross: F(['|       .---.', '|      /     \\', '|     |  . .  |', '|      \\  -  /', "|       '---'"], ['|     _/---\\_', '|    / /|23|\\ \\', '|   o \\ \\|  |/ /', '|      \\_|__|_/  o', ...CROUCH_LEGS]),
  // the drive: one long stride, the ball low in front, the other arm back
  drive: F(HEAD, [J0, J1, '|   / / |  |  \\ \\', '|   o   |__|    o', ...STRIDE_LEGS]),
  // gather: down into the jump, the ball pulled in to the chest
  gather: F(HEAD, [J0, J1, '|   /  /(@)\\  \\', '|   \\_/ |__| \\_/', ...CROUCH_LEGS]),
  // the jump shot: off the floor, one arm straight up with the ball, the knees tucked
  jump: F(['|      .---.   (@)', "|     /  ' \\   |", '|    |  ^ ^  |  /', '|     \\  -  / /', "|      '---'/"], ['|     _/---\\/', '|    / /|23|\\|', '|   / / |  |', '|   o   |__|', ...TUCK_LEGS]),
  // the release: the follow-through, the wrist flopped over, the ball already gone
  release: F(HEAD_UP, ['|     _/---\\_  *', '|    / /|23|\\ \\/', '|   / / |  |  /', '|   o   |__|  \'', ...STAND_LEGS]),
  // the dunk leap: stretched, the ball held in one hand high above the head, the legs trailing
  leap: F(['|      .---.   (@)', "|     /  ' \\  /", '|    |  ^ ^  |/', '|     \\  -  /', "|      '---'"], ['|     _/---\\/', '|    / /|23|\\|', '|   / / |  |', '|   o   |__|', ...SPLIT_LEGS]),
  // the slam: the arm all the way up, the ball going through the rim
  dunk: F(['|      .---.   \\@/', "|     /  ' \\   |", '|    |  ^ ^  | /', '|     \\  -  / /', "|      '---'/"], ['|     _/---\\/', '|    / /|23|\\|', '|   / / |  |', '|   o   |__|', ...TUCK_LEGS]),
  // hang time: the legs scissored, the tongue out, the ball up in one hand
  hang: F(['|      .---.   (@)', '|     /     \\ /', '|    |  o o  |/', '|     \\ =P= /', "|      '---'"], ['|     _/---\\/', '|    / /|23|\\|', '|   / / |  |', '|  o    |__|', ...SPLIT_LEGS]),
  // the landing: down on both feet, knees soft, the ball tucked
  land: F(HEAD, [J0, J1, '|   / / |  |  \\ \\', '|   o   |__|   (@)', ...CROUCH_LEGS]),
  // the shrug: the shoulders up, both palms open, the tongue out
  shrug: F(HEAD_TONGUE, ['|    _/-----\\_', '|   /  |23|  \\', '|  o_\\  |  |  /_o', '|     \\_|__|_/', ...STAND_LEGS]),
  // the Jumpman: one arm up with the ball, the legs split in the air
  jumpman: F(['|      .---.   (@)', '|     /     \\  /', '|    |  . .  |/', '|     \\  -  /', "|      '---'"], ['|    _/---\\/', '|   / /|23|\\|', '|  /  / |  |', '| o   |__|', ...SPLIT_LEGS]),
  // the pivot: weight on the back foot, the ball held out wide
  pivot: F(HEAD, [J0, J1, '|   / / |  | \\(@)', '|   o   |__|', ...STRIDE_LEGS]),
};

// ---------------------------------------------------------------------------------------------------------------------
// The hoop (front view, 13 wide): the board, the rim, the net, in three wobble frames; and the ball.
// ---------------------------------------------------------------------------------------------------------------------
export const HOOP_W = 13;
export const HOOP_FRAMES = [
  ['+-----------+', '|  +-----+  |', '|  |     |  |', '+--+-----+--+', '   (=====)   ', '    \\|||||/   ', '     \\|||/    ', '      \\_/     '],
  ['+-----------+', '|  +-----+  |', '|  |     |  |', '+--+-----+--+', '    (=====)  ', '     \\|||||/  ', '      \\|||/   ', '       \\_/    '],
  ['+-----------+', '|  +-----+  |', '|  |     |  |', '+--+-----+--+', '  (=====)    ', '   \\|||||/    ', '    \\|||/     ', '     \\_/      '],
];
export const HOOP_H = HOOP_FRAMES[0].length;
