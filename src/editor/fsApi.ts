// Thin wrapper around the dev-only /api/* endpoints exposed by the Vite
// plugin in vite.config.ts. These only exist while `npm run dev` is running.

export type FsTreeNode = {
  name: string;
  path: string;
  isDir: boolean;
  children?: FsTreeNode[];
};

export type FsTreeResponse = Record<string, FsTreeNode[]>;

export const fetchProjectTree = async (): Promise<FsTreeResponse | null> => {
  try {
    const response = await fetch('/api/tree', { cache: 'no-store' });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
};

export const saveJsonFile = async (path: string, data: unknown): Promise<boolean> => {
  try {
    const response = await fetch('/api/save-json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, data }),
    });
    return response.ok;
  } catch {
    return false;
  }
};

export type ImportModelAnimation = { name: string; path: string };

export type ImportModelResult = {
  ok: boolean;
  asset?: { id: string; name: string; path: string; type: string; tags: string[]; source: string };
  clipNames?: string[];
  error?: string;
  log?: string;
};

// Asks the dev server to run the Blender conversion script against a base
// FBX (optionally merging Mixamo animation-only FBX files as named clips)
// and register the resulting GLB in assets/asset-library.json.
export const importModel = async (
  name: string,
  basePath: string,
  animations: ImportModelAnimation[],
): Promise<ImportModelResult> => {
  try {
    const response = await fetch('/api/import-model', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, basePath, animations }),
    });
    return await response.json();
  } catch (error) {
    return { ok: false, error: String(error) };
  }
};

export const importFbxFile = async (
  file: File,
  options: { mode: 'character' | 'animation'; name: string; target?: string },
): Promise<ImportModelResult> => {
  try {
    const params = new URLSearchParams({
      mode: options.mode,
      name: options.name,
      target: options.target ?? 'ch44-hero',
    });
    const response = await fetch(`/api/import-fbx?${params.toString()}`, {
      method: 'POST',
      headers: { 'X-File-Name': file.name },
      body: file,
    });
    return await response.json();
  } catch (error) {
    return { ok: false, error: String(error) };
  }
};
