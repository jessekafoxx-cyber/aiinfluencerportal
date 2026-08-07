import { db } from "@workspace/db";
import { portalUsersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

async function setupAdmin() {
  const email = "greg@cookemedia.io";

  const [existing] = await db.select().from(portalUsersTable).where(eq(portalUsersTable.email, email));

  if (existing) {
    const [updated] = await db.update(portalUsersTable).set({
      role: "admin",
      isActive: true,
      updatedAt: new Date(),
    }).where(eq(portalUsersTable.id, existing.id)).returning();
    console.log("Updated existing user to admin:", updated.email, "role:", updated.role);
  } else {
    const [created] = await db.insert(portalUsersTable).values({
      email,
      firstName: "Greg",
      role: "admin",
      isActive: true,
    }).returning();
    console.log("Created admin user:", created.email, "role:", created.role, "id:", created.id);
  }

  process.exit(0);
}
setupAdmin().catch(console.error);
