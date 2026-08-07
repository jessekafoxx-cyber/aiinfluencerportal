const { ReplitConnectors } = require("@replit/connectors-sdk");
const sheetId = "1BCgnCEvO_A1TePotXvD1Wo2JYUsyp56G_wpV5qj834M";
const connectors = new ReplitConnectors();
(async () => {
  try {
    const meta = await connectors.proxy(
      "google-sheet",
      `/v4/spreadsheets/${encodeURIComponent(sheetId)}`,
      { method: "GET", query: { fields: "sheets.properties(title,index,gridProperties)" } }
    );
    if (meta.ok) {
      const j = await meta.json();
      console.log("TABS:", JSON.stringify(j.sheets?.map(s => s.properties), null, 2));
    } else {
      console.log("META ERR:", meta.status, (await meta.text()).slice(0, 400));
    }
  } catch (e) { console.log("META EXC:", e.message); }
  try {
    const r = await connectors.proxy(
      "google-sheet",
      `/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/${encodeURIComponent("A1:Z20")}`,
      { method: "GET" }
    );
    if (r.ok) {
      const j = await r.json();
      console.log("\nA1:Z20 rows:");
      for (const row of (j.values || [])) console.log("  ", JSON.stringify(row));
    } else { console.log("VAL ERR:", r.status, (await r.text()).slice(0, 400)); }
  } catch (e) { console.log("VAL EXC:", e.message); }
})();
