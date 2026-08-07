import pg from "pg";

const devUrl = process.env.DEV_DATABASE_URL || process.env.DATABASE_URL;
const prodUrl = process.env.PROD_DATABASE_URL;
if (!devUrl || !prodUrl) {
  console.error("Need DEV_DATABASE_URL (or DATABASE_URL) and PROD_DATABASE_URL");
  process.exit(1);
}

async function main() {
  const dev = new pg.Client({ connectionString: devUrl });
  const prod = new pg.Client({ connectionString: prodUrl, ssl: { rejectUnauthorized: false } });
  await dev.connect();
  await prod.connect();
  try {
    const devUsers = (await dev.query(`
      SELECT email, first_name, last_name, avatar_url, role, order_id, is_active,
             is_a_list, a_list_joined_at, whop_user_id, current_dfy_phase,
             portal_key, created_at
      FROM portal_users WHERE portal_key='room30'
    `)).rows;
    console.log(`Dev room30 users: ${devUsers.length}`);

    const emails = devUsers.map((u: any) => u.email);
    const devOrders = (await dev.query(
      `SELECT * FROM orders WHERE email = ANY($1::text[])`,
      [emails],
    )).rows;
    console.log(`Dev orders for those emails: ${devOrders.length}`);

    let insertedUsers = 0, updatedUsers = 0;
    for (const u of devUsers) {
      const existing = await prod.query(
        `SELECT id, role FROM portal_users WHERE lower(email)=lower($1) AND portal_key=$2`,
        [u.email, u.portal_key],
      );
      if (existing.rows.length > 0) {
        const ex = existing.rows[0];
        const newRole = u.role === "admin" || ex.role === "admin" ? "admin" : (ex.role || u.role || "user");
        await prod.query(
          `UPDATE portal_users SET
             first_name = COALESCE(first_name, $1),
             last_name = COALESCE(last_name, $2),
             role = $3,
             is_active = COALESCE(is_active, false) OR $4,
             is_a_list = COALESCE(is_a_list, false) OR $5,
             a_list_joined_at = COALESCE(a_list_joined_at, $6),
             whop_user_id = COALESCE(whop_user_id, $7),
             updated_at = now()
           WHERE id = $8`,
          [u.first_name, u.last_name, newRole, !!u.is_active, !!u.is_a_list, u.a_list_joined_at, u.whop_user_id, ex.id],
        );
        updatedUsers++;
      } else {
        await prod.query(
          `INSERT INTO portal_users
             (email, first_name, last_name, avatar_url, role, order_id, is_active,
              is_a_list, a_list_joined_at, whop_user_id, current_dfy_phase,
              portal_key, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, now(), now())`,
          [u.email, u.first_name, u.last_name, u.avatar_url, u.role, u.order_id,
           !!u.is_active, !!u.is_a_list, u.a_list_joined_at, u.whop_user_id,
           u.current_dfy_phase ?? 0, u.portal_key],
        );
        insertedUsers++;
      }
    }
    console.log(`Users -> inserted: ${insertedUsers}, updated: ${updatedUsers}`);

    const orderCols = ["id","email","main_product_paid","upsell1_paid","downsell1_paid","upsell2_paid","upsell3_paid",
      "total_amount","current_step","bump1_paid","bump2_paid","bump3_paid","whop_user_id","whop_receipt_id",
      "whop_membership_id","product_slugs","whop_bundle_plan_id","stripe_customer_id","stripe_session_id",
      "stripe_payment_intent_id","tiktok_slideshow_paid","hook_demo_paid","done_for_you_pack_paid",
      "portfolio_paid","platinum_paid","affiliate_code","affiliate_attributed_at","phone"];

    let insertedOrders = 0, updatedOrders = 0;
    for (const o of devOrders) {
      const values = orderCols.map((c) => o[c] ?? null);
      const placeholders = orderCols.map((_, i) => `$${i + 1}`).join(",");
      const updateSet = orderCols.filter((c) => c !== "id").map((c) => `${c} = EXCLUDED.${c}`).join(", ");
      const res = await prod.query(
        `INSERT INTO orders (${orderCols.join(",")}, created_at, updated_at)
         VALUES (${placeholders}, COALESCE($${orderCols.length + 1}, now()), now())
         ON CONFLICT (id) DO UPDATE SET ${updateSet}, updated_at = now()
         RETURNING (xmax = 0) AS inserted`,
        [...values, o.created_at],
      );
      if (res.rows[0].inserted) insertedOrders++; else updatedOrders++;
    }
    console.log(`Orders -> inserted: ${insertedOrders}, updated: ${updatedOrders}`);

    const finalUsers = (await prod.query(`SELECT portal_key, COUNT(*)::int AS n FROM portal_users GROUP BY portal_key ORDER BY portal_key`)).rows;
    console.log("PROD users now:", finalUsers);
    const finalOrders = (await prod.query(`SELECT COUNT(*)::int AS n FROM orders`)).rows[0];
    console.log("PROD orders now:", finalOrders);
  } finally {
    await dev.end();
    await prod.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
