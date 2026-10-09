/**
 * Where the panel is: which tab is in front, and what each view has
 * selected. The shell turns deep links into it and writes it back into the
 * URL hash; views read their own slot and report their user's selections.
 * Neither reaches into the other.
 *
 * A link can name something a view has no data for yet (a freshly opened
 * snapshot, before its recording has streamed in), so a link's id is held
 * as the view's *request* until the view matches it ({@link resolve}) or
 * the user selects something else ({@link select}). While it is held the
 * link reports it, so the address bar keeps pointing where the link did.
 *
 * Each view keeps its own selection: an Updates row is a component tag, and
 * moving the Components selection to whichever instance a row stands for
 * would pick an element nobody chose.
 *
 * Framework-free; the shell owns the instance and hands it to the views.
 */

import type {TimeRange} from '../lib/timeline/range.js';
import type {DeepLink, DeepLinkTab} from './deep-link.js';

/** The views that hold a selection, and what each selects by. */
export interface Selections {
  /** An element in the Components tree. */
  components: number;
  /** An element whose component row is selected in Updates. */
  updates: number;
  /** The start event of the selected timeline span. */
  timeline: string;
  /** The time range drawn in the Timeline's tracks. */
  range: TimeRange;
}

export type SelectingView = keyof Selections;

export class PanelLocation {
  #tab: DeepLinkTab;
  readonly #selected: {[V in SelectingView]: Selections[V] | null} = {
    components: null,
    updates: null,
    timeline: null,
    range: null,
  };
  readonly #requested: {[V in SelectingView]?: Selections[V]} = {};
  readonly #listeners = new Set<() => void>();

  constructor(tab: DeepLinkTab = 'components') {
    this.#tab = tab;
  }

  get tab(): DeepLinkTab {
    return this.#tab;
  }

  /** What `view` shows selected; `null` for nothing. */
  selected<V extends SelectingView>(view: V): Selections[V] | null {
    return this.#selected[view];
  }

  /** The id a link asked `view` to select that it has not matched yet. */
  requested<V extends SelectingView>(view: V): Selections[V] | undefined {
    return this.#requested[view];
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  setTab(tab: DeepLinkTab): void {
    if (tab === this.#tab) return;
    this.#tab = tab;
    this.#changed();
  }

  /**
   * Go where `link` points. An event id or a range with no element id is the
   * timeline's.
   * An element id means the same thing in Components and Updates, so the tab
   * the link named is honoured and only defaults to Components when it named
   * none; otherwise `#tab=updates&component=3` would land on the wrong tab
   * and look like the parameter was ignored.
   */
  apply(link: DeepLink): void {
    if (link.tab !== undefined) this.#tab = link.tab;
    if (link.componentId !== undefined) {
      const view = link.tab === 'updates' ? 'updates' : 'components';
      this.#tab = view;
      this.#requested[view] = link.componentId;
    } else if (link.eventId !== undefined || link.range !== undefined) {
      this.#tab = 'timeline';
      if (link.eventId !== undefined) this.#requested.timeline = link.eventId;
      if (link.range !== undefined) this.#requested.range = link.range;
    }
    this.#changed();
  }

  /** The user selected `id` in `view`; supersedes anything a link asked. */
  select<V extends SelectingView>(view: V, id: Selections[V] | null): void {
    const held = view in this.#requested;
    if (!held && this.#selected[view] === id) return;
    delete this.#requested[view];
    this.#selected[view] = id;
    this.#changed();
  }

  /**
   * `view` matched its request to `id`, or gave up on it with `null` (the
   * id is not in its data and will not be: evicted, or another session's).
   */
  resolve<V extends SelectingView>(view: V, id: Selections[V] | null): void {
    if (!(view in this.#requested)) return;
    delete this.#requested[view];
    this.#selected[view] = id;
    this.#changed();
  }

  /** The link that reopens the panel here: the tab and its view's selection. */
  link(): DeepLink {
    const link: DeepLink = {tab: this.#tab};
    const tab = this.#tab;
    if (tab === 'components' || tab === 'updates') {
      const id = this.#requested[tab] ?? this.#selected[tab];
      if (id !== null) link.componentId = id;
    } else if (tab === 'timeline') {
      const id = this.#requested.timeline ?? this.#selected.timeline;
      if (id !== null) link.eventId = id;
      const range = this.#requested.range ?? this.#selected.range;
      if (range !== null) link.range = range;
    }
    return link;
  }

  #changed(): void {
    for (const listener of this.#listeners) listener();
  }
}
