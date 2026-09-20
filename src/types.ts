export type NoteColor = "sun" | "mint" | "sky" | "rose" | "lavender" | "paper";
export type ViewMode = "edit" | "split" | "preview";
export type WindowLayer = "bottom" | "normal" | "top";

export interface DetachedNoteState {
  x: number;
  y: number;
  layer: WindowLayer;
}

export interface Note {
  id: string;
  title: string;
  content: string;
  color: NoteColor;
  pinned: boolean;
  archived: boolean;
  group: string;
  createdAt: number;
  updatedAt: number;
}

export interface Settings {
  viewMode: ViewMode;
  windowLayer: WindowLayer;
  theme: "light" | "dark" | "system";
  sidebarOpen: boolean;
  storagePath: string;
  groups: string[];
  detachedNotes: Record<string, DetachedNoteState>;
}
