// Tools > Library: every character, prop and Gaussian splat in Hawkes Gen's library (hawkesgen/docs/library.md), shared
// with Studio, the other products' tools and Claude. Each one keeps every version of its model/splat slot (and a prop's
// reference image): use one, discard, give feedback and revise, or make more takes with the recipes in
// hawkesgen/presets/phorigins.json.
//
// assets/models and assets/splats stay what the game loads: Import brings them into the library (hawkes.library.json:
// one GLB or .splat per entity), and a pick is written back to the same file. The components are Hawkes Gen's web
// components (./hawkesgen/, a copy of hawkesgen/clients/js); they call Gen through the dev server (/api/gen,
// tools/genLibrary.mjs), which adds the key.

const $ = (id: string) => document.getElementById(id) as HTMLElement;
const PREF = 'ph-library-writeback';

const overlay = () => $('libraryOverlay');
const statusEl = () => $('libraryStatus');
let kitReady: Promise<void> | null = null;
let lib: HTMLElement | null = null;

const loadKit = () =>
  (kitReady ??= (async () => {
    // A plain path so TypeScript leaves the module alone; Vite serves it as is.
    const kit = '/src/editor/hawkesgen/hawkesgen-ui.mjs';
    const ui = await import(/* @vite-ignore */ kit);
    ui.configure({ url: `${location.origin}/api/gen`, key: '', project: 'phorigins' });
  })());

type Counts = Record<string, number>;

const run = async (what: 'import' | 'export', body: Record<string, unknown>): Promise<Counts | null> => {
  statusEl().textContent = what === 'import' ? 'Importing…' : 'Writing back…';
  try {
    const r = await fetch(`/api/library/${what}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    const counts = j.counts as Counts;
    statusEl().textContent = Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ') || 'nothing to do';
    return counts;
  } catch (e) {
    statusEl().textContent = `Failed: ${(e as Error).message}`;
    return null;
  }
};

const setKind = (kind: string) => {
  if (!lib) return;
  if (kind) lib.setAttribute('kind', kind);
  else lib.removeAttribute('kind');
};

const openLibrary = async () => {
  overlay().hidden = false;
  if (lib) return;
  statusEl().textContent = 'Loading…';
  try {
    await loadKit();
    lib = document.createElement('hg-library');
    lib.setAttribute('project', 'phorigins');
    lib.setAttribute('thumb', 'reference,concept');
    lib.setAttribute('open-inline', '');
    setKind(($('libraryKind') as HTMLSelectElement).value);
    // A pick changes what the game loads: write that entity's GLB or .splat back.
    lib.addEventListener('hg-pick', async (ev: Event) => {
      if (!($('libraryWriteBack') as HTMLInputElement).checked) return;
      const slug = String((ev as CustomEvent).detail.entity).split('/')[1];
      const counts = await run('export', { only: slug });
      if (counts?.written) statusEl().textContent = `Wrote ${counts.written} file${counts.written > 1 ? 's' : ''} into assets/. Reload the level to see it.`;
    });
    $('libraryHost').append(lib);
    statusEl().textContent = '';
  } catch (e) {
    statusEl().textContent = `Couldn't load the library: ${(e as Error).message}`;
  }
};

const closeLibrary = () => {
  overlay().hidden = true;
};

export const bindLibrary = () => {
  const writeBack = $('libraryWriteBack') as HTMLInputElement;
  try {
    writeBack.checked = localStorage.getItem(PREF) !== 'off';
  } catch {
    /* default on */
  }
  writeBack.addEventListener('change', () => {
    try {
      localStorage.setItem(PREF, writeBack.checked ? 'on' : 'off');
    } catch {
      /* fine */
    }
  });
  $('libraryBtn').addEventListener('click', () => void openLibrary());
  $('libraryCloseBtn').addEventListener('click', closeLibrary);
  overlay().querySelector('.story-modal')?.addEventListener('click', (event) => event.stopPropagation());
  overlay().addEventListener('click', (event) => {
    if (event.target === overlay()) closeLibrary();
  });
  ($('libraryKind') as HTMLSelectElement).addEventListener('change', (event) => setKind((event.target as HTMLSelectElement).value));
  $('libraryImportBtn').addEventListener('click', async () => {
    const dry = await run('import', { dry: true });
    if (!dry) return;
    const n = (dry['would-add'] ?? 0) + (dry['would-create'] ?? 0) + (dry['would-pick'] ?? 0);
    if (!n) {
      statusEl().textContent = 'The library already has everything in assets/models and assets/splats.';
      return;
    }
    if (confirm(`Import ${dry['would-create'] ?? 0} new characters, props and splats and ${dry['would-add'] ?? 0} files into Hawkes Gen's library?`)) {
      await run('import', {});
      lib?.setAttribute('project', 'phorigins'); // reload the list
    }
  });
  $('libraryExportBtn').addEventListener('click', async () => {
    const dry = await run('export', { dry: true });
    if (!dry) return;
    if (!dry['would-write']) {
      statusEl().textContent = 'assets/models and assets/splats already match the library.';
      return;
    }
    if (confirm(`Write ${dry['would-write']} files into assets/models and assets/splats?`)) await run('export', {});
  });
};
