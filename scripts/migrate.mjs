import { readFile, readdir } from "node:fs/promises";
import { sql, projectRef } from "./management.mjs";
await sql(
  "create schema if not exists supabase_migrations; create table if not exists supabase_migrations.schema_migrations(version text primary key, statements text[], name text);",
);
const existing = await sql(
  "select version from supabase_migrations.schema_migrations order by version",
  true,
);
const applied = new Set(existing.map((row) => row.version));
const files = (await readdir("supabase/migrations"))
  .filter((file) => /^\d+_[a-z0-9_]+\.sql$/.test(file))
  .sort();
for (const file of files) {
  const [version, ...nameParts] = file.replace(/\.sql$/, "").split("_");
  if (applied.has(version)) {
    console.log(`Already applied: ${file}`);
    continue;
  }
  const source = await readFile(`supabase/migrations/${file}`, "utf8");
  // A unique dollar delimiter avoids altering SQL while retaining the exact migration in CLI history.
  const delimiter = "$migration_" + version + "$";
  if (source.includes(delimiter))
    throw new Error("Migration delimiter collision");
  await sql(
    `begin; select pg_advisory_xact_lock(hashtextextended('voixel-schema-migrations',0)); ${source}\n insert into supabase_migrations.schema_migrations(version,name,statements) values('${version}','${nameParts.join("_")}',array[${delimiter}${source}${delimiter}]); commit;`,
  );
  console.log(`Applied: ${file}`);
}
await sql("notify pgrst, 'reload schema';");
console.log(`Migration history recorded for ${projectRef}.`);
