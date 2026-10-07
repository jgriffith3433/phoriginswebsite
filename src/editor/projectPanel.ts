import type { FsTreeNode } from './fsApi';

export type AssetKind = 'model' | 'audio' | 'texture' | 'light' | 'other';

export const inferAssetKind = (fileName: string): AssetKind => {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'glb' || ext === 'gltf') return fileName.toLowerCase().includes('light') ? 'light' : 'model';
  if (ext === 'wav' || ext === 'mp3' || ext === 'ogg') return 'audio';
  if (ext === 'png' || ext === 'jpg' || ext === 'jpeg') return 'texture';
  return 'other';
};

export type DraggableAssetPayload = {
  path: string;
  name: string;
  kind: AssetKind;
};

export type ProjectPanelOptions = {
  onFileClick?: (node: FsTreeNode) => void;
};

const kindIcon: Record<AssetKind, string> = {
  model: '🧊',
  audio: '🔊',
  texture: '🖼️',
  light: '💡',
  other: '📄',
};

const renderNode = (node: FsTreeNode, depth: number, options: ProjectPanelOptions): HTMLElement => {
  const row = document.createElement('div');
  row.className = node.isDir ? 'fs-row fs-dir' : 'fs-row fs-file';
  row.style.paddingLeft = `${depth * 14 + 10}px`;

  if (node.isDir) {
    row.innerHTML = `<span class="fs-caret">▾</span><span class="fs-icon">📁</span><span class="fs-name">${node.name}</span>`;
  } else {
    const kind = inferAssetKind(node.name);
    const draggable = kind !== 'other';
    row.innerHTML = `<span class="fs-icon">${kindIcon[kind]}</span><span class="fs-name">${node.name}</span><span class="type-tag">${kind}</span>`;
    row.draggable = draggable;
    row.classList.toggle('fs-draggable', draggable);
    if (draggable) {
      row.addEventListener('dragstart', (event) => {
        const payload: DraggableAssetPayload = { path: node.path, name: node.name, kind };
        event.dataTransfer?.setData('application/json', JSON.stringify(payload));
        event.dataTransfer!.effectAllowed = 'copy';
        row.classList.add('fs-dragging');
      });
      row.addEventListener('dragend', () => row.classList.remove('fs-dragging'));
    }
    row.addEventListener('click', () => options.onFileClick?.(node));
  }

  const wrapper = document.createElement('div');
  wrapper.className = 'fs-node';
  wrapper.appendChild(row);

  if (node.isDir && node.children?.length) {
    const childContainer = document.createElement('div');
    childContainer.className = 'fs-children';
    node.children.forEach((child) => childContainer.appendChild(renderNode(child, depth + 1, options)));
    wrapper.appendChild(childContainer);

    row.addEventListener('click', () => {
      const collapsed = childContainer.style.display === 'none';
      childContainer.style.display = collapsed ? '' : 'none';
      row.querySelector('.fs-caret')!.textContent = collapsed ? '▾' : '▸';
    });
  }

  return wrapper;
};

export const renderProjectTree = (
  container: HTMLElement,
  roots: { label: string; nodes: FsTreeNode[] }[],
  options: ProjectPanelOptions = {},
) => {
  container.innerHTML = '';
  roots.forEach(({ label, nodes }) => {
    const section = document.createElement('div');
    section.className = 'fs-section';
    const heading = document.createElement('div');
    heading.className = 'fs-section-label';
    heading.textContent = label;
    section.appendChild(heading);
    nodes.forEach((node) => section.appendChild(renderNode(node, 0, options)));
    container.appendChild(section);
  });
};
