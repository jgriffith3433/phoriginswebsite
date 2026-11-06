/** Lore entries: finishing a level unlocks the entry for that chapter, and the Level Complete card links to its page on the site. */
import { lineText } from './locale';

/** Page names under `/lore/` on the site. Same order as `site/lore.json`, which builds those pages. */
export const LORE_SLUGS = ['the-apex-peak', 'b3', 'the-return', 'the-desk', 'going-home', 'the-station', 'the-train', 'the-morning'] as const;

export type LoreEntry = { n: number; slug: string; title: string; text: string; url: string };

/** The site sits next to the build: `/play/game.html` reaches `/lore/x.html`, and the dev server's `/game.html` reaches `./lore/x.html`. */
export const loreUrl = (slug: string, base: string = location.href) =>
  new URL(`${new URL(base).pathname.includes('/play/') ? '../' : './'}lore/${slug}.html`, base).href;

export const loreEntry = (n: number): LoreEntry | null => {
  const slug = LORE_SLUGS[n - 1];
  if (!slug) return null;
  return {
    n,
    slug,
    title: lineText(`lore.${n}.title`, ''),
    text: lineText(`lore.${n}.text`, ''),
    url: loreUrl(slug),
  };
};

/** Unlocked entries, kept sorted and without repeats. */
export const withLore = (list: readonly number[] | undefined, n?: number) =>
  [...new Set([...(list ?? []), ...(n ? [n] : [])])].filter((x) => x >= 1 && x <= LORE_SLUGS.length).sort((a, b) => a - b);
