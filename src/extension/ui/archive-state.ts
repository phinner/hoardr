import { createSignal, onCleanup } from "solid-js";
import { exportArchive, summary } from "~/extension/archive/store";
import { exportDiagnostics } from "~/extension/diagnostics/log";
import {
  readSettings,
  type Settings,
  writeSettings,
} from "~/extension/sync/settings";

type Counts = Awaited<ReturnType<typeof summary>>;

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${name}-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function createArchiveState() {
  const [counts, setCounts] = createSignal<Counts | null>(null);
  const [settings, setSettings] = createSignal<Settings | null>(null);
  const [exporting, setExporting] = createSignal(false);
  const [error, setError] = createSignal("");

  const refresh = async () => {
    try {
      const [nextCounts, nextSettings] = await Promise.all([
        summary(),
        readSettings(),
      ]);
      setCounts(nextCounts);
      setSettings(nextSettings);
    } catch {
      setError("Could not open the local archive.");
    }
  };

  const toggleCapture = async () => {
    const current = settings();
    if (!current) return;
    await writeSettings({ captureEnabled: !current.captureEnabled });
    await refresh();
  };

  const exportJson = async () => {
    setExporting(true);
    try {
      download(await exportArchive(), "hoardr");
    } catch {
      setError("Could not export the local archive.");
    } finally {
      setExporting(false);
    }
  };

  const exportLogs = async () => {
    try {
      download(await exportDiagnostics(), "hoardr-logs");
    } catch {
      setError("Could not export the logs.");
    }
  };

  const clearIssue = async () => {
    setError("");
    await writeSettings({ lastIssue: null });
    await refresh();
  };

  void refresh();
  const timer = setInterval(() => void refresh(), 2_000);
  onCleanup(() => clearInterval(timer));

  return {
    counts,
    settings,
    exporting,
    error,
    issue: () => error() || settings()?.lastIssue || "",
    toggleCapture: () =>
      void toggleCapture().catch(() => setError("Could not save the setting.")),
    exportJson: () => void exportJson(),
    exportLogs: () => void exportLogs(),
    clearIssue: () => void clearIssue().catch(() => {}),
  };
}

export type ArchiveState = ReturnType<typeof createArchiveState>;
