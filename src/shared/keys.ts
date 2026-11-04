// Storage keys, kept free of dependencies so the content script stays small.
export const siteStyleKey = (origin: string) => `site:${origin}`;
export const statusKey = (tabId: number) => `status:${tabId}`;
export const pickedKey = (tabId: number) => `picked:${tabId}`;
