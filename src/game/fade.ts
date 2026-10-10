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

  const update = (delta: number) => {
    if (rate <= 0 || opacity === target) return;
    const step = rate * Math.min(0.1, Math.max(0, delta));
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
