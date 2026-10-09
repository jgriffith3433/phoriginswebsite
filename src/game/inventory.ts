import type { InventoryItemType, InventoryState } from './types';

const defaultInventoryItems: Record<InventoryItemType, number> = {
  medkit: 1,
  ammo: 0,
  scrap: 0,
  power_core: 0,
};

/** Per-item stack caps. A full stack stays in the world. */
export const ITEM_CAP: Record<InventoryItemType, number> = {
  medkit: 3,
  ammo: 4,
  scrap: 8,
  power_core: 2,
};

export const createInventoryState = (): InventoryState => ({
  slots: 6,
  items: { ...defaultInventoryItems },
});

export const itemCount = (inventory: InventoryState, item: InventoryItemType) => inventory.items[item] ?? 0;

export const roomFor = (inventory: InventoryState, item: InventoryItemType) =>
  Math.max(0, ITEM_CAP[item] - itemCount(inventory, item));

/** Adds up to the stack cap. Returns how many were actually taken. */
export const addItem = (inventory: InventoryState, item: InventoryItemType, amount = 1) => {
  const taken = Math.max(0, Math.min(amount, roomFor(inventory, item)));
  if (taken <= 0) return 0;
  inventory.items[item] = itemCount(inventory, item) + taken;
  return taken;
};

export const consumeItem = (inventory: InventoryState, item: InventoryItemType, amount = 1) => {
  const current = inventory.items[item] ?? 0;
  if (current < amount) return false;
  inventory.items[item] = current - amount;
  return true;
};

export const inventorySummary = (inventory: InventoryState) =>
  Object.entries(inventory.items)
    .filter(([, count]) => count > 0)
    .map(([id, count]) => `${id}: ${count}`)
    .join(', ') || 'Empty inventory';
