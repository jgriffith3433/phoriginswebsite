# Playable beats

The story moments that used to be watched, and the verb each one is played with. A beat is told through a mechanic
(What Remains of Edith Finch), with no menu or tutorial text: the verb is taught by the world, and the line of text
that remains is one objective line at most. Every beat has a touch version (390x844, the left stick and the existing
buttons, the touch controls stay visible) and a way for a repeat player to skip it (the Skip button: held ~0.85 s on
touch, a click or Enter on desktop; for the vat break it only shows once the player has finished the beat once,
`hawkes.vatSeen` in localStorage).

Status: **the vat break, the Desk's mirror and the desk sweep are built**. The train pursuit is specified here and keeps
its current form until tuned; its row says what the player will do.

## Vat break (B3, level 2) — built

- **Verb:** walk out of the acid. Steering is the only input, and it fights back.
- **How it is taught, wordless:** the shot (about 5 s: the creature lunges at the glass, Pierce backs away, the glass
  goes, the acid hits him) ends with the camera handed back mid-fall. The door he came in by carries the usual objective
  marker; one line, "Get to the door.", is the only text. Everything else is felt: the stick answers late (input lag
  grows from 0.05 s to about 0.4 s), the heading drifts and the fumes pull him back toward the pool, the walk becomes a
  stagger, he falls twice (control is gone for 1.5 s and 2 s), the flashlight stutters from 6 s and is dead by 8.5 s,
  and heartbeat and breath rise and quicken. The second fall is under a 0.12 s blink: the avatar swaps to
  `asset-ch44-hero` there, so there is no pop and no T-pose. After it he crawls at 0.55 of walk speed. "What happened to
  me..." plays over the stagger and the crawl. The beat ends when he reaches the door, at least 21 s in (21-26 s,
  15 s or more of movement input), with no death possible. The door is soft-capped east (`maxX`) so a player cannot
  rush it in five seconds.
- **Touch:** the left stick only. No button is needed (jump is switched off in the acid). Touch controls are not hidden:
  the acid is not a cinematic.
- **Hold-to-skip:** a repeat player (finished the beat before) sees Skip during the acid; holding it jumps to the
  swapped, crawling Pierce at the door and the Level Complete offer.
- Code: `src/story/act1.ts` (`beginAcid`, `stepAcid`, `ImpairState`), `src/main.ts` (`impair`, `lagInput`),
  `cutscenes/b3-vat-break.json` (the 5 s shot). Playtest: `vat-acid`.

## The mirror (The Desk, level 4) — built

- **Verb:** walk up to the glass and move. No prompt. The Return's own mirror (level 3's ending) is unchanged: it is
  still the **Look in mirror** walk-up that ends that level.
- **What happens:** Pierce starts inside the hall bathroom, a few steps from the glass. Walking within ~0.5 m of it
  (x >= 18.15) eases the camera (about 0.7 s) to an over-the-shoulder frame, a little behind and left of him, looking
  at the reflection, and holds it while the player keeps the stick. The reflection is a second `asset-ch44-hero` body
  that exists only in the mirror pass (layer `DOUBLE_LAYER`, `bathroomMirror.setDouble`). It copies his position and
  heading from a pose history, late: the lag grows from 0 to 0.5 s over ~7.5 s. Once the lag is there and he has
  walked 1.6 m (or 18 s have passed) it turns its head once (head and neck about the bone's up axis, 0.45 s out,
  0.9 s hold, 0.5 s back) while he has not. The level bed and his breath drop to silence, then "That's me. I'm not
  seeing things." plays; the lag eases back and the camera is handed back. "Look at this. Nobody is going to accept
  me." and "That is just human nature." follow while he walks to the desk.
- **Touch:** the left stick only; the camera is not touched. **Hold-to-skip:** none needed (not a scene).
- Code: `src/story/theDesk.ts` (`stepMirror`), `src/story/bathroomMirror.ts`. Probe `desk().mirror`
  (`maxLagMs`, `headTurns`, `quiet`, `thatsMe`).

## The desk sweep (The Desk, level 4) — built

- **Verb:** drag. Press and hold, then drag across the desk (mouse, or one finger anywhere on the screen). A hand
  follows the drag on the desk plane and pushes what it touches along the drag direction, at the drag's speed.
- **How it is taught, wordless:** a pale hand floats over the papers and sweeps across them on its own until the first
  push (and again after 5 s idle).
- **Harder sweeps more:** each prop needs a hand speed to move at all: papers 0.45 m/s, the folder 0.8, the glass
  1.6, the terminal 2.7 (m/s, world). Sliding props lose speed to friction and go over the desk edge, fall, and land
  with a sound (paper, impact, crash). All paper-class props on the floor, then "I am not staying here to be stared
  at. I am going home.", then End Level.
- **Hold-to-skip:** the Skip button shoves everything at once.
- Code: `src/story/theDesk.ts`. Probe `desk().desk`. Playtest `desk-beats` (`{"phone":true}` for 390x844 touch).
- Sounds: `sfx.desk.*` in `locales/sfx.json`, stand-ins in `soundFallback.ts` (the breath has none and is silent
  until Gen makes it).

## The train pursuit (The Train, level 7) — built as walking; the chase is to tune

- **Verb:** close the distance, one car at a time. The old body is always one car ahead; the player keeps walking, and
  runs (Shadow run) to shorten the gap, which only makes him walk faster. It never resolves.
- **How it is taught, wordless:** the old body holds the center pole in car 1 and walks through the front door when
  Pierce moves; the objective marker rides the door, and the gap is the only readout. The stop in car 3 is where the
  chase pays off: he gets off, and Pierce is let to reach the open door.
- **Touch:** the left stick walks, **Use** (Next car) at the front door, the existing Shadow run button.
- **Hold-to-skip:** the opening scene (`train-opening`) has Skip; a repeat player may skip a car with Skip held at the
  front door, which jumps to the next car with the old body one car ahead.

## Hunt retry (B3, level 2)

Not a story beat but part of the same promise: a death in the hunt costs under 3 seconds. A 0.6 s red fade, Pierce at
the last checkpoint (one per room entered) with health full and ammo kept, the creature hidden for about 3 s at the
farthest hiding spot, the drone never restarting (no reload, no card). Logged: `huntRetries`, `retrySeconds`.
