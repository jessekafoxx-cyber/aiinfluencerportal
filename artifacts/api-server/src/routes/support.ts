import { Router } from "express";
import { getAuth } from "../lib/auth-compat";
import { db } from "@workspace/db";
import {
  portalUsersTable,
  supportArticlesTable,
  supportChatsTable,
  lessonProgressTable,
  lessonsTable,
  coursePhasesTable,
  ordersTable,
  accessLogsTable,
} from "@workspace/db";
import { eq, and, desc, asc, ilike, or, sql } from "drizzle-orm";
import OpenAI from "openai";
import { getUserContext } from "../lib/user-context";
import { getPortalKey } from "../lib/portal-key";

const supportRouter = Router();

const requireAuth = async (req: any, res: any, next: any) => {
  const auth = getAuth(req);
  const userId = auth?.sessionClaims?.userId || auth?.userId;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" }); return;
  }
  req.clerkId = userId;

  const [user] = await db
    .select()
    .from(portalUsersTable)
    .where(eq(portalUsersTable.clerkId, String(userId)));
  if (!user) {
    res.status(403).json({ error: "User not found" }); return;
  }
  req.portalUser = user;
  next();
};

supportRouter.get("/portal/support/articles", requireAuth, async (req: any, res) => {
  try {
    const { search, category } = req.query;
    let query = db
      .select()
      .from(supportArticlesTable)
      .where(eq(supportArticlesTable.isPublished, true))
      .orderBy(asc(supportArticlesTable.sortOrder));

    const articles = await query;

    let filtered = articles;
    if (category && category !== "all") {
      filtered = filtered.filter((a) => a.category === category);
    }
    if (search && typeof search === "string" && search.trim()) {
      const s = search.toLowerCase();
      filtered = filtered.filter(
        (a) =>
          a.title.toLowerCase().includes(s) ||
          (a.summary && a.summary.toLowerCase().includes(s)) ||
          a.content.toLowerCase().includes(s)
      );
    }

    res.json({
      articles: filtered.map((a) => ({
        id: a.id,
        slug: a.slug,
        title: a.title,
        category: a.category,
        summary: a.summary,
      })),
    });
    return;
  } catch (error: any) {
    console.error("Error fetching articles:", error?.message);
    res.status(500).json({ error: "Failed to fetch articles" });
    return;
  }
});

supportRouter.get("/portal/support/articles/:slug", requireAuth, async (req: any, res) => {
  try {
    const [article] = await db
      .select()
      .from(supportArticlesTable)
      .where(
        and(
          eq(supportArticlesTable.slug, req.params.slug),
          eq(supportArticlesTable.isPublished, true)
        )
      );
    if (!article) { res.status(404).json({ error: "Article not found" }); return; }
    res.json({ article });
    return;
  } catch (error: any) {
    console.error("Error fetching article:", error?.message);
    res.status(500).json({ error: "Failed to fetch article" });
    return;
  }
});

