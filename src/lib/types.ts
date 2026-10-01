/** The component the source overlay resolved under the pointer. */
export interface ElementInfo {
  /** The element's tag name, e.g. `my-element`. */
  tagName: string;
  /** The class that defines the element, when the plugin recorded it. */
  componentName?: string;
  /** Where the component is defined. */
  source: {
    /** Absolute path of the defining module. */
    filePath: string;
    /** Line of the class declaration in that module. */
    lineNumber: number;
  };
}

/** An editor the source overlay can open files in. */
export interface EditorConfig {
  /** Label shown in the overlay, e.g. `VS Code`. */
  name: string;
  /** Builds the URL that opens `path` at `line`, e.g. `vscode://file/…`. */
  url: (path: string, line: number) => string;
}

/** Options for the in-page source overlay (`sourceOverlay`). */
export interface SourceOverlayOptions {
  /**
   * Hotkey letter with Ctrl+Shift (default `s` -> Ctrl+Shift+S).
   */
  key?: string;

  /** Built-in editor key or custom `{ name, url }`. Defaults to `vscode`. */
  editor?: EditorConfig | string;

  /** Optional workspace root prefix for absolute file paths. */
  workspaceRoot?: string;

  /** Mouse move throttle in ms (default 50). */
  throttleMs?: number;

  /**
   * What the picker can pick. `source` (the default) is your own components,
   * the ones with a file to open. `lit` is any Lit element, so library ones
   * such as `<wa-button>` pick into the DevTools panel too, without a source.
   */
  hosts?: 'source' | 'lit';

  /** Filter elements to skip during inspection. */
  exclude?: (el: Element) => boolean;

  /** Callback fired when the user clicks a component. */
  onSelect?: (info: ElementInfo) => void;
}
