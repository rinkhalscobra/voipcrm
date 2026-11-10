import { mkdir, writeFile } from "node:fs/promises";
const root =
  "https://api.teltel.io/v2/api.user.0d9ae995324f03f254d3da8d963d46b2.json";
const cache = new Map();
async function resolve(value, base) {
  if (!value || typeof value !== "object") return value;
  if (value.$ref && !value.$ref.startsWith("#")) {
    const url = new URL(value.$ref, base).href;
    if (!cache.has(url))
      cache.set(
        url,
        fetch(url).then(async (r) => {
          if (!r.ok) throw new Error(`Spec HTTP ${r.status}`);
          return resolve(await r.json(), url);
        }),
      );
    return cache.get(url);
  }
  if (Array.isArray(value))
    return Promise.all(value.map((v) => resolve(v, base)));
  return Object.fromEntries(
    await Promise.all(
      Object.entries(value).map(async ([k, v]) => [k, await resolve(v, base)]),
    ),
  );
}
const spec = await resolve(await (await fetch(root)).json(), root);
await mkdir("docs/provider", { recursive: true });
await writeFile(
  "docs/provider/teltel.resolved.json",
  JSON.stringify(spec, null, 2),
);
console.log(
  `Resolved ${Object.keys(spec.paths).length} paths from ${cache.size} source files`,
);
