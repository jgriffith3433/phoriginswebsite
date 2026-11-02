# Level 8 — beat sheet (proposal for J, content only)

Status: **proposal, not canon.** Nothing here is wired into the game, `locales/en.json` or `AGENTS.md`. Part 1 is the
beat sheet; Part 2 is the open canon questions, kept apart on purpose. Where the lore is silent, the sheet takes a
**default** (marked *default*) so the level can be read end to end, and the question list says what J would be
overruling.

Sources read: `AGENTS.md` (levels 1–7), `levels/level-library.json`, `src/story/credits.ts` (the "unspoken
leftovers" are the best record of canon for levels 3–7), `src/story/phone.json` and `locales/en.json` (Voss, Hale
and Pierce lines), `characters.html`, `about.html`, `videos/terminal/story.md`. **`Lore.txt`
(`C:\Projects\phoriginsassets`) is not in this checkout and could not be read.** Its content is therefore listed as a
question (Q1), not assumed.

Working title: **Level 8 — The Morning** (`the-morning`, theme: home interior, apartment; reward: "The news").
Combat off. Pierce is `asset-ch44-hero`. Shadow mode exists but has nothing to hit (see S2).

## What the canon already fixes

- Hale is furious Pierce walked out and "will speak with the other investors" (L3, L4 credits).
- Hale's last word (L7): "Nothing from B3 reached the street… We're contained." Pierce: "Keep it that way." Her fear was
  a leak to the street; "the leak preferred a man" (L7 credits).
- Voss is the one who treats B3 as a ward: "Ethics and the charter say we seal it. Those are patients down there,
  Pierce. Not prototypes." He "called Pierce first, then sent one message" (L1 credits). He asks questions the others
  don't ("You don't sound like yourself." "What happened down there?" "Whose voice is that?").
- Lang is the calendar and Zurich; he wants a date.
- The charter "asked for a seal and an end to B3". "The Tape would keep the record of what happened that night."
  The company "could seal the doors and hide the records."
- Pierce's old body got off at an unnamed stop and took the street; "the tower still expected to see the coat". Pierce
  stayed on the train. Never explained: nobody names it.
- "Home was a word he still used for a place that had not seen him." (L4 credits.) Hale told him "Go home" and he said
  "I'm on my way."
- The public never sees B3, the vat or the creature (signage rule; the news copy below keeps to it).

## Part 1 — The beats

### S0 — Where The Train ends (about 60 s, scripted, Skip works)
The uptown 6 keeps going after the doors closed on the unnamed stop. Pierce rides alone in the car with two or three
riders who keep their eyes off him. The windows run to the tunnel lamps (reuse the Train set). The dashboard map over
the door finally names a stop: *his* stop, the one nearest his home (name: Q2). The train brakes, the doors open on a
plain platform with no splat-cavern: a real, small, ordinary station. Nobody is on the platform. The commuters stay
in the car.
- Bark (Pierce): "Mine." (the first time on this train a stop is his.)
- **Default:** he gets off and climbs the stairs; the train goes on without him, a mirror of L7.

### S1 — The walk up (about 90 s, control)
Short dark residential street, wet, quiet, a few lit windows. No pedestrians that matter; two at most, who cross the
street rather than pass him. No police, no cars that hurt him, no tutorial. Objective `objective.morning.home`:
"Home. Three blocks." The tower is visible once, far, lit, at the end of an avenue; he does not stop.
- Bark: "Three blocks. I can walk three blocks."

### S2 — The threshold (about 45 s, control then short scene)
His building has a doorman's desk, empty (night). The street door and then his own door open to his hand: the lock
reads the print without hesitation. **Default:** it opens. (Q3.) The apartment is dark, tidy, lived in: a chair
facing a window, a coat, a cup, a framed photo (face turned down: Q4), a landline with a red light. Nothing in it
reacts to Shadow mode; the powers prompt does not appear on this level.
- Pierce (inner): "It still knows my hand."
- Pierce: "Home." (Said once, as a fact, not a comfort.)
Walk-up: **Sit** (like the board chair) at the chair by the window. The sit is the cutscene that becomes S3.

### S3 — The wake-up (about 40 s, scripted)
Fade to black as he sits. Silence, then a city morning: traffic, a building elevator, a kettle somewhere through a
wall. Grey-gold light comes up on the same room, same chair, same coat. He has slept in it. The first thing in frame
is his hand on the armrest. He opens it, closes it. The red light on the landline is blinking, with the phone in
the other room also vibrating (Voss). The television in the corner switches on by its timer.
- Pierce: "I slept." / "I don't sleep."  (Q5: does the new body sleep? default: yes, once, badly.)
- Control returns in the room. Objective `objective.morning.news`: "The news. The television." The marker is the TV.
Walk-up button: **Watch** (E).

