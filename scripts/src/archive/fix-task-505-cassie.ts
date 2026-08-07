/**
 * Task #505: One-off recovery for Cassie Nicole (cassienicole@mailbox.org).
 *
 * Symptoms reported:
 *   - Cassie hit the /sep2026-checkout flow and saw "Payment Complete"
 *     without an actual charge clearing on Whop/Stripe (frontend bug
 *     fixed in this same task by the verify-whop hardening).
 *   - She is already on the Portugal-CSV grant list, so her room30
 *     portal access is meant to be FULL. No new charge is owed.
 *   - The duplicate-insert path produced two portal_users rows for her
 *     email: id 65 (portal_key='main', is_a_list=true, no clerk_id) and
 *     id 132 (portal_key='room30', is_a_list=false, with clerk_id).
 *
 * This script:
 *   1. Merges the two portal_users rows into one canonical row keyed by
 *      lower(email): keep is_a_list=true, a_list_joined_at preserved
 *      ('2026-05-14 21:38:27.742'), portal_key='room30', the live
 *      clerk_id from the Clerk-created row, and isActive=true. Repoints
 *      any soft user_id references from the loser to the winner before
 *      deleting the loser, then leaves migration 0049's lower(email)
 *      unique index to guarantee this can't re-occur.
 *   2. Sends Cassie a personal support email confirming no charge
 *      happened and reassuring her that her Room30 access is intact.
 *
 * The merge step is also performed at scale by migration
 * 0049_t505_portal_users_email_unique.sql; this script is the manual
 * pre-migration safety net plus the email side effect (which the
 * migration cannot do).
 *
 * Usage:
 *   DRY_RUN=1 pnpm --filter @workspace/scripts run fix:task-505-cassie
 *   pnpm --filter @workspace/scripts run fix:task-505-cassie -- --apply
 */

import { and, eq, sql } from "drizzle-orm";
import { db, portalUsersTable } from "@workspace/db";
import { sendEmail } from "../../../artifacts/api-server/src/lib/email";

const CASSIE_EMAIL = "cassienicole@mailbox.org";
const APPLY = process.argv.includes("--apply") || process.env.DRY_RUN === "0";

