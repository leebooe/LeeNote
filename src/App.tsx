import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  Archive,
  ArchiveRestore,
  Check,
  ChevronDown,
  ChevronRight,
  Eye,
  FileDown,
  FilePenLine,
  FileUp,
  Folder,
  FolderOpen,
  FolderPlus,
  GripHorizontal,
  Layers2,
  Maximize2,
  Menu,
  Minus,
  Moon,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  Search,
  Settings as SettingsIcon,
  Square,
  Star,
  Sun,
  Trash2,
  X,
} from "lucide-react";
import { createNote, loadNotes, loadSettings, saveNotes, saveSettings } from "./data";
import { openDetachedNoteWindow } from "./detached";
import leeNoteLogo from "../assets/leenote-logo-white.png";
import { renderMarkdown } from "./markdown";
import {
  chooseStorageDirectory,
  getDefaultStorageDirectory,
  loadNotesFromDirectory,
  openStorageDirectory,
  saveNotesToDirectory,
} from "./storage";
import type { Note, NoteColor, Settings, ViewMode, WindowLayer } from "./types";
import {
  applyWindowLayer,
  closeWindow,
  isTauri,
  minimizeWindow,
  startWindowDragging,
  toggleMaximizeWindow,
} from "./window";

const colors: NoteColor[] = ["sun", "mint", "sky", "rose", "lavender", "paper"];

const layerLabels: Record<WindowLayer, string> = {
  bottom: "桌面层",
  normal: "普通层",
  top: "置顶层",
};

const isMacOS = /Mac|iPhone|iPad|iPod/i.test(navigator.platform);

function formatTime(value: number) {
  const date = new Date(value);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  }
  return date.toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
}

