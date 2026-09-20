import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { Layers2, Minus, PanelLeftOpen, X } from "lucide-react";
import { loadNotes, loadSettings, saveNotes, saveSettings } from "./data";
import type { Note, WindowLayer } from "./types";
import { applyWindowLayer, minimizeWindow, startWindowDragging } from "./window";

const noteId = new URLSearchParams(window.location.search).get("note") ?? "";

function persistDetachedState(patch: { x?: number; y?: number; layer?: WindowLayer }) {
  const latest = loadSettings();
  const current = latest.detachedNotes[noteId] ?? { x: 0, y: 0, layer: "normal" };
  saveSettings({
    ...latest,
    detachedNotes: {
      ...latest.detachedNotes,
      [noteId]: { ...current, ...patch },
    },
  });
}

export default function NoteWindow() {
  const [note, setNote] = useState<Note | undefined>(() =>
    loadNotes().find((candidate) => candidate.id === noteId),
  );
  const [settings] = useState(loadSettings);
  const [layer, setLayer] = useState<WindowLayer>(
    () => settings.detachedNotes[noteId]?.layer ?? "normal",
  );
  const reattachTimer = useRef<number | undefined>(undefined);
  const effectiveTheme = useMemo(() => {
    if (settings.theme !== "system") return settings.theme;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }, [settings.theme]);

  useEffect(() => {
    document.documentElement.dataset.theme = effectiveTheme;
  }, [effectiveTheme]);

  useEffect(() => {
    void applyWindowLayer(layer);
  }, [layer]);

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window) || !noteId) return;
    let disposed = false;
    const cleanup: Array<() => void> = [];

    void (async () => {
      const { emitTo, listen } = await import("@tauri-apps/api/event");
      const { getCurrentWindow, Window } = await import("@tauri-apps/api/window");
      const currentWindow = getCurrentWindow();

      cleanup.push(
        await listen<Note>("leenote:note-updated", (event) => {
          if (event.payload.id === noteId) setNote(event.payload);
        }),
      );

      cleanup.push(
        await currentWindow.onMoved((event) => {
          const position = event.payload;
          persistDetachedState({ x: position.x, y: position.y });
          void emitTo("main", "leenote:note-window-moved", {
            noteId,
            x: position.x,
            y: position.y,
          });
          window.clearTimeout(reattachTimer.current);
          reattachTimer.current = window.setTimeout(async () => {
            const mainWindow = await Window.getByLabel("main");
            if (!mainWindow || disposed) return;
            const [mainPosition, mainSize, mainScale, currentSize] = await Promise.all([
              mainWindow.outerPosition(),
              mainWindow.outerSize(),
              mainWindow.scaleFactor(),
              currentWindow.outerSize(),
            ]);
            const centerX = position.x + currentSize.width / 2;
            const centerY = position.y + Math.min(currentSize.height / 2, 120 * mainScale);
            const mainWidth = mainSize.width / mainScale;
            const sidebarWidth = mainWidth <= 760
              ? 0
              : Math.min(284, Math.max(210, mainWidth * 0.2731));
            const sidebarRight = mainPosition.x + Math.min(sidebarWidth * mainScale, mainSize.width);
            const insideSidebar =
              centerX >= mainPosition.x &&
              centerX <= sidebarRight &&
              centerY >= mainPosition.y &&
              centerY <= mainPosition.y + mainSize.height;
            if (!insideSidebar) return;
            await emitTo("main", "leenote:note-reattach", { noteId });
            await currentWindow.destroy();
          }, 420);
        }),
      );
      cleanup.push(
        await currentWindow.onCloseRequested(async () => {
          await emitTo("main", "leenote:note-reattach", { noteId });
        }),
      );
    })();

    return () => {
      disposed = true;
      window.clearTimeout(reattachTimer.current);
      cleanup.forEach((unlisten) => unlisten());
    };
  }, []);

  const updateNote = (patch: Partial<Note>) => {
    if (!note) return;
    const next = { ...note, ...patch, updatedAt: Date.now() };
    setNote(next);
    saveNotes(loadNotes().map((candidate) => (candidate.id === next.id ? next : candidate)));
    if ("__TAURI_INTERNALS__" in window) {
      void import("@tauri-apps/api/event").then(({ emitTo }) =>
        emitTo("main", "leenote:note-updated", next),
      );
    }
  };

  const reattach = async () => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    const [{ emitTo }, { getCurrentWindow }] = await Promise.all([
      import("@tauri-apps/api/event"),
      import("@tauri-apps/api/window"),
    ]);
    await emitTo("main", "leenote:note-reattach", { noteId });
    await getCurrentWindow().destroy();
  };

  const cycleLayer = () => {
    const layers: WindowLayer[] = ["normal", "top", "bottom"];
    const nextLayer = layers[(layers.indexOf(layer) + 1) % layers.length];
    setLayer(nextLayer);
    persistDetachedState({ layer: nextLayer });
    if ("__TAURI_INTERNALS__" in window) {
      void import("@tauri-apps/api/event").then(({ emitTo }) =>
        emitTo("main", "leenote:note-window-layer", { noteId, layer: nextLayer }),
      );
    }
  };

  const handleTitlebarMouseDown = (event: ReactMouseEvent<HTMLElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest("button")) return;
    event.preventDefault();
    void startWindowDragging();
  };

  if (!note) {
    return <main className="detached-note-shell detached-note-missing">便签不存在</main>;
  }

  return (
    <main className={`detached-note-shell note-${note.color}`}>
      <header className="detached-titlebar" onMouseDown={handleTitlebarMouseDown}>
        <span className="detached-title">
          {note.title || "无标题便签"}
        </span>
        <div className="detached-window-actions">
          <button
            className={layer === "normal" ? "" : "is-layer-fixed"}
            onClick={cycleLayer}
            title={{ normal: "普通层", top: "置顶层", bottom: "桌面层" }[layer]}
            aria-label={{ normal: "普通层", top: "置顶层", bottom: "桌面层" }[layer]}
          >
            <Layers2 size={15} />
          </button>
          <button onClick={() => void reattach()} title="收回 LeeNote 列表" aria-label="收回 LeeNote 列表">
            <PanelLeftOpen size={15} />
          </button>
          <button onClick={() => void minimizeWindow()} title="最小化" aria-label="最小化">
            <Minus size={16} />
          </button>
          <button className="detached-close" onClick={() => void reattach()} title="关闭并收回列表" aria-label="关闭并收回列表">
            <X size={16} />
          </button>
        </div>
      </header>
      <input
        className="detached-note-title"
        value={note.title}
        onChange={(event) => updateNote({ title: event.target.value })}
        placeholder="便签标题"
        spellCheck={false}
      />
      <textarea
        className="detached-note-editor"
        value={note.content}
        onChange={(event) => updateNote({ content: event.target.value })}
        placeholder="开始记录…支持 Markdown"
        spellCheck
      />
      <footer className="detached-statusbar">
        <span>Markdown</span>
        <span>{note.content.length} 字符</span>
      </footer>
    </main>
  );
}
