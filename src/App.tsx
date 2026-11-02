// Shell: top bar, global states (loading, fixture banner, error), then the
// screen for the route. `App` wires the router and the flow hook; `Shell`
// is the pure view so tests can render any state directly.

import { useEffect, useMemo } from "react";
import type { FlowState } from "./api.ts";
import { useFlow } from "./api.ts";
import type { Route } from "./router.ts";
import { Link, useRoute } from "./router.ts";
import { derive, needsYou } from "./engine/index.ts";
import { ConfigContext } from "./components/ExtLink.tsx";
import { ErrorScreen } from "./components/ErrorScreen.tsx";
import { Skeleton } from "./components/Skeleton.tsx";
import { TopBar } from "./components/TopBar.tsx";
import { Archive } from "./screens/Archive.tsx";
import { Board } from "./screens/Board.tsx";
import { IntentScreen } from "./screens/Intent.tsx";
import { Systems } from "./screens/Systems.tsx";

const FIXTURE_COPY = "This deploy has no GitHub token; showing fixture data.";

export function Shell({ route, flow }: { route: Route; flow: FlowState }) {
  const { snapshot, now } = flow;
  const derived = useMemo(() => (snapshot ? derive(snapshot, now) : []), [snapshot, now]);
  const needs = useMemo(() => (snapshot ? needsYou(derived, snapshot, now) : null), [derived, snapshot, now]);

  const count = needs?.count ?? 0;
  useEffect(() => {
    document.title = count > 0 ? `Flow (${count})` : "Flow";
  }, [count]);

  let body;
  if (!snapshot) {
    body = flow.status === "loading" || !flow.lastError ? <Skeleton /> : <ErrorScreen error={flow.lastError} snapshot={null} onRefresh={flow.refresh} />;
  } else {
    switch (route.name) {
      case "board":
        body = <Board snapshot={snapshot} derived={derived} needs={needs!} now={now} openStage={route.stage} />;
        break;
      case "intent":
        body = <IntentScreen id={route.id} snapshot={snapshot} derived={derived} now={now} />;
        break;
      case "systems":
        body = <Systems snapshot={snapshot} now={now} />;
        break;
      case "archive":
        body = <Archive derived={derived} now={now} />;
        break;
      case "not-found":
        body = (
          <div className="empty-screen">
            <p>
              There is no page at <code>{route.path}</code>. <Link href="/">Back to the Board</Link>.
            </p>
          </div>
        );
        break;
    }
  }

  const err = flow.lastError;
  const showErrorBlock = snapshot && err && !flow.refreshing && (err.kind === "token" || err.kind === "rate-limit" || err.kind === "not-found");

  return (
    <ConfigContext.Provider value={snapshot?.config ?? null}>
      <TopBar route={route} flow={flow} />
      <main className="page" aria-busy={flow.status === "loading"}>
        {flow.mode === "fixture" && <div className="banner fixture">{FIXTURE_COPY}</div>}
        {showErrorBlock && <ErrorScreen error={err} snapshot={snapshot} onRefresh={flow.refresh} />}
        {body}
      </main>
    </ConfigContext.Provider>
  );
}

export function App() {
  const route = useRoute();
  const flow = useFlow();
  return <Shell route={route} flow={flow} />;
}
