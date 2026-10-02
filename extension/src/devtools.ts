/**
 * The extension's DevTools page: Chrome loads it, hidden, each time DevTools
 * opens, and it adds the Lit tab.
 */

void chrome.devtools.panels.create('Lit', 'icon.svg', 'panel.html');
