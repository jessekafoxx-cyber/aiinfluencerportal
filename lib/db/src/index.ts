import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// IMPORTANT: pool sizing is critical for portal responsiveness.
//
// The default `pg` pool max is 10. The ad research board background media
// processor runs many concurrent download workers and each one needs a DB
// connection for `markPending` and `persistResult`. With the default of 10
// the pool would exhaust during heavy processing and every other portal
// request (lessons, masterclass, sidebar `me` query) would block waiting
// for a connection, making the entire portal feel laggy.
//
// We set max to 25 so background processing has plenty of headroom while
// always leaving connections available for live user requests.
// statement_timeout caps any single query so a runaway query cannot pin a
// connection forever. idleTimeoutMillis recycles cold connections.
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 25,
  idleTimeoutMillis: 30_000,
  statement_timeout: 30_000,
});
export const db = drizzle(pool, { schema });

export * from "./schema";
