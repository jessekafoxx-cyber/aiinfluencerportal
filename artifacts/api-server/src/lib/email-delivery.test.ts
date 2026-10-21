import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { build } from "esbuild";

// Run the real sender/enrollment code with an isolated environment, in-memory
// email ledger and mocked provider. Never read credentials or send real mail.
async function loadEmailFlow(env: Record<string, string> = {}) {
  const logs: Record<string, any>[] = [];
  const sends: Record<string, any>[] = [];
  const connectorCalls: string[] = [];
  let rejectSend = false;
  let connectorStatus = 200;
  const table = (name: string, fields: string[]) =>
    Object.fromEntries([["_table", name], ...fields.map((field) => [field, field])]);
  const emailLogsTable = table("emails", ["id", "email", "status", "templateType", "metadata"]);
  const portalUsersTable = table("users", ["id", "email", "clerkId", "isActive"]);
  const doubles = {
    db: {
      select: () => ({
        from: (target: typeof emailLogsTable) => ({
          where: (predicate: (row: any) => boolean) => ({
            limit: async (limit: number) =>
              (target === emailLogsTable ? logs : []).filter(predicate).slice(0, limit),
          }),
        }),
      }),
      insert: () => ({
        values: async (row: Record<string, any>) => { logs.push({ ...row, id: logs.length + 1 }); },
      }),
      update: () => ({ set: () => ({ where: async () => {} }) }),
    },
    emailLogsTable,
    portalUsersTable,
    eq: (key: string, value: unknown) => (row: any) => row[key] === value,
    inArray: (key: string, values: unknown[]) => (row: any) => values.includes(row[key]),
    and: (...predicates: ((row: any) => boolean)[]) =>
      (row: any) => predicates.every((predicate) => predicate(row)),
    sql: (strings: TemplateStringsArray, ...values: any[]) =>
      (row: any) => strings.join("").includes("orderId")
        ? row.metadata?.orderId === values[1]
        : row.email === values[1],
    Resend: class {
      constructor(private apiKey: string) {}
      emails = {
        send: async (message: Record<string, any>) => {
          sends.push({ ...message, key: this.apiKey });
          return rejectSend
            ? { error: { name: "validation_error", message: "Mock provider failure" } }
            : { data: { id: `mock-message-${sends.length}` } };
        },
      };
    },
    logger: { warn() {}, error() {}, info() {} },
    clerkClient: {},
  };
  const stubs: Record<string, string[]> = {
    "@workspace/db": ["db", "emailLogsTable", "portalUsersTable"],
    "drizzle-orm": ["eq", "inArray", "and", "sql"],
    resend: ["Resend"],
    "./logger": ["logger"],
    "./logger.ts": ["logger"],
    "./auth-compat": ["clerkClient"],
  };
  const bundle = await build({
    stdin: {
      contents: 'export { sendEmail } from "./email"; export { enrollPurchaserAndSendEmail } from "./purchase-enrollment";',
      resolveDir: import.meta.dirname,
      loader: "ts",
    },
    bundle: true,
    write: false,
    platform: "node",
    format: "cjs",
    plugins: [{
      name: "isolated-email-dependencies",
      setup(plugin) {
        plugin.onResolve({ filter: /.*/ }, (args) =>
          stubs[args.path] ? { path: args.path, namespace: "email-test" } : undefined);
        plugin.onLoad({ filter: /.*/, namespace: "email-test" }, (args) => ({
          contents: stubs[args.path].map((name) =>
            `export const ${name} = globalThis.testDoubles.${name};`).join("\n"),
        }));
      },
    }],
  });
  const module = { exports: {} as any };
  runInNewContext(bundle.outputFiles[0].text, {
    module, exports: module.exports, testDoubles: doubles,
    process: { env: { ...env } },
    console: { error() {}, warn() {}, log() {} },
    URL,
    fetch: async (url: string) => {
      connectorCalls.push(url);
      return {
        ok: connectorStatus === 200,
        status: connectorStatus,
        json: async () => ({ items: [{ settings: { api_key: "mock-connector-key" } }] }),
      };
    },
  });
  return {
    ...module.exports, logs, sends, connectorCalls,
    rejectProvider: (reject: boolean) => { rejectSend = reject; },
    setConnectorStatus: (status: number) => { connectorStatus = status; },
  };
}