### S4 — The news (about 75 s, scripted, plays over the TV; camera holds on Pierce's face lit by it)
A morning programme. Anchor voice only, plus a still. The still is a **portrait of Pierce Hawkes from the Hawkes
Biomedical annual report**: the old face. Pierce looks at it as at a stranger. (We never see the double.) Full copy
is in "News copy" below. Beats of the report: the company statement, the board's decision, the building. Nothing
about a lab, a basement, a patient, a creature or an incident below ground; the only lie the report tells is a
tidy one.
- Pierce, after: "They did it without me in the room." (Reads as the betrayal he understands.)
- The landline rings, then the phone.

### S5 — Voss calls (about 70 s, scripted phone call, answered at the landline)
Full script below. Voss tells him what the news left out and what he did. Voss "called Pierce first" in L1; here he
calls Pierce first again, before it airs a second time. The call ends with Voss saying where he is and what he will
not do.

### S6 — The exit beat (control, then End Level)
Objective `objective.morning.out`: "Out. The street." The front door is the walk-up (**Leave**). The hall outside
is the same hall; the lock behind him clicks. **Default:** he does not take anything: not the coat on the chair, not
the photo. He leaves wearing the clothes from the tower. He steps out into a bright, ordinary morning, a block
from the station he got off at; the TV through the wall is already saying his name to an empty room.
- Pierce, last line: "He gets the street. I get the train." is L7's last line; the L8 echo is **"Somebody is
  going to have to tell them which one of us walks in."** *(cut if J rejects Q6; alternative: "Alright." as a
  deliberate echo of Hale's "Alright".)*
- **End Level** (`ui.complete.morning`): "Level Complete. The morning kept its story. He kept the door."
- Ending song: reuse `ending-6` unless J wants a new one (cost line at the bottom: none needed).

## Part 1b — News copy (final text, all public-safe)

All of this is spoken by an anchor/voiceover on a morning programme; the lower-third is the second block. No B3,
vat, creature, patient, acid or "incident below ground". The word "contained" appears once, in Hale's mouth, so the
audience hears what she said on the train.

**Anchor (voice-over, first segment — "Hawkes Biomedical"):**
1. "Good morning. Hawkes Biomedical has a new chairman this morning, and its founder is out."
2. "In a statement issued before dawn, the company's board said it had voted overnight to remove Pierce Hawkes as
   chairman, effective immediately, citing a breach of his duties to the board and to the company's investors."
3. "The board said Mr. Hawkes left a scheduled meeting at Hawkes Tower last evening and could not be reached for the
   rest of the night."
4. "Director Hale, who chaired the meeting, has been named interim chairman. In a written statement she said the
   company is, quote, stable, and that the matters before the board are contained."
5. "A second director, identified only as Voss, is reported to have supported the motion. A spokesperson for the
   company declined to say whether the vote was unanimous."
6. "Mr. Hawkes could not be reached for comment. Police said they were called to Hawkes Tower last night after a
   report from building security. They said no one was hurt and no arrests have been made."

**Anchor (second segment — "the markets"):**
7. "Shares in Hawkes Biomedical were indicated sharply lower before the open. Analysts pointed to a, quote, chairman
   who made the company and then left it sitting in the dark."
8. "Investors in Zurich, who had been promised a date for the company's next announcement, have been told to expect
   one from the interim chairman within days."

**Lower-third ticker (rolling, 4 items, 6-8 words each):**
- HAWKES BIOMEDICAL REMOVES FOUNDER AS CHAIRMAN
- DIRECTOR HALE NAMED INTERIM CHAIRMAN
- BOARD: "MATTERS ARE CONTAINED"
- POLICE: NO ONE HURT AT HAWKES TOWER

**Anchor (sign-off over the portrait):**
9. "Pierce Hawkes, founder and, until last night, chairman of Hawkes Biomedical. We'll have more as it comes in."

Voice notes for later (not generated): anchor is a single neutral broadcast voice (`News`, Passerby-class, not a
named character). No lines made without J's OK on the copy; they are voice-only cents each, no GPU.

## Part 1c — Voss's call (full script)

Incoming on the landline (S4→S5), then answerable on the cell. One call, twelve lines, about 70 s at 0.92 volume,
the same register as `phone.voss-*`: short, plain, never raised. Voss calls him **Pierce** and nothing else. Pierce
is Jackson; Voss is his existing phone voice. Proposed ids `phone.voss-morning.01`–`12`, contact `voss`, type
`phone`.

