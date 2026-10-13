/**
 * Rotating minimap. Camera forward is up. A level hands it a draw callback for
 * the map itself (world coordinates under the transform), plus points of interest.
 * The objective marker sits on the map, or clamps to the rim with an arrow.
 */

export type MapBlip = { x: number; z: number; kind: 'police' | 'hostile' | 'linked' | 'shop' | 'person' };

export type MapSource = {
  draw: (ctx: CanvasRenderingContext2D, cx: number, cz: number, radius: number) => void;
  stores: { x: number; z: number; name: string }[];
  station: { x: number; z: number } | null;
  blips: MapBlip[];
};

export type MinimapFrame = {
  x: number;
  z: number;
  /** Character facing, radians, forward = (sin, cos). */
  yaw: number;
  /** Camera forward on the ground. */
  fx: number;
  fz: number;
  target: { x: number; z: number } | null;
  source: MapSource;
};

const BLIP_COLOR: Record<MapBlip['kind'], string> = {
  police: '#4f8dff',
  hostile: '#ff5a4a',
  linked: '#b07bff',
  shop: '#ffd27a',
  person: 'rgba(220,230,240,0.55)',
};

export const createMinimap = (host: HTMLElement) => {
  const wrap = document.createElement('div');
  wrap.className = 'minimap';
  wrap.hidden = true;
  wrap.setAttribute('aria-hidden', 'true');
  const canvas = document.createElement('canvas');
  wrap.appendChild(canvas);
  host.appendChild(wrap);
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  let wait = 0;
  let clock = 0;
  let shown = false;

  const fit = () => {
    const size = wrap.clientWidth || 168;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const px = Math.round(size * dpr);
    if (canvas.width !== px) {
      canvas.width = px;
      canvas.height = px;
    }
    return { size: px, dpr };
  };

  const draw = (frame: MinimapFrame) => {
    const { size, dpr } = fit();
    const W = size;
    const half = W / 2;
    const radius = 120;
    const k = (half - 2 * dpr) / radius;
    const a = Math.atan2(frame.fx, frame.fz);
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    const toScreen = (wx: number, wz: number) => {
      const dx = wx - frame.x;
      const dz = wz - frame.z;
      return { x: half + k * (dx * cos - dz * sin), y: half - k * (dx * sin + dz * cos) };
    };
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, W);
    ctx.save();
    ctx.beginPath();
    ctx.arc(half, half, half - 1, 0, Math.PI * 2);
    ctx.clip();
    ctx.setTransform(
      k * cos, -k * sin,
      -k * sin, -k * cos,
      half - k * (frame.x * cos - frame.z * sin),
      half + k * (frame.x * sin + frame.z * cos),
    );
    frame.source.draw(ctx, frame.x, frame.z, radius * 1.45);
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    // Points of interest.
    const dot = (p: { x: number; y: number }, r: number, fill: string, stroke = 'rgba(0,0,0,0.6)') => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.lineWidth = dpr;
      ctx.strokeStyle = stroke;
      ctx.stroke();
    };
    for (const store of frame.source.stores) {
      const p = toScreen(store.x, store.z);
      if (Math.hypot(p.x - half, p.y - half) > half - 6 * dpr) continue;
      ctx.fillStyle = '#ffd27a';
      ctx.font = `700 ${8 * dpr}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      dot(p, 4.2 * dpr, '#2a2112', '#ffd27a');
      ctx.fillStyle = '#ffd27a';
      ctx.fillText('$', p.x, p.y + 0.3 * dpr);
    }
    if (frame.source.station) {
      const p = toScreen(frame.source.station.x, frame.source.station.z);
      if (Math.hypot(p.x - half, p.y - half) < half - 6 * dpr) {
        dot(p, 5.5 * dpr, '#1f7a3a', '#bfffcf');
        ctx.fillStyle = '#eaffef';
        ctx.font = `800 ${8 * dpr}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('M', p.x, p.y + 0.4 * dpr);
      }
    }
    for (const blip of frame.source.blips) {
      const p = toScreen(blip.x, blip.z);
      if (Math.hypot(p.x - half, p.y - half) > half - 3 * dpr) continue;
      const r = blip.kind === 'person' ? 1.6 * dpr : 3 * dpr;
      if (blip.kind === 'police') {
        const flash = Math.sin(clock * 10) > 0;
        dot(p, r, flash ? '#4f8dff' : '#ff4a4a');
      } else dot(p, r, BLIP_COLOR[blip.kind], blip.kind === 'person' ? 'transparent' : 'rgba(0,0,0,0.6)');
    }

    // Objective.
    if (frame.target) {
      const p = toScreen(frame.target.x, frame.target.z);
      const dx = p.x - half;
      const dy = p.y - half;
      const d = Math.hypot(dx, dy);
      const rim = half - 9 * dpr;
      const pulse = 1 + Math.sin(clock * 4) * 0.12;
      ctx.fillStyle = '#ffcc4d';
      ctx.strokeStyle = 'rgba(40,24,0,0.85)';
      ctx.lineWidth = 1.4 * dpr;
      if (d <= rim) {
        const s = 6 * dpr * pulse;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y - s);
        ctx.lineTo(p.x + s, p.y);
        ctx.lineTo(p.x, p.y + s);
        ctx.lineTo(p.x - s, p.y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else {
        const ux = dx / d;
        const uy = dy / d;
        const ex = half + ux * rim;
        const ey = half + uy * rim;
        const s = 7 * dpr * pulse;
        ctx.beginPath();
        ctx.moveTo(ex + ux * s, ey + uy * s);
        ctx.lineTo(ex - uy * s * 0.7 - ux * s * 0.4, ey + ux * s * 0.7 - uy * s * 0.4);
        ctx.lineTo(ex + uy * s * 0.7 - ux * s * 0.4, ey - ux * s * 0.7 - uy * s * 0.4);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
    }

    // Player arrow: facing relative to the camera.
    const rel = frame.yaw - a;
    const fx = Math.sin(rel);
    const fy = -Math.cos(rel);
    const s = 7 * dpr;
    ctx.beginPath();
    ctx.moveTo(half + fx * s, half + fy * s);
    ctx.lineTo(half - fx * s * 0.6 - fy * s * 0.62, half - fy * s * 0.6 + fx * s * 0.62);
    ctx.lineTo(half - fx * s * 0.25, half - fy * s * 0.25);
    ctx.lineTo(half - fx * s * 0.6 + fy * s * 0.62, half - fy * s * 0.6 - fx * s * 0.62);
    ctx.closePath();
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.lineWidth = 1.3 * dpr;
    ctx.strokeStyle = 'rgba(0,0,0,0.75)';
    ctx.stroke();
    ctx.restore();

    // North tick on the rim.
    const nx = half - Math.sin(a) * (half - 8 * dpr);
    const ny = half - Math.cos(a) * (half - 8 * dpr);
    ctx.fillStyle = 'rgba(8,14,20,0.85)';
    ctx.beginPath();
    ctx.arc(nx, ny, 6 * dpr, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#e8eef3';
    ctx.font = `800 ${8 * dpr}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('N', nx, ny + 0.4 * dpr);
  };

  return {
    /** Call every frame. Pass null to hide. */
    update: (delta: number, frame: MinimapFrame | null) => {
      clock += delta;
      if (!frame) {
        if (shown) {
          wrap.hidden = true;
          shown = false;
        }
        return;
      }
      if (!shown) {
        wrap.hidden = false;
        shown = true;
        wait = 0;
      }
      wait -= delta;
      if (wait > 0) return;
      wait = 1 / 20;
      draw(frame);
    },
  };
};
