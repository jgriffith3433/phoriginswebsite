# Playable beats

The story moments that used to be watched, and the verb each one is played with. A beat is told through a mechanic
(What Remains of Edith Finch), with no menu or tutorial text: the verb is taught by the world, and the line of text
that remains is one objective line at most. Every beat has a touch version (390x844, the left stick and the existing
buttons, the touch controls stay visible) and a way for a repeat player to skip it (the Skip button: held ~0.85 s on
touch, a click or Enter on desktop; for the vat break it only shows once the player has finished the beat once,
`hawkes.vatSeen` in localStorage).

Status: **the vat break is built** (this change). The mirror, desk shove and train pursuit are specified here and keep
their current scripted form until each is built; their rows say what the player will do.

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

## The mirror (The Return, level 3; The Desk, level 4) — to build

- **Verb:** wipe the glass and look. Pierce's reflection starts as the old man; the player rubs the condensation off
  (a held E or press-and-drag over the mirror) until the face is clear. The wiped area is where the new face shows.
- **How it is taught, wordless:** the mirror is fogged only where Pierce's breath has been; the first smear is shown
  by his hand coming up when the player first presses near it; the glass answers with a streak of clear and a sound.
- **Touch:** drag one finger across the mirror (the camera is locked to the glass for the beat, the left stick is not
  used); the Look in mirror button stays the entry.
- **Hold-to-skip:** Skip clears the glass at once and plays the line "That's me. I'm not seeing things."

## The desk shove (The Desk, level 4) — to build

- **Verb:** sweep. Hold toward the desk and flick across it to shove the papers off, as hard as the player means it.
  The harder the swipe, the more falls; the line after is the same either way.
- **How it is taught, wordless:** the papers sit square and still; Pierce's hand hovers over them and shakes while the
  player is not pushing, and the first push moves them a little with a rustle.
- **Touch:** the left stick pushed toward the desk and released (a flick), or a swipe across the desk.
- **Hold-to-skip:** Skip shoves them all at once.

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
