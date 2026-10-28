import type { Note, NoteLock } from "./types";

export interface NoteBackup {
  app: "LeeNote";
  version: 1;
  createdAt: number;
  notes: Note[];
  groups: string[];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 8.64e15;
}

function parseLock(value: unknown): NoteLock | undefined {
  if (value === undefined) return undefined;
  if (!isObject(value) || value.version !== 1 || value.algorithm !== "PBKDF2-SHA-256"
    || !Number.isInteger(value.iterations) || (value.iterations as number) < 1
    || (value.iterations as number) > 2_000_000
    || typeof value.salt !== "string" || typeof value.hash !== "string") {
    throw new Error("备份中的便签密码数据无效");
  }
  try {
    if (atob(value.salt).length !== 16 || atob(value.hash).length !== 32) throw new Error();
  } catch {
    throw new Error("备份中的便签密码数据无效");
  }
  return {
    version: 1, algorithm: "PBKDF2-SHA-256", iterations: value.iterations as number,
    salt: value.salt, hash: value.hash,
  };
}

export function parseBackup(content: string): NoteBackup {
  let value: unknown;
  try { value = JSON.parse(content); } catch { throw new Error("远程备份 JSON 格式无效"); }
  if (!isObject(value) || value.app !== "LeeNote" || value.version !== 1
    || !isTimestamp(value.createdAt) || !Array.isArray(value.notes)
    || !Array.isArray(value.groups) || !value.groups.every((group) => typeof group === "string")) {
    throw new Error("请选择 LeeNote v1 格式的备份文件");
  }
  const ids = new Set<string>();
  const notes = value.notes.map((note: unknown): Note => {
    if (!isObject(note) || typeof note.id !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(note.id) || ids.has(note.id)
      || typeof note.title !== "string" || typeof note.content !== "string"
      || typeof note.color !== "string" || !["sun", "mint", "sky", "rose", "lavender", "paper"].includes(note.color)
      || typeof note.pinned !== "boolean" || typeof note.archived !== "boolean"
      || typeof note.group !== "string" || !isTimestamp(note.createdAt) || !isTimestamp(note.updatedAt)) {
      throw new Error("备份中的便签数据无效或包含重复 ID");
    }
    ids.add(note.id);
    return {
      id: note.id, title: note.title, content: note.content, color: note.color as Note["color"],
      pinned: note.pinned, archived: note.archived, group: note.group,
      createdAt: note.createdAt, updatedAt: note.updatedAt, lock: parseLock(note.lock),
    };
  });
  return {
    app: "LeeNote", version: 1, createdAt: value.createdAt, notes,
    groups: Array.from(new Set([...value.groups as string[], ...notes.map((note) => note.group)].filter(Boolean))),
  };
}

export function createBackup(notes: Note[], groups: string[]): NoteBackup {
  // Round-trip through the parser so uploads and downloads share the same schema.
  return parseBackup(JSON.stringify({ app: "LeeNote", version: 1, createdAt: Date.now(), notes, groups }));
}

function noteContents(note: Note) {
  return JSON.stringify([note.title, note.content, note.color, note.pinned, note.archived, note.group, note.lock ?? null]);
}

export function mergeBackup(current: Note[], backup: NoteBackup): Note[] {
  const byId = new Map(current.map((note) => [note.id, note]));
  const additions: Note[] = [];
  for (const note of backup.notes) {
    const existing = byId.get(note.id);
    if (!existing) {
      additions.push(note);
    } else if (noteContents(existing) !== noteContents(note)) {
      const restored = { ...note, title: `${note.title || "无标题"}（WebDAV 恢复）` };
      // Repeating a restore should reuse an identical conflict copy.
      if (!current.some((candidate) => noteContents(candidate) === noteContents(restored))) {
        additions.push({ ...restored, id: crypto.randomUUID() });
      }
    }
  }
  return [...additions, ...current];
}
