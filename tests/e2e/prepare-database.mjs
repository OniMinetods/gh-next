import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const databaseUrl = new URL(process.env.DATABASE_URL ?? "");
if (
  databaseUrl.protocol !== "postgresql:" ||
  databaseUrl.hostname !== "127.0.0.1" ||
  databaseUrl.port !== "55433" ||
  databaseUrl.username !== "gh_next_e2e" ||
  databaseUrl.pathname !== "/gh_next_e2e"
) {
  throw new Error(
    "E2E setup requires the dedicated gh_next_e2e test database."
  );
}

const sql = postgres(databaseUrl.href, { max: 1, connect_timeout: 5 });
try {
  await migrate(drizzle(sql), {
    migrationsFolder: fileURLToPath(new URL("../../drizzle", import.meta.url))
  });
  const fixtures = await readFile(
    new URL("./fixtures.sql", import.meta.url),
    "utf8"
  );
  await sql.begin(async (transaction) => {
    await transaction.unsafe(fixtures);
    await transaction.unsafe(await readFile(new URL("./comment-fixtures.sql", import.meta.url), "utf8"));
  });
} finally {
  await sql.end();
}
