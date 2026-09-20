import { invoke } from "@tauri-apps/api/core";
import type { Note } from "./types";
import { isTauri } from "./window";

export async function getDefaultStorageDirectory() {
  if (!isTauri()) return "";
  return invoke<string>("default_storage_directory");
}

export async function chooseStorageDirectory() {
  if (!isTauri()) return null;
  return invoke<string | null>("choose_storage_directory");
}

export async function loadNotesFromDirectory(directory: string) {
  if (!isTauri() || !directory) return null;
  return invoke<Note[] | null>("load_notes_file", { directory });
}

export async function saveNotesToDirectory(directory: string, notes: Note[]) {
  if (!isTauri() || !directory) return;
  await invoke("save_notes_file", { directory, notes });
}

export async function openStorageDirectory(directory: string) {
  if (!isTauri() || !directory) return;
  await invoke("open_storage_directory", { directory });
}
