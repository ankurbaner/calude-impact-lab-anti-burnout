/**
 * Preload bridge for the recovery card.
 *
 * Exposes a tiny, explicit surface to the renderer via contextBridge — no Node
 * APIs, no remote module. The renderer can only receive card content and send
 * two intents back: "done" and "snooze".
 */
import { contextBridge, ipcRenderer, IpcRendererEvent } from "electron";
import { CardContent } from "./cardContent";

contextBridge.exposeInMainWorld("burnout", {
  /**
   * Subscribe to card content pushed from the main process.
   * @param callback - Invoked with the content each time a card is shown.
   */
  onContent: (callback: (content: CardContent) => void): void => {
    ipcRenderer.on("card:content", (_event: IpcRendererEvent, content: CardContent) =>
      callback(content),
    );
  },
  /** Dismiss the card ("I did the eye break"). */
  done: (): void => {
    ipcRenderer.send("card:done");
  },
  /** Dismiss and push the next reminder back by the configured snooze. */
  snooze: (): void => {
    ipcRenderer.send("card:snooze");
  },
  /**
   * Report the rendered card's height so the window can be sized to fit.
   * Card copy varies in length, so a fixed window either clips the buttons or
   * leaves dead space; the renderer is the only place that knows the answer.
   * @param height - Measured content height in CSS pixels.
   */
  reportHeight: (height: number): void => {
    ipcRenderer.send("card:height", height);
  },
});
