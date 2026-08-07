/**
 * Check for drift between the Drizzle schema (source of truth in
 * `lib/db/src/schema/`) and the columns actually present in the connected
 * Postgres database (`information_schema.columns`).
 *
 * Reports, per table:
 *   - missing columns (in schema, not in DB)  -> hard failure, root cause of
 *     the kind of 500 we saw in Task #432 when `orders.phone` was missing.
 *   - type-mismatched columns                 -> hard failure.
 *   - extra columns (in DB, not in schema)    -> warning (likely legacy /
 *     dropped intentionally without a migration).
 *
 * Exits non-zero if any missing or mismatched columns are found so this can
 * be wired into CI.
 *
 * Run:
 *   pnpm --filter @workspace/scripts run check:schema-drift
 */

import { pool } from "@workspace/db";
import * as schema from "@workspace/db/schema";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";

type DrizzleColumn = {
  name: string;
  sqlType: string;
  notNull: boolean;
};

type DbColumn = {
  column_name: string;
  data_type: string;
  udt_name: string;
  is_nullable: "YES" | "NO";
};

function normalizeSqlType(raw: string): string {
  // Drizzle's getSQLType() returns strings like "varchar(255)", "text",
  // "timestamp with time zone", "integer", "jsonb", "uuid", etc.
  // information_schema.columns.data_type returns the canonical Postgres
  // form ("character varying", "timestamp with time zone", "integer",
  // "USER-DEFINED" for enums, "ARRAY" for arrays, etc).
  //
  // We normalize both sides to a small, comparable token so cosmetic
  // differences (length specifiers, "with time zone" vs "tz", aliases)
  // don't cause false positives.
  const t = raw.toLowerCase().trim();
  // Strip parenthesized size/precision: varchar(255) -> varchar.
  const noParen = t.replace(/\s*\([^)]*\)/g, "");

  if (noParen.startsWith("character varying") || noParen === "varchar")
    return "varchar";
  if (noParen === "character" || noParen === "char") return "char";
  if (noParen === "text") return "text";
  if (
    noParen === "integer" ||
    noParen === "int" ||
    noParen === "int4" ||
    noParen === "serial" ||
    noParen === "serial4"
  )
    return "integer";
  if (
    noParen === "bigint" ||
    noParen === "int8" ||
    noParen === "bigserial" ||
    noParen === "serial8"
  )
    return "bigint";
  if (
    noParen === "smallint" ||
    noParen === "int2" ||
    noParen === "smallserial" ||
    noParen === "serial2"
  )
    return "smallint";
  if (noParen === "boolean" || noParen === "bool") return "boolean";
  if (noParen === "real" || noParen === "float4") return "real";
  if (
    noParen === "double precision" ||
    noParen === "float8" ||
    noParen === "double"
  )
    return "double precision";
  if (noParen.startsWith("numeric") || noParen.startsWith("decimal"))
    return "numeric";
  if (noParen === "json") return "json";
  if (noParen === "jsonb") return "jsonb";
  if (noParen === "uuid") return "uuid";
  if (noParen === "date") return "date";
  if (noParen.startsWith("timestamp with time zone")) return "timestamptz";
  if (noParen.startsWith("timestamp without time zone")) return "timestamp";
  if (noParen.startsWith("timestamptz")) return "timestamptz";
  if (noParen.startsWith("timestamp")) return "timestamp";
  if (noParen.startsWith("time with time zone")) return "timetz";
  if (noParen.startsWith("time without time zone")) return "time";
  if (noParen.startsWith("time")) return "time";
  if (noParen === "bytea") return "bytea";
  // Array forms. Drizzle emits e.g. "integer[]" / "text[]". Postgres's
  // udt_name for array columns is the element type prefixed with "_"
  // (e.g. "_int4", "_text"). Normalize both to "<element>[]".
  if (noParen.endsWith("[]")) {
    return `${normalizeSqlType(noParen.slice(0, -2))}[]`;
  }
  if (noParen.startsWith("_")) {
    return `${normalizeSqlType(noParen.slice(1))}[]`;
  }
  return noParen;
}

