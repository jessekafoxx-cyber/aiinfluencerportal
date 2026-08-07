import { db } from "@workspace/db";
import { portalUsersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

async function linkClerk() {
  const [updated] = await db.update(portalUsersTable).set({
    clerkId: "user_3ByQ90Ah9MCXxET9nxi1DPirqT7",
    updatedAt: new Date(),
  }).where(eq(portalUsersTable.email, "greg@cookemedia.io")).returning();
  console.log("Linked Clerk ID to admin user:", updated.email, "clerk:", updated.clerkId);
  process.exit(0);
}
linkClerk().catch(console.error);
