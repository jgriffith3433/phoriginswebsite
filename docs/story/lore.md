# Lore entries

One entry per chapter, on the site and in the game. Finishing a level (End Level pressed, Level Complete card) unlocks
that chapter's entry: the card shows `Lore unlocked · n/8`, the entry's title and line, and a **Read more** link that
opens `lore/<slug>.html` on the site. Every lore page has a **Play this level** link to `play/game.html?level=N`: the
title card opens on that level and Start enters it (`?level=N` in `main.ts`; ungated, like `?beat=`).

- Long text: `site/lore.json`. The lede (also the card line) and title: `locales/en.json` `lore.N.title` / `lore.N.text`.
- Pages: `node tools/buildLore.mjs` writes `lore.html` and `lore/*.html`. Rerun after editing either source.
- Slugs: `src/game/lore.ts` `LORE_SLUGS`. Unlocks are `lore: number[]` on the `ph-origins-save` cookie (Reset clears it).
- Public copy never names the vat or the creature. Playtest: `lore-link`.
