import type { InventoryItemType, InventoryState } from './types';

const defaultInventoryItems: Record<InventoryItemType, number> = {
  medkit: 1,
  ammo: 6,
  scrap: 0,
  power_core: 0,
};

export const createInventoryState = (): InventoryState => ({
  slots: 6,
  items: { ...defaultInventoryItems },
});

export const addItem = (inventory: InventoryState, item: InventoryItemType, amount = 1) => {
  inventory.items[item] = (inventory.items[item] ?? 0) + amount;
  return inventory;
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
