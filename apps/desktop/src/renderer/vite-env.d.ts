import type { OverlayApi } from "../preload/index";

declare global {
  interface Window {
    overlay: OverlayApi;
  }
}

export {};
