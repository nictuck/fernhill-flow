// Security review: only production and branch-deploy may touch the site-wide
// Blobs store. A deploy preview runs fork-PR code with the site's Blobs
// credentials, so through this module it must only ever reach a
// deploy-scoped store that is wiped with the deploy.

import type { Store as NetlifyBlobStore } from "@netlify/blobs";
import { SITE_CONTEXTS, makeStore, scopeFor } from "../../netlify/lib/store.ts";
import type { StoreFactories } from "../../netlify/lib/store.ts";

function factories(chosen: string[], keys: string[]): StoreFactories {
  const stub = (scope: string) => () => {
    chosen.push(scope);
    return {
      get: async (key: string) => {
        keys.push(`get ${key}`);
        return null;
      },
      setJSON: async (key: string) => {
        keys.push(`set ${key}`);
        return { modified: true };
      },
      delete: async (key: string) => {
        keys.push(`delete ${key}`);
      },
    } as unknown as NetlifyBlobStore;
  };
  return { site: stub("site"), deploy: stub("deploy") };
}

describe("store scope by deploy context", () => {
  test.each(["deploy-preview", "dev", "preview-42", "staging", "branch-deploy-typo"])("%s never resolves to the site store", async (prefix) => {
    const chosen: string[] = [];
    const keys: string[] = [];
    const store = makeStore(prefix, factories(chosen, keys));
    await store.getJSON("latest");
    await store.setJSON("lock", { at: "x" }, { onlyIfNew: true });
    await store.delete("lock");
    expect(scopeFor(prefix)).toBe("deploy");
    expect(chosen).toEqual(["deploy"]);
    expect(keys).toEqual([`get ${prefix}/latest`, `set ${prefix}/lock`, `delete ${prefix}/lock`]);
  });

  test.each(["production", "branch-deploy"])("%s uses the site-wide store under its own prefix", async (prefix) => {
    const chosen: string[] = [];
    const keys: string[] = [];
    const store = makeStore(prefix, factories(chosen, keys));
    await store.getJSON("latest");
    expect(scopeFor(prefix)).toBe("site");
    expect(chosen).toEqual(["site"]);
    expect(keys).toEqual([`get ${prefix}/latest`]);
  });

  test("the site allow-list is exactly production and branch-deploy", () => {
    expect([...SITE_CONTEXTS].sort()).toEqual(["branch-deploy", "production"]);
  });

  test("the Netlify store is created lazily and once", async () => {
    const chosen: string[] = [];
    const store = makeStore("production", factories(chosen, []));
    expect(chosen).toEqual([]);
    await store.getJSON("a");
    await store.getJSON("b");
    expect(chosen).toEqual(["site"]);
  });
});
