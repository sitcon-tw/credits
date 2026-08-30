import { defineConfig } from 'astro/config';

// The public site is a GitHub Pages project site published under https://sitcon.org/credits/,
// so `base` must be `/credits` and `build.format` must stay `file`: the default `directory`
// format would relocate claim.html to claim/index.html and break the published claim URLs
// that scripts/profiles/comment-published-profile.mjs and the issue forms hand out.
//
// `trailingSlash` stays at the default `ignore` so `astro dev` and `astro preview` both serve
// `/credits/` exactly as GitHub Pages does. Setting it to `never` makes the dev server 404 on
// the published URL shape.
export default defineConfig({
  site: 'https://sitcon.org',
  base: '/credits',
  output: 'static',
  build: { format: 'file' },
  devToolbar: { enabled: false },
});
