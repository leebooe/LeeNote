import type { DetachedNoteState, Note } from "./types";
import { isTauri } from "./window";

const openingWindows = new Map<string, Promise<void>>();

export function detachedWindowLabel(noteId: string) {
  return `note-${noteId}`;
}

export function openDetachedNoteWindow(note: Note, state: DetachedNoteState) {
  if (!isTauri()) return Promise.resolve();
  const label = detachedWindowLabel(note.id);
  const existingTask = openingWindows.get(label);
  if (existingTask) return existingTask;

  const task = (async () => {
    const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    if (await WebviewWindow.getByLabel(label)) return;

    const noteWindow = new WebviewWindow(label, {
      url: `index.html?note=${encodeURIComponent(note.id)}`,
      title: note.title || "无标题便签",
      x: Math.round(state.x),
      y: Math.round(state.y),
      width: 380,
      height: 430,
      minWidth: 300,
      minHeight: 260,
      decorations: false,
      transparent: true,
      shadow: true,
      resizable: true,
      visible: true,
      focus: true,
      alwaysOnTop: state.layer === "top",
      alwaysOnBottom: state.layer === "bottom",
    });

    await new Promise<void>((resolve, reject) => {
      void noteWindow.once("tauri://created", () => resolve());
      void noteWindow.once("tauri://error", (event) => reject(event.payload));
    });
  })();

  openingWindows.set(label, task);
  void task.finally(() => {
    if (openingWindows.get(label) === task) openingWindows.delete(label);
  });
  return task;
}
