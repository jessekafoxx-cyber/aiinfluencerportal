import { createHash } from "node:crypto";
import { db } from "@workspace/db";
import { ordersTable, portalUsersTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";

const ALL_PAID_FIELDS = {
  mainProductPaid: true,
  bump1Paid: true,
  bump2Paid: true,
  bump3Paid: true,
  upsell1Paid: true,
  upsell2Paid: true,
  upsell3Paid: true,
  downsell1Paid: true,
  tiktokSlideshowPaid: true,
  hookDemoPaid: true,
  doneForYouPackPaid: true,
  portfolioPaid: true,
  platinumPaid: true,
} as const;

function deterministicOrderId(email: string): string {
  const hash = createHash("sha1").update(email).digest("hex").slice(0, 16);
  return `room30-admin-grant-${hash}`;
}

async function seedRoom30Admin() {
  const emailArg = (process.argv[2] || "").trim().toLowerCase();
  if (!emailArg) {
    console.error(
      "Usage: seed:room30-admin <email> [role]\n" +
        "Refusing to run without an explicit email argument.",
    );
    process.exit(1);
  }
  const email = emailArg;
  // Optional second arg lets you grant a non-admin staff role (e.g. "team"
  // for a contractor who needs to manage users but should not be able to
  // promote anyone else to admin). Defaults to "admin" to preserve the
  // existing behaviour.
  const role = (process.argv[3] || "admin").trim().toLowerCase();
  const portalKey = "room30";

  const [existing] = await db
    .select()
    .from(portalUsersTable)
    .where(and(eq(portalUsersTable.email, email), eq(portalUsersTable.portalKey, portalKey)));

  if (existing) {
    const [updated] = await db
      .update(portalUsersTable)
      .set({
        role,
        isActive: true,
        isAList: true,
        aListJoinedAt: existing.aListJoinedAt || new Date(),
        updatedAt: new Date(),
      })
      .where(eq(portalUsersTable.id, existing.id))
      .returning();
    console.log("Updated Room30 user to admin:", {
      email: updated.email,
      portalKey: updated.portalKey,
      role: updated.role,
      isActive: updated.isActive,
      isAList: updated.isAList,
    });
  } else {
    const [created] = await db
      .insert(portalUsersTable)
      .values({
        email,
        portalKey,
        role,
        isActive: true,
        isAList: true,
        aListJoinedAt: new Date(),
      })
      .returning();
    console.log("Created Room30 admin user:", {
      email: created.email,
      portalKey: created.portalKey,
      role: created.role,
      isActive: created.isActive,
      isAList: created.isAList,
      id: created.id,
    });
  }

  // Upsert a synthetic orders row with every entitlement flag set to true
  // so the buyer sees no lock icons in the Room30 sidebar. Deterministic
  // id keeps this idempotent across re-runs.
  const orderId = deterministicOrderId(email);
  await db
    .insert(ordersTable)
    .values({
      id: orderId,
      email,
      ...ALL_PAID_FIELDS,
    })
    .onConflictDoUpdate({
      target: ordersTable.id,
      set: {
        email,
        ...ALL_PAID_FIELDS,
        updatedAt: new Date(),
      },
    });
  console.log("Upserted full-access order row:", { orderId, email, fields: "ALL_PAID" });

  process.exit(0);
}

seedRoom30Admin().catch((err) => {
  console.error(err);
  process.exit(1);
});