const KNOWLEDGE_BASE = `
You are the AI Support Assistant for AI Influencer Portfolio — the operating system for building and running an AI-powered influencer business.

ABOUT THE PRODUCT:
- AI Influencer Portfolio pairs a full Masterclass with AI tools, Done For You assets, and templates members need to ship offers, run ads, and grow a portfolio of digital products.
- The portal includes: Dashboard, Masterclass, Your Brain, Operating System, My Influencers, Done For You Pack, Platinum Club, Ad Research Board, 2,000 Hook Library, Leaderboard, and more.
- Premium add-ons (Done For You Pack, Platinum Club, individual AI Influencers, etc.) are unlocked separately — they appear in the sidebar with a price if not yet owned.

ABOUT THE PLATFORM:
- Each Masterclass lesson has Brief, Notes, and Build (AI prompts) tabs.
- Videos are streamed via Wistia — they cannot be downloaded.
- Progress is tracked per lesson via Mark as Complete.
- OS tools and AI assistants use credits shown in the sidebar pill.
- Your Brain is the shared AI knowledge base every tool reads from — fill it in once with niche, voice, offers, and audience.

SUPPORT GUIDELINES:
- Be helpful, friendly, and encouraging.
- Speak like a knowledgeable team member who genuinely cares.
- If you don't know the answer, say so honestly and offer to pass the conversation to the team.
- For technical issues (login, access, video playback), provide clear troubleshooting steps.
- Always be professional and solution-oriented.
- Keep responses concise but thorough.

REFUND POLICY:
- Refunds are available within 14 days of purchase.
- Eligibility is checked automatically against the member's access history.
- Heavy use of AI tools, downloads from the Done For You Pack, or working past the preview phase of the Masterclass can disqualify a refund.
- Platinum Club is a monthly subscription — members can cancel any time; access continues until the end of the paid month.
- Approved refunds are processed through Whop and land back on the card within 5–10 business days.

COMMON QUESTIONS:
- "How do I access?" → Sign in with the exact email used at purchase. Access activates automatically after payment.
- "My video won't play" → Refresh, disable ad blockers, try Chrome or Safari. Videos are hosted on Wistia.
- "Can I download lessons?" → Videos are streaming only. Prompts can be saved to Assets from the Build tab.
- "How do I track progress?" → Each lesson has a Mark as Complete button. The Dashboard shows total progress.
- "I can't find my purchase" → Check the email used at checkout. If it still doesn't show, ask in the support chat so the team can look it up.
- "What's included?" → The Masterclass, Your Brain, Operating System tools, My Influencers, Ad Research Board, and all unlocked add-ons.
- "Out of credits?" → Top up from the Credits page in the sidebar.
`;

supportRouter.post("/portal/support/chat", requireAuth, async (req: any, res) => {
  try {
    const { message, chatId } = req.body;
    if (!message || typeof message !== "string" || message.length > 5000) {
      res.status(400).json({ error: "Message is required (max 5000 chars)" }); return;
    }

    const user = req.portalUser;

    const portalKey = getPortalKey(req);
    const [fullUserContext, articles] = await Promise.all([
      getUserContext(user.id, user.email, portalKey),
      db.select({ title: supportArticlesTable.title, content: supportArticlesTable.content })
        .from(supportArticlesTable)
        .where(eq(supportArticlesTable.isPublished, true)),
    ]);

    const articleContext = articles
      .map((a) => `Article: ${a.title}\n${a.content}`)
      .join("\n\n---\n\n");

    let existingChat: any = null;
    let chatMessages: any[] = [];

    if (chatId) {
      const [chat] = await db
        .select()
        .from(supportChatsTable)
        .where(
          and(eq(supportChatsTable.id, chatId), eq(supportChatsTable.userId, user.id))
        );
      if (chat) {
        existingChat = chat;
        chatMessages = (chat.messages as any[]) || [];
      }
    }

    chatMessages.push({ role: "user", content: message, timestamp: new Date().toISOString() });

    const basicUserInfo = `
USER INFO:
- Name: ${user.firstName || ""} ${user.lastName || ""}
- Email: ${user.email}
- Account status: ${user.isActive ? "Active" : "Inactive"}
- Account created: ${user.createdAt ? new Date(user.createdAt).toLocaleDateString() : "Unknown"}
`;

    const openai = new OpenAI({
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
      apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
    });

    const systemMessage = `${KNOWLEDGE_BASE}\n\n${basicUserInfo}${fullUserContext}\n\nKNOWLEDGE BASE ARTICLES:\n${articleContext}`;

    const openaiMessages: any[] = [
      { role: "system", content: systemMessage },
      ...chatMessages.map((m: any) => ({ role: m.role, content: m.content })),
    ];

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: openaiMessages,
      max_completion_tokens: 2048,
    });

    const aiResponse = completion.choices[0]?.message?.content || "I'm sorry, I couldn't process your request. Please try again in a moment.";

    chatMessages.push({ role: "assistant", content: aiResponse, timestamp: new Date().toISOString() });

    let savedChatId: number;
    if (existingChat) {
      await db
        .update(supportChatsTable)
        .set({ messages: chatMessages, updatedAt: new Date() })
        .where(eq(supportChatsTable.id, existingChat.id));
      savedChatId = existingChat.id;
    } else {
      const [newChat] = await db
        .insert(supportChatsTable)
        .values({ userId: user.id, messages: chatMessages })
        .returning();
      savedChatId = newChat.id;
    }

    res.json({ response: aiResponse, chatId: savedChatId });
    return;
  } catch (error: any) {
    console.error("Support chat error:", error?.message);
    res.status(500).json({ error: "Failed to process your message. Please try again." });
    return;
  }
});

