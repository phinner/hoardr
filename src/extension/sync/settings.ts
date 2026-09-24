import { browser } from "wxt/browser";
import type { CredentialId } from "~/shared/auth";

export interface Connection {
  readonly serverUrl: string;
  readonly token: string;
  readonly credentialId: CredentialId;
  readonly name: string;
  readonly lastSyncAt: number | null;
}

export interface Settings {
  readonly connection: Connection | null;
  readonly captureEnabled: boolean;
  readonly backoff: {
    readonly failures: number;
    readonly retryAt: number;
  } | null;
  readonly lastCaptureAt: number | null;
  readonly lastIssue: string | null;
}

const defaults: Settings = {
  connection: null,
  captureEnabled: true,
  backoff: null,
  lastCaptureAt: null,
  lastIssue: null,
};

const keys = Object.keys(defaults) as (keyof Settings)[];

export async function readSettings(): Promise<Settings> {
  const stored: Partial<Settings> = await browser.storage.local.get(keys);
  return { ...defaults, ...stored };
}

export async function readSetting<K extends keyof Settings>(key: K) {
  const stored: Partial<Settings> = await browser.storage.local.get(key);
  return stored[key] ?? defaults[key];
}

export const writeSettings = (values: Partial<Settings>) =>
  browser.storage.local.set(values);
