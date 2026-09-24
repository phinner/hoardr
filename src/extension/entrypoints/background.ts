import { browser } from "wxt/browser";
import { defineBackground } from "wxt/utils/define-background";
import { upsert } from "~/extension/archive/store";
import {
  type CaptureMessage,
  isCaptureMessage,
  parseCapture,
} from "~/extension/capture/parse";
import { installStreamCapture } from "~/extension/capture/stream";
import { readSetting, writeSettings } from "~/extension/sync/settings";
import { syncAll } from "~/extension/sync/sync";

const SYNC_ALARM = "hoardr-sync";

let pendingSync: ReturnType<typeof setTimeout> | undefined;

const scheduleSync = () => {
  clearTimeout(pendingSync);
  pendingSync = setTimeout(() => void syncAll(false), 2_000);
};

async function storeCapture(message: CaptureMessage, senderUrl: string) {
  try {
    if (!(await readSetting("captureEnabled"))) return;

    const capture = parseCapture(message, senderUrl, Date.now());
    if (capture.posts.length === 0 && capture.viewerStates.length === 0) return;

    const changed = await upsert(capture, message.page);
    await writeSettings({ lastCaptureAt: Date.now() });
    if (changed > 0) scheduleSync();
  } catch {
    await writeSettings({
      lastIssue: "Some posts could not be saved. Reload the page to try again.",
    });
  }
}

const createAlarm = () =>
  void browser.alarms.create(SYNC_ALARM, { periodInMinutes: 5 });

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(createAlarm);
  browser.runtime.onStartup.addListener(() => {
    createAlarm();
    void syncAll(false);
  });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === SYNC_ALARM) void syncAll(false);
  });

  if (import.meta.env.FIREFOX)
    installStreamCapture(
      (message, documentUrl) => void storeCapture(message, documentUrl),
    );

  /* Chrome only accepts a returned Promise from 148 on, so replies go
     through `sendResponse` and the listener returns true to keep it open. */
  browser.runtime.onMessage.addListener(
    (message: unknown, sender, sendResponse) => {
      if (sender.id !== browser.runtime.id) return;

      /* The popup may be open as a tab, so extension pages are recognised
         by their URL rather than by having no tab. */
      if (isExtensionPage(sender.url) && isSyncRequest(message)) {
        void syncAll(true).then(sendResponse);
        return true;
      }

      if (
        sender.tab &&
        sender.frameId === 0 &&
        sender.url &&
        isCaptureMessage(message)
      ) {
        void storeCapture(message, sender.url)
          .catch(() => {})
          .finally(() => sendResponse(null));
        return true;
      }
    },
  );
});

const isSyncRequest = (message: unknown) =>
  typeof message === "object" &&
  message !== null &&
  "type" in message &&
  message.type === "sync";

const isExtensionPage = (url: string | undefined) =>
  url?.startsWith(browser.runtime.getURL("/")) ?? false;
