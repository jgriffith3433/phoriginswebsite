/**
 * Chapter title over the in-engine opening (`chapterOpening.ts`): "Chapter N", the level name and one story line,
 * typeset over the live world (no black card). The text fades in slowly once the shot is moving and out before the
 * camera glides into the player's. One press, tap or key skips the shot (`onSkip`); a 44 px Skip button is always there.
 */
import { lineText } from './locale';

export type ChapterView = { open: boolean; kicker: string; title: string; line: string; closing: boolean };

const WORDS = ['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
/** A press right after the card appears is the Start tap itself, so it does not count. */
const ARM_MS = 250;

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
  const textEl = root.querySelector('.chapter-inner') as HTMLElement;
  let active = false;
  let closing = false;
  let releasing = false;
  let skipHandler: (() => void) | null = null;
  let detach: (() => void) | null = null;

  const show = (n: number, fallbackName: string, onSkip: () => void) => {
    if (active) return;
    const copy = chapterCopy(n, fallbackName);
    kickerEl.textContent = copy.kicker;
    titleEl.textContent = copy.title;
    lineEl.textContent = copy.line;
    lineEl.hidden = !copy.line;
    root.hidden = false;
    closing = false;
    releasing = false;
    active = true;
    skipHandler = onSkip;
    root.classList.remove('titled', 'leaving');
    void root.offsetWidth;
    root.classList.add('on');
    let armed = false;
    const fire = () => {
      if (!armed || closing) return;
      closing = true;
      skipHandler?.();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat || ['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) return;
      if (!armed) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      fire();
    };
    const onPress = (event: Event) => {
      if (!armed) return;
      event.preventDefault();
      event.stopPropagation();
      fire();
    };
    window.addEventListener('keydown', onKey, true);
    root.addEventListener('pointerdown', onPress, true);
    const timer = window.setTimeout(() => { armed = true; }, ARM_MS);
    detach = () => {
      window.clearTimeout(timer);
      window.removeEventListener('keydown', onKey, true);
      root.removeEventListener('pointerdown', onPress, true);
      detach = null;
    };
  };

  /** The slow fade-in (CSS transition on `.titled`). */
  const titleIn = () => {
    if (!active) return;
    root.classList.remove('leaving');
    root.classList.add('titled');
  };

  /** Fade the text out, ahead of the camera glide. */
  const titleOut = () => {
    if (!active) return;
    closing = true;
    root.classList.add('leaving');
    root.classList.remove('titled');
  };

  /** Drop the card (the world is already on screen: there is nothing to crossfade). */
  const release = (ms = 300) => {
    if (!active || releasing) return;
    releasing = true;
    detach?.();
    root.style.transitionDuration = `${ms}ms`;
    root.classList.remove('on', 'titled');
    window.setTimeout(() => {
      root.hidden = true;
      root.style.transitionDuration = '';
      root.classList.remove('leaving');
      releasing = false;
      closing = false;
      active = false;
      skipHandler = null;
    }, ms);
  };

  const rect = (el: Element | null) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  };

  return {
    release,
    show,
    titleIn,
    titleOut,
    showing: () => active,
    view: (): ChapterView => ({
      open: !root.hidden,
      kicker: kickerEl.textContent ?? '',
      title: titleEl.textContent ?? '',
      line: lineEl.hidden ? '' : lineEl.textContent ?? '',
      closing,
    }),
    /** Boxes (CSS px) for the phone checks: the typeset text and the Skip button. */
    layout: () => ({
      titled: root.classList.contains('titled'),
      text: rect(textEl),
      skip: rect(skipEl),
      viewport: { w: root.getBoundingClientRect().width, h: root.getBoundingClientRect().height },
      /** Screen px per CSS px (a phone frame on a desktop is scaled down). */
      scale: root.offsetWidth ? root.getBoundingClientRect().width / root.offsetWidth : 1,
    }),
  };
};
