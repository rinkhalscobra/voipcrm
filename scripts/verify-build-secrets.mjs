import { readFile, readdir } from "node:fs/promises";
async function files(dir) {
  const results = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) results.push(...(await files(path)));
    else results.push(path);
  }
  return results;
}
const secrets = [
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  process.env.SUPABASE_ACCESS_TOKEN,
  process.env.PROVIDER_ENCRYPTION_KEY,
  process.env.TELTEL_API_KEY,
].filter(Boolean);
for (const file of await files(".next/static")) {
  const content = await readFile(file, "utf8");
  if (secrets.some((secret) => content.includes(secret)))
    throw new Error(`Server secret found in browser artifact: ${file}`);
}
console.log(
  `Browser bundle confidentiality passed: ${secrets.length} configured server secrets absent from static assets.`,
);
