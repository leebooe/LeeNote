import type { Note, Settings } from "./types";

const NOTES_KEY = "leenote.notes.v1";
const SETTINGS_KEY = "leenote.settings.v1";

const starterContent = `# 欢迎使用 LeeNote

这是一张始终陪在桌面上的 Markdown 便签。

- [ ] 按 **⌘/Ctrl + N** 新建便签
- [ ] 使用右上角按钮切换编辑与预览
- [x] 内容会自动保存

> 让记录足够轻，想法才愿意留下来。
`;

export const defaultSettings: Settings = {
  viewMode: "edit",
  windowLayer: "normal",
  theme: "system",
  sidebarOpen: true,
};

export function createNote(overrides: Partial<Note> = {}): Note {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    title: "新便签",
    content: "",
    color: "sun",
    pinned: false,
    archived: false,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

export function loadNotes(): Note[] {
  try {
    const raw = localStorage.getItem(NOTES_KEY);
    if (raw) return JSON.parse(raw) as Note[];
  } catch {
    // Corrupted local data falls back to the starter note.
  }
  return [createNote({ title: "欢迎使用 LeeNote", content: starterContent, pinned: true })];
}

export function saveNotes(notes: Note[]) {
  localStorage.setItem(NOTES_KEY, JSON.stringify(notes));
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...defaultSettings, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    // Invalid preferences use safe defaults.
  }
  return defaultSettings;
}

export function saveSettings(settings: Settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}
