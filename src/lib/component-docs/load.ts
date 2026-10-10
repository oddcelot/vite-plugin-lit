/**
 * Finds the Custom Elements Manifests a project can see and answers "what is
 * `<my-tag>` documented as?" from them.
 *
 * Two places are searched: the project's own package (the nearest
 * `package.json` at or above the Vite root) and the packages it lists as
 * dependencies, resolved the way Node would, by walking `node_modules` up
 * from the project so hoisted monorepos work. Dependencies of dependencies are
 * not followed. A package points at its manifest with the `customElements`
 * field, or leaves a `custom-elements.json` beside its `package.json`.
 *
 * Everything touching the disk goes through an injected `DocsFs`, so this
 * module has no `node:` imports and tests run on an in-memory tree. Paths are
 * handled as `/`-separated strings, with backslashes normalised, so Windows
 * roots behave the same.
 *
 * It reads three kinds of file: `package.json`s, and manifests named by a
 * `customElements` field that stay inside that package's directory. A field
 * pointing elsewhere (`../x.json`, an absolute path) is ignored. Nothing here
 * throws or logs per file; a missing or broken file is just skipped.
 *
 * Parsed manifests are cached by modification time, discovery by the project
 * `package.json`'s, and each lookup re-stats them so edits show up without a
 * restart.
 */

import type {ComponentDocs} from '../../types/component-docs.js';
import {docsFromManifest} from './manifest.js';

/** The file access the index needs. `undefined` means missing or unreadable. */
export interface DocsFs {
  readFile(path: string): string | undefined;
  /** Modification time in ms, for regular files only. */
  mtime(path: string): number | undefined;
}

/** A synchronous `DocsFs` over `node:fs`, imported on first use. */
export const nodeDocsFs = async (): Promise<DocsFs> => {
  const fs = await import('node:fs');
  return {
    readFile: (path) => {
      try {
        return fs.readFileSync(path, 'utf8');
      } catch {
        return undefined;
      }
    },
    mtime: (path) => {
      try {
        const stat = fs.statSync(path);
        return stat.isFile() ? stat.mtimeMs : undefined;
      } catch {
        return undefined;
      }
    },
  };
};

export interface ComponentDocsIndex {
  /** The tag's docs from the first manifest that has it, project first. */
  get(tagName: string): Promise<ComponentDocs | null>;
}

// --- paths -----------------------------------------------------------------

const DRIVE = /^[a-zA-Z]:/;

const isAbsolute = (path: string): boolean =>
  path.startsWith('/') || path.startsWith('\\') || DRIVE.test(path);

/** `/`-separated, with `.` and `..` resolved. Meant for absolute input. */
const normalize = (path: string): string => {
  const parts = path.replace(/\\/g, '/').split('/');
  let root = '';
  if (path.startsWith('/') || path.startsWith('\\')) root = '/';
  else if (DRIVE.test(path)) root = `${parts.shift() ?? ''}/`;
  const kept: string[] = [];
  for (const part of parts) {
    if (part === '' || part === '.') continue;
    if (part === '..') kept.pop();
    else kept.push(part);
  }
  return root + kept.join('/');
};

const isRoot = (path: string): boolean =>
  path === '/' || /^[a-zA-Z]:\/$/.test(path);

const dirname = (path: string): string => {
  if (isRoot(path)) return path;
  const index = path.lastIndexOf('/');
  const parent = path.slice(0, index);
  return parent === '' || (DRIVE.test(parent) && parent.length === 2)
    ? `${parent}/`
    : parent;
};

const join = (dir: string, name: string): string => normalize(`${dir}/${name}`);

/** `dir`, then each parent up to the filesystem root. */
const walkUp = (dir: string): string[] => {
  const dirs = [dir];
  for (let current = dir; !isRoot(current);) {
    current = dirname(current);
    dirs.push(current);
  }
  return dirs;
};

/**
 * Resolves a package-relative path, or `undefined` when it is absolute or
 * escapes `packageDir`. Returns the absolute path and the package-relative one.
 */
const confined = (
  packageDir: string,
  relative: string
): {path: string; relative: string} | undefined => {
  if (isAbsolute(relative)) return undefined;
  const path = join(packageDir, relative);
  const prefix = packageDir.endsWith('/') ? packageDir : `${packageDir}/`;
  if (!path.startsWith(prefix) || path === prefix) return undefined;
  return {path, relative: path.slice(prefix.length)};
};

/** A name that can only mean a directory directly under `node_modules`. */
const isDependencyName = (name: string): boolean =>
  !name.startsWith('.') &&
  !name.includes('\\') &&
  !name.split('/').some((part) => part === '..' || part === '');

// --- discovery -------------------------------------------------------------

const MANIFEST_FALLBACK = 'custom-elements.json';
const DEPENDENCY_FIELDS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
];

export interface ManifestSource {
  /** Absolute path to the manifest file. */
  path: string;
  /** Relative to the package, for `origin.manifest`. */
  relative: string;
  /** Absent for the project's own. */
  package?: string;
}

