import { phaseLabels, verdictLabels } from "../domain/courtroom";
import type { Save } from "./storage";

export function Archives({
  saves,
  currentId,
  busy,
  error,
  resume,
  choose,
}: {
  saves: Save[];
  currentId?: string;
  busy: boolean;
  error: string;
  resume: (id: string) => void;
  choose: () => void;
}) {
  return (
    <main className="case-library">
      <header>
        <h1>庭审存档</h1>
      </header>
      {error && <p role="alert">{error}</p>}
      {saves.length === 0 ? (
        <>
          <p>尚无庭审存档。</p>
          <button className="button primary" onClick={choose}>
            选择案件
          </button>
        </>
      ) : (
        <div className="library-grid">
          {saves.map((save) => {
            const state = save.snapshot?.state;
            const result = state?.result;
            return (
              <article className="library-card" key={save.id}>
                <div className="library-body">
                  <small>
                    {save.bundle.case.docket} · {result ? "已完成" : "进行中"}
                  </small>
                  <h2>{save.bundle.case.title}</h2>
                  <p>
                    {result
                      ? verdictLabels[result.verdict]
                      : phaseLabels[state?.phase ?? "setup"]}{" "}
                    · {state?.events.length ?? 0} 条记录
                  </p>
                  <small>
                    最近保存　
                    {new Date(save.updatedAt ?? 0).toLocaleString("zh-CN")}
                  </small>
                  <button
                    className="button primary"
                    disabled={busy && save.id !== currentId}
                    onClick={() => resume(save.id)}
                  >
                    {result ? "回看庭审" : "继续庭审"}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </main>
  );
}
