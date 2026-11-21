import { caseLibrary } from "../content/builtin";
import type { ContentBundle } from "../domain/profiles";

export function CaseLibrary({
  disabled,
  custom,
  choose,
}: {
  disabled: boolean;
  custom?: ContentBundle;
  choose: (bundle: ContentBundle) => void;
}) {
  const catalog = caseLibrary.map((b) =>
    custom?.case.id === b.case.id ? custom : b,
  );
  if (custom && !catalog.includes(custom)) catalog.push(custom);
  return (
    <main className="case-library">
      <header>
        <span className="section-kicker">CASE LIBRARY</span>
        <h1>选择案件</h1>
        <p>选择一份卷宗，担任被告的辩护律师。</p>
      </header>
      <div className="library-grid">
        {catalog.map((b) => {
          const item = b.case;
          return (
            <article key={item.id} className="library-card">
              <header className={"file-cover " + item.id}>
                <span className="hero-code">{item.docket}</span>
                <h2>{item.title}</h2>
                <small>{item.court}</small>
              </header>
              <div className="library-body">
                <p>{item.background}</p>
                <dl>
                  <dt>被告</dt>
                  <dd>{item.defendant}</dd>
                  <dt>指控</dt>
                  <dd>{item.charge}</dd>
                </dl>
                <button
                  disabled={disabled}
                  className="button primary"
                  onClick={() => choose(b)}
                >
                  新建庭审
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </main>
  );
}