function excerpt(content: string) {
  return content
    .replace(/```[\s\S]*?```/g, "代码片段")
    .replace(/[#>*_`\[\]()-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

export default function App() {
  const [notes, setNotes] = useState<Note[]>(loadNotes);
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [activeId, setActiveId] = useState(() => notes[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const [listFilter, setListFilter] = useState<"all" | "favorites" | "archived">("all");
  const [groupTreeOpen, setGroupTreeOpen] = useState(true);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    () => new Set(["__ungrouped__"]),
  );
  const [draggingNoteId, setDraggingNoteId] = useState<string | null>(null);
  const [showMore, setShowMore] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [systemDark, setSystemDark] = useState(() =>
    window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const [saved, setSaved] = useState(true);
  const [storageReady, setStorageReady] = useState(() => !isTauri());
  const titleInput = useRef<HTMLInputElement>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const storageInitialized = useRef(false);
  const pointerDrag = useRef<{
    note: Note;
    pointerId: number;
    startX: number;
    startY: number;
    dragging: boolean;
  } | null>(null);

  const detachedNoteIds = useMemo(
    () => new Set(Object.keys(settings.detachedNotes)),
    [settings.detachedNotes],
  );
  const activeNote =
    notes.find((note) => note.id === activeId && !detachedNoteIds.has(note.id)) ??
    notes.find((note) => !detachedNoteIds.has(note.id));
  const groups = useMemo(
    () =>
      Array.from(
        new Set([...settings.groups, ...notes.map((note) => note.group).filter(Boolean)]),
      ).sort((left, right) => left.localeCompare(right, "zh-CN")),
    [notes, settings.groups],
  );

  useEffect(() => {
    setSaved(false);
    const timer = window.setTimeout(() => {
      void (async () => {
        saveNotes(notes);
        if (storageReady && settings.storagePath) {
          await saveNotesToDirectory(settings.storagePath, notes);
        }
        setSaved(true);
      })();
    }, 250);
    return () => window.clearTimeout(timer);
  }, [notes, settings.storagePath, storageReady]);

  useEffect(() => {
    saveSettings(settings);
    document.documentElement.dataset.theme = settings.theme;
    void applyWindowLayer(settings.windowLayer);
  }, [settings]);

  useEffect(() => {
    if (!isTauri() || storageInitialized.current) return;
    storageInitialized.current = true;
    void (async () => {
      const directory = settings.storagePath || (await getDefaultStorageDirectory());
      if (!settings.storagePath) {
        setSettings((current) => ({ ...current, storagePath: directory }));
      }
      const storedNotes = await loadNotesFromDirectory(directory);
      if (storedNotes?.length) {
        setNotes(storedNotes.map((note) => ({ ...note, group: note.group ?? "" })));
      } else {
        await saveNotesToDirectory(directory, notes);
      }
      setStorageReady(true);
    })();
  }, []);

  useEffect(() => {
    const discoveredGroups = notes.map((note) => note.group).filter(Boolean);
    if (discoveredGroups.every((group) => settings.groups.includes(group))) return;
    setSettings((current) => ({
      ...current,
      groups: Array.from(new Set([...current.groups, ...discoveredGroups])),
    }));
  }, [notes, settings.groups]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const updateSystemTheme = () => setSystemDark(media.matches);
    media.addEventListener("change", updateSystemTheme);
    return () => media.removeEventListener("change", updateSystemTheme);
  }, []);

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    const cleanup: Array<() => void> = [];
    void (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      cleanup.push(
        await listen<Note>("leenote:note-updated", (event) => {
          setNotes((current) =>
            current.map((note) => (note.id === event.payload.id ? event.payload : note)),
          );
        }),
      );
      cleanup.push(
        await listen<{ noteId: string }>("leenote:note-reattach", (event) => {
          setSettings((current) => {
            const detachedNotes = { ...current.detachedNotes };
            delete detachedNotes[event.payload.noteId];
            return { ...current, detachedNotes };
          });
          setActiveId(event.payload.noteId);
        }),
      );
      cleanup.push(
        await listen<{ noteId: string; x: number; y: number }>(
          "leenote:note-window-moved",
          (event) => {
            setSettings((current) => {
              if (!current.detachedNotes[event.payload.noteId]) return current;
              return {
                ...current,
                detachedNotes: {
                  ...current.detachedNotes,
                  [event.payload.noteId]: {
                    ...current.detachedNotes[event.payload.noteId],
                    x: event.payload.x,
                    y: event.payload.y,
                  },
                },
              };
            });
          },
        ),
      );
      cleanup.push(
        await listen<{ noteId: string; layer: WindowLayer }>(
          "leenote:note-window-layer",
          (event) => {
            setSettings((current) => {
              const detached = current.detachedNotes[event.payload.noteId];
              if (!detached) return current;
              return {
                ...current,
                detachedNotes: {
                  ...current.detachedNotes,
                  [event.payload.noteId]: { ...detached, layer: event.payload.layer },
                },
              };
            });
          },
        ),
      );
    })();
    return () => cleanup.forEach((unlisten) => unlisten());
  }, []);

  useEffect(() => {
    for (const [noteId, position] of Object.entries(settings.detachedNotes)) {
      const note = notes.find((candidate) => candidate.id === noteId);
      if (note) {
        void openDetachedNoteWindow(note, position).catch(() => {
          setSettings((current) => {
            if (!current.detachedNotes[noteId]) return current;
            const detachedNotes = { ...current.detachedNotes };
            delete detachedNotes[noteId];
            return { ...current, detachedNotes };
          });
        });
      }
    }
  }, [notes, settings.detachedNotes]);

  const addNote = useCallback(() => {
    const note = createNote();
    setNotes((current) => [note, ...current]);
    setActiveId(note.id);
    setQuery("");
    setListFilter("all");
    window.setTimeout(() => titleInput.current?.select(), 0);
  }, []);

  const addNoteToGroup = (groupKey: string) => {
    const group = groupKey === "__ungrouped__" ? "" : groupKey;
    const note = { ...createNote(), group };
    setNotes((current) => [note, ...current]);
    setActiveId(note.id);
    setQuery("");
    setListFilter("all");
    setExpandedGroups((current) => new Set(current).add(groupKey));
    window.setTimeout(() => titleInput.current?.select(), 0);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const modifier = event.metaKey || event.ctrlKey;
      if (modifier && event.key.toLowerCase() === "n") {
        event.preventDefault();
        addNote();
      }
      if (modifier && event.key.toLowerCase() === "f") {
        event.preventDefault();
        document.querySelector<HTMLInputElement>("#note-search")?.focus();
      }
      if (modifier && event.key === "Enter") {
        event.preventDefault();
        setSettings((current) => ({
          ...current,
          viewMode: current.viewMode === "preview" ? "edit" : "preview",
        }));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("leenote:new-note", addNote);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("leenote:new-note", addNote);
    };
  }, [addNote]);

  const updateNote = (noteId: string, patch: Partial<Note>) => {
    setNotes((current) =>
      current.map((note) =>
        note.id === noteId ? { ...note, ...patch, updatedAt: Date.now() } : note,
      ),
    );
  };

  const updateActive = (patch: Partial<Note>) => {
    if (activeNote) updateNote(activeNote.id, patch);
  };

  const createGroup = (assignActiveNote = false) => {
    const name = window.prompt("新建分组名称")?.trim();
    if (!name) return;
    setSettings((current) => ({
      ...current,
      groups: current.groups.includes(name) ? current.groups : [...current.groups, name],
    }));
    if (assignActiveNote && activeNote) updateActive({ group: name });
    setExpandedGroups((current) => new Set(current).add(name));
  };

  const renameActiveGroup = () => {
    const currentGroup = activeNote?.group;
    if (!currentGroup) return;
    const name = window.prompt("重命名分组", currentGroup)?.trim();
    if (!name || name === currentGroup) return;
    setNotes((current) =>
      current.map((note) =>
        note.group === currentGroup ? { ...note, group: name, updatedAt: Date.now() } : note,
      ),
    );
    setSettings((current) => ({
      ...current,
      groups: Array.from(new Set(current.groups.map((group) => (group === currentGroup ? name : group)))),
    }));
    setExpandedGroups((current) => {
      const next = new Set(current);
      if (next.delete(currentGroup)) next.add(name);
      return next;
    });
  };

  const deleteActiveGroup = () => {
    const currentGroup = activeNote?.group;
    if (!currentGroup || !window.confirm(`删除分组“${currentGroup}”？分组内便签将移到未分组。`)) return;
    setNotes((current) =>
      current.map((note) =>
        note.group === currentGroup ? { ...note, group: "", updatedAt: Date.now() } : note,
      ),
    );
    setSettings((current) => ({
      ...current,
      groups: current.groups.filter((group) => group !== currentGroup),
    }));
    setExpandedGroups((current) => {
      const next = new Set(current);
      next.delete(currentGroup);
      return next;
    });
  };

  const filteredNotes = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return notes
      .filter((note) => !detachedNoteIds.has(note.id))
      .filter((note) => (listFilter === "archived" ? note.archived : !note.archived))
      .filter((note) => listFilter !== "favorites" || note.pinned)
      .filter((note) => !needle || `${note.title}\n${note.content}`.toLocaleLowerCase().includes(needle))
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt);
  }, [detachedNoteIds, listFilter, notes, query]);

  const favoriteCount = useMemo(
    () => notes.filter((note) => note.pinned && !note.archived).length,
    [notes],
  );

  const archivedCount = useMemo(() => notes.filter((note) => note.archived).length, [notes]);

  const toggleArchiveActive = () => {
    if (!activeNote) return;
    if (activeNote.archived) {
      updateActive({ archived: false });
      setListFilter("all");
      return;
    }
    const remaining = notes.filter((note) => note.id !== activeNote.id && !note.archived);
    updateActive({ archived: true });
    if (remaining[0]) setActiveId(remaining[0].id);
    else addNote();
  };

  const deleteActive = () => {
    if (!activeNote || !window.confirm(`永久删除“${activeNote.title || "无标题"}”？`)) return;
    const remaining = notes.filter((note) => note.id !== activeNote.id);
    if (remaining.length === 0) {
      const replacement = createNote();
      setNotes([replacement]);
      setActiveId(replacement.id);
      return;
    }
    setNotes(remaining);
    setActiveId(remaining.find((note) => !note.archived)?.id ?? remaining[0].id);
  };

  const cycleLayer = () => {
    const layers: WindowLayer[] = ["normal", "top", "bottom"];
    setSettings((current) => ({
      ...current,
      windowLayer: layers[(layers.indexOf(current.windowLayer) + 1) % layers.length],
    }));
  };

  const setViewMode = (viewMode: ViewMode) => setSettings((current) => ({ ...current, viewMode }));

  const exportActive = () => {
    if (!activeNote) return;
    const safeName = (activeNote.title || "无标题").replace(/[\\/:*?"<>|]/g, "-");
    const blob = new Blob([activeNote.content], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${safeName}.md`;
    anchor.click();
    URL.revokeObjectURL(url);
    setShowMore(false);
  };

  const importMarkdown = async (file: File) => {
    const content = await file.text();
    const note = createNote({ title: file.name.replace(/\.md$/i, ""), content });
    setNotes((current) => [note, ...current]);
    setActiveId(note.id);
    setQuery("");
    setShowMore(false);
  };

  const changeStorageDirectory = async () => {
    const directory = await chooseStorageDirectory();
    if (!directory || directory === settings.storagePath) return;
    await saveNotesToDirectory(directory, notes);
    setSettings((current) => ({ ...current, storagePath: directory }));
  };

  const revealStorageDirectory = () => {
    if (settings.storagePath) void openStorageDirectory(settings.storagePath);
  };

  const effectiveTheme = settings.theme === "system" ? (systemDark ? "dark" : "light") : settings.theme;

  const handleTitlebarMouseDown = (event: ReactMouseEvent<HTMLElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest("button")) return;
    event.preventDefault();
    void startWindowDragging();
  };

  const beginDesktopDrag = (event: ReactPointerEvent<HTMLElement>, note: Note) => {
    if (event.button !== 0) return;
    pointerDrag.current = {
      note,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      dragging: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const updateDesktopDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = pointerDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (!drag.dragging) {
      const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
      if (distance < 5) return;
      drag.dragging = true;
      setDraggingNoteId(drag.note.id);
    }
    event.preventDefault();
  };

  const finishDesktopDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = pointerDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    pointerDrag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDraggingNoteId(null);
    if (!drag.dragging) {
      setActiveId(drag.note.id);
      return;
    }
    event.preventDefault();
    const outsideMainWindow =
      event.clientX <= 0 ||
      event.clientY <= 0 ||
      event.clientX >= window.innerWidth - 1 ||
      event.clientY >= window.innerHeight - 1;
    if (!outsideMainWindow || (event.screenX === 0 && event.screenY === 0)) return;

    const position = {
      x: Math.max(0, event.screenX - 36),
      y: Math.max(0, event.screenY - 22),
      layer: "normal" as WindowLayer,
    };
    setSettings((current) => ({
      ...current,
      detachedNotes: { ...current.detachedNotes, [drag.note.id]: position },
    }));
  };

  const cancelDesktopDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (pointerDrag.current?.pointerId !== event.pointerId) return;
    pointerDrag.current = null;
    setDraggingNoteId(null);
  };

  const toggleGroupNode = (group: string) => {
    setExpandedGroups((current) => {
      const next = new Set(current);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  };

  const renderTreeNote = (note: Note) => (
    <div
      className={`note-row tree-note-row ${note.id === activeNote?.id ? "active" : ""} ${draggingNoteId === note.id ? "is-dragging" : ""}`}
      key={note.id}
      role="button"
      tabIndex={0}
      onPointerDown={(event) => beginDesktopDrag(event, note)}
      onPointerMove={updateDesktopDrag}
      onPointerUp={finishDesktopDrag}
      onPointerCancel={cancelDesktopDrag}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          setActiveId(note.id);
        }
      }}
    >
      <GripHorizontal className="note-drag-handle" size={14} />
      <span className={`note-dot color-${note.color}`} />
      <span className="note-copy">
        <span className="note-row-title">
          {note.title || "无标题"}
          {note.pinned && <Star size={12} fill="currentColor" />}
        </span>
        <span className="note-row-excerpt">{excerpt(note.content) || "空白便签"}</span>
      </span>
      <span className="note-time">{formatTime(note.updatedAt)}</span>
    </div>
  );

  return (
    <main
      className={`app-shell ${isMacOS ? "app-shell-macos" : "app-shell-windows"} note-${activeNote?.color ?? "sun"}`}
    >
      <input
        ref={importInput}
        className="file-input"
        type="file"
        accept=".md,.markdown,text/markdown,text/plain"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void importMarkdown(file);
          event.target.value = "";
        }}
      />
      <header
        className={`titlebar ${isMacOS ? "titlebar-macos" : "titlebar-windows"}`}
        onMouseDown={handleTitlebarMouseDown}
      >
        {isMacOS && (
          <div className="traffic-lights">
            <button className="traffic close" onClick={() => void closeWindow()} aria-label="隐藏窗口" />
            <button className="traffic minimize" onClick={() => void minimizeWindow()} aria-label="最小化" />
            <button
              className="traffic zoom"
              onClick={() => void toggleMaximizeWindow()}
              aria-label="最大化或还原"
            />
          </div>
        )}
        <button
          className="icon-button sidebar-toggle"
          onClick={() => setSettings((current) => ({ ...current, sidebarOpen: !current.sidebarOpen }))}
          title={settings.sidebarOpen ? "收起便签列表" : "展开便签列表"}
        >
          {settings.sidebarOpen ? <PanelLeftClose size={17} /> : <PanelLeftOpen size={17} />}
        </button>
        <div className="drag-title">
          <span className="brand-mark" aria-hidden="true">
            <img src={leeNoteLogo} alt="" />
          </span>
          <span>LeeNote</span>
        </div>
        <div className="window-actions">
          <span className={`save-state ${saved ? "is-saved" : ""}`}>
            {saved ? "已保存" : "保存中…"}
          </span>
          <button className="layer-button" onClick={cycleLayer} title="切换窗口层级">
            <Layers2 size={15} />
            {layerLabels[settings.windowLayer]}
          </button>
        </div>
        {!isMacOS && (
          <div className="windows-caption-buttons">
            <button onClick={() => void minimizeWindow()} aria-label="最小化" title="最小化">
              <Minus size={16} strokeWidth={1.5} />
            </button>
            <button onClick={() => void toggleMaximizeWindow()} aria-label="最大化或还原" title="最大化或还原">
              <Square size={12} strokeWidth={1.5} />
            </button>
            <button
              className="windows-close"
              onClick={() => void closeWindow()}
              aria-label="关闭"
              title="关闭"
            >
              <X size={17} strokeWidth={1.5} />
            </button>
          </div>
        )}
      </header>

      <div className="workspace">
        <aside className={`sidebar ${settings.sidebarOpen ? "is-open" : ""}`}>
          <div className="sidebar-head">
            <div className="search-box">
              <Search size={15} />
              <input
                id="note-search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索便签"
              />
              {query && (
                <button onClick={() => setQuery("")} aria-label="清除搜索">
                  <X size={14} />
                </button>
              )}
            </div>
            <button className="new-note" onClick={addNote} title="新建便签 (⌘/Ctrl+N)">
              <Plus size={18} />
            </button>
          </div>

          <nav className="note-filters" aria-label="便签筛选">
            <button
              className={listFilter === "all" ? "active" : ""}
              onClick={() => setListFilter("all")}
            >
              全部
              <span>{notes.filter((note) => !note.archived).length}</span>
            </button>
            <button
              className={listFilter === "favorites" ? "active" : ""}
              onClick={() => setListFilter("favorites")}
            >
              <Star size={13} fill={listFilter === "favorites" ? "currentColor" : "none"} />
              收藏
              <span>{favoriteCount}</span>
            </button>
            <button
              className={listFilter === "archived" ? "active" : ""}
              onClick={() => setListFilter("archived")}
            >
              <Archive size={13} />
              归档
              <span>{archivedCount}</span>
            </button>
          </nav>

          <div className="note-list group-tree">
            <div className="group-tree-root">
              <button onClick={() => setGroupTreeOpen((open) => !open)}>
                {groupTreeOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <Folder size={14} />
                <span>全部便签</span>
                <small>{filteredNotes.length}</small>
              </button>
              <button className="group-tree-add" onClick={() => createGroup()} title="新建分组" aria-label="新建分组">
                <FolderPlus size={15} />
              </button>
            </div>
            {groupTreeOpen && (
              <div className="group-tree-branches">
                {[
                  { key: "__ungrouped__", label: "未分组", notes: filteredNotes.filter((note) => !note.group) },
                  ...groups.map((group) => ({
                    key: group,
                    label: group,
                    notes: filteredNotes.filter((note) => note.group === group),
                  })),
                ].map((branch) => {
                  const expanded = expandedGroups.has(branch.key);
                  return (
                    <section
                      className="group-tree-branch"
                      key={branch.key}
                    >
                      <div className="group-tree-branch-head">
                        <button className="group-tree-node" onClick={() => toggleGroupNode(branch.key)}>
                          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                          <Folder size={13} />
                          <span>{branch.label}</span>
                          <small>{branch.notes.length}</small>
                        </button>
                        <button
                          className="group-note-add"
                          onClick={() => addNoteToGroup(branch.key)}
                          title={`在${branch.label}中新建便签`}
                          aria-label={`在${branch.label}中新建便签`}
                        >
                          <Plus size={14} />
                        </button>
                      </div>
                      {expanded && <div className="group-tree-notes">{branch.notes.map(renderTreeNote)}</div>}
                    </section>
                  );
                })}
              </div>
            )}
            {filteredNotes.length === 0 && (
              <div className="empty-search">
                {listFilter === "favorites" && !query ? (
                  <Star size={22} />
                ) : listFilter === "archived" && !query ? (
                  <Archive size={22} />
                ) : (
                  <Search size={22} />
                )}
                <p>
                  {listFilter === "favorites" && !query
                    ? "还没有收藏便签"
                    : listFilter === "archived" && !query
                      ? "还没有归档便签"
                      : "没有找到匹配的便签"}
                </p>
              </div>
            )}
          </div>

          <div className="sidebar-footer">
            <span>{filteredNotes.length} 张便签</span>
            <div className="footer-actions">
              <div className="theme-toggle" aria-label="外观主题">
                <button
                  className={effectiveTheme === "light" ? "active" : ""}
                  onClick={() => setSettings((current) => ({ ...current, theme: "light" }))}
                  title="明亮模式"
                >
                  <Sun size={14} />
                </button>
                <button
                  className={effectiveTheme === "dark" ? "active" : ""}
                  onClick={() => setSettings((current) => ({ ...current, theme: "dark" }))}
                  title="暗黑模式"
                >
                  <Moon size={14} />
                </button>
              </div>
              <button
                className={`settings-button ${showSettings ? "active" : ""}`}
                onClick={() => setShowSettings((value) => !value)}
                title="设置"
              >
                <SettingsIcon size={16} />
              </button>
            </div>
            {showSettings && (
              <div className="settings-popover">
                <div className="settings-title">
                  <span>设置</span>
                  <button onClick={() => setShowSettings(false)} aria-label="关闭设置">
                    <X size={14} />
                  </button>
                </div>
                <label>编辑视图</label>
                <div className="settings-options">
                  {(["edit", "split", "preview"] as ViewMode[]).map((mode) => (
                    <button
                      key={mode}
                      className={settings.viewMode === mode ? "active" : ""}
                      onClick={() => setViewMode(mode)}
                    >
                      {{ edit: "编辑", split: "分栏", preview: "预览" }[mode]}
                    </button>
                  ))}
                </div>
                <label>窗口层级</label>
                <div className="settings-options">
                  {(["bottom", "normal", "top"] as WindowLayer[]).map((layer) => (
                    <button
                      key={layer}
                      className={settings.windowLayer === layer ? "active" : ""}
                      onClick={() => setSettings((current) => ({ ...current, windowLayer: layer }))}
                    >
                      {{ bottom: "桌面", normal: "普通", top: "置顶" }[layer]}
                    </button>
                  ))}
                </div>
                <label>保存路径</label>
                <div className="storage-path-setting">
                  <div className="storage-path-value" title={settings.storagePath}>
                    <FolderOpen size={14} />
                    <span>{settings.storagePath || "正在准备默认目录…"}</span>
                  </div>
                  <div className="storage-path-actions">
                    <button onClick={() => void changeStorageDirectory()}>更改目录</button>
                    <button onClick={revealStorageDirectory} disabled={!settings.storagePath}>
                      打开目录
                    </button>
                  </div>
                  <span className="storage-format-hint">每篇便签保存为独立 Markdown 文件</span>
                </div>
                <button
                  className="system-theme-button"
                  onClick={() => setSettings((current) => ({ ...current, theme: "system" }))}
                >
                  跟随系统外观
                  {settings.theme === "system" && <Check size={14} />}
                </button>
              </div>
            )}
          </div>
        </aside>

        <section className="note-stage">
          {activeNote ? (
            <>
              <div className="note-toolbar">
                <div className="note-meta">
                  <button
                    className={`icon-button ${activeNote.pinned ? "active" : ""}`}
                    onClick={() => updateActive({ pinned: !activeNote.pinned })}
                    title={activeNote.pinned ? "取消收藏" : "收藏便签"}
                  >
                    <Star size={16} fill={activeNote.pinned ? "currentColor" : "none"} />
                  </button>
                  <div className="note-color-picker" aria-label="便签颜色">
                    {colors.map((color) => (
                      <button
                        key={color}
                        className={`color-choice color-${color} ${activeNote.color === color ? "active" : ""}`}
                        onClick={() => updateActive({ color })}
                        aria-label={`选择 ${color} 颜色`}
                        aria-pressed={activeNote.color === color}
                      >
                        {activeNote.color === color && <Check size={12} />}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="view-switcher" aria-label="编辑模式">
                  <button
                    className={settings.viewMode === "edit" ? "active" : ""}
                    onClick={() => setViewMode("edit")}
                    title="编辑"
                  >
                    <FilePenLine size={15} />
                  </button>
                  <button
                    className={settings.viewMode === "split" ? "active" : ""}
                    onClick={() => setViewMode("split")}
                    title="分栏"
                  >
                    <Maximize2 size={14} />
                  </button>
                  <button
                    className={settings.viewMode === "preview" ? "active" : ""}
                    onClick={() => setViewMode("preview")}
                    title="预览"
                  >
                    <Eye size={15} />
                  </button>
                </div>

                <div className="note-actions">
                  <button
                    className="icon-button"
                    onClick={toggleArchiveActive}
                    title={activeNote.archived ? "恢复到全部便签" : "归档"}
                  >
                    {activeNote.archived ? <ArchiveRestore size={16} /> : <Archive size={16} />}
                  </button>
                  <button className="icon-button danger" onClick={deleteActive} title="删除">
                    <Trash2 size={16} />
                  </button>
                  <button
                    className={`icon-button ${showMore ? "active" : ""}`}
                    title="更多"
                    onClick={() => setShowMore((value) => !value)}
                  >
                    <MoreHorizontal size={17} />
                  </button>
                  {showMore && (
                    <div className="more-popover">
                      <button onClick={() => importInput.current?.click()}>
                        <FileUp size={15} />
                        导入 Markdown
                      </button>
                      <button onClick={exportActive}>
                        <FileDown size={15} />
                        导出为 .md
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <div className="note-heading">
                <input
                  ref={titleInput}
                  className="title-input"
                  value={activeNote.title}
                  onChange={(event) => updateActive({ title: event.target.value })}
                  placeholder="便签标题"
                  spellCheck={false}
                />
                <div className="note-heading-meta">
                  <span className="updated-at">编辑于 {formatTime(activeNote.updatedAt)}</span>
                  <div className="note-group-setting" aria-label="所属分组">
                    <Folder size={13} />
                    <select
                      value={activeNote.group}
                      onChange={(event) => updateActive({ group: event.target.value })}
                      title="修改所属分组"
                    >
                      <option value="">未分组</option>
                      {groups.map((group) => (
                        <option key={group} value={group}>{group}</option>
                      ))}
                    </select>
                    <button onClick={() => createGroup(true)} title="新建分组并移入" aria-label="新建分组并移入">
                      <FolderPlus size={14} />
                    </button>
                    <button
                      onClick={renameActiveGroup}
                      disabled={!activeNote.group}
                      title="重命名当前分组"
                      aria-label="重命名当前分组"
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      className="danger"
                      onClick={deleteActiveGroup}
                      disabled={!activeNote.group}
                      title="删除当前分组"
                      aria-label="删除当前分组"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              </div>

              <div className={`editor-area mode-${settings.viewMode}`}>
                {(settings.viewMode === "edit" || settings.viewMode === "split") && (
                  <textarea
                    className="markdown-editor"
                    value={activeNote.content}
                    onChange={(event) => updateActive({ content: event.target.value })}
                    placeholder="开始记录…支持 Markdown"
                    spellCheck
                  />
                )}
                {(settings.viewMode === "preview" || settings.viewMode === "split") && (
                  <article
                    className="markdown-preview"
                    dangerouslySetInnerHTML={{ __html: renderMarkdown(activeNote.content) }}
                  />
                )}
              </div>

              <footer className="statusbar">
                <span>Markdown</span>
                <span>{activeNote.content.length} 字符</span>
                <span>{activeNote.content.split(/\s+/).filter(Boolean).length} 词</span>
              </footer>
            </>
          ) : (
            <div className="empty-state">
              <Menu size={28} />
              <p>选择或新建一张便签</p>
              <button onClick={addNote}>新建便签</button>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
