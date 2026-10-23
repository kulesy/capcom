// The window's title as a rule that needs no page. Chrome puts the app's name and a dash in front of an installed app's title unless the
// title starts with the name, so an installed window shows the name alone, and a browser tab keeps the page's own title.
export const APP_NAME = 'GhostShell';

export const INSTALLED = '(display-mode: standalone), (display-mode: window-controls-overlay)';

export const windowTitle = (title, installed) => (installed ? APP_NAME : title);
