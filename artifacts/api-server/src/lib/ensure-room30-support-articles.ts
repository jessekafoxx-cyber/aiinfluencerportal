import { db, supportArticlesTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { logger } from "./logger";

// Slugs from the legacy Apex / "Prompt & Build OS" seed
// (artifacts/api-server/src/routes/support.ts seed-articles list) that
// are no longer relevant in the Room30 portal. We delete these by name
// rather than a blanket "delete everything not in the new set" so we
// never wipe articles that another portal (course-portal shares the
// same support_articles table) or an admin may have added manually.
const LEGACY_APEX_SLUGS = [
  "getting-started",
  "course-structure",
  "prompts-templates",
  "progress-tracking",
  "contact-support",
  // Retired: the assistant this article described is no longer surfaced to
  // members, so the article is dropped from the seed AND removed from any
  // database that already has it.
  "greg-ai",
];

type SeedArticle = {
  slug: string;
  title: string;
  category: "getting-started" | "course-help" | "troubleshooting" | "billing" | "general";
  summary: string;
  content: string;
  sortOrder: number;
};

const CHAT_LINE =
  "Need a human? Open the chat bubble in the bottom-right corner of any portal page and we will get back to you there.";

export const ROOM30_SUPPORT_ARTICLES: SeedArticle[] = [
  {
    slug: "welcome-to-room30",
    title: "Welcome to AI Influencer Portfolio",
    category: "getting-started",
    summary: "What AI Influencer Portfolio is and how the portal is laid out.",
    sortOrder: 1,
    content: `<h2>Welcome to AI Influencer Portfolio</h2>
<p>AI Influencer Portfolio is the operating system for running an AI-powered influencer business. It pairs a full masterclass with the AI tools, templates and Done For You assets you need to ship offers, run ads and grow a portfolio of digital products.</p>
<h3>Where to start</h3>
<ol>
<li><strong>Dashboard</strong> - your home base. Shows progress, latest drops and quick links to every section.</li>
<li><strong>Masterclass</strong> - work through the lessons in order. Each one has video, notes and a Build prompt.</li>
<li><strong>Your Brain</strong> - load your niche, voice and offers in once so every AI tool is tuned to you.</li>
<li><strong>Operating System</strong> - the OS Builder and per-tool generators that turn your Brain into funnels, scripts, ads and more.</li>
<li><strong>My Influencers</strong> - create and manage your AI influencers and the videos they push out.</li>
</ol>
<h3>Premium add-ons in the sidebar</h3>
<p>The gold and purple rows in the sidebar are upgrades - Done For You Pack, Our Portfolio, TikTok AI Slideshow Masterclass, 2,000 Hook Library, Platinum Club and more. Anything you do not own yet shows a price; tap to unlock.</p>
<p>${CHAT_LINE}</p>`,
  },
  {
    slug: "how-room30-works",
    title: "How the AI Influencer Portfolio System Works",
    category: "getting-started",
    summary: "The 4 layers of the system - Brain, Build, Influencer, Distribution.",
    sortOrder: 2,
    content: `<h2>The AI Influencer Portfolio System</h2>
<p>The system has four layers. Get them in this order and everything downstream gets faster:</p>
<h3>1. Your Brain</h3>
<p>One AI knowledge base for your niche, voice, offers and audience. Every AI tool in the portal pulls from it so you stop re-typing context.</p>
<h3>2. Build (Operating System)</h3>
<p>The OS Builder spins up sales pages, funnels, hooks, scripts, ads, carousels, bios and emails on top of your Brain. You edit the output - the system does the heavy lifting.</p>
<h3>3. Your AI Influencer</h3>
<p>Create one or more AI influencers in My Influencers. They become the face of your content - daily videos, hooks, demos, podcast clips and slideshows.</p>
<h3>4. Distribution</h3>
<p>Plug your assets into TikTok, Instagram, YouTube and paid traffic. The Daily Ad Research Board and 2,000 Hook Library keep your creative fresh.</p>
<p>${CHAT_LINE}</p>`,
  },

  {
    slug: "your-brain",
    title: "Your Brain: Loading Your AI Knowledge Base",
    category: "course-help",
    summary: "What Your Brain stores and how to fill it in for the best AI output.",
    sortOrder: 10,
    content: `<h2>Your Brain</h2>
<p>Your Brain is the shared context every AI tool in the portal reads from. Filling it in once stops you from re-explaining your niche, voice and offers in every prompt.</p>
<h3>What it stores</h3>
<ul>
<li>Niche, sub-niche and ideal customer</li>
<li>Tone of voice and brand do/do-not list</li>
<li>Your offers, prices and bonuses</li>
<li>Proof points, testimonials and case studies</li>
<li>Optional uploads - PDFs, transcripts, sales pages</li>
</ul>
<h3>Where it shows up</h3>
<p>The Operating System tools, Script Writer, Carousel Creator, Bio Generator, Image Prompt Generator and the Sales Page Copy OS all read from your Brain. Update it once and every tool gets sharper at the same time.</p>
<h3>Pre-Built Brains</h3>
<p>Short on time? Open Your Brain and pick a Pre-Built Brain that matches your niche to seed it instantly, then tweak from there.</p>
<p>${CHAT_LINE}</p>`,
  },
  {
    slug: "masterclass-how-to-use",
    title: "Masterclass: How To Work Through It",
    category: "course-help",
    summary: "Every lesson tab explained and the order to follow.",
    sortOrder: 11,
    content: `<h2>The AI Influencer Portfolio Masterclass</h2>
<p>The masterclass is the spine of the portal. Work through it in order - every phase builds on the last.</p>
<h3>Lesson tabs</h3>
<ul>
<li><strong>Brief</strong> - one-screen summary of what the lesson covers.</li>
<li><strong>Notes</strong> - detailed written breakdown of the video. Skim before you watch, re-read after.</li>
<li><strong>Build</strong> - ready-to-use AI prompts for that lesson. Click Save to Assets to keep one.</li>
</ul>
<h3>Marking progress</h3>
<p>Hit Mark As Complete at the bottom of each lesson. Your Dashboard tracks total lessons completed and tells you exactly where to pick up next time.</p>
<h3>Pace</h3>
<p>One or two lessons a day is plenty. The system rewards builders, not bingers - actually run the prompt and ship the deliverable before moving on.</p>
<p>${CHAT_LINE}</p>`,
  },
  {
    slug: "operating-system",
    title: "Operating System: Builder and OS Tools",
    category: "course-help",
    summary: "How the OS Builder and the individual OS tools work, plus how credits are used.",
    sortOrder: 12,
    content: `<h2>The Operating System</h2>
<p>The Operating System is where you turn your Brain into shippable assets. It has two layers:</p>
<h3>OS Builder</h3>
<p>Open Operating System in the sidebar to see the grid of OSes - Sales Page Copy OS, Low-Ticket Funnel OS, High-Ticket Funnel OS and more. Each one walks you through a guided multi-step build that outputs a finished asset you can copy or download.</p>
<h3>Per-tool generators</h3>
<p>Smaller tools live alongside the OSes - Carousel Creator, Script Writer, Avatar Prompt Generator, Image Prompt Generator, IG Bio Generator, Domain Name Generator and the Find Your Expertise tool.</p>
<h3>Credits</h3>
<p>OS tool runs use credits. Your live balance is shown in the sidebar pill. If you ever run low, top up from the Credits page - AI chat usage is tracked separately under your AI Usage allowance.</p>
<p>${CHAT_LINE}</p>`,
  },
  {
    slug: "my-influencers",
    title: "My Influencers: Creating and Using AI Influencers",
    category: "course-help",
    summary: "Buying, configuring and pushing content through your AI influencer.",
    sortOrder: 13,
    content: `<h2>My Influencers</h2>
<p>Your AI influencer is the face of your content. The portal lets you create, configure and run one or more influencers - then plug their videos straight into TikTok, Instagram and YouTube.</p>
<h3>Buying an influencer</h3>
<p>Open My Influencers in the sidebar and pick from the available avatars. After purchase the influencer lands in your library with their voice, look and base scenes ready to use.</p>
<h3>Configuring</h3>
<p>Open any influencer and set their niche, accent, vocabulary and signature scene types - green screen, hook + demo, selfie yapping, podcast clip, viral carousel and so on. These choices feed the script and image generators.</p>
<h3>Daily content</h3>
<p>Push scripts from Script Writer or hooks from the 2,000 Hook Library straight into your influencer. Each video can be downloaded ready to post.</p>
<p>${CHAT_LINE}</p>`,
  },
  {
    slug: "ad-research-board",
    title: "Daily Ad Research Board",
    category: "course-help",
    summary: "What the Ad Research Board pulls in and how to use it for your own creative.",
    sortOrder: 15,
    content: `<h2>Daily Ad Research Board</h2>
<p>The Ad Research Board pulls fresh, high-spend ads from your competitor set every day so you always have a live swipe file to model.</p>
<h3>What you see</h3>
<ul>
<li>Live thumbnails of running ads, sorted by recency</li>
<li>Hook lines, scripts and creative angles</li>
<li>Click through to the source ad library entry</li>
</ul>
<h3>How to use it</h3>
<p>Open the board first thing in your daily build session. Pick three ads with hooks you would scroll-stop on. Send the hooks into the Script Writer or 2,000 Hook Library to generate variations of your own.</p>
<h3>Sidebar tip</h3>
<p>The board uses every pixel of the viewport, so the sidebar auto-collapses the first time you visit. Hit the sidebar toggle any time to bring it back.</p>
<p>${CHAT_LINE}</p>`,
  },
  {
    slug: "done-for-you-pack",
    title: "Done For You Pack: Templates and Assets",
    category: "course-help",
    summary: "What is in the Done For You Pack and how to plug each item into your build.",
    sortOrder: 16,
    content: `<h2>Done For You Pack</h2>
<p>Once unlocked, the Done For You Pack expands in the sidebar with every template library you get access to:</p>
<ul>
<li>100 AI Influencers, 250+ Scenes, Bridge Pages</li>
<li>3,000+ Canva Ad Templates</li>
<li>Faceless Hook Templates, 50+ Viral Carousel Templates</li>
<li>4,000+ Background Reel Music, 100+ IG Story Templates and Highlights</li>
<li>1,000+ Ad Swipe File, 70K Viral Video B-Roll, 1,000+ Proven Content Scripts</li>
<li>5+ Sales Funnel Templates, 20 Advertorial Page Templates, 100+ Advertorial Page Swipes</li>
<li>VSL Ad Swipes and Landing Page Swipes</li>
</ul>
<h3>How to use it</h3>
<p>Open any sub-item to see previews and direct download or duplicate links. The fastest workflow: pick a template, drop it into Canva or your funnel builder, then run it through the Operating System tools to swap the copy for your own offer.</p>
<p>${CHAT_LINE}</p>`,
  },
  {
    slug: "hook-library",
    title: "2,000 Hook Library",
    category: "course-help",
    summary: "Using the 2,000 Hook Library to feed Script Writer and your influencer.",
    sortOrder: 17,
    content: `<h2>2,000 Hook Library</h2>
<p>The 2,000 Hook Library is every proven opener our team uses, sorted into categories so you can find one in seconds.</p>
<h3>Categories</h3>
<p>Educational, Curiosity, Alex Hormozi (bonus), Story, Pattern Interrupt, Listicle, Question, Contrarian and more. Each hook is tagged so you can filter by intent.</p>
<h3>How to use it</h3>
<ol>
<li>Pick a hook that matches the angle you want to test.</li>
<li>Send it to Script Writer to generate a full short-form script around it.</li>
<li>Push the script into your AI influencer to render the video.</li>
</ol>
<h3>Important</h3>
<p>Script Writer is hard-wired to pull from this library - it will never invent its own hook formulas. That keeps every video grounded in something already proven.</p>
<p>${CHAT_LINE}</p>`,
  },
  {
    slug: "tiktok-slideshow-masterclass",
    title: "TikTok AI Slideshow Masterclass",
    category: "course-help",
    summary: "What the TikTok AI Slideshow Masterclass covers and where to start.",
    sortOrder: 18,
    content: `<h2>TikTok AI Slideshow Masterclass</h2>
<p>A focused masterclass on the slideshow ad format that is winning on TikTok right now. Once unlocked it sits in your sidebar as its own portal section.</p>
<h3>What it covers</h3>
<ul>
<li>Why slideshows are quietly out-converting video on TikTok</li>
<li>The exact frame-by-frame structure that works</li>
<li>AI prompts for generating slide copy and images</li>
<li>The automation flow to publish slideshows daily</li>
</ul>
<h3>Pair it with</h3>
<p>The 2,000 Hook Library for openers, Carousel Creator for the slide visuals and your AI influencer for the cover frame.</p>
<p>${CHAT_LINE}</p>`,
  },
  {
    slug: "platinum-club",
    title: "Platinum Club: Monthly Drops and Bonuses",
    category: "course-help",
    summary: "What Platinum Club members get every month and when the next drop lands.",
    sortOrder: 19,
    content: `<h2>Platinum Club</h2>
<p>Platinum Club is the inner-circle membership. Members get a fresh stack of assets dropped into the portal at midnight on the last day of every month, on top of permanent bonuses.</p>
<h3>What lands every month</h3>
<ul>
<li>A brand new custom digital product built for you</li>
<li>90 Done For You AI avatar videos (3 a day)</li>
<li>50 ready-to-use ads with full scripts and creative</li>
<li>Private 2-hour live workshop with the team</li>
<li>A members-only custom funnel for one of our portfolio products you can promote</li>
</ul>
<h3>Bonuses</h3>
<p>Our top 20 performing ads from our own ad account every month, with the full scripts and assets, plus a one-time Platinum Founder Code that unlocks free access to every future AI Influencer Portfolio main product.</p>
<h3>Countdown</h3>
<p>Open Platinum Club in the sidebar to see the live countdown to the next drop and the full deliverables list.</p>
<p>${CHAT_LINE}</p>`,
  },
  {
    slug: "your-portfolio-affiliate",
    title: "Your Portfolio and Affiliate Promotion",
    category: "course-help",
    summary: "Promoting AI Influencer Portfolio products and where your affiliate links live.",
    sortOrder: 20,
    content: `<h2>Your Portfolio</h2>
<p>Your Portfolio appears in the sidebar once your first paid order lands. It is your affiliate hub for every AI Influencer Portfolio product you can promote.</p>
<h3>What you get</h3>
<ul>
<li>A unique affiliate link for each product</li>
<li>Live earnings, click and conversion tracking</li>
<li>Pre-built creative you can use to promote</li>
</ul>
<h3>Payouts</h3>
<p>Commissions are tracked in real time and paid out through Whop. Your dashboard inside Your Portfolio shows pending and paid totals.</p>
<h3>Want more to promote?</h3>
<p>Platinum Club members get an extra members-only funnel each month they can plug straight into their own influencer and run.</p>
<p>${CHAT_LINE}</p>`,
  },
  {
    slug: "leaderboard",
    title: "Leaderboard: Connecting Whop and Tracking Revenue",
    category: "course-help",
    summary: "Setting up your leaderboard profile and connecting Whop for live tracking.",
    sortOrder: 21,
    content: `<h2>Leaderboard</h2>
<p>The leaderboard ranks members by tracked revenue so you can see how you stack up and pull lessons from people a few steps ahead.</p>
<h3>Setting up your profile</h3>
<p>Open Leaderboard in the sidebar and create your profile - tag name, niche and avatar. This is separate from your account settings.</p>
<h3>Connecting Whop</h3>
<p>Connect your Whop account from the same screen. Once linked, your revenue from Whop-hosted offers feeds the leaderboard automatically. You can disconnect at any time.</p>
<h3>Privacy</h3>
<p>Only your tag name, niche and revenue tier show publicly. Your real name, email and Whop account are never exposed.</p>
<p>${CHAT_LINE}</p>`,
  },
  {
    slug: "plugs",
    title: "Plugs: Recommended Tools and Stack",
    category: "course-help",
    summary: "What Plugs is and how to use the recommended stack.",
    sortOrder: 22,
    content: `<h2>Plugs</h2>
<p>Plugs is the curated stack of third-party tools the AI Influencer Portfolio team actually uses. Each entry has a short reason it is on the list and a direct link.</p>
<h3>Categories</h3>
<ul>
<li>AI - language models, voice, image and video tools</li>
<li>Funnel and page builders</li>
<li>Ad platforms and trackers</li>
<li>Analytics and CRM</li>
<li>Productivity and automation</li>
</ul>
<h3>Affiliate disclosure</h3>
<p>Some Plugs links are affiliate links. We only list tools we run ourselves and your price never changes when you click through.</p>
<p>${CHAT_LINE}</p>`,
  },
  {
    slug: "done-for-you-service",
    title: "Done For You Service (Inner Circle)",
    category: "course-help",
    summary: "What the Done For You service includes and who it is for.",
    sortOrder: 23,
    content: `<h2>Done For You Service</h2>
<p>Done For You is our hands-on build service for members who want the team to do the work. It is shown in the sidebar as a gold Done For You row.</p>
<h3>What you get</h3>
<ul>
<li>Custom AI influencer built for your niche</li>
<li>Full sales funnel built and connected end-to-end</li>
<li>Initial creative pack - hooks, scripts and ads</li>
<li>Ongoing optimisation calls with the team</li>
</ul>
<h3>Who it is for</h3>
<p>Operators who already have a clear offer and want to compress weeks of build into days. If you are still figuring out your niche, work through the Masterclass first.</p>
<h3>How to apply</h3>
<p>Open Done For You in the sidebar to see the current intake. A-list members go straight to the inner portal; everyone else lands on the application page.</p>
<p>${CHAT_LINE}</p>`,
  },

  {
    slug: "login-issues",
    title: "I Can't Log In or Access My Account",
    category: "troubleshooting",
    summary: "Sign-in problems and how to fix them.",
    sortOrder: 50,
    content: `<h2>Login Issues</h2>
<h3>Use the email you bought with</h3>
<p>You must sign in using the exact email address you used at checkout. Check for typos or alternate accounts.</p>
<h3>Reset your password</h3>
<p>Hit Forgot Password on the sign-in screen. The reset email arrives within a couple of minutes - check spam if it does not show up.</p>
<h3>Account not yet activated</h3>
<p>Activation is automatic right after payment. If your portal still says no access after a few minutes:</p>
<ol>
<li>Sign out, clear cookies for the portal domain and sign back in.</li>
<li>Try Chrome or Safari in a fresh window.</li>
<li>Confirm the payment receipt landed in your inbox.</li>
</ol>
<h3>Still locked out?</h3>
<p>${CHAT_LINE} Send the email you bought with so we can match it to your order.</p>`,
  },
  {
    slug: "video-playback",
    title: "Videos Not Playing or Loading",
    category: "troubleshooting",
    summary: "Fix playback issues in the masterclass and tool video previews.",
    sortOrder: 51,
    content: `<h2>Video Playback</h2>
<h3>Quick fixes</h3>
<ul>
<li>Refresh the page - most playback hiccups clear with a reload.</li>
<li>Disable ad blockers and privacy extensions on the portal domain.</li>
<li>Try Chrome or Safari in a clean window.</li>
<li>Clear the browser cache for the portal domain.</li>
<li>Check your internet speed - the player needs about 5 Mbps for smooth playback.</li>
</ul>
<h3>Mobile</h3>
<p>Videos play on mobile, but the masterclass is built for desktop. If you keep getting buffering on mobile, switch to desktop or try a different mobile browser.</p>
<h3>Still broken?</h3>
<p>${CHAT_LINE} Tell us the lesson, your browser and a screenshot of any error.</p>`,
  },
  {
    slug: "ai-tools-not-working",
    title: "AI Tools or Generations Not Working",
    category: "troubleshooting",
    summary: "What to do when an OS tool, an AI assistant or a video generation hangs or errors.",
    sortOrder: 52,
    content: `<h2>AI Tools Not Working</h2>
<p>Most generation issues fall into one of three buckets. Check them in this order:</p>
<h3>1. Out of credits or AI usage</h3>
<p>OS tool runs use credits and the AI assistants use your AI usage allowance. Check the credit pill in the sidebar - if you are over the limit you will see an Over Limit pill and tools will pause until you top up.</p>
<h3>2. Empty or thin Brain</h3>
<p>If your Brain is mostly empty, generations come back generic or fail validation. Open Your Brain and fill in niche, voice, offers and audience before re-running.</p>
<h3>3. Network or upstream blip</h3>
<p>OpenAI and the avatar providers occasionally hiccup. Wait 30 seconds and re-run. If the same prompt keeps failing, refresh the page first - sometimes a stale session token is to blame.</p>
<h3>Stuck generations</h3>
<p>Influencer video and image renders queue up in the background. They survive a refresh - check My Influencers or the relevant tool page after a minute.</p>
<p>${CHAT_LINE}</p>`,
  },

  {
    slug: "billing-charges",
    title: "Understanding Your Charges",
    category: "billing",
    summary: "How charges from AI Influencer Portfolio appear and what each one is for.",
    sortOrder: 70,
    content: `<h2>Understanding Your Charges</h2>
<h3>How charges show up</h3>
<p>Charges appear on your statement from <strong>AI Influencer Portfolio</strong> or <strong>Whop</strong>. Multiple items in one purchase usually appear as separate line items.</p>
<h3>One-time vs recurring</h3>
<p>The masterclass and the Done For You Pack are one-time payments. The only recurring charge in the system is <strong>Platinum Club</strong> at its monthly price - and only if you opted in.</p>
<h3>Common one-time items</h3>
<ul>
<li>Main masterclass purchase</li>
<li>Order bumps - 2,000 Hook Library, TikTok Slideshow + IG Hijack, Ad Suite</li>
<li>Post-purchase upgrades - Done For You Pack, Our Portfolio, Ad Masterclass</li>
<li>OS tool credit top-ups</li>
<li>Per-influencer purchases inside My Influencers</li>
</ul>
<h3>Do not recognise a charge?</h3>
<p>${CHAT_LINE} Send the date, amount and last four digits of the card and we will identify it within hours - please contact us before raising a chargeback.</p>`,
  },
  {
    slug: "refund-policy",
    title: "Refund Policy and How to Request",
    category: "billing",
    summary: "Refund window, eligibility and how to start a request.",
    sortOrder: 71,
    content: `<h2>Refund Policy</h2>
<h3>14-day window</h3>
<p>Refunds are available within <strong>14 days</strong> of purchase, subject to the conditions below.</p>
<h3>Eligibility</h3>
<p>Eligibility is checked automatically against your access logs. Heavy use of the AI tools, downloads from the Done For You Pack or working past the preview phase of the masterclass can disqualify a refund.</p>
<h3>Platinum Club</h3>
<p>Platinum Club is a monthly subscription. You can cancel any time from the chat bubble - your access stays until the end of the current paid month and you are not billed again.</p>
<h3>How to request</h3>
<p>${CHAT_LINE} Include the email you bought with and the order or charge you want refunded. Approved refunds are processed through Whop and land back on your card in 5-10 business days.</p>`,
  },
  {
    slug: "managing-platinum-subscription",
    title: "Managing Your Platinum Club Subscription",
    category: "billing",
    summary: "Pausing, cancelling or updating payment for Platinum Club.",
    sortOrder: 72,
    content: `<h2>Managing Platinum Club</h2>
<h3>Cancelling</h3>
<p>You can cancel Platinum Club at any time. Cancelling stops the next billing cycle - your access continues until the end of the month you have already paid for, including the next monthly drop if it lands before your end date.</p>
<h3>Updating your card</h3>
<p>Whop holds the saved payment method for Platinum Club. Update it from the receipt email or the Whop dashboard linked at the top of any Platinum Club receipt.</p>
<h3>Pausing</h3>
<p>We do not currently offer pauses. Cancel and re-join when you are ready - the bonuses you have already collected stay yours, but the Founder Code and any week-only bonuses cannot be re-issued.</p>
<h3>Help</h3>
<p>${CHAT_LINE}</p>`,
  },

  {
    slug: "how-to-get-support",
    title: "How to Get Support",
    category: "general",
    summary: "Every channel for getting help and what to use each one for.",
    sortOrder: 90,
    content: `<h2>Getting Support</h2>
<h3>1. Search this knowledge base</h3>
<p>Use the search bar at the top of the Support page - most questions are answered here.</p>
<h3>2. AI support chat</h3>
<p>Tap Chat With Support on the Support page. The AI assistant is trained on the full knowledge base and your account history and can resolve most issues instantly.</p>
<h3>3. Talk to the team</h3>
<p>${CHAT_LINE} A real person picks up the conversation - typical first reply is within a few hours during working hours.</p>
<h3>Response times</h3>
<ul>
<li>AI Chat - instant</li>
<li>Team replies via the chat bubble - within a few hours during working hours</li>
<li>Account and billing issues - within 6 hours</li>
</ul>`,
  },
  {
    slug: "account-settings",
    title: "Managing Your Account Settings",
    category: "general",
    summary: "Profile, password, security and connected accounts.",
    sortOrder: 91,
    content: `<h2>Account Settings</h2>
<h3>Where to find them</h3>
<p>Open Settings at the bottom of the sidebar.</p>
<h3>What you can change</h3>
<ul>
<li>Profile photo and display name</li>
<li>Password</li>
<li>Two-factor authentication</li>
<li>Connected social logins</li>
</ul>
<h3>Changing your email</h3>
<p>Email changes need to be verified manually so they cannot be self-served. ${CHAT_LINE} Send the request from your current registered email so we can confirm and switch within 24 hours.</p>
<h3>Leaderboard profile</h3>
<p>Your leaderboard tag name, niche and Whop connection live in the Leaderboard section, separate from account settings.</p>
<h3>Security</h3>
<p>Use a long, unique password and enable two-factor authentication. Never share your portal password with anyone - the team will never ask for it.</p>`,
  },
];

export async function ensureRoom30SupportArticles(): Promise<void> {
  try {
    const slugs = ROOM30_SUPPORT_ARTICLES.map((a) => a.slug);

    for (const article of ROOM30_SUPPORT_ARTICLES) {
      const [existing] = await db
        .select()
        .from(supportArticlesTable)
        .where(eq(supportArticlesTable.slug, article.slug));

      if (existing) {
        await db
          .update(supportArticlesTable)
          .set({ ...article, isPublished: true, updatedAt: new Date() })
          .where(eq(supportArticlesTable.id, existing.id));
      } else {
        await db.insert(supportArticlesTable).values({
          ...article,
          isPublished: true,
        });
      }
    }

    // Remove only the known-stale legacy Apex slugs. Anything else in
    // support_articles (course-portal entries, admin additions, future
    // seeds) is left alone.
    const removed = await db
      .delete(supportArticlesTable)
      .where(inArray(supportArticlesTable.slug, LEGACY_APEX_SLUGS))
      .returning({ slug: supportArticlesTable.slug });

    logger.info(
      {
        upserted: slugs.length,
        removed: removed.length,
        removedSlugs: removed.map((r) => r.slug),
      },
      "ensureRoom30SupportArticles: done",
    );
  } catch (err) {
    logger.error({ err }, "ensureRoom30SupportArticles: failed");
  }
}
