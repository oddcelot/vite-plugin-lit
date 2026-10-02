import {css} from 'lit';

/**
 * Square corners for Web Awesome parts whose radius is hard-coded rather than
 * read from the `--wa-border-radius-*` tokens wa-theme.css zeroes. Part
 * selectors only reach one shadow root down, so each view that renders one
 * of these components adds this to its own styles.
 */
export const waSquare = css`
  wa-switch::part(control),
  wa-switch::part(thumb) {
    border-radius: 0;
  }
`;
