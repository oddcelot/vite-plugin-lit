import {defineConfig} from 'astro/config';
import starlight from '@astrojs/starlight';
import sitemap from '@astrojs/sitemap';
import starlightLinksValidator from 'starlight-links-validator';
import starlightLlmsTxt from 'starlight-llms-txt';
export default defineConfig({
  site: 'https://oddcelot.github.io',
  // GitHub Pages project path. Astro does not rewrite hrefs written in
  // Markdown, and Astro 7's Markdown processor has no rehype hook to do it
  // for us, so internal links in content are written with this prefix. The
  // links validator checks every one of them against the real page set.
  base: '/vite-plugin-lit',
  integrations: [
    starlight({
      title: 'vite-plugin-lit',
      description:
        'True HMR for Lit components, CSS delivery helpers, and a DevTools timeline for Vite.',
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/oddcelot/vite-plugin-lit',
        },
        {
          icon: 'npm',
          label: 'npm',
          href: 'https://www.npmjs.com/package/@oddsquad/vite-plugin-lit',
        },
      ],
      editLink: {
        baseUrl: 'https://github.com/oddcelot/vite-plugin-lit/edit/main/docs/',
      },
      lastUpdated: true,
      customCss: ['./src/styles/custom.css'],
      // Starlight >= 0.39 requires the autogenerate config inside `items`;
      // a group with a bare `autogenerate` key is a hard error.
      sidebar: [
        {
          label: 'Getting started',
          items: [{autogenerate: {directory: 'getting-started'}}],
        },
        {label: 'Guides', items: [{autogenerate: {directory: 'guides'}}]},
        {label: 'Reference', items: [{autogenerate: {directory: 'reference'}}]},
        {
          label: 'Contributing',
          items: [{autogenerate: {directory: 'contributing'}}],
        },
      ],
      plugins: [starlightLinksValidator(), starlightLlmsTxt()],
    }),
    sitemap(),
  ],
});
