import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import MobileApp from "./mobile/MobileApp";
import { TooltipProvider } from "@/components/ui/tooltip";
import { selectShell } from "@/lib/platform";
import { initLocale } from "@/lib/i18n";
import { primeImportedFonts, refreshImportedFonts } from "@/lib/imported-fonts";
import {
  applyChatFont,
  applyUiChrome,
  loadChatFontFamily,
  loadUiFontFamily,
  loadUiFontSize,
} from "@/lib/ui-chrome-font";
import "@fontsource-variable/geist/wght.css";
import "./index.css";

initLocale();
primeImportedFonts();
applyUiChrome(loadUiFontSize(), loadUiFontFamily());
applyChatFont(loadChatFontFamily());
void refreshImportedFonts();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <TooltipProvider>
      {selectShell() === "mobile" ? <MobileApp /> : <App />}
    </TooltipProvider>
  </React.StrictMode>,
);