function collectDrizzleTables(): Map<string, DrizzleColumn[]> {
  const result = new Map<string, DrizzleColumn[]>();
  for (const value of Object.values(schema as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    // Drizzle tables are objects with the table symbol. getTableConfig
    // throws for non-tables, so we guard with a try/catch rather than
    // sniffing internal symbols.
    let config:
      | ReturnType<typeof getTableConfig>
      | null = null;
    try {
      config = getTableConfig(value as PgTable);
    } catch {
      continue;
    }
    if (!config) continue;
    const cols: DrizzleColumn[] = config.columns.map((c) => ({
      name: c.name,
      sqlType: c.getSQLType(),
      notNull: c.notNull,
    }));
    result.set(config.name, cols);
  }
  return result;
}

async function fetchDbColumns(): Promise<Map<string, DbColumn[]>> {
  const { rows } = await pool.query<DbColumn & { table_name: string }>(`
    SELECT table_name, column_name, data_type, udt_name, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public'
    ORDER BY table_name, ordinal_position
  `);
  const map = new Map<string, DbColumn[]>();
  for (const row of rows) {
    const arr = map.get(row.table_name) ?? [];
    arr.push({
      column_name: row.column_name,
      data_type: row.data_type,
      udt_name: row.udt_name,
      is_nullable: row.is_nullable,
    });
    map.set(row.table_name, arr);
  }
  return map;
}

function dbTypeToken(col: DbColumn): string {
  // For USER-DEFINED (enums) or ARRAY types, information_schema.data_type
  // is unhelpful; fall back to udt_name which has the concrete type name.
  if (col.data_type === "USER-DEFINED" || col.data_type === "ARRAY") {
    return normalizeSqlType(col.udt_name);
  }
  return normalizeSqlType(col.data_type);
}

type Finding = {
  table: string;
  kind: "missing-table" | "missing-column" | "type-mismatch" | "extra-column";
  column?: string;
  detail?: string;
};

async function main() {
  const drizzleTables = collectDrizzleTables();
  const dbTables = await fetchDbColumns();

  const findings: Finding[] = [];

  for (const [tableName, schemaCols] of drizzleTables) {
    const dbCols = dbTables.get(tableName);
    if (!dbCols) {
      findings.push({ table: tableName, kind: "missing-table" });
      continue;
    }
    const dbColByName = new Map(dbCols.map((c) => [c.column_name, c]));
    const schemaColNames = new Set(schemaCols.map((c) => c.name));

    for (const sc of schemaCols) {
      const dc = dbColByName.get(sc.name);
      if (!dc) {
        findings.push({
          table: tableName,
          kind: "missing-column",
          column: sc.name,
          detail: sc.sqlType,
        });
        continue;
      }
      const schemaTok = normalizeSqlType(sc.sqlType);
      const dbTok = dbTypeToken(dc);
      if (schemaTok !== dbTok) {
        findings.push({
          table: tableName,
          kind: "type-mismatch",
          column: sc.name,
          detail: `schema=${schemaTok} db=${dbTok}`,
        });
      }
    }

    for (const dc of dbCols) {
      if (!schemaColNames.has(dc.column_name)) {
        findings.push({
          table: tableName,
          kind: "extra-column",
          column: dc.column_name,
          detail: dbTypeToken(dc),
        });
      }
    }
  }

  const missingTables = findings.filter((f) => f.kind === "missing-table");
  const missingCols = findings.filter((f) => f.kind === "missing-column");
  const mismatches = findings.filter((f) => f.kind === "type-mismatch");
  const extras = findings.filter((f) => f.kind === "extra-column");

  const checkedTables = drizzleTables.size;
  console.log(
    `Checked ${checkedTables} Drizzle tables against ${dbTables.size} public tables in DB.`,
  );

  function printGroup(label: string, items: Finding[]) {
    if (items.length === 0) return;
    console.log(`\n${label} (${items.length}):`);
    for (const f of items) {
      const col = f.column ? `.${f.column}` : "";
      const detail = f.detail ? `  [${f.detail}]` : "";
      console.log(`  - ${f.table}${col}${detail}`);
    }
  }

  printGroup("MISSING TABLES (in schema, not in DB)", missingTables);
  printGroup("MISSING COLUMNS (in schema, not in DB)", missingCols);
  printGroup("TYPE MISMATCHES", mismatches);
  printGroup("EXTRA COLUMNS (in DB, not in schema) [warning]", extras);

  await pool.end();

  const hardFailures =
    missingTables.length + missingCols.length + mismatches.length;
  if (hardFailures > 0) {
    console.error(
      `\nSchema drift detected: ${hardFailures} hard failure(s). See above.`,
    );
    process.exit(1);
  }
  console.log("\nNo missing tables/columns or type mismatches. OK.");
}

main().catch(async (err) => {
  console.error(err);
  try {
    await pool.end();
  } catch {
    // ignore
  }
  process.exit(1);
});