const message = {
  email: "buyer@example.test",
  subject: "Test",
  body: "Test email",
  templateType: "test",
};

test("configured key works without a connector and retains branded sender", async () => {
  const flow = await loadEmailFlow({ RESEND_API_KEY: "mock-project-key" });
  const result = await flow.sendEmail(message);
  assert.equal(result.status, "sent");
  assert.equal(flow.sends[0].key, "mock-project-key");
  assert.equal(flow.sends[0].from, "AI Influencer Portfolio <team@aiinfluencerpublishing.com>");
  assert.equal(flow.connectorCalls.length, 0);
  assert.equal(flow.logs[0].status, "sent");
  assert.equal(flow.logs[0].messageId, "mock-message-1");
});

test("connector configuration remains supported when no explicit key exists", async () => {
  const flow = await loadEmailFlow({
    REPLIT_CONNECTORS_HOSTNAME: "connector.example.test", REPL_IDENTITY: "mock-identity",
  });
  assert.equal((await flow.sendEmail(message)).status, "sent");
  assert.equal(flow.sends[0].key, "mock-connector-key");
  assert.equal(flow.connectorCalls.length, 1);
});

test("explicit key takes priority over a connector and respects sender override", async () => {
  const flow = await loadEmailFlow({
    RESEND_API_KEY: "mock-project-key",
    RESEND_FROM_EMAIL: "Test Sender <sender@example.test>",
    REPLIT_CONNECTORS_HOSTNAME: "connector.example.test", REPL_IDENTITY: "mock-identity",
  });
  assert.equal((await flow.sendEmail(message)).status, "sent");
  assert.equal(flow.sends[0].key, "mock-project-key");
  assert.equal(flow.sends[0].from, "Test Sender <sender@example.test>");
  assert.equal(flow.connectorCalls.length, 0);
});

test("missing sender configuration fails explicitly and records the failed attempt", async () => {
  const flow = await loadEmailFlow();
  assert.equal((await flow.sendEmail(message)).status, "failed");
  assert.equal(flow.logs[0].status, "failed");
  assert.match(flow.logs[0].metadata.error, /credentials not available/);
  assert.equal(flow.sends.length, 0);
});

test("connector HTTP failures are logged rather than treated as valid settings", async () => {
  const flow = await loadEmailFlow({
    REPLIT_CONNECTORS_HOSTNAME: "connector.example.test", REPL_IDENTITY: "mock-identity",
  });
  flow.setConnectorStatus(503);
  assert.equal((await flow.sendEmail(message)).status, "failed");
  assert.equal(flow.logs[0].metadata.error, "Resend connector lookup failed (HTTP 503)");
  assert.equal(flow.sends.length, 0);
});

test("failed enrollment can retry; successful enrollment suppresses later duplicates", async () => {
  const flow = await loadEmailFlow({ RESEND_API_KEY: "mock-project-key" });
  const purchase = { email: message.email, orderId: "mock-order-1" };
  flow.rejectProvider(true);
  assert.equal((await flow.enrollPurchaserAndSendEmail(purchase)).status, "failed");
  assert.equal(flow.logs[0].status, "failed");
  flow.rejectProvider(false);
  assert.equal((await flow.enrollPurchaserAndSendEmail(purchase)).status, "sent");
  assert.equal(flow.sends.length, 2);
  assert.equal((await flow.enrollPurchaserAndSendEmail(purchase)).reason, "already_sent");
  assert.equal(flow.sends.length, 2);
  assert.equal((await flow.enrollPurchaserAndSendEmail({ ...purchase, orderId: "mock-order-2" })).status, "sent");
  assert.equal(flow.sends.length, 3);
});
