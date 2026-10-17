import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import MobileApp from "./mobile/MobileApp";
import { selectShell } from "@/lib/platform";
import { initLocale } from "@/lib/i18n";
import { applyUiChrome, loadUiFontFamily, loadUiFontSize } from "@/lib/ui-chrome-font";
import "@fontsource-variable/geist/wght.css";
import "./index.css";

initLocale();
applyUiChrome(loadUiFontSize(), loadUiFontFamily());

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {selectShell() === "mobile" ? <MobileApp /> : <App />}
  </React.StrictMode>,
);