const readJson = (
  fs: DocsFs,
  path: string
): Record<string, unknown> | undefined => {
  const raw = fs.readFile(path);
  if (raw === undefined) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' &&
      parsed !== null &&
      !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Where a package keeps its manifest: the `customElements` field if it names
 * a file inside the package, else `custom-elements.json` beside it. A fallback
 * is only offered if it exists, unless `always` (the project's own, which an
 * analyzer run may create while the dev server is up).
 */
const manifestSource = (
  fs: DocsFs,
  packageDir: string,
  packageJson: Record<string, unknown>,
  packageName: string | undefined,
  always: boolean
): ManifestSource | undefined => {
  const field = packageJson.customElements;
  const fromField =
    typeof field === 'string' ? confined(packageDir, field) : undefined;
  const found = fromField ?? confined(packageDir, MANIFEST_FALLBACK);
  if (found === undefined) return undefined;
  if (fromField === undefined && !always && fs.mtime(found.path) === undefined)
    return undefined;
  const source: ManifestSource = {path: found.path, relative: found.relative};
  if (packageName !== undefined) source.package = packageName;
  return source;
};

/** The first `package.json` at `root` or above it. */
const findProjectPackage = (fs: DocsFs, root: string): string | undefined =>
  walkUp(root)
    .map((dir) => join(dir, 'package.json'))
    .find((path) => fs.mtime(path) !== undefined);

/** Names across every dependency field, in field order, without repeats. */
const dependencyNames = (packageJson: Record<string, unknown>): string[] => {
  const names = new Set<string>();
  for (const field of DEPENDENCY_FIELDS) {
    const deps = packageJson[field];
    if (typeof deps !== 'object' || deps === null) continue;
    for (const name of Object.keys(deps))
      if (isDependencyName(name)) names.add(name);
  }
  return [...names];
};

/** The nearest `node_modules/<name>` up from `projectDir`, as Node resolves it. */
const dependencySource = (
  fs: DocsFs,
  projectDir: string,
  name: string
): ManifestSource | undefined => {
  for (const dir of walkUp(projectDir)) {
    const packageDir = join(dir, `node_modules/${name}`);
    const depJson = readJson(fs, join(packageDir, 'package.json'));
    if (depJson === undefined) continue;
    const depName =
      typeof depJson.name === 'string' && depJson.name !== ''
        ? depJson.name
        : name;
    return manifestSource(fs, packageDir, depJson, depName, false);
  }
  return undefined;
};

const discover = (fs: DocsFs, packageJsonPath: string): ManifestSource[] => {
  const packageJson = readJson(fs, packageJsonPath);
  if (packageJson === undefined) return [];
  const projectDir = dirname(packageJsonPath);
  const sources = [
    manifestSource(fs, projectDir, packageJson, undefined, true),
  ];
  for (const name of dependencyNames(packageJson))
    sources.push(dependencySource(fs, projectDir, name));
  return sources.filter((source) => source !== undefined);
};

/**
 * The manifests visible from `root` that exist right now, the project's
 * first. Uncached: for the dev server's page links, read once per page.
 */
export const findManifests = (fs: DocsFs, root: string): ManifestSource[] => {
  const packageJsonPath = findProjectPackage(fs, normalize(root));
  if (packageJsonPath === undefined) return [];
  return discover(fs, packageJsonPath).filter(
    (source) => fs.mtime(source.path) !== undefined
  );
};

// --- index -----------------------------------------------------------------

/**
 * A lazy, self-refreshing index over the manifests visible from the project.
 *
 * @param options.root The Vite root; read on every lookup, since it can be
 *   unknown early on. Without one, every lookup misses.
 * @param options.fs The file access, awaited per lookup so `nodeDocsFs` can
 *   load on first use.
 */
export const createComponentDocsIndex = (options: {
  root: () => string | undefined;
  fs: () => Promise<DocsFs> | DocsFs;
}): ComponentDocsIndex => {
  const discovered = new Map<
    string,
    {mtime: number; sources: ManifestSource[]}
  >();
  const parsed = new Map<string, {mtime: number; docs: ComponentDocs[]}>();

  const docsOf = (fs: DocsFs, source: ManifestSource): ComponentDocs[] => {
    const mtime = fs.mtime(source.path);
    if (mtime === undefined) {
      parsed.delete(source.path);
      return [];
    }
    const cached = parsed.get(source.path);
    if (cached?.mtime === mtime) return cached.docs;
    const manifest = readJson(fs, source.path);
    const origin: {package?: string; manifest: string} = {
      manifest: source.relative,
    };
    if (source.package !== undefined) origin.package = source.package;
    const docs =
      manifest === undefined ? [] : docsFromManifest(manifest, origin);
    parsed.set(source.path, {mtime, docs});
    return docs;
  };

  const sourcesFor = (fs: DocsFs, root: string): ManifestSource[] => {
    const packageJsonPath = findProjectPackage(fs, normalize(root));
    if (packageJsonPath === undefined) return [];
    const mtime = fs.mtime(packageJsonPath);
    if (mtime === undefined) return [];
    const cached = discovered.get(packageJsonPath);
    if (cached?.mtime === mtime) return cached.sources;
    const sources = discover(fs, packageJsonPath);
    discovered.set(packageJsonPath, {mtime, sources});
    return sources;
  };

  return {
    async get(tagName) {
      const root = options.root();
      if (root === undefined) return null;
      const fs = await options.fs();
      for (const source of sourcesFor(fs, root)) {
        const match = docsOf(fs, source).find(
          (docs) => docs.tagName === tagName
        );
        if (match !== undefined) return match;
      }
      return null;
    },
  };
};
