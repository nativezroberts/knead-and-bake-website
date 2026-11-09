/**
 * Product Model — single source of truth for product status across the site.
 *
 * Merges static menu data (menu.json) with live inventory (/api/inventory)
 * and computes a canonical `status` for every product.
 *
 * Status rules:
 *   available=false                => "not_available"
 *   available=true  && qty === 0   => "sold_out"
 *   available=true  && qty > 0     => "available"
 */

import ContentLoader from './content-loader.js';

const API_BASE = window.__API_BASE || '';

/**
 * Compute display status from availability flag and quantity.
 * @param {boolean} available - menu-level availability
 * @param {number}  qty       - current inventory quantity
 * @returns {"available"|"sold_out"|"not_available"}
 */
export function computeStatus(available, qty) {
  if (!available) return 'not_available';
  return qty > 0 ? 'available' : 'sold_out';
}

/** Human-readable label for each status. */
export const STATUS_LABEL = {
  available:     'Available',
  sold_out:      'SOLD OUT',
  not_available: 'Not Available',
};

/**
 * Load products with inventory merged in.
 * Returns the full menu structure with each item enriched:
 *   { ...menuItem, qty, status }
 *
 * @returns {Promise<{categories: Array, items: Array, seasonalBanner: Object}|null>}
 */
export async function loadProducts() {
  let menuData, inventoryData;

  try {
    const [menuResult, inventoryRes] = await Promise.all([
      ContentLoader.menu(),
      fetch(`${API_BASE}/api/inventory`),
    ]);
    menuData = menuResult;
    inventoryData = inventoryRes.ok ? await inventoryRes.json() : { products: [] };
  } catch {
    menuData = await ContentLoader.menu();
    inventoryData = { products: [] };
  }

  if (!menuData) return null;

  const inventoryMap = new Map(
    (inventoryData.products || []).map(p => [p.sku, p])
  );

  // Inventory (editable in admin) is the product catalog. menu.json supplies defaults
  // for the original products; any field set in inventory overrides it. Products added
  // from the admin page exist only in inventory and are appended to their category.
  // Archived products are left out of the public inventory response entirely.
  const menuSkus = new Set(menuData.items.map(i => i.sku));
  const hasInventory = inventoryMap.size > 0;
  const merged = [
    // If the inventory API is down, fall back to the full static menu
    ...menuData.items.filter(item => !hasInventory || inventoryMap.has(item.sku)),
    ...[...inventoryMap.values()].filter(p => !menuSkus.has(p.sku)),
  ];

  const items = merged.map(item => {
    const inv = inventoryMap.get(item.sku);
    const qty = inv ? Number(inv.currentQty) || 0 : 0;
    // Inventory availability is authoritative when present.
    // menu.json availability is used as fallback when inventory entry is missing.
    const available = inv ? !!inv.available : !!item.available;
    const overrides = {};
    for (const field of ['name', 'price', 'category', 'description', 'allergens', 'image', 'seasonal', 'topSeller']) {
      const v = inv?.[field];
      if (v !== undefined && v !== null && v !== '') overrides[field] = v;
    }
    const product = {
      description: '',
      allergens: [],
      ...item,
      ...overrides,
    };
    product.price = Number(product.price) || 0;
    return {
      ...product,
      available,
      qty,
      currentQty: qty, // alias kept for renderOrderItem compat
      status: computeStatus(available, qty),
    };
  });

  return {
    categories: menuData.categories,
    items,
    seasonalBanner: menuData.seasonalBanner,
  };
}
