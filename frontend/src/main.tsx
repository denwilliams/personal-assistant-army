import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// Apply dark mode based on system preference
if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
  document.documentElement.classList.add('dark');
}

// Listen for system theme changes
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
  if (e.matches) {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
});

const root = createRoot(document.getElementById("root")!);
root.render(<App />);