supportRouter.post("/portal/support/refund-request", requireAuth, async (req: any, res) => {
  try {
    const user = req.portalUser;

    if (!user.orderId && !user.whopUserId) {
      res.json({
        eligible: false,
        reason: "No purchase found on your account. If you believe this is an error, ask here in the support chat and the team will take a look.",
      }); return;
    }

    // Refund eligibility is a course-portal-only flow (Whop bundle); scope
    // the lesson/phase joins to portal_key='main' so Room30 phases/lessons
    // never count toward (or block) a refund decision.
    const progress = await db
      .select({
        phaseSlug: coursePhasesTable.slug,
      })
      .from(lessonProgressTable)
      .innerJoin(lessonsTable, eq(lessonProgressTable.lessonId, lessonsTable.id))
      .innerJoin(coursePhasesTable, eq(lessonsTable.phaseId, coursePhasesTable.id))
      .where(and(
        eq(lessonProgressTable.userId, user.id),
        eq(lessonsTable.portalKey, "main"),
      ));

    const accessedPhasesFromProgress = [...new Set(progress.map((p) => p.phaseSlug))];

    const phase1Lessons = await db
      .select({ slug: lessonsTable.slug })
      .from(lessonsTable)
      .innerJoin(coursePhasesTable, eq(lessonsTable.phaseId, coursePhasesTable.id))
      .where(and(
        eq(coursePhasesTable.slug, "the-strategy"),
        eq(lessonsTable.portalKey, "main"),
      ));
    const phase1Slugs = new Set(phase1Lessons.map((l) => l.slug));

    const accessLogs = await db
      .select({ resourceId: accessLogsTable.resourceId })
      .from(accessLogsTable)
      .where(
        and(
          eq(accessLogsTable.userId, user.id),
          eq(accessLogsTable.action, "lesson_view")
        )
      );
    const accessedLessonSlugs = accessLogs
      .map((l) => l.resourceId)
      .filter(Boolean);
    const accessedBeyondPhase1FromLogs = accessedLessonSlugs.some(
      (slug) => slug && !phase1Slugs.has(slug)
    );

    const accessedBeyondPhase1 =
      accessedPhasesFromProgress.some((p) => p !== "the-strategy") ||
      accessedBeyondPhase1FromLogs;

    if (accessedBeyondPhase1) {
      res.json({
        eligible: false,
        reason:
          "Based on your account activity, you've accessed course content beyond Phase 1 (The Strategy). Per our terms and conditions, refunds are only available for users who haven't accessed premium content beyond the preview phase. If you have questions, ask here in the support chat and the team will take a look.",
      }); return;
    }

    let order: any = null;
    if (user.orderId) {
      const [o] = await db.select().from(ordersTable).where(eq(ordersTable.id, user.orderId));
      order = o;
    }
    if (!order && user.email) {
      const [o] = await db.select().from(ordersTable).where(eq(ordersTable.email, user.email));
      order = o;
    }

    const purchaseDate = order?.createdAt ? new Date(order.createdAt) : (user.createdAt ? new Date(user.createdAt) : null);
    if (purchaseDate) {
      const daysSincePurchase = Math.floor(
        (Date.now() - purchaseDate.getTime()) / (1000 * 60 * 60 * 24)
      );
      if (daysSincePurchase > 14) {
        res.json({
          eligible: false,
          reason:
            "Your purchase was made more than 14 days ago. Per our terms and conditions, refunds are available within 14 days of purchase. If you have special circumstances, ask here in the support chat and the team will take a look.",
        }); return;
      }
    }

    // Automatic refund processing is retired with the payment-processor
    // integration. Eligibility is still assessed here; the actual refund
    // is handled manually by support.
    res.json({
      eligible: true,
      processed: false,
      reason:
        "You appear to be eligible for a refund. Ask here in the support chat and the team will take it from here and process it right away.",
    });
    return;
  } catch (error: any) {
    console.error("Refund request error:", error?.message);
    res.status(500).json({ error: "Failed to process refund request" });
    return;
  }
});

