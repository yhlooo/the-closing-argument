import type { Snapshot } from "../engine/courtroom";
import type { ContentBundle } from "../domain/profiles";
import { validateConnection, type Connection } from "../llm/connection";
import { CourtError } from "../engine/courtroom";

export interface Save {
  id: string;
  revision: number;
  seed: number;
  bundle: ContentBundle;
  connection: Omit<Connection, "apiKey">;
  snapshot?: Snapshot;
  updatedAt?: number;
  legacyDrafts?: boolean;
}

let opening: Promise<IDBDatabase> | undefined;
function database() {
  return (opening ??= new Promise((resolve, reject) => {
    const request = indexedDB.open("closing-argument-v1", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("game");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }));
}
const trialKey = (id: string) => "trial/" + id;
const currentKey = "current-trial";

export async function readLibrary(): Promise<{
  saves: Save[];
  current?: Save;
}> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("game", "readwrite");
    const store = tx.objectStore("game");
    let currentId: string | undefined;
    let saves: Save[] = [];
    const old = store.get("active");
    old.onsuccess = () => {
      const legacy: Save | undefined = old.result;
      if (legacy) {
        store.put(
          { ...legacy, updatedAt: Date.now(), legacyDrafts: true },
          trialKey(legacy.id),
        );
        store.put(legacy.id, currentKey);
        store.delete("active");
      }
      const pointer = store.get(currentKey);
      pointer.onsuccess = () => {
        currentId = pointer.result;
      };
      const records = store.getAll(IDBKeyRange.bound("trial/", "trial/\uffff"));
      records.onsuccess = () => {
        saves = records.result.sort(
          (a: Save, b: Save) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0),
        );
      };
    };
    tx.oncomplete = () =>
      resolve({ saves, current: saves.find((s) => s.id === currentId) });
    tx.onabort = () => reject(tx.error);
  });
}

export async function selectSave(id: string): Promise<Save> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("game", "readwrite");
    const store = tx.objectStore("game");
    const request = store.get(trialKey(id));
    request.onsuccess = () => {
      if (request.result) store.put(id, currentKey);
      else tx.abort();
    };
    tx.oncomplete = () => resolve(request.result);
    tx.onabort = () =>
      reject(new CourtError("无法读取这份庭审存档，请重新打开存档页。"));
  });
}

export async function writeSave(next: Save, previous?: Save) {
  const db = await database();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction("game", "readwrite");
    const store = tx.objectStore("game");
    const key = trialKey(next.id);
    const read = store.get(key);
    let conflict = false;
    read.onsuccess = () => {
      const old: Save | undefined = read.result;
      if (old?.id !== previous?.id || old?.revision !== previous?.revision) {
        conflict = true;
        tx.abort();
      } else {
        store.put(next, key);
        if (!previous) store.put(next.id, currentKey);
      }
    };
    tx.oncomplete = () => resolve();
    tx.onabort = () =>
      reject(
        new CourtError(
          conflict
            ? "另一页面已更新本庭，请重新打开存档后继续。"
            : "本地存档写入失败，请检查浏览器可用空间。",
        ),
      );
  });
}

const connectionKey = "court-connection-v1";
export function readConnection(): Connection | undefined {
  try {
    const raw = localStorage.getItem(connectionKey);
    if (!raw) return;
    const value = JSON.parse(raw);
    if (
      !value ||
      !["demo", "openai-chat", "openai-responses", "anthropic"].includes(
        value.protocol,
      ) ||
      !["apiKey", "baseURL", "model"].every((k) => typeof value[k] === "string")
    )
      return;
    return value.protocol === "demo"
      ? { ...value, apiKey: "" }
      : validateConnection(value);
  } catch {
    return undefined;
  }
}
export function storeConnection(config: Connection) {
  localStorage.setItem(connectionKey, JSON.stringify(config));
}
