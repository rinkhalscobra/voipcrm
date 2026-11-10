import { readFile, writeFile } from "node:fs/promises";
import { sql } from "./management.mjs";
const mode = process.argv[2];
if (!["demo", "live"].includes(mode))
  throw new Error(
    "Usage: node --env-file=.env scripts/switch-data-mode.mjs demo|live",
  );
await sql(
  `insert into public.system_settings(key,value) values('data_mode','"${mode}"'::jsonb) on conflict(key) do update set value=excluded.value,updated_at=now();`,
);
let env = await readFile(".env", "utf8");
env = /^DATA_MODE=/m.test(env)
  ? env.replace(/^DATA_MODE=.*$/m, `DATA_MODE=${mode}`)
  : `${env.trimEnd()}\nDATA_MODE=${mode}\n`;
await writeFile(".env", env, { mode: 0o600 });
process.env.DATA_MODE = mode;
await import("./configure-auth.mjs");
console.log(
  `Data mode is ${mode}. Restart the web application and worker. Existing demo and live records are preserved and remain isolated.`,
);
