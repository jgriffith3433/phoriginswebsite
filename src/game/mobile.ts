export type DeviceProfile = {
  isMobile: boolean;
  isTablet: boolean;
  isSmall: boolean;
  isLandscape: boolean;
  isTouch: boolean;
  safeAreaTop: number;
  safeAreaBottom: number;
};

export const detectDevice = (): DeviceProfile => {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
  const isMobile = isTouch && width < 1200;
  const isTablet = !isMobile && width >= 768 && width < 1200;
  const isSmall = width < 420 || height < 680;
  const isLandscape = width > height;

  return {
    isMobile,
    isTablet,
    isSmall,
    isLandscape,
    isTouch,
    safeAreaTop: Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--safe-area-top') || '0') || 0,
    safeAreaBottom: Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--safe-area-bottom') || '0') || 0,
  };
};

export const configureResponsiveUI = (root: HTMLElement) => {
  const profile = detectDevice();
  const body = document.body;

  body.dataset.device = profile.isMobile ? 'mobile' : profile.isTablet ? 'tablet' : 'desktop';
  body.dataset.orientation = profile.isLandscape ? 'landscape' : 'portrait';
  body.dataset.touch = profile.isTouch ? 'true' : 'false';

  root.classList.toggle('is-mobile', profile.isMobile);
  root.classList.toggle('is-tablet', profile.isTablet);
  root.classList.toggle('is-small', profile.isSmall);
  root.classList.toggle('is-landscape', profile.isLandscape);

  const safeTop = Math.max(0, Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('env(safe-area-inset-top, 0px)')) || 0);
  const safeBottom = Math.max(0, Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('env(safe-area-inset-bottom, 0px)')) || 0);

  document.documentElement.style.setProperty('--safe-area-top', `${safeTop}px`);
  document.documentElement.style.setProperty('--safe-area-bottom', `${safeBottom}px`);

  const mobileScale = profile.isSmall ? 0.9 : profile.isMobile ? 0.96 : 1;
  root.style.setProperty('--ui-scale', mobileScale.toString());
  root.style.setProperty('--hud-padding-top', `${safeTop + (profile.isMobile ? 12 : 16)}px`);
  root.style.setProperty('--hud-padding-bottom', `${safeBottom + (profile.isMobile ? 12 : 20)}px`);
};
