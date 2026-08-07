import { db } from "@workspace/db";
import {
  portalUsersTable,
  aListRoadmapTable,
  dfyBuildAssetsTable,
  dfyClientUpdatesTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";

async function main() {
  const email = "greg@cookemedia.io";
  const [target] = await db
    .select()
    .from(portalUsersTable)
    .where(eq(portalUsersTable.email, email));
  if (!target) {
    console.error(`No portal user for ${email}`);
    process.exit(1);
  }

  const [milestones, assets, updates] = await Promise.all([
    db.select().from(aListRoadmapTable).where(eq(aListRoadmapTable.userId, target.id)),
    db.select().from(dfyBuildAssetsTable).where(eq(dfyBuildAssetsTable.userId, target.id)),
    db.select().from(dfyClientUpdatesTable).where(eq(dfyClientUpdatesTable.userId, target.id)),
  ]);

  if (milestones.length || assets.length || updates.length) {
    console.log(
      `Already seeded (milestones=${milestones.length}, assets=${assets.length}, updates=${updates.length}). Setting phase=2 + isAList=true and exiting.`
    );
    await db
      .update(portalUsersTable)
      .set({
        currentDfyPhase: 2,
        isAList: true,
        aListJoinedAt: target.aListJoinedAt ?? new Date(),
        updatedAt: new Date(),
      })
      .where(eq(portalUsersTable.id, target.id));
    process.exit(0);
  }

  await db
    .update(portalUsersTable)
    .set({
      currentDfyPhase: 2,
      isAList: true,
      aListJoinedAt: target.aListJoinedAt ?? new Date(),
      updatedAt: new Date(),
    })
    .where(eq(portalUsersTable.id, target.id));

  const now = Date.now();
  const day = 86400000;

  const milestonesData = [
    { milestone: "War Map call booked", description: "30-minute strategy session locked in.", status: "completed", phaseNumber: 1, sortOrder: 10, completedAt: new Date(now - 18 * day), targetDate: new Date(now - 18 * day) },
    { milestone: "Offer math approved", description: "Price, margins and rev targets signed off.", status: "completed", phaseNumber: 1, sortOrder: 20, completedAt: new Date(now - 17 * day), targetDate: new Date(now - 17 * day) },
    { milestone: "Build brief delivered", description: "Final brief sent to the build team.", status: "completed", phaseNumber: 1, sortOrder: 30, completedAt: new Date(now - 16 * day), targetDate: new Date(now - 16 * day) },
    { milestone: "Cold open recordings finalized", description: "Three top-of-funnel hooks recorded and approved.", status: "completed", phaseNumber: 2, sortOrder: 40, completedAt: new Date(now - 9 * day), targetDate: new Date(now - 9 * day) },
    { milestone: "Funnel pages built", description: "Sales page, order form, upsell and thank-you live in staging.", status: "in-progress", phaseNumber: 2, sortOrder: 50, targetDate: new Date(now + 3 * day) },
    { milestone: "Email sequences written", description: "Welcome, post-purchase and abandoned cart drafted.", status: "in-progress", phaseNumber: 2, sortOrder: 60, targetDate: new Date(now + 5 * day) },
    { milestone: "Ad creative cut and queued", description: "Six static and four video creatives produced.", status: "upcoming", phaseNumber: 2, sortOrder: 70, targetDate: new Date(now + 7 * day) },
    { milestone: "Launch call scheduled", description: "Walk through the live funnel and push it live with Greg.", status: "upcoming", phaseNumber: 3, sortOrder: 80, targetDate: new Date(now + 12 * day) },
    { milestone: "First 7-day push", description: "Daily review of performance and quick fixes.", status: "upcoming", phaseNumber: 3, sortOrder: 90, targetDate: new Date(now + 19 * day) },
    { milestone: "Weekly workshop access", description: "Standing live workshops every Tuesday for 12 weeks.", status: "upcoming", phaseNumber: 4, sortOrder: 100, targetDate: new Date(now + 14 * day) },
  ];
  await db.insert(aListRoadmapTable).values(milestonesData.map((m: any) => ({ ...m, userId: target.id })));

  const assetsData = [
    { title: "Cold open recordings - master folder", category: "creative", assetType: "link" as const, url: "https://drive.google.com/drive/folders/cold-opens-demo", notes: "All three hooks plus B-roll. Final cuts approved.", status: "ready" as const, phaseNumber: 2, sortOrder: 10 },
    { title: "Funnel build - staging link", category: "funnel", assetType: "link" as const, url: "https://staging.apexoffers.io/cooke", notes: "Sales page, order form and upsell. Final QA pass underway.", status: "in-progress" as const, phaseNumber: 2, sortOrder: 20 },
    { title: "Welcome email sequence (5 emails)", category: "emails", assetType: "doc" as const, url: "https://docs.google.com/document/d/welcome-seq-demo", notes: "Day 0 to day 14, indoctrination plus first soft pitch.", status: "needs-review" as const, phaseNumber: 2, sortOrder: 30 },
    { title: "Ad creative pack - V1", category: "ads", assetType: "link" as const, url: "https://drive.google.com/drive/folders/ad-pack-v1", notes: "Six statics and four 30-second videos. Ready to upload to Ads Manager.", status: "ready" as const, phaseNumber: 2, sortOrder: 40 },
    { title: "Automation map (Zapier)", category: "automation", assetType: "doc" as const, url: "https://miro.com/board/automation-map-demo", notes: "Lead capture into CRM, tag application, slack alerts on purchase.", status: "in-progress" as const, phaseNumber: 2, sortOrder: 50 },
    { title: "War Map document - final", category: "war-map", assetType: "doc" as const, url: "https://docs.google.com/document/d/war-map-final-demo", notes: "Locked offer, math, build scope and launch plan.", status: "ready" as const, phaseNumber: 1, sortOrder: 10 },
  ];
  await db.insert(dfyBuildAssetsTable).values(assetsData.map((a: any) => ({ ...a, userId: target.id })));

  const updatesData = [
    { authorRole: "admin", authorName: "Apex Build Team", kind: "update", title: "Build kickoff complete", body: "Funnel pages are wireframed and the copy is in review. We will have a staging link for you by end of day Thursday.", phaseNumber: 2, status: "open" },
    { authorRole: "admin", authorName: "Apex Build Team", kind: "request", title: "Brand assets needed", body: "Please drop your logo (SVG and PNG transparent), brand fonts and three hero shots in the shared folder so we can finalize the funnel pages.", phaseNumber: 2, status: "open" },
    { authorRole: "client", authorName: "Gregory Cooke", kind: "reply", title: null, body: "Logo and fonts uploaded to the Drive folder. Hero shots coming Tuesday from the photo shoot.", phaseNumber: 2, status: "open" },
    { authorRole: "admin", authorName: "Apex Build Team", kind: "update", title: "Cold open recordings approved", body: "Hook 3 tested strongest in the focus pull. We are leading the ad rotation with that one.", phaseNumber: 2, status: "open" },
    { authorRole: "admin", authorName: "Apex Build Team", kind: "update", title: "War Map locked", body: "Offer math approved, build brief signed off and handed to the team. Phase 2 is officially in motion.", phaseNumber: 1, status: "answered" },
  ];
  await db.insert(dfyClientUpdatesTable).values(updatesData.map((u: any) => ({ ...u, userId: target.id })));

  console.log(`Seeded Greg (id=${target.id}) with phase=2, ${milestonesData.length} milestones, ${assetsData.length} assets, ${updatesData.length} updates.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