async function main(): Promise<void> {
  const mode = APPLY ? "APPLY" : "DRY-RUN";
  console.log(`[fix-task-505-cassie] mode=${mode} email=${CASSIE_EMAIL}`);

  const rows = await db
    .select()
    .from(portalUsersTable)
    .where(sql`lower(${portalUsersTable.email}) = lower(${CASSIE_EMAIL})`);

  if (rows.length === 0) {
    console.log("[fix-task-505-cassie] no portal_users row found - nothing to do");
    return;
  }

  console.log(
    `[fix-task-505-cassie] found ${rows.length} portal_users row(s):`,
    rows.map((r) => ({ id: r.id, portalKey: r.portalKey, isAList: r.isAList, aListJoinedAt: r.aListJoinedAt, clerkId: r.clerkId })),
  );

  // Winner selection: prefer is_a_list=true, then oldest created_at, then smallest id.
  const sorted = [...rows].sort((a, b) => {
    if (!!a.isAList !== !!b.isAList) return a.isAList ? -1 : 1;
    const aT = a.createdAt ? new Date(a.createdAt).getTime() : Infinity;
    const bT = b.createdAt ? new Date(b.createdAt).getTime() : Infinity;
    if (aT !== bT) return aT - bT;
    return a.id - b.id;
  });
  const winner = sorted[0];
  const losers = sorted.slice(1);

  if (losers.length === 0) {
    console.log(`[fix-task-505-cassie] only one row (id ${winner.id}) - sending support email only`);
  } else {
    const donorClerk = losers.find((l) => l.clerkId)?.clerkId ?? null;
    const donorWhop = losers.find((l) => l.whopUserId)?.whopUserId ?? null;
    const donorOrder = losers.find((l) => l.orderId)?.orderId ?? null;
    console.log(
      `[fix-task-505-cassie] winner=${winner.id} losers=${losers.map((l) => l.id).join(",")} donorClerk=${donorClerk}`,
    );

    if (APPLY) {
      await db.transaction(async (tx) => {
        await tx.update(portalUsersTable)
          .set({
            clerkId: winner.clerkId ?? donorClerk,
            whopUserId: winner.whopUserId ?? donorWhop,
            orderId: winner.orderId ?? donorOrder,
            portalKey: "room30",
            isActive: true,
            isAList: true,
            aListJoinedAt: winner.aListJoinedAt ?? new Date("2026-05-14T21:38:27.742Z"),
            updatedAt: new Date(),
          })
          .where(eq(portalUsersTable.id, winner.id));

        // Free up the unique clerk_id from losers before delete.
        for (const l of losers) {
          await tx.update(portalUsersTable)
            .set({ clerkId: null })
            .where(eq(portalUsersTable.id, l.id));
        }

        const loserIds = losers.map((l) => l.id);
        // Repoint every public integer user_id column from losers to winner.
        await tx.execute(sql`
          DO $$
          DECLARE col RECORD;
          BEGIN
            FOR col IN
              SELECT table_schema, table_name, column_name
                FROM information_schema.columns
               WHERE table_schema = 'public'
                 AND column_name = 'user_id'
                 AND data_type = 'integer'
                 AND table_name <> 'portal_users'
            LOOP
              EXECUTE format(
                'UPDATE %I.%I SET %I = $1 WHERE %I = ANY($2)',
                col.table_schema, col.table_name, col.column_name, col.column_name
              ) USING ${winner.id}::int, ARRAY[${sql.raw(loserIds.join(","))}]::int[];
            END LOOP;
          END$$;
        `);

        for (const l of losers) {
          await tx.delete(portalUsersTable).where(eq(portalUsersTable.id, l.id));
        }
      });
      console.log(`[fix-task-505-cassie] merged into id ${winner.id}`);
    } else {
      console.log("[fix-task-505-cassie] (dry-run) would merge losers into winner");
    }
  }

  const subject = "About your Portugal Retreat checkout - quick clarification";
  const body = [
    `Hi Cassie,`,
    ``,
    `Greg here. You mentioned you hit a "Payment Complete" screen on the Portugal Retreat checkout earlier but weren't sure whether you'd actually been charged - I just want to confirm directly:`,
    ``,
    `1. No payment was taken from your card. We verified on both Whop and Stripe and there is no charge against your account from this checkout attempt. There is nothing for us to refund and nothing for you to dispute.`,
    `2. The "Payment Complete" screen you saw was a frontend bug on our end which we have now patched. The page should only ever show that message after a real, confirmed Whop receipt clears - it slipped through in an edge case and we are sorry for the moment of confusion.`,
    `3. Your Room30 portal access is unchanged and fully unlocked. You're on the Portugal attendee list and your A-List membership is active, so everything you had access to before is still there - no action needed from you.`,
    ``,
    `If you want to revisit the Portugal Retreat 2026 separately, the checkout link is the same one as before and is now safe to use. If anything looks off when you log in, hit reply on this email and I'll sort it out personally.`,
    ``,
    `Thanks for flagging this - it genuinely helped us catch the bug before anyone else hit it.`,
    ``,
    `- Greg`,
  ].join("\n");

  if (APPLY) {
    await sendEmail({
      email: CASSIE_EMAIL,
      subject,
      body,
      templateType: "task_505_cassie_support",
      metadata: { task: 505, winnerPortalUserId: winner.id },
      replyTo: "greg@cookemedia.io",
    });
    console.log(`[fix-task-505-cassie] support email sent to ${CASSIE_EMAIL}`);
  } else {
    console.log(`[fix-task-505-cassie] (dry-run) would send support email to ${CASSIE_EMAIL}:`);
    console.log("---SUBJECT---");
    console.log(subject);
    console.log("---BODY---");
    console.log(body);
    console.log("---END---");
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error("[fix-task-505-cassie] failed:", err);
    process.exit(1);
  },
);