supportRouter.get("/portal/support/chat/history", requireAuth, async (req: any, res) => {
  try {
    const user = req.portalUser;
    const chats = await db
      .select()
      .from(supportChatsTable)
      .where(eq(supportChatsTable.userId, user.id))
      .orderBy(desc(supportChatsTable.updatedAt))
      .limit(1);

    if (chats.length === 0) {
      res.json({ chat: null }); return;
    }

    res.json({ chat: chats[0] });
    return;
  } catch (error: any) {
    console.error("Chat history error:", error?.message);
    res.status(500).json({ error: "Failed to fetch chat history" });
    return;
  }
});

supportRouter.post("/portal/support/seed-articles", async (req: any, res) => {
  const authHeader = req.headers["x-internal-secret"];
  const secret = process.env.SESSION_SECRET;
  if (!secret || authHeader !== secret) {
    res.status(403).json({ error: "Forbidden" }); return;
  }

  const articles = [
    {
      slug: "getting-started",
      title: "Getting Started with Prompt & Build OS",
      category: "getting-started",
      summary: "Everything you need to know to begin building your low-ticket acquisition system.",
      content: `<h2>Welcome to the Low-Ticket Acquisition and Operating System</h2>
<p>You now have access to the complete Prompt & Build OS - the full system for building a low-ticket offer that feeds $100K+ high-ticket deals. Here is how to get started:</p>
<h3>1. Access Your Portal</h3>
<p>Sign in using the <strong>same email address</strong> you used to purchase. Your account activates automatically after payment.</p>
<h3>2. Start with "The Strategy"</h3>
<p>Go to <strong>OS & Masterclass</strong> in the sidebar. Begin with Phase 1 - "The Strategy." This covers who this system is for, the strategy you must understand, how the Prompt & Build OS works, the tool stack you will need, and how to get support. Do not skip this phase.</p>
<h3>3. Understand the Lesson Tabs</h3>
<p>Every lesson has four tabs below the video:</p>
<ul>
<li><strong>Brief</strong> - A quick summary of what the lesson covers</li>
<li><strong>Notes</strong> - Detailed formatted notes breaking down the lesson content</li>
<li><strong>Build</strong> - Ready-to-use AI prompts and templates you can paste straight into ChatGPT or Claude</li>
<li><strong>Action Task</strong> - The specific thing you need to do after watching. Complete this before moving on.</li>
</ul>
<h3>4. Save Your Prompts and Work</h3>
<p>Click <strong>"Save to Assets"</strong> on any prompt in the Build tab. This saves it to your personal Assets library in the sidebar so you can access it any time.</p>
<h3>5. Follow the Phases in Order</h3>
<p>The system is designed to be worked through sequentially. Each phase builds on the last - from strategy and research, through offer creation and sales asset build, all the way to running your sales machine.</p>`,
      sortOrder: 1,
    },
    {
      slug: "course-structure",
      title: "The 6 Phases Explained",
      category: "getting-started",
      summary: "How the system is structured and what each phase covers.",
      content: `<h2>The 6 Phases of the Low-Ticket Acquisition and Operating System</h2>
<p>The system takes you from understanding the model to having a fully operational low-ticket funnel that generates $100K+ high-ticket deals. Here is what each phase covers:</p>
<h3>Phase 1: The Strategy (6 lessons)</h3>
<p>Foundational understanding of the entire system. Covers who this is for, the core strategy behind low-ticket acquisition, how the Prompt & Build OS works, the tools you will use, how to get 1-on-1 support, and in-person workshop opportunities.</p>
<h3>Phase 2: Research & Offer Creation (8 lessons)</h3>
<p>Deep market research and building your offer stack. You will define your positioning, build your research documents, learn the 3 types of low-ticket offers, construct your premium $5K-$100K+ offer stack, build your $100K+ offer, set up tracking and KPIs, and create your branding guidelines.</p>
<h3>Phase 3: Creation, Delivery & Experience (6 lessons)</h3>
<p>Building and delivering your product in under 24 hours. Covers your deliverables, the actual creation process, building your portal, creating your support AI, and designing the client experience that drives ascension.</p>
<h3>Phase 4: Sales Asset Build (10 lessons)</h3>
<p>Building every sales asset you need. Covers the anatomy of a high-converting sales funnel, picking your build style, the actual build, amending copy, updating images, VSL creation, connecting your payment processor and domain, connecting to your portal, and reviewing and testing everything.</p>
<h3>Phase 5: The Sales Machine (13 lessons)</h3>
<p>Turning on the traffic and revenue engine. Covers the mindset shift, your traffic strategy, creating 30+ content pieces in 30 minutes a day, the 3-second audience segment, engagement ad campaigns, profile setup, direct response campaigns, daily YouTube videos, IG and TikTok story sequences, daily email, WhatsApp remarketing, the daily 4-hour work structure, and re-posting content after 90 days.</p>
<h3>Phase 6: Scaling To $1M/mo (2 lessons)</h3>
<p>The closing notes on scaling in a post-AI world, plus how to access 1-on-1 help and in-person intensives for hands-on guidance.</p>`,
      sortOrder: 2,
    },
    {
      slug: "login-issues",
      title: "I Can't Log In or Access My Account",
      category: "troubleshooting",
      summary: "Troubleshoot login and account access problems.",
      content: `<h2>Login Troubleshooting</h2>
<h3>Check Your Email Address</h3>
<p>You must sign in with the <strong>exact same email</strong> you used when you purchased. This is the most common access issue - check for typos or alternate email addresses.</p>
<h3>Password Issues</h3>
<p>Click <strong>"Forgot Password"</strong> on the sign-in page to reset. Check your spam and junk folders if the reset email does not arrive within a few minutes.</p>
<h3>Account Not Activated</h3>
<p>Your account should activate automatically after purchase. If it has not after a few minutes:</p>
<ol>
<li>Sign out completely and sign back in</li>
<li>Clear your browser cache and cookies</li>
<li>Try a different browser - Chrome or Safari work best</li>
</ol>
<h3>Two-Factor Authentication</h3>
<p>If you have enabled two-factor authentication and are locked out, use the backup codes provided when you set it up. If you have lost those, ask in the support chat.</p>
<h3>Still Having Issues?</h3>
<p>Use the <strong>support chat</strong> on this page with the email address you purchased with and we will resolve it within 6 hours.</p>`,
      sortOrder: 3,
    },
    {
      slug: "video-playback",
      title: "Videos Not Playing or Loading",
      category: "troubleshooting",
      summary: "Fix video playback issues in the course player.",
      content: `<h2>Video Playback Issues</h2>
<h3>Quick Fixes</h3>
<ul>
<li><strong>Refresh the page</strong> - Most playback issues resolve with a simple page refresh</li>
<li><strong>Check your internet connection</strong> - Videos stream in real time and need a stable connection</li>
<li><strong>Try a different browser</strong> - Chrome and Safari work best with our video player</li>
<li><strong>Disable ad blockers</strong> - Some ad blockers interfere with Wistia video playback</li>
<li><strong>Clear browser cache</strong> - Old cached data can cause playback errors</li>
</ul>
<h3>Mobile Playback</h3>
<p>Videos play on mobile browsers. If you are having issues on mobile, try switching to desktop mode in your browser settings, or use a different browser app. For the best experience, we recommend watching on desktop or laptop.</p>
<h3>Slow Loading</h3>
<p>If videos load slowly, check your internet speed. Videos require at least 5 Mbps for smooth playback. If you are on a slow connection, try lowering the video quality using the settings icon on the player.</p>
<h3>Still Not Working?</h3>
<p>Use the <strong>support chat</strong> on this page and tell us your browser name, device type, and what the error message says.</p>`,
      sortOrder: 4,
    },
    {
      slug: "refund-policy",
      title: "Refund Policy & How to Request a Refund",
      category: "billing",
      summary: "Our refund terms and how to request one.",
      content: `<h2>Refund Policy</h2>
<h3>14-Day Refund Window</h3>
<p>We offer refunds within <strong>14 days</strong> of your purchase date, subject to the conditions below.</p>
<h3>Eligibility Conditions</h3>
<p>To qualify for a refund, you must <strong>not have accessed any course content beyond Phase 1 (The Strategy)</strong>.</p>
<p>Phase 1 - "The Strategy" - is considered the preview phase. You can watch all 6 lessons in Phase 1 and still be eligible for a refund within the 14-day window.</p>
<p>However, if you have accessed <strong>any lesson</strong> in Phase 2 (Research & Offer Creation), Phase 3 (Creation, Delivery & Experience), Phase 4 (Sales Asset Build), Phase 5 (The Sales Machine), or Phase 6 (Scaling), you are <strong>not eligible</strong> for a refund. This is clearly stated in the terms and conditions you agreed to at checkout.</p>
<h3>How to Request a Refund</h3>
<p>You can request a refund directly through the <strong>AI support chat</strong> on this page. The system will automatically check your eligibility based on your access history and process the refund if you qualify.</p>
<p>Alternatively, ask in the <strong>support chat</strong> using your purchase email address.</p>
<h3>Processing Time</h3>
<p>Approved refunds are processed immediately through Whop. Funds typically appear back in your account within 5-10 business days depending on your bank or card provider.</p>
<h3>After a Refund</h3>
<p>Once a refund is processed, your portal access is deactivated. If you change your mind later, you would need to repurchase.</p>`,
      sortOrder: 5,
    },
    {
      slug: "billing-charges",
      title: "Understanding Your Charges",
      category: "billing",
      summary: "Full breakdown of what you purchased and how charges appear.",
      content: `<h2>Understanding Your Charges</h2>
<h3>Main Product - $27</h3>
<p>The core purchase is the <strong>DFY AI Influencer, Custom Build Sales Funnel & Masterclass</strong> at $27. This includes full access to the Prompt & Build OS with all 6 phases, 45 lessons, AI prompts, templates, and action tasks.</p>
<h3>Order Bumps (At Checkout)</h3>
<p>During checkout, you may have added one or more optional order bumps:</p>
<ul>
<li><strong>TikTok Slide Show Masterclass, Prompts & Automation</strong> - $37</li>
<li><strong>2,000 Hook Library</strong> - $27</li>
<li><strong>AI Static Ad Generator - 100+ Unique Ads In 90 Seconds</strong> - $17</li>
</ul>
<h3>Post-Purchase Upgrades (Upsells)</h3>
<p>After checkout, you may have been offered one-time upgrade pages:</p>
<ul>
<li><strong>DFY AI Infrastructure</strong> - $197 (or Templates Lite at $47 if you skipped)</li>
<li><strong>Ad Masterclass + AI Ad Suite</strong> - $297</li>
<li><strong>Portfolio Expansion Package</strong> - $497</li>
</ul>
<h3>Important: No Subscriptions</h3>
<p>All charges are <strong>one-time payments</strong>. There are no recurring subscriptions, no hidden fees, and no future billing. You will not be charged again.</p>
<h3>How Charges Appear</h3>
<p>Charges appear on your bank or credit card statement from <strong>AI Influencer Portfolio</strong> or <strong>Whop</strong>. If you purchased multiple items, they may appear as separate line items.</p>
<h3>See a Charge You Do Not Recognise?</h3>
<p>Use the <strong>support chat</strong> on this page with the charge amount and date, and we will identify it for you immediately. Please contact us before filing a dispute with your bank - we can resolve most issues within hours.</p>`,
      sortOrder: 6,
    },
    {
      slug: "prompts-templates",
      title: "How to Use the AI Prompts & Build Tab",
      category: "course-help",
      summary: "How the Build tab works and how to get the most from the prompts.",
      content: `<h2>Using the AI Prompts & Build Tab</h2>
<h3>What Is the Build Tab?</h3>
<p>Most lessons include a <strong>Build</strong> tab with ready-to-use AI prompts. These are prompts we have refined that you can paste directly into ChatGPT, Claude, or any AI tool to build the specific deliverable for that lesson.</p>
<h3>How to Use Them</h3>
<ol>
<li><strong>Watch the lesson video first</strong> - Understand the context before using the prompt</li>
<li><strong>Read the Notes tab</strong> - Get the detailed breakdown of what you are building</li>
<li><strong>Copy the prompt from the Build tab</strong> - Click to copy, then paste into your AI tool</li>
<li><strong>Customise with your details</strong> - Replace placeholder sections with your specific niche, audience, and brand details</li>
<li><strong>Complete the Action Task</strong> - Apply what you have built before moving to the next lesson</li>
</ol>
<h3>Saving Prompts to Your Library</h3>
<p>Click <strong>"Save to Assets"</strong> on any prompt to store it in your personal Assets library. Access saved prompts any time from the <strong>Assets</strong> section in the sidebar.</p>
<h3>Customisation Tips</h3>
<p>The prompts are starting points designed to get you 80% of the way there. To get the best results:</p>
<ul>
<li>Add your specific niche and target audience details</li>
<li>Include your brand voice and tone preferences</li>
<li>Reference your research documents from Phase 2</li>
<li>Iterate - run the prompt, review the output, then refine with follow-up instructions</li>
</ul>`,
      sortOrder: 7,
    },
    {
      slug: "progress-tracking",
      title: "Tracking Your Progress",
      category: "course-help",
      summary: "How to track your lesson completion and overall progress.",
      content: `<h2>Tracking Your Course Progress</h2>
<h3>Marking Lessons Complete</h3>
<p>After watching a lesson and completing the action task, click <strong>"Mark as Complete"</strong> at the bottom of the lesson. This saves your progress automatically.</p>
<h3>Action Tasks</h3>
<p>Each lesson has a specific <strong>Action Task</strong> in the Action Task tab. This is the one thing you need to do to apply that lesson. Check it off when done. Do not skip action tasks - they are how you actually build your system.</p>
<h3>Dashboard Overview</h3>
<p>Your <strong>Dashboard</strong> shows your overall progress including:</p>
<ul>
<li>Total lessons completed out of 45</li>
<li>Action tasks completed</li>
<li>Which phase you are currently in</li>
<li>A quick link to continue where you left off</li>
</ul>
<h3>Recommended Pace</h3>
<p>Work through 1-2 lessons per day. The system is designed to be actionable - every lesson has a clear deliverable. Focus on completing each action task before moving on. Rushing through without building leads to poor results.</p>
<h3>Leaderboard</h3>
<p>Once you start generating revenue with your low-ticket system, connect your Whop account in the <strong>Leaderboard</strong> section to track and compare your progress with other members.</p>`,
      sortOrder: 8,
    },
    {
      slug: "contact-support",
      title: "How to Get Support",
      category: "general",
      summary: "All the ways to get help - AI chat and more.",
      content: `<h2>Getting Support</h2>
<h3>AI Support Chat</h3>
<p>Use the chat feature on this page or the floating chat widget in the bottom-right corner for instant answers. The AI assistant is trained on the course content and can help with most questions immediately.</p>
<h3>Talk to the Team</h3>
<p>Ask in the <strong>support chat</strong> on this page and we will pick it up for:</p>
<ul>
<li>Account access issues that the AI cannot resolve</li>
<li>Billing questions or payment disputes</li>
<li>Technical issues with the portal</li>
<li>Partnership or business inquiries</li>
</ul>
<h3>Response Times</h3>
<ul>
<li><strong>AI Chat</strong> - Instant</li>
<li><strong>Team reply (Billing & Access)</strong> - Within 6 hours</li>
<li><strong>Team reply (Technical Issues)</strong> - Within 12 hours</li>
<li><strong>Team reply (General)</strong> - Within 24 hours</li>
</ul>
<h3>1-on-1 Help</h3>
<p>For hands-on guidance, we offer 1-on-1 coaching and in-person intensives. Details are covered in the course (Phase 1 - "1-1 Help & In-Person Workshops" and Phase 6 - "Get 1-1 Help & In-Person Intensives"). A-List clients get direct access through the A-List Clients section in the sidebar.</p>
`,
      sortOrder: 9,
    },
    {
      slug: "account-settings",
      title: "Managing Your Account Settings",
      category: "general",
      summary: "Update your profile, password, and security settings.",
      content: `<h2>Account Settings</h2>
<h3>Accessing Settings</h3>
<p>Click <strong>Settings</strong> in the sidebar to manage your account profile, password, and security options.</p>
<h3>What You Can Change</h3>
<ul>
<li><strong>Profile photo</strong> - Upload or change your avatar</li>
<li><strong>Password</strong> - Update your password at any time</li>
<li><strong>Two-factor authentication</strong> - Enable 2FA for additional security on your account</li>
<li><strong>Connected accounts</strong> - Manage any social login connections</li>
</ul>
<h3>Changing Your Email</h3>
<p>To change the email address associated with your account, ask in the <strong>support chat</strong> while signed in with your current registered email. We will update it and confirm within 24 hours.</p>
<h3>Leaderboard Profile</h3>
<p>To set up or edit your leaderboard profile (tag name, niche, Whop connection), go to the <strong>Leaderboard</strong> section in the sidebar. Your leaderboard profile is separate from your account settings.</p>
<h3>Security Recommendations</h3>
<p>We recommend using a strong, unique password and enabling two-factor authentication through your account settings. Never share your login credentials with anyone.</p>
<h3>Legal Information</h3>
<p>This platform is operated by <strong>AI Influencer Portfolio</strong>. Full terms and conditions were agreed to at the time of purchase.</p>`,
      sortOrder: 10,
    },
  ];

  try {
    for (const article of articles) {
      const [existing] = await db
        .select()
        .from(supportArticlesTable)
        .where(eq(supportArticlesTable.slug, article.slug));

      if (existing) {
        await db
          .update(supportArticlesTable)
          .set({ ...article, updatedAt: new Date() })
          .where(eq(supportArticlesTable.id, existing.id));
      } else {
        await db.insert(supportArticlesTable).values(article);
      }
    }

    res.json({ success: true, count: articles.length });
    return;
  } catch (error: any) {
    console.error("Seed articles error:", error?.message);
    res.status(500).json({ error: "Failed to seed articles" });
    return;
  }
});

export default supportRouter;
