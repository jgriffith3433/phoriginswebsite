/** Full-screen black veil. `to` is 0 (clear) through 1 (black). */

export type ScreenFade = {
  to: (amount: number, seconds?: number) => void;
  update: (delta: number) => void;
};

export const createScreenFade = (veil: HTMLElement): ScreenFade => {
  let opacity = 1;
  let target = 1;
  let rate = 0;

  const paint = () => {
    veil.style.opacity = opacity.toFixed(4);
  };

  const to = (amount: number, seconds = 0) => {
    target = Math.max(0, Math.min(1, amount));
    const duration = Math.max(0, seconds);
    if (duration === 0 || target === opacity) {
      opacity = target;
      rate = 0;
      paint();
      return;
    }
    rate = Math.abs(target - opacity) / duration;
  };

  // The veil runs on the clock, not on frame count: a slow GPU (a frame of 0.3 s or more) must not stretch a 1.5 s
  // fade into many seconds of black. The cap (1 s) keeps a Pause or a hidden tab from skipping the whole fade.
  const update = (delta: number) => {
    if (rate <= 0 || opacity === target) return;
    const step = rate * Math.min(1, Math.max(0, delta));
    if (Math.abs(target - opacity) <= step) {
      opacity = target;
      rate = 0;
    } else {
      opacity += Math.sign(target - opacity) * step;
    }
    paint();
  };

  paint();
  return { to, update };
};
