import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./tokens.css";
import { App } from "./App";
import { tg } from "./telegram";

tg()?.ready();
tg()?.expand();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
