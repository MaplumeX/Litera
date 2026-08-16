import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { initLocale } from "@/lib/i18n";
import { applyUiChrome, loadUiFontFamily, loadUiFontSize } from "@/lib/ui-chrome-font";
import "@fontsource-variable/geist/wght.css";
import "./index.css";

initLocale();
applyUiChrome(loadUiFontSize(), loadUiFontFamily());

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
