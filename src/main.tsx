import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { initLocale } from "@/lib/i18n";
import "./index.css";

initLocale();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
