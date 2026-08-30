/**
 * The site's base path with any trailing slash removed.
 *
 * The published site lives at https://sitcon.org/credits/, so `astro.config.mjs` sets
 * `base: '/credits'`. Astro reports `import.meta.env.BASE_URL` with or without a trailing
 * slash depending on the `trailingSlash` setting, so every in-page URL is built from this
 * normalized value instead of from the raw environment variable.
 */
export const BASE = String(import.meta.env.BASE_URL ?? '').replace(/\/+$/, '');

export function basePath(path = '') {
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${BASE}${suffix}`;
}
