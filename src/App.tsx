import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  ArchiveRestore,
  Check,
  ChevronLeft,
  Eye,
  FileDown,
  FilePenLine,
  FileUp,
  Layers2,
  Maximize2,
  Menu,
  Minus,
  Moon,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Settings as SettingsIcon,
  Star,
  Sun,
  Trash2,
  X,
} from "lucide-react";
import { createNote, loadNotes, loadSettings, saveNotes, saveSettings } from "./data";
import { renderMarkdown } from "./markdown";
import type { Note, NoteColor, Settings, ViewMode, WindowLayer } from "./types";
import { applyWindowLayer, closeWindow, minimizeWindow } from "./window";

const colors: NoteColor[] = ["sun", "mint", "sky", "rose", "lavender", "paper"];

const layerLabels: Record<WindowLayer, string> = {
  bottom: "桌面层",
  normal: "普通层",
  top: "置顶层",
};

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
  const [showMore, setShowMore] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [systemDark, setSystemDark] = useState(() =>
    window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const [saved, setSaved] = useState(true);
  const titleInput = useRef<HTMLInputElement>(null);
  const importInput = useRef<HTMLInputElement>(null);

  const activeNote = notes.find((note) => note.id === activeId) ?? notes[0];

  useEffect(() => {
    setSaved(false);
    const timer = window.setTimeout(() => {
      saveNotes(notes);
      setSaved(true);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [notes]);

  useEffect(() => {
    saveSettings(settings);
    document.documentElement.dataset.theme = settings.theme;
    void applyWindowLayer(settings.windowLayer);
  }, [settings]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const updateSystemTheme = () => setSystemDark(media.matches);
    media.addEventListener("change", updateSystemTheme);
    return () => media.removeEventListener("change", updateSystemTheme);
  }, []);

  const addNote = useCallback(() => {
    const note = createNote();
    setNotes((current) => [note, ...current]);
    setActiveId(note.id);
    setQuery("");
    setListFilter("all");
    window.setTimeout(() => titleInput.current?.select(), 0);
  }, []);

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

  const updateActive = (patch: Partial<Note>) => {
    if (!activeNote) return;
    setNotes((current) =>
      current.map((note) =>
        note.id === activeNote.id ? { ...note, ...patch, updatedAt: Date.now() } : note,
      ),
    );
  };

  const filteredNotes = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return notes
      .filter((note) => (listFilter === "archived" ? note.archived : !note.archived))
      .filter((note) => listFilter !== "favorites" || note.pinned)
      .filter((note) => !needle || `${note.title}\n${note.content}`.toLocaleLowerCase().includes(needle))
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt);
  }, [listFilter, notes, query]);

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

  const effectiveTheme = settings.theme === "system" ? (systemDark ? "dark" : "light") : settings.theme;

  return (
    <main className={`app-shell note-${activeNote?.color ?? "sun"}`}>
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
      <header className="titlebar" data-tauri-drag-region>
        <div className="traffic-lights" aria-hidden="true">
          <button className="traffic close" onClick={() => void closeWindow()} aria-label="隐藏窗口" />
          <button className="traffic minimize" onClick={() => void minimizeWindow()} aria-label="最小化" />
          <button className="traffic zoom" aria-label="缩放窗口" />
        </div>
        <button
          className="icon-button sidebar-toggle"
          onClick={() => setSettings((current) => ({ ...current, sidebarOpen: !current.sidebarOpen }))}
          title={settings.sidebarOpen ? "收起便签列表" : "展开便签列表"}
        >
          {settings.sidebarOpen ? <PanelLeftClose size={17} /> : <PanelLeftOpen size={17} />}
        </button>
        <div className="drag-title" data-tauri-drag-region>
          <span className="brand-mark">L</span>
          <span>LeeNote</span>
        </div>
        <div className="window-actions">
          <span className={`save-state ${saved ? "is-saved" : ""}`}>{saved ? "已保存" : "保存中…"}</span>
          <button className="layer-button" onClick={cycleLayer} title="切换窗口层级">
            <Layers2 size={15} />
            {layerLabels[settings.windowLayer]}
          </button>
        </div>
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

          <div className="note-list">
            {filteredNotes.map((note) => (
              <button
                className={`note-row ${note.id === activeNote?.id ? "active" : ""}`}
                key={note.id}
                onClick={() => setActiveId(note.id)}
              >
                <span className={`note-dot color-${note.color}`} />
                <span className="note-copy">
                  <span className="note-row-title">
                    {note.title || "无标题"}
                    {note.pinned && <Star size={12} fill="currentColor" />}
                  </span>
                  <span className="note-row-excerpt">{excerpt(note.content) || "空白便签"}</span>
                </span>
                <span className="note-time">{formatTime(note.updatedAt)}</span>
              </button>
            ))}
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
                <label>便签颜色</label>
                <div className="settings-colors" aria-label="便签颜色">
                  {colors.map((color) => (
                    <button
                      key={color}
                      className={`color-choice color-${color} ${activeNote?.color === color ? "active" : ""}`}
                      onClick={() => updateActive({ color })}
                      aria-label={`选择 ${color} 颜色`}
                      aria-pressed={activeNote?.color === color}
                    >
                      {activeNote?.color === color && <Check size={13} />}
                    </button>
                  ))}
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
                <span className="updated-at">编辑于 {formatTime(activeNote.updatedAt)}</span>
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
