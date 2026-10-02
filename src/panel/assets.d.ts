/** Vite's `?raw` import: the file's contents as a string. */
declare module '*.svg?raw' {
  const content: string;
  export default content;
}

/** Side-effect stylesheet import; Vite injects (dev) or extracts (build) it. */
declare module '*.css';
