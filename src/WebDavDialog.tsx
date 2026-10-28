import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { CloudDownload, CloudUpload, X } from "lucide-react";
import { createBackup, parseBackup, type NoteBackup } from "./backup";
import type { Note } from "./types";

interface WebDavConfig {
  url: string;
  username: string;
  directory: string;
}

interface StoredConfig {
  config: WebDavConfig;
  hasPassword: boolean;
}

interface Props {
  ready: boolean;
  getSnapshot: () => { notes: Note[]; groups: string[] };
  onRestore: (backup: NoteBackup) => void;
  onClose: () => void;
}

const emptyConfig: WebDavConfig = { url: "", username: "", directory: "LeeNote" };

export default function WebDavDialog({ ready, getSnapshot, onRestore, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const operation = useRef(false);
  const [config, setConfig] = useState(emptyConfig);
  const [stored, setStored] = useState<StoredConfig | null>(null);
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<NoteBackup | null>(null);
  const dirty = !stored || JSON.stringify(config) !== JSON.stringify(stored.config) || password.length > 0;
  const hasSavedPassword = stored?.hasPassword && config.url === stored.config.url && config.username === stored.config.username;

  useEffect(() => {
    dialog.current?.showModal();
    let disposed = false;
    void invoke<StoredConfig>("load_webdav_config").then((value) => {
      if (disposed) return;
      setStored(value);
      setConfig(value.config);
    }).catch((reason: unknown) => {
      if (!disposed) setError(String(reason));
    }).finally(() => { if (!disposed) setLoading(false); });
    return () => { disposed = true; };
  }, []);

  const run = async (label: string, action: () => Promise<void>) => {
    if (operation.current || loading) return;
    operation.current = true;
    setBusy(label);
    setMessage("");
    setError("");
    try { await action(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { operation.current = false; setBusy(""); }
  };

  const changeConfig = (patch: Partial<WebDavConfig>) => {
    setConfig((current) => ({ ...current, ...patch }));
    setPreview(null);
    setMessage("");
    setError("");
  };

  const save = () => run("保存配置…", async () => {
    const value = await invoke<StoredConfig>("save_webdav_config", {
      config, password: password || null,
    });
    setStored(value);
    setConfig(value.config);
    setPassword("");
    setPreview(null);
    setMessage("配置已保存，密码由系统凭据库保管。");
  });

  const test = () => run("连接中…", async () => {
    await invoke("test_webdav_connection", { config, password: password || null });
    setMessage("连接成功，服务器支持 WebDAV。备份操作将确认目录写入权限。");
  });

  const upload = () => run("正在备份…", async () => {
    const snapshot = getSnapshot();
    const backup = createBackup(snapshot.notes, snapshot.groups);
    await invoke("upload_webdav_backup", { content: JSON.stringify(backup, null, 2) });
    setPreview(null);
    setMessage(`备份成功：${backup.notes.length} 篇便签，${backup.groups.length} 个分组 · ${new Date(backup.createdAt).toLocaleString()}`);
  });

  const download = () => run("读取远程备份…", async () => {
    setPreview(null);
    const content = await invoke<string>("download_webdav_backup");
    setPreview(parseBackup(content));
  });

  const restore = () => run("合并恢复…", async () => {
    if (!preview) return;
    onRestore(preview);
    setPreview(null);
    setMessage("合并完成，便签和分组已加入本地数据，内容冲突的便签已保留恢复副本。");
  });

  return (
    <dialog ref={dialog} className="webdav-dialog" aria-labelledby="webdav-title"
      onCancel={(event) => { event.preventDefault(); if (!operation.current) onClose(); }}>
      <div className="webdav-heading">
        <div><h2 id="webdav-title">WebDAV 备份</h2><p>将全部便签和分组备份到你的 WebDAV 存储。</p></div>
        <button className="webdav-close" onClick={onClose} disabled={Boolean(busy)} aria-label="关闭 WebDAV 备份"><X size={18} /></button>
      </div>
      <fieldset disabled={loading || Boolean(busy)}>
        <label htmlFor="webdav-url">服务器地址</label>
        <input id="webdav-url" type="url" autoComplete="url" placeholder="https://dav.example.com/dav/"
          value={config.url} onChange={(event) => changeConfig({ url: event.target.value })} />
        <div className="webdav-fields">
          <div><label htmlFor="webdav-username">用户名</label>
            <input id="webdav-username" autoComplete="username" value={config.username}
              onChange={(event) => changeConfig({ username: event.target.value })} /></div>
          <div><label htmlFor="webdav-password">密码 / 应用专用密码</label>
            <input id="webdav-password" type="password" autoComplete="new-password" value={password}
              placeholder={hasSavedPassword ? "已保存，留空沿用" : "请输入密码"}
              onChange={(event) => { setPassword(event.target.value); setPreview(null); }} /></div>
        </div>
        <label htmlFor="webdav-directory">备份目录</label>
        <input id="webdav-directory" value={config.directory} placeholder="LeeNote"
          onChange={(event) => changeConfig({ directory: event.target.value })} />
        <p className="webdav-hint">目录会自动创建；文件名为 leenote-backup.json，每次备份更新此文件。</p>
        <div className="webdav-actions">
          <button onClick={() => void test()} disabled={!config.url.trim()}>测试连接</button>
          <button onClick={() => void save()} disabled={!config.url.trim() || !dirty}>保存配置</button>
        </div>
      </fieldset>
      <div className="webdav-backup-section">
        <p className="webdav-hint">备份包含便签原文（含已加锁便签）。建议使用 HTTPS 和可信存储。</p>
        {dirty && !loading && <p className="webdav-hint">保存当前配置后即可备份或恢复。</p>}
        {!ready && <p className="webdav-hint">正在加载本地便签…</p>}
        <div className="webdav-actions">
          <button className="webdav-primary" disabled={loading || Boolean(busy) || dirty || !ready || !config.url}
            onClick={() => void upload()}><CloudUpload size={16} />立即备份</button>
          <button disabled={loading || Boolean(busy) || dirty || !ready || !config.url}
            onClick={() => void download()}><CloudDownload size={16} />读取远程备份</button>
        </div>
      </div>
      {preview && <div className="webdav-preview">
        <strong>远程备份 · {new Date(preview.createdAt).toLocaleString()}</strong>
        <p>{preview.notes.length} 篇便签 · {preview.groups.length} 个分组</p>
        <p>本地便签继续保留，相同 ID 的冲突内容以“WebDAV 恢复”副本加入。</p>
        <div className="webdav-actions">
          <button disabled={Boolean(busy)} onClick={() => setPreview(null)}>取消</button>
          <button className="webdav-primary" disabled={Boolean(busy) || !ready || dirty} onClick={() => void restore()}>合并恢复</button>
        </div>
      </div>}
      <div className="webdav-status" role="status" aria-live="polite">{loading ? "正在加载配置…" : busy || message}</div>
      {error && <p className="webdav-error" role="alert">{error}</p>}
    </dialog>
  );
}
