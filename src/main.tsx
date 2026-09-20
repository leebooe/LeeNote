import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import NoteWindow from "./NoteWindow";
import "./styles.css";

const isDetachedNoteWindow = new URLSearchParams(window.location.search).has("note");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {isDetachedNoteWindow ? <NoteWindow /> : <App />}
  </StrictMode>,
);
