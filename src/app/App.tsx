import { Archives } from "./Archives";
import { courtTurn, delay } from "./conductor";
import {
  readLibrary,
  selectSave,
  writeSave,
  readConnection,
  storeConnection,
  type Save,
} from "./storage";
import { useEffect, useRef, useState } from "react";
import { builtinBundle } from "../content/builtin";
import { bundleSchema, type ContentBundle } from "../domain/profiles";
import {
  phaseLabels,
  type CourtState,
  type CourtEvent,
} from "../domain/courtroom";
import { CourtroomEngine, CourtError } from "../engine/courtroom";
import { createEvidenceSandbox } from "../engine/sandbox";
import { DemoDriver } from "../llm/demo";
import { describeError } from "../llm/driver";
import type { Connection } from "../llm/sdk";

const initialConnection: Connection = {
  protocol: "demo",
  baseURL: "https://api.openai.com/v1",
  model: "",
  apiKey: "",
};
import { CaseLibrary } from "./CaseLibrary";
import { ActionPanel } from "./ActionPanel";
import { Creator } from "./Creator";
import { Transcript } from "./Transcript";
import { ConnectionDialog, protocols } from "./ConnectionDialog";
import { download } from "./controls";
const pages = {
  home: "案件",
  archives: "存档",
  creator: "创作",
} as const;
type MenuPage = keyof typeof pages;
type Page = MenuPage | "court";
const phases = Object.keys(phaseLabels) as (keyof typeof phaseLabels)[];
const seed = () => crypto.getRandomValues(new Uint32Array(1))[0];
function Scales() {
  return (
    <svg
      width="29"
      height="29"
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M16 4v23M8 28h16M5 9h22M8 9l-5 11h10L8 9Zm16 0-5 11h10L24 9Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <circle cx="16" cy="6" r="2" fill="currentColor" />
    </svg>
  );
}
export function App() {
  const [bundle, setBundle] = useState<ContentBundle>(builtinBundle);
  const [draftBundle, setDraftBundle] = useState<ContentBundle>(() => {
    try {
      const data = localStorage.getItem("court-studio-v1");
      return data ? bundleSchema.parse(JSON.parse(data)) : builtinBundle;
    } catch {
      return builtinBundle;
    }
  });
  function saveStudio(content: ContentBundle) {
    localStorage.setItem("court-studio-v1", JSON.stringify(content));
    setDraftBundle(content);
  }
  const [connection, setConnection] = useState(initialConnection);
  const [activeConnection, setActiveConnection] = useState(initialConnection);
  const [returnPage, setReturnPage] = useState<"home" | "archives">("home");
  const [tab, setTab] = useState<Page>("home");
  const [settings, setSettings] = useState(false);
  const [busy, setBusy] = useState(false),
    [progress, setProgress] = useState("");
  const [speech, setSpeech] = useState<CourtEvent>();
  const [staged, setStaged] = useState<CourtEvent[]>([]);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [defenseQuestion, setDefenseQuestion] = useState<{
    question: string;
    respond: (value: string) => void;
  }>();
  const controller = useRef<AbortController | null>(null);
  const [initialEngine] = useState(
    () => new CourtroomEngine(builtinBundle, new DemoDriver(), { seed: 142 }),
  );
  const engine = useRef(initialEngine);
  const [state, setState] = useState<CourtState>(engine.current.getState());
  const [ready, setReady] = useState(false);
  const saved = useRef<Save | undefined>(undefined);
  const actionArea = useRef<HTMLElement>(null);
  const [archives, setArchives] = useState<Save[]>([]);
  const [setupDraft, setSetupDraft] = useState<Connection>();
  const [evidenceId, setEvidenceId] = useState("");
  const [sandbox, setSandbox] = useState<CourtState>();
  const answerDefense = (question: string, signal: AbortSignal) =>
    new Promise<string>((resolve, reject) => {
      const cancel = () => {
        setDefenseQuestion(undefined);
        reject(new DOMException("取消", "AbortError"));
      };
      if (signal.aborted) {
        cancel();
        return;
      }
      signal.addEventListener("abort", cancel, { once: true });
      setDefenseQuestion({
        question,
        respond: (value) => {
          signal.removeEventListener("abort", cancel);
          setDefenseQuestion(undefined);
          resolve(value);
        },
      });
    });
  async function driverFor(config: Connection) {
    if (config.protocol === "demo") return new DemoDriver();
    const { SdkDriver } = await import("../llm/sdk");
    return new SdkDriver(config);
  }
  async function run(action: (signal: AbortSignal) => Promise<unknown>) {
    if (controller.current) return;
    controller.current = new AbortController();
    setBusy(true);
    setError("");
    setNotice("");
    setProgress("准备庭审操作…");
    try {
      await action(controller.current.signal);
    } catch (error) {
      setError(describeError(error));
    } finally {
      setState(engine.current.getState());
      setBusy(false);
      setProgress("");
      setSpeech(undefined);
      setStaged([]);
      controller.current = null;
      setDefenseQuestion(undefined);
    }
  }
  function attach(game: Save, config: Connection) {
    let streamed: CourtEvent | undefined;
    engine.current = new CourtroomEngine(
      game.bundle,
      {
        live: config.protocol !== "demo",
        complete: async (request) => {
          if (config.protocol !== "demo" && !config.apiKey)
            throw new CourtError(
              "请打开模型设置，重新输入 API Key 后继续本庭。",
            );
          return (await driverFor(config)).complete(request);
        },
      },
      {
        seed: game.seed,
        snapshot: game.snapshot,
        answerDefense,
        onProgress: setProgress,
        onSpeech: (event) => {
          streamed = event;
          setSpeech(streamed);
        },
        onLine: async (event, signal) => {
          const text = event.text;
          const displayed =
            streamed &&
            (streamed.speakerId === event.speakerId ||
              (event.speakerId === "prosecution" &&
                streamed.speakerId === game.bundle.prosecutor.id)) &&
            text.includes(streamed.text);
          streamed = undefined;
          const reduced = window.matchMedia(
            "(prefers-reduced-motion: reduce)",
          ).matches;
          if (!displayed && !reduced) {
            for (let n = 5; n < text.length; n += 5) {
              setSpeech({
                ...event,
                text: text.slice(0, n),
              });
              await delay(30, signal);
            }
          }
          setSpeech(event);
          await delay(reduced ? 20 : 340, signal);
          setStaged((lines) => [...lines, event]);
          setSpeech(undefined);
        },
        onCommit: async (snapshot) => {
          const previous = saved.current;
          const next = {
            ...game,
            updatedAt: Date.now(),
            revision: (previous?.revision ?? 0) + 1,
            snapshot,
          };
          await writeSave(next, previous);
          saved.current = next;
          setState(snapshot.state);
          setStaged([]);
        },
      },
    );
    setBundle(game.bundle);
    setState(engine.current.getState());
    setActiveConnection(config);
  }
  function freshGame(content: ContentBundle, config: Connection): Save {
    const { apiKey: _secret, ...publicConfig } = config;
    return {
      id: crypto.randomUUID(),
      revision: 0,
      updatedAt: Date.now(),
      seed: seed(),
      bundle: content,
      connection: publicConfig,
    };
  }
  useEffect(() => {
    let mounted = true;
    readLibrary()
      .then(({ saves, current }) => {
        const route = window.location.hash.slice(1);
        const game = route.startsWith("trial/")
          ? (saves.find((s) => s.id === route.slice(6)) ?? current)
          : current;
        if (!mounted) return;
        setArchives(saves);
        saved.current = game;
        const stored = readConnection();
        const config =
          stored ??
          (game ? { ...game.connection, apiKey: "" } : initialConnection);
        if (game) attach(game, config);
        if (game && (route === "trial" || route.startsWith("trial/"))) {
          setReturnPage(
            history.state?.returnPage === "home" ? "home" : "archives",
          );
          setTab("court");
        } else if (route === "archives" || route === "creator") setTab(route);
        setConnection(config);
        if (!stored) {
          setSetupDraft(
            config.protocol === "demo"
              ? { ...config, protocol: "openai-chat" }
              : config,
          );
          setSettings(true);
        }
        setReady(true);
      })
      .catch(() =>
        setError("无法读取本地存档，请允许此页面使用浏览器本地存储并刷新。"),
      );
    return () => {
      mounted = false;
    };
  }, []);
  async function newTrial(content: ContentBundle) {
    await run(async () => {
      const game = freshGame(bundleSchema.parse(content), connection);
      await writeSave(game);
      saved.current = game;
      attach(game, connection);
      setEvidenceId("");
      enterCourt("home");
    });
  }
  function enterCourt(source: "home" | "archives") {
    if (!saved.current) return;
    setReturnPage(source);
    setTab("court");
    history.replaceState(
      { returnPage: source },
      "",
      "#trial/" + saved.current.id,
    );
    window.scrollTo(0, 0);
  }
  function navigate(page: MenuPage) {
    setTab(page);
    history.replaceState(
      null,
      "",
      location.pathname + location.search + (page === "home" ? "" : "#" + page),
    );
    window.scrollTo(0, 0);
  }
  useEffect(() => {
    if (!ready || tab !== "archives") return;
    let mounted = true;
    readLibrary()
      .then(({ saves }) => {
        if (mounted) setArchives(saves);
      })
      .catch(() => {
        if (mounted) setError("读取庭审列表失败，请重试。");
      });
    return () => {
      mounted = false;
    };
  }, [ready, tab, state]);
  async function resume(id: string) {
    if (controller.current && saved.current?.id === id) {
      enterCourt("archives");
      return;
    }
    await run(async () => {
      const game = await selectSave(id);
      saved.current = game;
      attach(game, connection);
      setEvidenceId("");
      enterCourt("archives");
    });
  }
  const play = async (action: (signal: AbortSignal) => Promise<unknown>) => {
    await run(action);
    requestAnimationFrame(() =>
      actionArea.current?.scrollIntoView({
        block: "nearest",
        behavior: "instant",
      }),
    );
  };
  const currentEvidence =
    state.phase === "prosecution"
      ? bundle.case.prosecutionEvidence
      : state.phase === "defense"
        ? bundle.case.defenseEvidence
        : [];
  const pending = state.events.find(
    (e) =>
      e.type === "evidence" &&
      !state.evidence.some((r) => r.id === e.evidenceId),
  );
  const selected =
    currentEvidence.find((e) => e.id === pending?.evidenceId) ??
    currentEvidence.find(
      (e) =>
        state.phase === "defense" &&
        e.id === evidenceId &&
        !state.evidence.some((r) => r.id === e.id),
    ) ??
    currentEvidence.find((e) => !state.evidence.some((r) => r.id === e.id)) ??
    currentEvidence[0];

  const automatic = courtTurn(state, bundle);
  useEffect(() => {
    if (
      !ready ||
      busy ||
      error ||
      tab !== "court" ||
      settings ||
      !saved.current ||
      !automatic
    )
      return;
    void play(async (signal) => {
      await delay(280, signal);
      await automatic(engine.current, signal);
    });
  }, [ready, busy, error, state, bundle, tab, settings]);
  const showDesk = !!defenseQuestion || (!automatic && !state.result && !busy);
  return (
    <div className="app-shell">
      <header className="topbar">
        {tab === "court" ? (
          <button className="return-link" onClick={() => navigate(returnPage)}>
            <span aria-hidden="true">‹</span>{" "}
            {returnPage === "archives" ? "返回存档" : "返回案件"}
          </button>
        ) : (
          <a
            className="brand"
            href="#"
            onClick={(event) => {
              event.preventDefault();
              navigate("home");
            }}
          >
            <span className="brand-icon">
              <Scales />
            </span>
            <span>
              <b>最后陈述</b>
              <small>THE CLOSING ARGUMENT</small>
            </span>
          </a>
        )}
        <nav aria-label="主导航">
          {(Object.keys(pages) as MenuPage[]).map((page) => (
            <button
              key={page}
              className={tab === page ? "nav-active" : ""}
              aria-current={tab === page ? "page" : undefined}
              disabled={!ready}
              onClick={() => navigate(page)}
            >
              {pages[page]}
            </button>
          ))}
        </nav>
        <button
          disabled={busy || !ready}
          className="connection-button"
          onClick={() => {
            setSetupDraft(connection);
            setSettings(true);
          }}
        >
          <i className="status-dot" />
          {protocols[connection.protocol]}
          <span aria-hidden="true"> ⚙</span>
        </button>
      </header>
      {tab === "home" ? (
        <>
          {error && (
            <p className="message error" role="alert">
              {error}
            </p>
          )}
          <CaseLibrary
            disabled={busy || !ready}
            custom={draftBundle}
            choose={newTrial}
          />
        </>
      ) : tab === "archives" ? (
        <Archives
          saves={archives}
          currentId={saved.current?.id}
          busy={busy || !ready}
          error={error}
          resume={resume}
          choose={() => navigate("home")}
        />
      ) : tab === "court" && !saved.current ? (
        <main className="case-library">
          <h1>法庭</h1>
          <p>尚未开庭。选择一个案件开始庭审。</p>
          <button
            className="button primary"
            disabled={!ready}
            onClick={() => navigate("home")}
          >
            选择案件
          </button>
        </main>
      ) : tab === "court" ? (
        <main className="court-grid">
          <aside className="dossier">
            <section className="case-card">
              <div className="section-kicker">CASE DOSSIER</div>
              <h2>案件卷宗</h2>
              <div className="docket">{bundle.case.docket}</div>
              <dl>
                <dt>案件名称</dt>
                <dd>{bundle.case.title}</dd>
                <dt>被告</dt>
                <dd>{bundle.case.defendant}</dd>
                <dt>指控</dt>
                <dd>{bundle.case.charge}</dd>
              </dl>
              <details>
                <summary>案情与证明要件</summary>
                <p>
                  法官 · {bundle.judge.name}
                  <br />
                  控方 · {bundle.prosecutor.name}
                </p>
                <p>{bundle.case.background}</p>
                <ol>
                  {bundle.case.legalElements.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ol>
              </details>
            </section>
            <section className="jury-panel" tabIndex={0}>
              <div className="section-heading">
                <h3>陪审团</h3>
                <small>{state.jurors.length} / 12 席</small>
              </div>
              {state.jurors.length ? (
                state.jurors.map((j, i) => (
                  <details key={j.id} className="juror">
                    <summary>
                      <span className="seat">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <span>
                        <b>{j.name}</b>
                        <small>
                          {j.occupation} · {j.age} 岁
                        </small>
                      </span>
                    </summary>
                    <p>
                      {j.personality} {j.background}
                    </p>
                  </details>
                ))
              ) : (
                <>
                  <div className="seats">
                    {Array.from({ length: 12 }, (_, i) => (
                      <span key={i}>{String(i + 1).padStart(2, "0")}</span>
                    ))}
                  </div>
                  <small>选任后可查看成员资料</small>
                </>
              )}
            </section>
            <details className="instructions">
              <summary>法庭指示</summary>
              <p>{bundle.case.juryInstructions}</p>
            </details>
          </aside>
          <div className="court-main">
            <section
              className={
                "hero " + (bundle.case.id === "harbor-ledger" ? "harbor" : "")
              }
            >
              <div className="hero-copy">
                <span className="hero-code">
                  CASE FILE　/　{bundle.case.docket}
                </span>
                <h1>{bundle.case.title}</h1>
                <p>{bundle.case.court}</p>
                <span className="hero-role">
                  代理被告　/　{bundle.case.defendant.split("/")[0].trim()}
                </span>
              </div>
            </section>
            <div className="progress-line">
              <div>
                <small>庭审进度</small>
                <b>{phaseLabels[state.phase]}</b>
              </div>
              <ol aria-label="庭审进度">
                {phases.map((p, i) => (
                  <li
                    key={p}
                    title={phaseLabels[p]}
                    className={i <= phases.indexOf(state.phase) ? "filled" : ""}
                    aria-current={p === state.phase ? "step" : undefined}
                  >
                    {phaseLabels[p]}
                  </li>
                ))}
              </ol>
              <a
                onClick={(e) => {
                  e.preventDefault();
                  document
                    .getElementById(
                      showDesk ? "current-action" : "transcript-end",
                    )
                    ?.scrollIntoView();
                }}
                className="jump"
                href={showDesk ? "#current-action" : "#transcript-end"}
              >
                {showDesk ? "当前环节" : "最新记录"}
              </a>
            </div>
            <div className="section-heading transcript-head">
              <div>
                <span className="section-kicker">COURT TRANSCRIPT</span>
                <h2>庭审记录</h2>
              </div>
              <button
                className="button quiet"
                disabled={!state.events.length}
                onClick={() =>
                  download(
                    bundle.case.id + "-transcript.json",
                    JSON.stringify(
                      { caseId: bundle.case.id, ...state },
                      null,
                      2,
                    ),
                    "application/json",
                  )
                }
              >
                导出记录
              </button>
            </div>
            <Transcript
              state={state}
              staged={staged}
              bundle={bundle}
              speech={speech}
            />
            <div id="transcript-end" />
            {error && (
              <p role="alert" className="message error">
                {error}
              </p>
            )}
            {notice && (
              <p role="status" className="message">
                {notice}
              </p>
            )}
            {busy && (
              <div className="message" role="status">
                {progress}{" "}
                <button
                  className="text-button"
                  onClick={() => controller.current?.abort()}
                >
                  取消操作
                </button>
              </div>
            )}
            {automatic && error && !busy && (
              <button className="button primary" onClick={() => setError("")}>
                继续庭审
              </button>
            )}
            <section
              hidden={!showDesk}
              aria-label="辩方工作台"
              className="action-card"
              id="current-action"
              ref={actionArea}
            >
              <div className="card-overline">
                <span>辩方工作台</span>
                <span>{protocols[activeConnection.protocol]}</span>
              </div>
              {defenseQuestion ? (
                <>
                  <h2>回复法庭询问</h2>
                  <DefenseAnswer
                    respond={defenseQuestion.respond}
                    cancel={() => controller.current?.abort()}
                  />
                </>
              ) : (
                !state.result &&
                !automatic && (
                  <ActionPanel
                    key={`${saved.current?.id}-${state.phase}-${state.openings.length}-${state.closings.length}-${selected?.id}-${state.evidence.length}`}
                    state={state}
                    bundle={bundle}
                    runId={saved.current!.id}
                    legacyDrafts={saved.current!.legacyDrafts}
                    selected={selected}
                    busy={busy || !ready}
                    choose={setEvidenceId}
                    run={play}
                    engine={engine.current}
                  />
                )
              )}
            </section>
          </div>
        </main>
      ) : (
        <>
          <div className="studio-status" role="status">
            {error || notice || progress}
          </div>
          <button
            className="studio-start button quiet"
            disabled={busy || !ready}
            onClick={() => navigate("home")}
          >
            查看案件列表
          </button>
          <Creator
            bundle={draftBundle}
            setBundle={saveStudio}
            busy={busy}
            sandbox={sandbox}
            setError={setError}
            setNotice={setNotice}
            debug={(side, id, argument, question) =>
              run(async (signal) => {
                setSandbox(undefined);
                const driver = await driverFor(connection);
                const instance = await createEvidenceSandbox(
                  draftBundle,
                  driver,
                  side,
                  id,
                  { seed: 142, answerDefense, onProgress: setProgress },
                );
                if (question.trim())
                  await instance.questionWitness(side, id, question, signal);
                await instance.presentEvidence(side, id, argument, signal);
                setSandbox(instance.getState());
                setNotice("独立调试完成；正式庭审保持原进度。");
              })
            }
          />
        </>
      )}
      <footer>
        <span>
          THE CLOSING ARGUMENT <span className="footer-divider">/</span>{" "}
          最后陈述
        </span>
        <span>虚构庭审 · 非法律建议</span>
      </footer>
      {settings && (
        <ConnectionDialog
          connection={setupDraft ?? connection}
          onSave={(value) => {
            storeConnection(value);
            if (saved.current) attach(saved.current, value);
            setConnection(value);
            setSettings(false);
            setError("");
          }}
          onClose={() => setSettings(false)}
        />
      )}
      {tab === "creator" && defenseQuestion && (
        <div className="modal-backdrop">
          <section className="modal">
            <h2>{defenseQuestion.question}</h2>
            <DefenseAnswer
              respond={defenseQuestion.respond}
              cancel={() => controller.current?.abort()}
            />
          </section>
        </div>
      )}
    </div>
  );
}
function DefenseAnswer({
  respond,
  cancel,
}: {
  respond: (value: string) => void;
  cancel: () => void;
}) {
  const [value, setValue] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (value.trim()) respond(value);
      }}
    >
      <label htmlFor="clarification-answer">你的公开答复</label>
      <textarea
        id="clarification-answer"
        autoFocus
        rows={5}
        value={value}
        maxLength={20000}
        onChange={(e) => setValue(e.target.value)}
      />
      <button
        type="submit"
        className="button primary full"
        disabled={!value.trim()}
      >
        提交答复
      </button>
      <button className="button quiet full" type="button" onClick={cancel}>
        取消本次证据操作
      </button>
    </form>
  );
}
