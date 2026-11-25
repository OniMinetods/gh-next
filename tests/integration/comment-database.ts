import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

export async function setupCommentDatabase() {
  const testUrl = new URL(
    "postgresql://gh_next_e2e:e2e-only@127.0.0.1:55433/gh_next_e2e"
  );
  const admin = new Pool({
    connectionString: testUrl.href,
    connectionTimeoutMillis: 3_000
  });
  const databaseName =
    "gh_next_e2e_comments_" + randomUUID().replaceAll("-", "");
  let created = false;
  let pool: Pool | undefined;

  async function close() {
    try {
      if (pool) await pool.end();
      if (created) await admin.query(`DROP DATABASE "${databaseName}"`);
    } finally {
      await admin.end();
    }
  }

  try {
    const {
      rows: [connection]
    } = await admin.query(
      "SELECT current_database() AS database, current_user AS username"
    );
    if (
      connection.database !== "gh_next_e2e" ||
      connection.username !== "gh_next_e2e"
    ) {
      throw new Error(
        "Expected the dedicated gh-next-e2e PostgreSQL instance."
      );
    }
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    created = true;
    testUrl.pathname = "/" + databaseName;
    pool = new Pool({ connectionString: testUrl.href, max: 5 });
    const db = drizzle(pool);
    await migrate(db, { migrationsFolder: "./drizzle" });
    return { pool, db, close, databaseUrl: testUrl.href };
  } catch (error) {
    await close();
    throw error;
  }
}
