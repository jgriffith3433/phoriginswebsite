# PH Origins: world bible

Status: the plan every agent builds to. Sources: `AGENTS.md` (levels 1-8 as built), `docs/story/*`, `src/story/credits.ts`
(the "unspoken leftovers" are the best canon for levels 3-7), `locales/en.json`. `Lore.txt` (phoriginsassets) is not in
this checkout; where this bible adds something, it is marked **new** and is a proposal J can overrule. Nothing here
changes game code.

**Tone.** Corporate-gothic body horror told quietly. Cold glass, warm lamps, a man who was the most important person in
a building and is now the thing the building cannot name. Lines are short and plain, never raised. The public never
sees B3, the vat or the creature (no Hawkes signage, news or lore page names them). Nobody ever explains why there are
two Pierces. Public cast is the named board only: **Pierce Hawkes**, **Director Hale** (woman), **Voss** (man), **Lang**
(man). Do not invent first names.

**The ten-second rule.** From any spot a player walks, within about 10 s something to see (a landmark, a mover, a lit
sign), hear (a bed, a one-shot, a voice) or do (an E prompt, a phone, a power, a pickup) must be in reach. "Gap budget"
in each area below says what covers the walk. `check:scene` and the playtest's gap timer are the judges.

**Legend.** *Exists* = built and in AGENTS.md. *Gap* = where it falls short. *New* = this bible's addition (a work item,
not built).

---

## Areas

One world, one night and one morning, nine places in the order Pierce walks them. All are one man's route from the 58th
floor to his own bed.

### 1. The Apex Peak (58th floor, level 1) - `apex-peak.json`
- **Mood:** polished, expensive, late. Walnut and navy, the city glittering 205 m below, every voice lowered.
- **Looks/sounds:** plaster-and-wainscot halls, boardroom with walnut slats and a valuation screen, Pierce's office
  (desk, terminal, sofa, bookshelves, rug), restroom (tile, two stalls, vanity, later the mirror), elevator cab. Bed:
  `room-tone.mp3` 0.14. HVAC hush, sconce hum, distant traffic through glass, phone tones.
- **Size:** about 60 m of hall plus rooms; 15-20 s to cross end to end at 3.05 m/s.
- **In/out:** in by the lobby elevator (late call), out by the cab to B3. Also reused as The Return's office and The Desk.
- *Exists (story through play):* hall 1 has a late associate at a desk, a locked east door marked IN SESSION, and a
  standing Hale silhouette visible through the board doorway that makes Pierce flinch — the board plot without the call
  (`src/story/apexBoardHall.ts`, playtest `living-places`). Hall 2 still has the cleaner.

### 2. B3 (level 2, and level 3's first half) - `b3-basement.json`
- **Mood:** sealed, wet, wrong. A place the player is afraid to light. Near dark; practical lights make small colored
  pools; exponential fog so corridor ends fall to black until the beam cuts them.
- **Looks/sounds:** pipe hall, containment, chem stores, decon, control, transformation wing, utility, the ACID VAT
  room. Riveted steel, stained tile, wet epoxy and diamond plate with puddle decals, hazard-banded doorframes, dripping
  pipes, steam. The phone flashlight (G) is a shadow-casting spot with a visible additive beam cone (scrolling dust
  noise on every tier; volumetric scattering on High). Fluorescent practicals flicker on a script with a buzz on the
  sfx bus. The vat is the hero green light (emissive liquid, projected caustics, rising bubbles). Green EXIT signs and
  red beacons mark the route without raising ambient. Creature gets a cool rim when the beam hits it. Bed
  `b3-drone.ogg` 0.20, drips, hum, fluorescent buzz, creature skitter and breath inside 15 m.
- **Size:** about 45 x 45 m of rooms; roughly 2 minutes to walk once, longer under the hunt.
- **In/out:** in by the cab; out through the vat room (transformation) and again as Ch44 up the cab to Apex. Cold open
  (first visit) boots here in the long hall with the flashlight already on.
