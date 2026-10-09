type HeapMemory = {
  usedJSHeapSize: number;
  jsHeapSizeLimit: number;
};

const readHeap = () => (performance as Performance & { memory?: HeapMemory }).memory;

const asMb = (bytes: number) => `${Math.round(bytes / (1024 * 1024))} MB`;

export const createPerfMonitor = (fpsEl: HTMLElement, memEl: HTMLElement) => {
  let wait = 0;
  let fpsText = '';
  let memText = '';

  return {
    update: (delta: number, fps: number) => {
      wait -= delta;
      if (wait > 0) return;
      wait = 0.25;
      const rounded = Math.max(0, Math.round(fps));
      const nextFps = String(rounded);
      if (nextFps !== fpsText) {
        fpsText = nextFps;
        fpsEl.textContent = nextFps;
        fpsEl.dataset.band = rounded >= 50 ? 'high' : rounded >= 30 ? 'mid' : 'low';
      }
      const heap = readHeap();
      const nextMem = heap ? asMb(heap.usedJSHeapSize) : 'n/a';
      if (nextMem !== memText) {
        memText = nextMem;
        memEl.textContent = nextMem;
      }
    },
  };
};
