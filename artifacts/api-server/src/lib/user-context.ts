import { db } from "@workspace/db";
import {
  portalUsersTable,
  lessonProgressTable,
  lessonsTable,
  coursePhasesTable,
  userAssetsTable,
  ordersTable,
  leaderboardProfilesTable,
  leaderboardRevenueTable,
  aListTasksTable,
  aListRoadmapTable,
  aListCallsTable,
  gregAiConversationsTable,
  userBrainProfilesTable,
} from "@workspace/db";
import { eq, and, desc, asc, count, sql } from "drizzle-orm";
import { getPrebuiltBrain } from "./prebuilt-brains.js";

// portalKey scopes which portal's curriculum we count for "X / Y lessons"
// math and which phases the chat assistant references. Defaults to 'main'
// for callers that haven't been threaded through yet (legacy / cron paths).
export async function getUserContext(
  userId: number,
  userEmail: string,
  portalKey: string = "main",
): Promise<string> {
  const sections: string[] = [];

  try {
    const progress = await db.select({
      lessonTitle: lessonsTable.title,
      lessonSlug: lessonsTable.slug,
      phaseTitle: coursePhasesTable.title,
      phaseSlug: coursePhasesTable.slug,
      completed: lessonProgressTable.completed,
      actionTaskCompleted: lessonProgressTable.actionTaskCompleted,
      watchTimeSeconds: lessonProgressTable.watchTimeSeconds,
      promptData: lessonProgressTable.promptData,
    })
    .from(lessonProgressTable)
    .innerJoin(lessonsTable, eq(lessonProgressTable.lessonId, lessonsTable.id))
    .innerJoin(coursePhasesTable, eq(lessonsTable.phaseId, coursePhasesTable.id))
    .where(and(
      eq(lessonProgressTable.userId, userId),
      eq(lessonsTable.portalKey, portalKey),
    ))
    .orderBy(asc(coursePhasesTable.sortOrder), asc(lessonsTable.sortOrder));

    if (progress.length > 0) {
      const completed = progress.filter(p => p.completed);
      const actionsDone = progress.filter(p => p.actionTaskCompleted);
      const totalWatch = progress.reduce((s, p) => s + (p.watchTimeSeconds || 0), 0);
      const watchHours = Math.round(totalWatch / 3600 * 10) / 10;

      const totalLessonsQuery = await db.select({ count: count() })
        .from(lessonsTable)
        .where(eq(lessonsTable.portalKey, portalKey));
      const totalLessons = totalLessonsQuery[0]?.count || 45;

      const accessedPhases = [...new Set(progress.map(p => p.phaseSlug))];
      const accessedBeyondPhase1 = accessedPhases.some(p => p !== "the-strategy");

      sections.push(`COURSE PROGRESS:
- Completed ${completed.length}/${totalLessons} lessons (${Math.round(completed.length / Number(totalLessons) * 100)}%)
- Action tasks completed: ${actionsDone.length}
- Total watch time: ${watchHours} hours
- Phases accessed: ${[...new Set(progress.map(p => p.phaseTitle))].join(", ")}
- Has accessed beyond Phase 1: ${accessedBeyondPhase1 ? "YES" : "NO"}
- Completed lessons: ${completed.map(c => c.lessonTitle).join(", ") || "None yet"}
- In progress / not started: ${progress.filter(p => !p.completed).map(p => `${p.phaseTitle} > ${p.lessonTitle}`).join(", ") || "All done!"}`);

      const promptEntries = progress.filter(p => p.promptData && Object.keys(p.promptData as any).length > 0);
      if (promptEntries.length > 0) {
        const promptSummaries = promptEntries.map(p => {
          const data = p.promptData as Record<string, any>;
          const preview = JSON.stringify(data).slice(0, 300);
          return `  - ${p.lessonTitle}: ${preview}`;
        }).join("\n");
        sections.push(`PROMPT/EXERCISE RESPONSES:\n${promptSummaries}`);
      }
    } else {
      sections.push("COURSE PROGRESS: Has not started any lessons yet.");
    }
  } catch (e) {}

  try {
    const assets = await db.select()
      .from(userAssetsTable)
      .where(eq(userAssetsTable.userId, userId))
      .orderBy(desc(userAssetsTable.updatedAt));

    if (assets.length > 0) {
      const byCategory: Record<string, typeof assets> = {};
      for (const a of assets) {
        if (!byCategory[a.category]) byCategory[a.category] = [];
        byCategory[a.category].push(a);
      }

      const assetLines = Object.entries(byCategory).map(([cat, items]) => {
        const itemSummaries = items.slice(0, 5).map(i => {
          const preview = (i.content || "").replace(/<[^>]*>/g, "").slice(0, 200);
          return `    - "${i.title}" ${i.lessonSlug ? `(from lesson: ${i.lessonSlug})` : ""}: ${preview}`;
        }).join("\n");
        return `  ${cat} (${items.length} items):\n${itemSummaries}`;
      }).join("\n");

      sections.push(`USER'S SAVED ASSETS & DOCS (${assets.length} total):\n${assetLines}`);
    }
  } catch (e) {}

  try {
    const [order] = await db.select().from(ordersTable)
      .where(eq(ordersTable.email, userEmail))
      .orderBy(desc(ordersTable.createdAt))
      .limit(1);

    if (order) {
      const purchases: string[] = [];
      if (order.mainProductPaid) purchases.push("Apex Offers Main ($27)");
      if (order.bump1Paid) purchases.push("VSL Vault (legacy $47)");
      if (order.bump2Paid) purchases.push("Daily Ad Research Board ($37)");
      if (order.bump3Paid) purchases.push("IG Follower Hijack ($27)");
      if (order.upsell1Paid) purchases.push("AI Coach Monthly ($197/mo)");
      if (order.downsell1Paid) purchases.push("AI Coach 7-Day Trial ($197/mo after trial)");
      if (order.upsell2Paid) purchases.push("Our Portfolio - 47 products + 5 AI Influencers ($297)");
      if (order.upsell3Paid) purchases.push("1-1 Strategy Call ($497)");
      const total = (order.totalAmount || 0) / 100;
      sections.push(`PURCHASES: ${purchases.join(", ")} | Total spent: $${total}`);
    }
  } catch (e) {}

  try {
    const [profile] = await db.select().from(leaderboardProfilesTable)
      .where(eq(leaderboardProfilesTable.userId, userId));

    if (profile) {
      const revenue = await db.select({
        total: sql<number>`COALESCE(SUM(${leaderboardRevenueTable.amount}), 0)`,
        saleCount: count(),
      }).from(leaderboardRevenueTable)
        .where(eq(leaderboardRevenueTable.profileId, profile.id));

      const totalRev = (revenue[0]?.total || 0) / 100;
      sections.push(`LEADERBOARD: Tag: ${profile.tagName} | Niche: ${profile.niche || "Not set"} | Revenue: $${totalRev} (${revenue[0]?.saleCount || 0} sales) | Whop connected: ${profile.isConnected ? "Yes" : "No"}`);
    }
  } catch (e) {}

  try {
    const user = await db.select().from(portalUsersTable).where(eq(portalUsersTable.id, userId));
    if (user[0]?.isAList) {
      const tasks = await db.select().from(aListTasksTable)
        .where(eq(aListTasksTable.userId, userId))
        .orderBy(desc(aListTasksTable.createdAt))
        .limit(10);

      const roadmap = await db.select().from(aListRoadmapTable)
        .where(eq(aListRoadmapTable.userId, userId))
        .orderBy(asc(aListRoadmapTable.sortOrder));

      const calls = await db.select().from(aListCallsTable)
        .where(eq(aListCallsTable.userId, userId))
        .orderBy(desc(aListCallsTable.callDate))
        .limit(5);

      const aListParts: string[] = ["A-LIST MEMBER"];
      if (tasks.length > 0) {
        const taskSummary = tasks.map(t => `  - [${t.status}] ${t.title}`).join("\n");
        aListParts.push(`Tasks:\n${taskSummary}`);
      }
      if (roadmap.length > 0) {
        const roadmapSummary = roadmap.map(r => `  - [${r.status}] ${r.milestone}`).join("\n");
        aListParts.push(`Roadmap:\n${roadmapSummary}`);
      }
      if (calls.length > 0) {
        const callSummary = calls.map(c => `  - ${c.title} (${c.callDate?.toLocaleDateString()})${c.notes ? `: ${c.notes.slice(0, 150)}` : ""}`).join("\n");
        aListParts.push(`Recent calls:\n${callSummary}`);
      }
      sections.push(aListParts.join("\n"));
    }
  } catch (e) {}

  try {
    const recentConvos = await db.select({
      title: gregAiConversationsTable.title,
      messageCount: gregAiConversationsTable.messageCount,
      lastMessageAt: gregAiConversationsTable.lastMessageAt,
    })
    .from(gregAiConversationsTable)
    .where(eq(gregAiConversationsTable.userId, userId))
    .orderBy(desc(gregAiConversationsTable.lastMessageAt))
    .limit(5);

    if (recentConvos.length > 0) {
      const convoSummary = recentConvos.map(c =>
        `  - "${c.title}" (${c.messageCount} msgs, ${c.lastMessageAt?.toLocaleDateString() || "unknown"})`
      ).join("\n");
      sections.push(`RECENT AI COACH CONVERSATIONS:\n${convoSummary}`);
    }
  } catch (e) {}

  try {
    const [brainProfile] = await db.select().from(userBrainProfilesTable).where(eq(userBrainProfilesTable.userId, userId));
    if (brainProfile) {
      // Prebuilt-brain mode: the user picked one of our curated brains so they
      // can promote one of OUR offers through the OS tools. Use the catalog
      // entry as the source of truth instead of their own (mostly empty) row.
      // Room30 has no curated-brain catalogue; ignore any persisted
      // prebuilt selection so OS tools never sell an Apex Offer through
      // the Room30 portal.
      if (
        portalKey !== "room30"
        && brainProfile.brainMode === "prebuilt"
        && brainProfile.selectedPrebuiltBrainId
      ) {
        const pre = getPrebuiltBrain(brainProfile.selectedPrebuiltBrainId);
        if (pre) {
          const brainParts: string[] = [
            `ACTIVE BRAIN: PRE-BUILT — "${pre.name}"`,
            `The user has chosen to promote one of our offers using a curated brain. Treat them as a partner selling THIS offer; do not invent a different business for them.`,
            `Offer name: ${pre.name}`,
            `Tagline: ${pre.tagline}`,
            `What it is: ${pre.shortDescription}`,
            `Audience: ${pre.audience}`,
            `Proof / highlights: ${pre.highlights.join("; ")}`,
            `Brain reference (first 2000 chars): ${pre.generatedBrain.substring(0, 2000)}`,
          ];
          sections.push(brainParts.join("\n"));
        }
      } else if (brainProfile.status === "generated" && brainProfile.generatedBrain) {
        const brainParts: string[] = [`USER'S BRAIN PROFILE (their business identity):`];
        if (brainProfile.name) brainParts.push(`Name: ${brainProfile.name}`);
        if (brainProfile.companyName) brainParts.push(`Company: ${brainProfile.companyName}`);
        if (brainProfile.whoDoYouHelp) brainParts.push(`Who they help: ${brainProfile.whoDoYouHelp}`);
        if (brainProfile.howDoYouHelpThem) brainParts.push(`How they help: ${brainProfile.howDoYouHelpThem}`);
        if (brainProfile.keyAchievements) brainParts.push(`Key achievements: ${brainProfile.keyAchievements}`);
        if (brainProfile.brandColorPrimary) brainParts.push(`Brand colors: Primary ${brainProfile.brandColorPrimary}, Secondary ${brainProfile.brandColorSecondary || "N/A"}`);
        const brainText = brainProfile.generatedBrain.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        brainParts.push(`Generated brain summary (first 2000 chars): ${brainText.substring(0, 2000)}`);
        sections.push(brainParts.join("\n"));
      }
    }
  } catch (e) {}

  if (sections.length === 0) return "";
  return "\n\n---\nUSER CONTEXT (use this to personalize your response — DO NOT reveal raw data, just use it naturally):\n" + sections.join("\n\n") + "\n---";
}
