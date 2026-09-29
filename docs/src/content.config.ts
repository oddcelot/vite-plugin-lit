import {defineCollection} from 'astro:content';
import {docsLoader} from '@astrojs/starlight/loaders';
import {docsSchema} from '@astrojs/starlight/schema';
import {changelogsLoader} from 'starlight-changelogs/loader';

export const collections = {
  docs: defineCollection({loader: docsLoader(), schema: docsSchema()}),
  // The root CHANGELOG.md, as a version list at /reference/changelog/ and a
  // page per release. scripts/sync-changelog.mjs writes the copy read here.
  changelogs: defineCollection({
    loader: changelogsLoader([
      {
        provider: 'keep-a-changelog',
        base: 'reference/changelog',
        changelog: '.generated/CHANGELOG.md',
        title: 'Changelog',
      },
    ]),
  }),
};
