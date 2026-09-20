import type { WindowLayer } from "./types";

export function isTauri() {
  return "__TAURI_INTERNALS__" in window;
}

export async function applyWindowLayer(layer: WindowLayer) {
  if (!isTauri()) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const appWindow = getCurrentWindow();
  await appWindow.setAlwaysOnTop(layer === "top");
  await appWindow.setAlwaysOnBottom(layer === "bottom");
}

export async function minimizeWindow() {
  if (!isTauri()) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().minimize();
}

export async function closeWindow() {
  if (!isTauri()) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().hide();
}
