import { getCurrentWindow } from "@tauri-apps/api/window";
import type { WindowLayer } from "./types";

export function isTauri() {
  return "__TAURI_INTERNALS__" in window;
}

export async function applyWindowLayer(layer: WindowLayer) {
  if (!isTauri()) return;
  const appWindow = getCurrentWindow();
  await appWindow.setAlwaysOnTop(layer === "top");
  await appWindow.setAlwaysOnBottom(layer === "bottom");
}

export async function minimizeWindow() {
  if (!isTauri()) return;
  await getCurrentWindow().minimize();
}

export async function startWindowDragging() {
  if (!isTauri()) return;
  await getCurrentWindow().startDragging();
}

export async function toggleMaximizeWindow() {
  if (!isTauri()) return;
  await getCurrentWindow().toggleMaximize();
}

export async function closeWindow() {
  if (!isTauri()) return;
  await getCurrentWindow().hide();
}