- *Exists (horror lighting):* `src/game/b3Horror.ts` on `b3-basement` (skipped fear for The Return's powers look).
  Playtest `b3-horror-light`.
- *Gap:* The Return runs the same rooms bright and empty (creature hidden): the biggest "demo" risk in the game.
  Gen wet-surface albedos land under `assets/textures/b3/` (`wet-concrete`, `rust-grating`, `lab-tile`,
  `algae-wall`, plus `-n`/`-r` maps and `-512` low-tier copies). The interior shader mixes them into EPOXY /
  DIAMOND / LAB_FLOOR / LAB_TILE when each WebP loads (`b3Surf`); procedural stand-ins stay until then.
  Authored `mat-b3-floor` points at the wet-concrete set once Gen imports.

### 3. The Return and The Desk (levels 3-4) - B3 hall, cab, Apex office, restroom mirror
- **Mood:** The Return: clinical over-bright humming fluorescents that blow out highlights, too clean and too empty,
  with one tube that buzzes (`src/game/quietLight.ts`). The Desk: a single desk-lamp key in the dark with long shadows
  across the desk and floor, city glow through the window as rim, MirrorTexture vanity plaque that reads reversed in
  the glass. A man learning his own hands.
- The ride up (`elevator-up`, ~69 s), the mirror (`bathroomMirror.ts`), the desk (papers shoved off). Same room as
  Apex so the player sees what changed, not what is new. Playtest `quiet-light`.

### 4. Hawkes Tower lobby (level 5 opening) - `going-home.json`
- **Mood:** marble night-shift. Receptionist desk beside the east elevator, doors on floor L.
- ~36 s scripted scene, then the doors to the street. 12 m.

### 5. The Street (level 5) - `src/story/city/`
- **Mood:** wet neon downtown at night, a living grid: avenues at z -144, -56, 32, 120, 208, cross streets x -126...294.
  Kabuki-in-the-rain: wet asphalt with a puddle mask, neon and headlights smeared across the street, rain with ground
  splashes, steam from manhole vents, headlight/taillight flares on traffic (`src/story/city/rainNight.ts`).
- **Looks/sounds:** signals, crosswalks, traffic, a plaza with subway globes, Liberty Square fountain, market
  (x 62-72), diner (96-108), news stand (145-156), park and pond NE, 1150 m of suburb edge. Bed `room-tone` 0.12,
  traffic, sirens, bell on shop doors, footsteps, rain hiss.
- **Neon landmarks (8 along Pierce's sidewalk, stand-in emissives until Gen WebPs in `assets/textures/city/neon/`):**
  Hawkes Biomedical billboard, pharmacy cross, noodle bar, pawn shop, Midnight Diner, Voss Capital, Liberty Square,
  hotel VACANCY. Public Hawkes signage never names B3, the vat or the creature.
- **Reflections:** High tier tries SSR; Low/Medium use a shared reflection probe on planar puddle plates (+1.8 cm over
  asphalt). Phone caps rain at ~1/3 and keeps the probe path (≥30 fps at 390x844).
- **Size:** Pierce's route is ~163 m of sidewalk (about 55 s); the whole generated city is ~2.3 km across.
- **In/out:** in from the lobby; out down the stairs at x 163.5 to the station.
- Playtest: `rain-city` (options `phone`).

### 6. The Station (level 6) - `the-station.json`
- **Mood:** sodium platform wash over tiled walls, humming, one tube failing. HAWKES ST. Rain still falls at the open
  stair end (west concourse); the platform itself is covered.
- Concourse, six turnstiles, platform, track trench, two cars, tunnel mouths. Bed 0.10. Departure board counting
  down (emissive amber matrix), tunnel wind, PA (`placeVoices.ts`). Tile / platform-edge / wall surfaces are procedural
  until Gen seamless paints land (`assets/textures/station/`).
- **Size:** ~80 m x 15 m; in by the stairs, out through the open train door.

### 7. The Train (level 7) - `the-train.json`
- **Mood:** the rocking dark between stops, amber lamps. Three cars, one set re-entered, then a stop with no name.
- Car x 0-18, benches, poles, ads, a 6 line map. Bed `train/rumble.ogg` 0.22. Tunnel lamps every 11 m (~0.8 s at
  cruise 14 m/s, always ≤ 3 s while moving); one fluorescent tube flickers; dark windows reflect the car's strip lights
  and seat blue over the tunnel.
- **In/out:** in from the open door; out the north door at the unnamed stop (End Level).

### 8. The Morning (level 8) - `the-morning.json`
- **Mood:** one room after the worst night; grey-gold dawn. Sunlight through venetian blinds as visible shafts in the
  air (VolumetricLightScattering on High, light-shaft meshes on Low), slowly sliding across the room; dust motes in the
  beams; the TV casting flickering blue spill synced to its picture (`src/game/quietLight.ts`). Playtest `quiet-light`.
- Apartment shell + runtime furniture, chair at the window, coat, face-down photo, landline with a red light, bed, TV,
  door. Bed `morning-room.ogg` 0.16.
- **Size:** one room, about 6 x 5 m; the whole level is ~8 minutes of scenes and one short walk.

### 9. The street outside (level 8's last view) and Act II threshold - **New, proposal**
- A bright, ordinary block a street away from the station he got off at. Not built. It is where level 9 starts if J
  takes the story on (Q at the bottom). Nothing in this bible depends on it being built.

**Geography summary:** tower 58 -> B3 -> tower 58 -> lobby L -> street (z 32, west to east) -> station (stairs x 163.5)
-> train (uptown 6) -> unnamed stop (old body gets off) -> Pierce rides on -> his stop -> three blocks -> his room.

---

### The title scene (the menu's own place, not a level)

After the cold open the Hawkes terminal title card sits over the level 1 office at night: Pierce stands at the window with his back to us, rain running down the pane, the generated city glowing 205 m below, his theme playing. About every 20 s lightning shows his reflection in the glass as the Shadow form for 0.3 s (broad, hunched, too tall, two red eyes) with a low sting. It tells the premise before a word is read: the man at the glass is already not alone in it. `src/game/titleScene.ts`.

## Landmarks

One per area, visible from far off. The player steers by it; the objective waypoint backs it up.

| Area | Landmark | How it reads from far off |
|---|---|---|
| Apex Peak | The north window wall (`office-wall-n`), the carpet of lights 205 m below | Every hall ends in lit glass; the Voss alarm light on the terminal |
| B3 | The ACID VAT room: green glow through the glass, `LIVE DRIPS` sign | Green wash on a dark wall from the pipe hall; hum rises toward it |
| The Return | The elevator LED strip (B3, B2, B1, L, 20, 40, 58) | Bright cab doors at the end of an over-bright hall |
| The Desk | The bathroom mirror and Pierce's desk with the shoved papers | The only door with a lit line beneath it; paper drift on the carpet |
| Lobby | The reception desk lamp and the elevator doors | A single warm lamp in cold marble; the doors closing behind |
| Street | Hawkes Tower (212 m, `STYLE.APEX`), behind him the whole walk; ahead the subway globes at the plaza | Tower red aircraft light blinking above every block; the globes pull him east |
| Station | The departure board counting down; the failing tube | A moving digit readout over the platform, a flicker you can hear |
| Train | The 6 line map over the door; the old body at the pole | Pale coat against blue seats at the end of each car |
| Morning | The TV and the window | The only light source that changes |

*Gap (existing):* the lobby has no far landmark outside the lobby itself; the Morning room has none until the TV
switches on. **New:** a brass wall clock in the lobby that stopped at 9:41 (the board time), and the apartment window
shows the tower, far, lit, in the same position as the lobby clock tower, so levels 5 and 8 bookend.

---

## Who lives here

Characters keep their names, voices (Hawkes Gen / ElevenLabs voices in `locales/voices.json`) and rules. Pierce is
Jackson; Hale is Annie; the street shout is Alexandra; Police is Adam; the receptionist is Liz.

### Named cast
- **Pierce Hawkes.** Chairman and founder. Two bodies: the **old body** (`asset-ch33-hero`, the tower's coat) and the
  **new body** (`asset-ch44-hero`, the player). Terse, tired, polite to doormen. Reacts to being seen with flinches and
  refusal; never explains himself. On foot he starts, stops and turns in place with planted feet (clips `StartWalk`,
  `Stop`, `Turn90` mirrored for the other side, `Turn180`, `StairsUp`; stairs down is the walk with foot IK). The same
  IK and speed-matched stride cover the Shadow form on levels 5–7.
- **Director Hale (woman, Annie).** The board's steel. Furious, measured, always on a phone or leaving a room. Her fear is
  a leak to the street. She calls Pierce at three points (levels 3, 6, 7) and each call is at a threshold.
- **Voss (man).** Pierce's friend-on-the-record, the one who calls first and asks questions the others don't. Treats B3
  as a ward ("patients, not prototypes"). Loyal to the charter.
- **Lang (man).** The calendar; wants a date for Zurich. Mentioned, seated at the board, never on the street.
- **The old body.** Holds the pole like he owns the train. Always one car ahead. Gets off at a stop with no name.
  Never explained, never addressed by any third party.
- **The commuter** (`asset-ch28-npc`). The man the old body talks to. Says "Night." Does not look back either.
- **The creature** (`asset-parasite-starkie`). In B3, hunts in bursts, runs to the vat glass. Never seen in public.

### Routines (what each does on their own)
- **Apex board** (Voss, Lang, Hale, the others on seats): after Pierce sits, talk then leave in turn; Hale last. While he
  walks to the seat they murmur (`placeVoices.ts`). *Exists:* a night cleaner (`asset-ch23-npc`, no name, speaker
  "Night shift") with a procedural cart who walks hall 2 once on level 1, says "Evening, Mr. Hawkes", then leaves the
  cart in the hall (`src/story/apexSlice.ts`). *Exists:* a late associate at a hall-1 desk (`bark.apex.desk01`: "They're
  already in. Hale's on her feet.") and a darkened silhouette through the board doorway (procedural, never a second
  Hale mesh next to seated Hale) that Pierce flinches at (`bark.apex.threat01`). Level 4 does not remount the slice or
  the board-hall module, so only the empty floor remains.
- **B3:** the creature loop (wait in decon, chase in bursts, roam 5-15 s, bite 22 at 1.8 m). *Exists:* a dead guard's
  badge on the Hall B drum and a radio that crackles twice when Pierce passes (no voice, just a tone;
  `src/game/b3Horror.ts`).
- **Lobby:** the receptionist (Liz) works late; on seeing Pierce she screams and calls police (scripted).
- **Street:** recycled pool of 16 pedestrians (9 mobile) on sidewalk paths; about one in twenty-five hostile, one in
  five runs; police arrive once, from behind, about 30 s after Voss's text; traffic on a lane graph; shopkeepers in
  the market, diner and news stand; bell on every shop door. **New:** a diner cook shouting an order every ~20 s, a busker
  at the plaza (guitar loop at distance, fades with distance), a news-stand radio playing the same weather, and a
  window cleaner on a gondola at a mid-rise who does not react to Pierce at all.
- **Station:** commuters on the platform; the PA and station voices (`placeVoices.ts`), the departure board. A rat
  crossing the track every few minutes. **New:** a janitor with a rolling bin at the far end who keeps mopping.
- **Train:** two or three riders per car (`asset-ch08/31/23-npc`) who stand by doors; one reads, one sleeps; they look
  at Pierce and then away. The conductor on the PA (placeVoices).
- **Morning:** neighbours through the wall (a kettle, a radio, a vacuum); the TV anchor (neutral broadcast voice, not a
  named character).

### How they react to the player
- **Pierce is the threat.** In Shadow mode he walks through people, who lose him and wander off; unshadowed he is stared
  at, shrunk from, screamed at.
- **Hostile/police:** punch on contact, run at Pierce, blocked by cars, lose him in Shadow mode.
- **Pedestrians:** turn when he bumps them, one in five screams or runs if he is right on them.
- **Riders:** keep their eyes off him; a possessed rider walks inside the car only.
- **The old body and the commuter are never targets and never turn around.**
- **Voss** is the only person who sounds as if he suspects: "You don't sound like yourself." "Whose voice is that?"

---

## What happens

Per area: **interactions** (several kinds), **events on their own**, **ambient sound**, **what changes over time**.
*Exists / Gap / New* as above.

### Apex Peak
- **Interactions:** answer the phone (F), Join meeting (seat), Look outside (window), Examine monitor (terminal), Ride
  Elevator, open the phone screen (messages, contacts, recents), flashlight (G), sidearm (Q), pick up the ammo box (E,
  after Hale's scene), sit on the sofa (*Exists*, E: a 4 s sit with the cushion creak and the skyline sound), read the
  papers on the desk (*Exists*, E: "Still warm. They left them open."), tap the valuation screen (*Exists*: the number
  ticks down with a soft beep), try the locked hall door (*Exists*, E: rattles, IN SESSION plate).
- **Own events:** Voss rings at start (`voss-late`) but is not required; the desk associate looks up; the locked door;
  Hale's standing silhouette through the board doorway flinches Pierce (*Exists*, `apexBoardHall`, beat 35); the alarm
  and red monitor; the board's departure; hall 2 practicals flicker (*Exists*, `apexSlice`); the city 205 m below moves;
  the cleaner walk (*Exists*, beat 29).
- **Sound:** room-tone 0.14; HVAC; phone tones; alarm loop 0.46; cab hum 0.5; chimes; cart wheels, sofa creak, skyline,
  screen tap, troffer flicker, door-locked (`locales/sfx.json` apex group).
- **Changes:** the valuation screen's number ticks down on each tap; the monitor goes dark; by level 4 the papers are
  on the floor and the room is bright.
- **Gap budget:** hall 1: desk person + locked door + board murmur + sconces; hall 2: cleaner and cart + art + flicker +
  threat silhouette; office: window + terminal + sofa/papers. Never more than ~8 s of nothing. Playtests `apex-slice`
  and `living-places` report `quality.maxQuietSeconds`.

### B3 (level 2)
- **Interactions:** E on ammo/medkit stacks, R reload, H medkit, Q sidearm, G flashlight, open the lab door, F phone,
  shoot, Look at CCTV in control (**new**, E: shows three feeds, one with the creature on a 2 s delay), pull a lab
  drawer for a keycard (**new**).
- **Own events:** the creature hunts and rests; pipes knock; steam bursts at the drops; light dips on a rush; red edge
  flash; a gurney wheel squeals when he passes (**new**); one halogen fails every ~40 s.
- **Sound:** `b3-drone`, drips, skitter, breath, hiss, heartbeat when near, chitter.
- **Changes:** pools dim as the creature approaches; after the vat break the hall lights come up (Return).
- **Gap budget:** every room has a practical, a drip and a pipe sound within 5 m.

### The Return and The Desk
- **Interactions:** Ride Elevator, answer Hale (F), Look in mirror (E), open a stall door (**new**, E: a creak and a
  line), flush the sink (**new**, E: running water over the reflection), shove papers (scripted), read a paper (**new**).
- **Own events:** the cab sways; floor LEDs cycle; Hale rings at x 44, z 30; phone buzzes; one clinical tube buzzes and
  stutters in the Return halls; The Desk's lamp is the only warm pool (city rim on the glass).
- **Sound:** cab hum, chimes, door slide, water, mirror breathing, fluorescent buzz (`sfx.b3.fluorescent-buzz`).
- **Changes:** Pierce's reflection shows the new body; Return stays over-bright; The Desk goes dark but for the lamp;
  the desk becomes a mess.
- **The Desk, played (built):** walking up to the glass (no prompt) eases the camera over his shoulder; the reflection
  lags him up to 0.5 s and turns its head once before he does, the bed and his breath go silent, "That's me." plays.
  At the desk a held drag (mouse or one finger) sweeps papers, folder, glass and terminal off with paper and impact
  sounds; a harder drag moves more (the terminal wants a hard one). Canon: the reflection is a second body of the new
  face; it never speaks and is never explained.
- *Gap:* the Return basement run is the longest empty stretch. **New:** along the pipe hall at x 44 a row of dead
  practicals that come on one by one as he passes, on a chime, and a ghost of the creature's skitter on the left wall.

### Lobby
- **Interactions:** E on the elevator, E on the reception phone (**new**: the line is dead), walk the revolving door.
- **Own events:** Liz screams, calls police; a security monitor flickers (**new**); automatic doors open and close on
  their own; marble floor shows Pierce's reflection.
- **Sound:** elevator chime, scream, dial tones, hush.
- **Changes:** the tower's lights drop floor by floor behind him as he exits (**new**).

### Street
- **Interactions:** C Shadow mode, Tab switch, click Shock/Possess (a second click kills), Consume, Shift run/fly,
  punch/kick when unshadowed, E at stores (**new**: buy nothing, but the shopkeeper's bell and a line), pick up the
  medkit/ammo box, phone, flashlight, minimap.
- **Own events:** signals cycle 30 s; traffic and police; peds scream; lights bloom; a car hits and knocks back;
  shopkeepers call; sirens (**new**, a siren Doppler every ~45 s); the diner cook shouts (**new**).
- **Sound:** traffic bed, footsteps, Shadow Shock, scream, siren, bell, busker at distance, wind, rain on awning (**new**).
- **Changes:** Voss's text arrives; police arrive; wet reflections; the plaza globes get closer; a building window row
  goes dark as the streets empty (**new**).
- **Gap budget:** an avenue block is ~50 m = 16 s; there is always a shop sign, a pedestrian, a car or a siren within 10 s.

### Station
- **Interactions:** E on the ticket machine (**new**: it prints a ticket that falls, no line), bench sit (**new**),
  trash bins, newsstand (**new**), turnstile (hop with a E), Shadow powers on commuters.
- **Own events:** the departure board counts down each second; a train passes (wind and light); the tube fails; the PA;
  the scripted shadow-commuter scene; Hale's call after 0.7 s.
- **Sound:** station bed 0.10, tunnel wind, PA, train passing roar, rat squeak.
- **Changes:** commuters thin out; the board's next train changes to "BOARDING".

### Train
- **Interactions:** E Next car at the front door, grab a pole (**new**, E: sways with it), read an ad (**new**, E:
  zooms), answer Hale at the stop, Shadow powers on riders, hold the door (**new**, fails).
- **Own events:** lamps pass; sway; jolt; train brakes into the unnamed stop; the old body walks out; the doors close.
- **Sound:** wheel rumble loop, rail joints, brake squeal, door chime, conductor PA.
- **Changes:** car 1 full, car 2 sparse, car 3 empty but for the two; the stop's tile glows green.

### The Morning
- **Interactions:** E at the door, Sleep, Watch, Leave, answer the landline (F), open the fridge (**new**, E: a jar,
  a cold light, one line), turn the radio on (**new**, E: static to the same news), touch the photo (**new**, E: stays
  face down).
- **Own events:** kettle through the wall, building elevator, a neighbour's door, the TV timer; dawn shafts slide east
  across the floor after Sleep; dust catches the beams; TV blue flicker on the sofa wall while Watch plays; the red
  light blinks.
- **Sound:** `morning-room.ogg` 0.16, traffic, kettle, TV audio.
- **Changes:** light moves across the room during the sleep scene; the TV picks up his name.

---

## Story beats

Each is an event the player lives: gameplay, an in-game cutscene with real events, sound, voice. On-screen text is a
last resort (one line at most). "Where/when" is the place and the trigger.

| # | Beat | Where / when | How it plays out (events) | Voice / sound |
|---|---|---|---|---|
| 1 | **Late.** Pierce is late to the board. | Apex hall, level start | Voss rings (`voss-late`); Pierce answers on the walk, then the board seats; walls and doors continue behind him | Voss, Pierce (Jackson); phone tones |
| 2 | **Room for Grace.** | Boardroom, after Join | `room-for-grace` cutscene: board talks, Hale furious, camera moves, then NPCs depart in order | Hale (Annie) at 1.0, room-tone ducked |
| 3 | **Look outside.** | Office window | Fade to black, up on the skyline; monologue; feed mounts after; Voss rings | Pierce VO, alarm |
| 4 | **The terminal.** | Office desk | Alarm loops, monitor red, screen powers down | Alarm 0.46, Pierce |
| 5 | **Down.** | Elevator | `elevator-b3`: cab hum, chimes, floors pass, sway | hum 0.5, descent rumble 0.38, 6 lines |
| 6 | **Door reveal.** | B3 lab door | Door slides, creature (Idle, Attack, shriek), flees through the south door | "Oh my god! What is that thing?!", shriek 0.78 |
| 7 | **The hunt.** | B3 decon onward | Creature chases in bursts; downed by 4 torso hits; runs to the glass | skitter, breath, heartbeat |
| 8 | **Vat break.** | ACID VAT | A 5 s shot: Attack on glass, crack, Pierce backs off, glass goes at 4.2 s, acid. Then played: 21-26 s of input in the acid (lag to ~0.4 s, drift, stagger, two falls, flashlight dies, heartbeat and breath rise), Ch44 swap hidden in the second fall, a crawl to the lab door. A death in the hunt before it is a 0.6 s red fade and a checkpoint, not a Defeat card. See `docs/story/playable-beats.md` | Scream 1.0, glass 0.86, splash 0.78, heartbeat, breath, "What happened to me..." |
| 9 | **Brightness.** | Pipe hall x 44 | He talks to himself, the lamps too bright, Hale rings | Pierce x4, Hale x3 (Annie) |
| 10 | **Up.** | Cab | `elevator-up` ~69 s; he reconstructs the vat, notices hands, decides on a mirror | rebornidle, chime |
| 11 | **That's me.** | Restroom mirror | Look in mirror; reflection; "That's me. I'm not seeing things." | Jackson 0.92 |
| 12 | **The desk.** | Office | Shoves papers, "I'm going home" | going-home/04-06 |
| 13 | **Nobody home.** | Lobby | Liz screams, calls police, "I'm not going back up" | Liz, Pierce |
| 14 | **The street.** | Sidewalk | Shadow-mode tutorial, Voss's text, police behind | Alexandra shout, Adam |
| 15 | **Is that me?** | Station platform | Scripted: the old body talks to the commuter, shadow duplicate yells then melee-360 and smoke | "Wait. Is that me?" x2 |
| 16 | **Hale at the stairs.** | Station | Hale: the board went well. "Alright." | Hale, Pierce |
| 17 | **One car ahead.** | Train car 1 | Fade up, the old body at the pole, two walk out, "Turn around." | cutscene 01-04 |
| 18 | **Always one car ahead.** | Car 2 | He spawns walking to the front door, goes through | bark 05 |
| 19 | **A stop with no name.** | Car 3 | Brakes, white tile, door opens, "This is me." "Night." | 06-10 |
| 20 | **Contained.** | Unnamed stop | Hale calls; "Nothing from B3 reached the street." | Hale (Annie) |
| 21 | **He gets the street.** | Door at x 11.2 | Doors close, train pulls out | train sfx, bark 11 |
| 22 | **Mine.** | S0 `ride` | Black, rumble, brakes, doors, "Mine." | train sfx |
| 23 | **Three blocks.** | S1 walk | Dark street slate (few lit windows) | bark |
| 24 | **It knows my hand.** | Apartment door | Lock reads the print; he enters | Pierce |
| 25 | **I slept.** | Bed | Black; he lies flat; light comes up | rumble to morning bed |
| 26 | **Watch.** | TV | Programme with his name; "They did it without me in the room." | anchor VO |
| 27 | **Voss.** | Landline | One-way call, seven lines | Voss phone voice |
| 28 | **Leave.** | Door | "Somebody is going to have to tell them which one of us walks in." End Level | line, ending-6, credits |

### Built this pass
- **36. The street teaches one power at a time.** *Exists* (`src/story/streetTutorial.ts`, `goingHome.ts`, playtest
  `street-powers`): Going Home, level 5 — each power in four steps (safe use, harder use, a twist, a payoff), never two
  at once and never closer than 30 s. Shadow in the crowd (people lose him; one startled walker runs and loses him);
  Shock on a police pair (the second officer charges, blind to the dark for a few seconds); Possess on a taped-off
  sidewalk (the guard walks to the tape and lifts it); Consume on the station guard who holds the stairs; Punch and
  Kick only after he drops Shadow and a man shoves him. A context prompt (icon, key, at most four words) hangs on the
  target or on the matching touch button while the power can be used; the button pulses once when its power unlocks.
  Told by play, not text: objective lines are eight words or fewer.
- **35. Board through the hall.** *Exists* (`src/story/apexBoardHall.ts`, playtest `living-places`): Apex hall 1–2,
  level 1 — a late associate at a desk says Hale is already standing; a side door marked IN SESSION rattles locked when
  Pierce tries it; through the board doorway a standing silhouette of Hale makes him flinch and say "She's standing."
  None of it needs the Voss call. The call still rings as parallel pressure.
- **29. The Cleaner.** *Exists* (`src/story/apexSlice.ts`, playtest `apex-slice`): Apex hall, level 1 — a night cleaner
  and her cart pass; "Evening, Mr. Hawkes." Cart left in the hall after she exits. Voice/SFX catalog entries ship; Gen
  takes may still be placeholders until Hawkes Gen is reachable.

- **0. The Cold Open.** *Exists* (`src/story/act1.ts` `beginColdOpen`, playtest `first-five`): a first visit only (no save).
  Tap to play drops the player into the B3 long hall as the old Pierce (`asset-ch33-hero`), flashlight on, the lab door
  open and lit green by the vat 26 m ahead. No text, no objective. A skitter crosses the wall, the hall light at x 26 fails,
  the creature's silhouette crosses the lit doorway, then it rushes him; the scream and a cut to black. One line,
  "Six hours earlier.", then the title terminal over the live 58th floor (quiet at first: wordmark and Start; the rest
  of the letterhead comes up after 30 s). Canon: B3 is the end of the night, so the cold open is a flash-forward of the
  hall he walks into in level 2; "six hours earlier" is the board night the title opens on. The creature's code is the
  hunt's own (clips, sounds); the cold-open rush is scripted and always ends in the scream.

### New beats (proposals, each an event; J to approve before build)
- **30. The Radio.** B3 pipe hall: a dead guard's radio crackles twice as Pierce passes; on the third pass in the Return
  it plays four seconds of the Hale/Voss call from level 1, then dies. *Pure sound, no text.*
- **31. Tower Clock.** Lobby: a stopped wall clock at 9:41; the apartment window later shows the tower at the same
  angle. *Image echo, no line.*
- **32. Rat on the Rail.** Station: a rat crosses the rails and a train passes seconds later; the rat is gone. *Sound
  and a short visible event.*
- **33. The Photograph.** The Morning: the frame stays face down. If the player presses E on it, Pierce lays his hand
  flat on it and does not lift it. *Gameplay only, no text.*
- **34. Neighbour.** The Morning: a neighbour's door opens and shuts in the hall as he leaves; one keyring jingle, nothing
  more. *Sound only.*

### Existing beats that fall short
- **Between 12 and 13**: the elevator down from 58 to L is a straight cut; **New:** a 20 s ride with the floors passing
  and one stop at 20 where a pair of staff board and step back off, saying nothing (the first time someone sees him).
- **Beat 20/21** relies on a phone call and a door; adding the rat (32) and the platform's wind makes it less static.
- **Beat 28** ends on one line; the chain 29-34 gives the story a quieter shape across the game.

### Credits and what is left
Credits are unspoken leftovers (see `src/story/credits.ts`). Work not covered here is level 9+: the Act I story ends at
The Morning. Whether the world continues is J's call (open question below).

## Known gaps and work items (in priority order)
1. **The Return basement is empty.** Add the dead-practical sequence, the radio and the creature's skitter ghost.
2. **Apex Peak vertical slice (first part done).** Cleaner, cart, sofa sit, papers, valuation tap, hall flicker,
   board-through-hall (desk, locked door, Hale silhouette) and `apex-slice` / `living-places` playtests are in. Still
   open: sconce dip when the elevator moves; Gen voice/SFX takes for the new desk/threat lines and door-locked when Gen
   is up; optional polished cart GLB (priced below / in task summary).
3. **Lobby and elevator to L have no life.** Add the clock, the monitor, the 20-floor stop.
4. **Station and train need a second layer.** Rat, janitor, pole grab, ad zoom.
5. **The Morning is a single room.** Add fridge, radio, photograph, neighbour.
6. **The Morning's walk and finale.** Beat 23 is a slate today. Replace it with a walked dark street: lit windows,
   footsteps, one distant siren, the tower far away. Add the lit tower in the apartment window, and the neighbour's door
   and keys on Leave. The silent placeholder VO needs real Gen takes (cents each).
7. **Playtest ties.** Each work item logs an `action` event. Add a per-area check that no more than 10 s pass without
   an event, interaction or ambient one-shot (the Return basement, Apex halls and lobby first). This document changes no
   code, so no scenario is added yet.

Fun-reviewer verdict on this bible: *thin* as a plan. The beats are voiced or acted and the tone is strong, but the Return
basement, Apex halls, lobby, the lift to L and the Morning are empty until items 1-6 are built. They are the first build
tasks.

## Open questions for J
- Is Act II (after The Morning) wanted, and does Pierce meet Voss on the street, or does the old body come back?
- May the cleaner speak one line (voice cents, no GPU)?
- Is the lobby clock's 9:41 acceptable as the board time?
- Do we keep "which of you" (Voss, Morning call) or cut to preserve "nobody names it"? (Q6 in the level-8 beat sheet.)


## Living places (58th floor, station, train)

- **Areas:** Apex Peak halls and office, The Station platform and concourse, The Train car.
- **Landmarks:** the hall cooler and light switch, the boardroom coffee machine and the desk phone (Apex); the IN SESSION
  door plate and the lit desk lamp in hall 1; the ticket machine, turnstiles, newsstand bell (Station); the center pole,
  the strap, the stop button (Train).
- **Who lives here:** a night guard (rounds in hall 1, tries each east door), a late associate at a desk and readers on
  the waiting chairs / phone / cooler (all "Night shift" voice, no first names); a standing Hale silhouette through the
  board doorway (story beat, not a routine); the station's platform walkers; the train's riders (one reads, one sleeps,
  one sways). They look up when Pierce passes. Nobody mentions B3.
- **What happens:** footsteps on every plant by floor; every touchable answers with a motion and a sound; the guard
  rattles a handle; Pierce can try the locked door; a rider stirs; barks never repeat within five minutes.
- **Story beats:** **35. Board through the hall** (desk, locked door, visible threat) — told as events, not a phone call.

## What Pierce says on the phone (reply moments)

Every scripted Voss and Hale call (`voss-late`, `voss-meeting`, `hale-walkout`, `hale-board`, Hale at the train stop `hale-train`) opens one reply moment while the caller is still talking: two or three short replies (4-7 words) and silence, for 5 s, chosen with 1/2/3 or a tap. Choosing early cuts the caller off; waiting plays the silence answer. Each reply is a spoken Pierce line and an answer from the caller.

- **vossTrust** (-2..+2, on the `ph-origins-save` cookie): up when Pierce gives Voss something (an answer, the tape kept safe), down when he brushes him off. **haleTemper** (-2..+2): how hot Hale runs; up when he is curt or stonewalls, down when he placates her.
- **The Morning**: Voss's last call is two-way. Its first and last line have three variants on vossTrust (<= -1 cold, 0 neutral, >= 1 warm), and two moments (the vote; the tape) let Pierce answer.
- Voice stays terse. Replies never name B3 in public, and nobody explains the two Pierces: Pierce asks "Who else knows about last night?", never "why are there two of me".
- Voices are the existing cast (Voss Adam-line voice, Pierce Jackson, Hale Annie), `assets/audio/phone/*-r1a|b|c(-ans|s-ans).mp3`, ids `phone.<call>.r1a`, `.r1a.ans`, `.r1s.ans`.


## Level 8 ending and the Act II hook (new canon, 2026-11)

- **The mirror by the door:** the hall mirror shows Pierce as the Shadow form. Nobody comments on it.
- **The coat** hangs by the door; he takes it and says the closing line: "Somebody is going to have to tell them which one of us walks in." (from the level 8 beat sheet).
- **Dawn:** the door opens onto white, then black, then the title PH ORIGINS and the end-suite cue.
- **Credits:** names only, over eight empty places: the apartment, the boardroom, the office window, B3's long hall, the vat room, the lobby, the station platform, the train car.
- **NEW CANON, the Act II call:** after the credits a phone buzzes. An unknown woman (voice: Alexandra) says: "Pierce. The one who got off the train is looking for you. Find me first." She knows about the other body; who she is is Act II's question.

## The ledger (added with the street ledger task)

- **Landmarks**: The City Ledger newspaper on Pierce's coffee table in The Morning; the police car on the Going Home avenue; three wanted posters and an officer at the Station gate (kills 2 or more).
- **Who lives here**: the Morning News anchor (calm, practised, public-safe), the gate officer (Police voice, tired and careful).
- **What happens**: two bystander deaths bring the siren and a car within 20 s; the morning after, the TV, the paper and Voss all say what the night cost. Bands and lines: `docs/story/ledger.md`.
