import type { Snapshot } from "../engine/courtroom";
import type { ContentBundle } from "../domain/profiles";
import type { Connection } from "../llm/sdk";
import { CourtError } from "../engine/courtroom";

export interface Save {
  id: string;
  revision: number;
  seed: number;
  bundle: ContentBundle;
  connection: Omit<Connection, "apiKey">;
  snapshot?: Snapshot;
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
export async function loadSave(): Promise<Save | undefined> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const req = db.transaction("game").objectStore("game").get("active");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
export async function writeSave(next: Save, previous?: Save) {
  const db = await database();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction("game", "readwrite");
    const store = tx.objectStore("game");
    const read = store.get("active");
    let conflict = false;
    read.onsuccess = () => {
      const old: Save | undefined = read.result;
      if (old?.id !== previous?.id || old?.revision !== previous?.revision) {
        conflict = true;
        tx.abort();
      } else store.put(next, "active");
    };
    tx.oncomplete = () => resolve();
    tx.onabort = () =>
      reject(
        new CourtError(
          conflict
            ? "另一页面已更新本庭，请刷新后继续。"
            : "本地存档写入失败，请检查浏览器可用空间。",
        ),
      );
  });
}
