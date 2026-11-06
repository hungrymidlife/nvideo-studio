export type View = 'library'|'settings'|'board';
export type LibraryItem = { id: number; name?: string; title?: string; path?: string; item_count?: number; last_scanned_at?: number; [key: string]: unknown };
