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

  const items = menuData.items.map(item => {
    const inv = inventoryMap.get(item.sku);
    const qty = inv ? inv.currentQty : 0;
    // Inventory availability is authoritative when present.
    // menu.json availability is used as fallback when inventory entry is missing.
    const available = inv ? !!inv.available : !!item.available;
    return {
      ...item,
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
