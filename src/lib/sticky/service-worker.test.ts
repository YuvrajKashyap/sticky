import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

// Execute the shipped worker with a Cache API double, including authenticated
// navigation responses. No server or real account is involved.
function worker() {
  const origin = "https://sticky.test";
  const stores = new Map<string, Map<string, Response>>();
  const listeners = new Map<string, (event: unknown) => void>();
  let offline = false;
  const key = (input: string | Request) => new URL(typeof input === "string" ? input : input.url, origin).href;
  const network = async (input: string | Request) => {
    if (offline) throw new TypeError("offline");
    return new Response(new URL(key(input)).pathname === "/" ? "PRIVATE WORKSPACE" : "public asset");
  };
  const caches = {
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
    open: async (name: string) => {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name)!;
      return {
        addAll: async (paths: string[]) => { for (const path of paths) store.set(key(path), await network(path)); },
        match: async (input: string | Request) => store.get(key(input))?.clone(),
      };
    },
    match: async (input: string | Request) => {
      for (const store of stores.values()) if (store.has(key(input))) return store.get(key(input))!.clone();
    },
  };
  runInNewContext(readFileSync(new URL("../../../public/sw.js", import.meta.url), "utf8"), {
    URL, Response, fetch: network, caches,
    self: { location: { origin }, skipWaiting() {}, clients: { claim: async () => {} },
      addEventListener: (type: string, handler: (event: unknown) => void) => listeners.set(type, handler) },
  });
  return {
    stores,
    async lifecycle(type: string) {
      const promises: Promise<unknown>[] = [];
      listeners.get(type)!({ waitUntil: (promise: Promise<unknown>) => promises.push(promise) });
      await Promise.all(promises);
    },
    offline() { offline = true; },
    async request(path: string, mode = "navigate") {
      const request = { url: key(path), method: "GET", mode } as Request;
      let response: Promise<Response> | undefined;
      listeners.get("fetch")!({ request, respondWith: (value: Promise<Response>) => { response = value; } });
      return response ?? network(request);
    },
  };
}

describe("service worker privacy", () => {
  it("never precaches authenticated workspace HTML", async () => {
    const sw = worker();
    await sw.lifecycle("install");
    for (const cache of sw.stores.values()) expect(cache.has("https://sticky.test/")).toBe(false);
  });

  it("removes legacy private caches while preserving unrelated caches", async () => {
    const sw = worker();
    sw.stores.set("sticky-shell-glass-s-v2", new Map([["https://sticky.test/", new Response("PRIVATE WORKSPACE")]]));
    sw.stores.set("unrelated-cache", new Map());
    await sw.lifecycle("install");
    await sw.lifecycle("activate");
    expect(sw.stores.has("sticky-shell-glass-s-v2")).toBe(false);
    expect(sw.stores.has("unrelated-cache")).toBe(true);
  });

  it("shows a public offline message after a signed-in install", async () => {
    const sw = worker();
    await sw.lifecycle("install");
    sw.offline();
    const response = await sw.request("/");
    expect(await response.text()).not.toContain("PRIVATE WORKSPACE");
    expect(response.status).toBe(503);
  });

  it("does not turn API failures into cached workspace responses", async () => {
    const sw = worker();
    await sw.lifecycle("install");
    sw.offline();
    await expect(sw.request("/api/v1/workspace", "cors")).rejects.toThrow("offline");
  });

  it("preserves online navigation and cached public install assets", async () => {
    const sw = worker();
    await sw.lifecycle("install");
    expect(await (await sw.request("/")).text()).toBe("PRIVATE WORKSPACE");
    sw.offline();
    expect(await (await sw.request("/brand/sticky-192.png", "no-cors")).text()).toBe("public asset");
  });
});
