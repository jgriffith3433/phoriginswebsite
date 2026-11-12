# Lore entries

One entry per chapter, on the site and in the game. Finishing a level (End Level pressed, Level Complete card) unlocks
that chapter's entry: the card shows `Lore unlocked · n/8`, the entry's title and line, and a **Read more** link that
opens `lore/<slug>.html` on the site. Every lore page has a **Play this level** link to `play/game.html?level=N`: the
title card opens on that level and Start enters it (`?level=N` in `main.ts`; ungated, like `?beat=`).

- Long text: `site/lore.json`. The lede (also the card line) and title: `locales/en.json` `lore.N.title` / `lore.N.text`.
- Pages: `node tools/buildLore.mjs` writes `lore.html` and `lore/*.html`. Rerun after editing either source.
- Slugs: `src/game/lore.ts` `LORE_SLUGS`. Unlocks are `lore: number[]` on the `ph-origins-save` cookie (Reset clears it).
- Public copy never names the vat or the creature. Playtest: `lore-link`.

## Chapter Select and hidden pages

The title's **Chapter Select** (`#loadModelBtn`, always enabled) lists eight cards built from the save: painted art
(`assets/textures/chapters/NN.webp`, 960x540 capped; a CSS gradient stands in until the file exists), title, best time
(`best` on the save, seconds per library id, written when End Level is pressed), **Lore n of m**, and what the save
recorded there (calls made, Hale and Voss standing, the street ledger). Locked chapters are dimmed. A tap starts the
chapter through `startAtLevel` with the save kept and no chapter card; hover or focus plays two seconds of that
chapter's bed (`playChapterCue`).

Each chapter hides three pages on the floor (`LORE_SPOTS` in `src/game/chapterSelect.ts`, copy `lore.N.found.<id>`):
walk within 1.5 m. They are saved as `found` on the cookie (`Record<chapter, id[]>`); finding all three also unlocks that
chapter's lore entry (`lore`). Not mounted in the cold open or in The Return's office. Probe `chapterSelect()`,
`loreSpots()`; playtest `chapter-select` (option `phone`).
