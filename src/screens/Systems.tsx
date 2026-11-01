// `/systems` — What is running where, and is production behind? (R7)
// Table at ≥ 601 px, one card per repo at ≤ 600 px; CSS picks one.

import type { ReleaseRun, Snapshot, SystemsRow } from "../engine/types.ts";
import { plural, systems } from "../engine/index.ts";
import { Badge } from "../components/Badge.tsx";
import { Exceptions } from "../components/Exceptions.tsx";
import { ExtLink } from "../components/ExtLink.tsx";
import { shortSha, siteName } from "../components/format.ts";
import { Link } from "../router.ts";

function ReleaseBadge({ run }: { run: ReleaseRun }) {
  if (run.pendingApproval) return <Badge kind="waiting">pending approval</Badge>;
  if (run.status === "completed") {
    if (run.conclusion === "success")
      return (
        <>
          <Badge kind="live">deployed</Badge>
          {run.approvedBy ? ` by ${run.approvedBy}` : ""}
        </>
      );
    return <Badge kind="ci-red">failed</Badge>;
  }
  return <Badge kind="progress">running</Badge>;
}

function CiBadge({ ci }: { ci: SystemsRow["repo"]["mainCi"] }) {
  const kind = ci === "green" ? "live" : ci === "red" ? "ci-red" : ci === "running" ? "progress" : "done";
  return <Badge kind={kind}>{ci}</Badge>;
}

function NotFound({ name }: { name: string }) {
  return (
    <span className="not-found">
      <code>{name}</code> is in flow.config.json but the token cannot see it. Add it to the token's selected repositories.
    </span>
  );
}

function sha(v: { version?: string; error?: string }): string {
  if (v.version) return shortSha(v.version);
  return v.error ? "unavailable" : "unknown";
}

function OpenCounts({ row, snapshot }: { row: SystemsRow; snapshot: Snapshot }) {
  const platform = snapshot.repos.find((r) => r.name === snapshot.config.platform_repo);
  const incidents = plural(row.openIncidents, "incident");
  const prs = plural(row.openPrs, "PR");
  return (
    <>
      {row.openIncidents > 0 && platform ? <ExtLink href={`${platform.url}/tree/main/incidents`}>{incidents}</ExtLink> : incidents}
      {" · "}
      {row.openPrs > 0 ? <ExtLink href={`${row.repo.url}/pulls`}>{prs}</ExtLink> : prs}
    </>
  );
}

export function Systems({ snapshot, now }: { snapshot: Snapshot; now: string }) {
  const rows = systems(snapshot);
  const productRepos = snapshot.config.repos.filter((r) => r.kind === "product");
  return (
    <div className="systems">
      <Link className="back" href="/">
        ← Board
      </Link>
      {rows.length > 0 && (
        <>
          <table>
            <thead>
              <tr>
                <th>Repo</th>
                <th>Staging (main)</th>
                <th>Production</th>
                <th>Production branch</th>
                <th>Status</th>
                <th>Last release</th>
                <th>main CI</th>
                <th>Open</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.repo.name}>
                  <td>
                    <strong>
                      <ExtLink href={row.repo.url}>{row.repo.name}</ExtLink>
                    </strong>
                    {row.repo.kind === "platform" && (
                      <>
                        <br />
                        <span className="label">company front door</span>
                      </>
                    )}
                  </td>
                  {row.repo.error ? (
                    <td colSpan={7}>
                      <NotFound name={row.repo.name} />
                    </td>
                  ) : (
                    <>
                      <td>
                        <ExtLink href={row.repo.staging.url}>{siteName(row.repo.staging.url)}</ExtLink>
                        <br />
                        <span className="sha">{sha(row.repo.staging)}</span>
                      </td>
                      <td>
                        <ExtLink href={row.repo.production.url}>{siteName(row.repo.production.url)}</ExtLink>
                        <br />
                        <span className="sha">{sha(row.repo.production)}</span>
                      </td>
                      <td>
                        <span className="sha">{row.repo.productionHead ? shortSha(row.repo.productionHead) : "none"}</span>
                      </td>
                      <td>
                        <span className={`line-${row.line.kind}`}>{row.line.text}</span>
                      </td>
                      <td>
                        {row.lastRelease ? (
                          <>
                            <ExtLink href={row.lastRelease.url}>run #{row.lastRelease.id}</ExtLink> · <ReleaseBadge run={row.lastRelease} />
                          </>
                        ) : (
                          <span className="label">no release yet</span>
                        )}
                      </td>
                      <td>
                        <CiBadge ci={row.repo.mainCi} />
                      </td>
                      <td>
                        <OpenCounts row={row} snapshot={snapshot} />
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="cards">
            {rows.map((row) => (
              <div className="sys-card" key={row.repo.name}>
                <strong>
                  <ExtLink href={row.repo.url}>{row.repo.name}</ExtLink>
                  {row.repo.kind === "platform" && <span className="label"> · company front door</span>}
                </strong>
                {row.repo.error ? (
                  <NotFound name={row.repo.name} />
                ) : (
                  <>
                    <div className="row2">
                      <span className="label">Staging</span>
                      <span>
                        <ExtLink href={row.repo.staging.url}>{siteName(row.repo.staging.url)}</ExtLink> · <span className="sha">{sha(row.repo.staging)}</span>
                      </span>
                    </div>
                    <div className="row2">
                      <span className="label">Production</span>
                      <span>
                        <ExtLink href={row.repo.production.url}>{siteName(row.repo.production.url)}</ExtLink> ·{" "}
                        <span className="sha">{sha(row.repo.production)}</span> · branch{" "}
                        <span className="sha">{row.repo.productionHead ? shortSha(row.repo.productionHead) : "none"}</span>
                      </span>
                    </div>
                    <div className={`line-${row.line.kind}`}>{row.line.text}</div>
                    <div>
                      {row.lastRelease ? (
                        <>
                          <ExtLink href={row.lastRelease.url}>run #{row.lastRelease.id}</ExtLink> · <ReleaseBadge run={row.lastRelease} />
                        </>
                      ) : (
                        <span className="label">no release yet</span>
                      )}
                    </div>
                    <div>
                      main CI <CiBadge ci={row.repo.mainCi} /> · <OpenCounts row={row} snapshot={snapshot} />
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        </>
      )}
      {productRepos.length === 0 && (
        <div className="empty-screen">
          <p>
            No product repos yet. <code>scripts/new-product</code> adds one.
          </p>
        </div>
      )}
      {snapshot.warnings.length > 0 && (
        <ul className="warnings" aria-label="Collection warnings">
          {snapshot.warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}
      <Exceptions snapshot={snapshot} now={now} />
    </div>
  );
}
