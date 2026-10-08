import type {
  InspectorCommand,
  InspectorMessage,
  ValueChild,
  ValuePath,
} from '../types/inspector.js';

/** One expanded value's children, as far as the panel knows them. */
export type ExpandedLevel =
  | {status: 'loading'; children?: ValueChild[]; more?: number}
  | {status: 'ready'; children: ValueChild[]; more: number}
  /** The path stopped resolving on the page. */
  | {status: 'gone'};

type ExpandedMessage = Extract<InspectorMessage, {type: 'expanded'}>;

const keyOf = (p: ValuePath): string =>
  JSON.stringify([p.section, p.name, ...p.keys]);

/** Whether `path` is `root` or lies under it. */
const isUnder = (path: ValuePath, root: ValuePath): boolean =>
  path.section === root.section &&
  path.name === root.name &&
  path.keys.length >= root.keys.length &&
  root.keys.every((k, i) => path.keys[i] === k);

/**
 * Which values the details pane has opened for the selected element, and
 * their children as the page reported them. Opening asks the page for one
 * level; a refresh of a row asks again for every open level under it, and
 * keeps showing the old children until the answer lands, so a value that
 * changes while open does not flicker.
 */
export class ValueExpansion {
  readonly #send: (command: InspectorCommand) => void;
  readonly #onChange: () => void;
  #id: number | null = null;
  #open = new Map<string, ValuePath>();
  #levels = new Map<string, ExpandedLevel>();

  constructor(send: (command: InspectorCommand) => void, onChange: () => void) {
    this.#send = send;
    this.#onChange = onChange;
  }

  /** Follow element `id`; switching to another one closes everything. */
  follow(id: number | null): void {
    if (id === this.#id) return;
    this.#id = id;
    this.#open.clear();
    this.#levels.clear();
  }

  isOpen(path: ValuePath): boolean {
    return this.#open.has(keyOf(path));
  }

  level(path: ValuePath): ExpandedLevel | undefined {
    return this.#levels.get(keyOf(path));
  }

  /** Open `path` and ask for its children, or close it and all under it. */
  toggle(path: ValuePath): void {
    if (this.#id === null) return;
    const key = keyOf(path);
    if (this.#open.has(key)) {
      for (const [k, p] of this.#open) {
        if (isUnder(p, path)) {
          this.#open.delete(k);
          this.#levels.delete(k);
        }
      }
    } else {
      this.#open.set(key, path);
      this.#request(path);
    }
    this.#onChange();
  }

  /** Ask again for every open level under the row `section`/`name`. */
  refresh(section: ValuePath['section'], name: string): void {
    const row: ValuePath = {section, name, keys: []};
    for (const path of this.#open.values()) {
      if (isUnder(path, row)) this.#request(path);
    }
  }

  /** Take an `expanded` answer; stale or unasked ones are dropped. */
  receive(message: ExpandedMessage): void {
    const key = keyOf(message.path);
    if (message.id !== this.#id || !this.#open.has(key)) return;
    this.#levels.set(
      key,
      message.children === null
        ? {status: 'gone'}
        : {
            status: 'ready',
            children: message.children,
            more: message.more ?? 0,
          }
    );
    this.#onChange();
  }

  #request(path: ValuePath): void {
    const key = keyOf(path);
    const known = this.#levels.get(key);
    this.#levels.set(
      key,
      known?.status === 'ready'
        ? {status: 'loading', children: known.children, more: known.more}
        : {status: 'loading'}
    );
    this.#send({type: 'expand', id: this.#id!, path});
  }
}
