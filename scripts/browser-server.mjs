import { spawn } from "node:child_process";
const env = {
  ...process.env,
  NODE_ENV: "production",
  NEXT_TELEMETRY_DISABLED: "1",
  NEXT_PUBLIC_SUPABASE_URL: "",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
  SUPABASE_SERVICE_ROLE_KEY: "",
  APP_URL: "http://127.0.0.1:3100",
  DATA_MODE: "live",
  BROWSER_TEST_MODE: "1",
};
let child;
for (const event of ["SIGINT", "SIGTERM"])
  process.on(event, () => child?.kill());
const run = (args) => {
  child = spawn(
    process.execPath,
    ["node_modules/next/dist/bin/next", ...args],
    { stdio: "inherit", windowsHide: true, env },
  );
  return child;
};
// Production output keeps browser QA stable while the user's dev server runs.
const build = run(["build"]);
build.on("exit", (code) => {
  if (code !== 0) {
    process.exit(code ?? 1);
    return;
  }
  const server = run(["start", "--hostname", "127.0.0.1", "--port", "3100"]);
  server.on("exit", (exitCode) => process.exit(exitCode ?? 0));
});