| # | Speaker | Line |
|---|---|---|
| 01 | Voss | Pierce. Before you hear it from anyone else. |
| 02 | Pierce | I saw it. The television is on. |
| 03 | Voss | Then you saw I voted. |
| 04 | Pierce | I saw your name. |
| 05 | Voss | I put it on the record because the charter says patients are not a number. I called you first last night. You were already in the elevator. |
| 06 | Pierce | You called Hale, too. |
| 07 | Voss | I called everyone. She is the only one who answered and she answered with a vote. |
| 08 | Voss | I sealed it, Pierce. The doors, the records. The tape from last night stays with me, not with the company. |
| 09 | Pierce | And me? |
| 10 | Voss | You're not on the tape. The man in the photograph is. (beat) I don't know which of you the board thinks it removed. |
| 11 | Pierce | Neither do I. |
| 12 | Voss | Then stay off the street and come to me. I'll be where I always am. |

(The parenthesis in line 10 is staging, not spoken.) The call
ends on Pierce, not on a hang-up: Voss waits on the line a moment after "Neither do I", then the line clicks. The
unspoken question is Q6: whether Voss knows, and what.

Staging rules from canon: no explanation of the double (Voss says "which of you" — *the closest the game gets to
naming it, and it is flagged as Q6*); the tape is mentioned once; B3 is never named by Voss in this call, he says
"the doors" and "the records".

## Part 1d — Proposed mission / data (not created)

- Main objective keys: `objective.morning.home`, `.news`, `.out`; `ui.complete.morning`; line prefix
  `dialogue.morning.*`, `bark.morning.*`, `news.morning.*`, `phone.voss-morning.*`.
- Side quests: `call-voss` only (the call is incoming; it counts on connect). `call-hale` is available but Hale does
  not answer (S5 note, Q7).
- Continue: none; this is the last playable level until J says otherwise. Card is **Exit only**, like level 7.

## Part 2 — Open canon questions (not invented; please decide)

1. **`Lore.txt` was not available.** Everything above comes from the repo, not the document the skill calls strict
   canon. The whole sheet must be checked against it. *Pick:* send me the file or approve the sheet as a proposal.
2. **Where is "his stop"?** The uptown 6 has only one named stop (HAWKES ST). Where Pierce lives, which neighbourhood
   and which building, is nowhere. *Default:* an unnamed residential stop, unnamed building, no address.
3. **Does home still accept him?** Does the lock, the doorman or the building know his hand and face? *Default:* the
   lock does, the doorman is absent. That is the cheapest version; canon may want it to refuse.
4. **Who lives there?** The photo on the table: Pierce alone, a partner, Grace? "Grace was always an option for
   someone else" (L1 credits) hints Grace is a person or idea, not defined. *Default:* the frame is face down and
   we never show it.
5. **Does the transformed body sleep and keep a routine?** *Default:* once, badly.
6. **The double.** Does the game ever acknowledge two Pierces to a third party? The news treats the old face as
   Pierce; Voss says "which of you". *Default:* Voss's line stays and answers nothing. J may want it cut to
   keep "nobody names it".
7. **The betrayal.** The brief says "the betrayal". Nothing in canon says who betrays whom. *Default (used above):*
   the board removes Pierce overnight; Voss's vote is the one that hurts. Alternatives: (a) Hale leaks the walk-out
   to the investors only (already said, not a betrayal), (b) Voss gives the tape to a regulator, (c) Lang sells
   the date to Zurich. Which is it?
8. **Is removal legal that fast?** Chairman, founder, charter powers, board seats: unknown. The copy says "voted
   overnight, effective immediately" and avoids the mechanism.
9. **What did Hale say about the street?** "Contained" is her L7 word. The news copy keeps it. If the leak is to
   come true, L8 or L9 must say how.
10. **What does Voss actually hold?** The "tape" appears only in credits (L2). *Default:* an internal record of that
    night, not public. Not defined: format, what it shows.
11. **Is Level 8 the end of Act I?** The README calls Act I "Hawkes Tower"; the Train closed with Exit only.
    *Default:* L8 is Exit only too. Anything after is J's.
12. **Public safety of the copy.** The news names Hawkes Tower, the board and the chairman; no B3/vat/creature
    appears. Confirm that is acceptable for a broadcast (the signage rule is for in-world signage, not news).
13. **Ending song and credits.** Reuse `ending-6`/`LEVEL_CREDITS[7]` or write a column for 8 (credits need a
    left/right set; nothing is drafted here).

## Cost

Content only. No GPU. Voice for about 25 lines (9 anchor, 12 call, a few barks) would be cents through Hawkes
Gen / ElevenLabs once approved. A new apartment set (props, sky) is design only here; no estimate run.
