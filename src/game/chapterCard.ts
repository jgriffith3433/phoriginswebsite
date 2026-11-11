/** Chapter title card: opens each level over the black veil with "Chapter N", the level name and one story line. */
import { lineText } from './locale';

export type ChapterView = { open: boolean; kicker: string; title: string; line: string; closing: boolean };

const WORDS = ['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
const HOLD_MS = 4600;
/** A press right after the card appears is the Start tap itself, so it does not count. */
const ARM_MS = 350;

export const chapterCopy = (n: number, fallbackName: string) => ({
  kicker: `Chapter ${WORDS[n - 1] ?? n}`,
  title: lineText(`chapter.${n}.title`, fallbackName),
  line: lineText(`chapter.${n}.line`, ''),
});

export const createChapterCard = (root: HTMLElement) => {
  const kickerEl = root.querySelector('.chapter-kicker') as HTMLElement;
  const titleEl = root.querySelector('.chapter-title') as HTMLElement;
  const lineEl = root.querySelector('.chapter-line') as HTMLElement;
  const skipEl = root.querySelector('.chapter-skip') as HTMLElement | null;
  let active: Promise<void> | null = null;
  let closing = false;
  let releasing = false;
  let finish: (() => void) | null = null;

  const show = (n: number, fallbackName: string): Promise<void> => {
    if (active) return releasing ? Promise.resolve() : active;
    const copy = chapterCopy(n, fallbackName);
    kickerEl.textContent = copy.kicker;
    titleEl.textContent = copy.title;
    lineEl.textContent = copy.line;
    lineEl.hidden = !copy.line;
    // Touch players have no key to press.
    if (skipEl) skipEl.textContent = document.body.dataset.device === 'desktop' ? 'Press any key to continue' : 'Tap to continue';
    root.hidden = false;
    closing = false;
    void root.offsetWidth;
    root.classList.add('on');
    active = new Promise<void>((resolve) => {
      let armed = false;
      let timer = 0;
      const close = () => {
        if (closing) return;
        closing = true;
        window.clearTimeout(timer);
        window.removeEventListener('keydown', onKey, true);
        root.removeEventListener('pointerdown', onPress, true);
        finish = null;
        // The card stays up (with its shimmer) until `release`: the level is not on screen yet.
        resolve();
      };
      const onKey = (event: KeyboardEvent) => {
        if (event.repeat || ['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) return;
        if (!armed) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        close();
      };
      const onPress = (event: Event) => {
        if (!armed) return;
        event.preventDefault();
        event.stopPropagation();
        close();
      };
      finish = close;
      window.addEventListener('keydown', onKey, true);
      root.addEventListener('pointerdown', onPress, true);
      window.setTimeout(() => { armed = true; }, ARM_MS);
      timer = window.setTimeout(close, HOLD_MS);
    });
    return active;
  };

  /** Crossfade the held card to the world, then drop it. */
  const release = (ms = 600) => {
    if (!active || releasing) return;
    releasing = true;
    root.style.transitionDuration = `${ms}ms`;
    root.classList.remove('on');
    window.setTimeout(() => {
      root.hidden = true;
      root.style.transitionDuration = '';
      releasing = false;
      closing = false;
      active = null;
    }, ms);
  };

  return {
    release,
    show,
    showing: () => active !== null,
    view: (): ChapterView => ({
      open: !root.hidden,
      kicker: kickerEl.textContent ?? '',
      title: titleEl.textContent ?? '',
      line: lineEl.hidden ? '' : lineEl.textContent ?? '',
      closing,
    }),
    skip: () => finish?.(),
  };
};
