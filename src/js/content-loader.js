/**
 * Content Loader — Fetches JSON data files and caches them in memory.
 * All content is loaded from /content/*.json so the site is data-driven.
 */

const ContentLoader = (() => {
  const cache = {};

  async function load(path) {
    if (cache[path]) return cache[path];
    try {
      const res = await fetch(path);
      if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
      const data = await res.json();
      cache[path] = data;
      return data;
    } catch (err) {
      console.error('[ContentLoader]', err);
      return null;
    }
  }

  return {
    siteConfig:    () => load('/content/site-config.json'),
    menu:          () => load('/content/menu.json'),
    recipes:       () => load('/content/recipes.json'),
    starterKit:    () => load('/content/starter-kit.json'),
    news:          () => load('/content/news.json'),
    testimonials:  () => load('/content/testimonials.json'),
    about:         () => load('/content/about.json'),
    load,
  };
})();

export default ContentLoader;
