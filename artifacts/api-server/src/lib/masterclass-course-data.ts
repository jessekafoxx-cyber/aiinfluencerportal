// AiIP Masterclass — 6-step course structure.
// Seeded at boot by ensure-main-masterclass.ts.
// Carry-over lessons (with existing Wistia video IDs and learner progress)
// keep their original slugs. New lessons use aiip- prefixed slugs and have
// no wistia_video_id (null → shown as "Coming Soon" in the portal UI).
// Notes are TipTap-compatible HTML rendered by RichTextViewer.

export const MASTERCLASS_PHASES: Array<{
  slug: string;
  title: string;
  sort_order: number;
}> = [
  { slug: "step-1-start-here", title: "Start Here", sort_order: 1 },
  { slug: "step-2-select-offer", title: "Select Your Offer + Build the Bridge", sort_order: 2 },
  { slug: "step-3-create-influencer", title: "Create Your AI Influencer", sort_order: 3 },
  { slug: "step-4-create-content", title: "Create Your Content", sort_order: 4 },
  { slug: "step-5-traffic-ads", title: "Traffic + Ads", sort_order: 5 },
  { slug: "step-6-next-steps", title: "Next Steps", sort_order: 6 },
];

export type MasterclassLesson = {
  slug: string;
  title: string;
  sort_order: number;
  phase_slug: string;
  wistia_video_id: string | null;
  notes: string | null;
};

export const MASTERCLASS_LESSONS: MasterclassLesson[] = [
  // ── STEP 1: START HERE ─────────────────────────────────────────────────────
  {
    slug: "masterclass-l01-intro-how-this-course-works",
    title: "Intro & How This Course Works",
    sort_order: 1,
    phase_slug: "step-1-start-here",
    wistia_video_id: "klyy0qatuw", // carry-over
    notes: `<h2>🎯 What You'll Learn</h2>
<p>How to build a profitable AI influencer business from scratch — <strong>no face, no complicated tech, zero experience needed</strong>.</p>
<p>This lesson maps the full path:</p>
<ul>
<li>Finding a winning affiliate offer and researching the audience</li>
<li>Building a bridge page that turns clicks into sales</li>
<li>Creating a photorealistic AI influencer with Claude + Higgsfield</li>
<li>Setting up Instagram and TikTok</li>
<li>Producing five types of scroll-stopping content</li>
<li>Handling comments and DMs, running engagement campaigns</li>
<li>Scaling to multiple accounts</li>
</ul>
<h2>💡 Why It Matters</h2>
<p>Most people watch a course and never act. This one is built to be <strong>done, not watched</strong> — each lesson ends with an action step.</p>
<p>And if you bought this offer, your AI influencer has <strong>already been generated for you</strong>, so you're starting ahead.</p>
<h2>🛠️ How to Do It</h2>
<ol>
<li><strong>Find your AI influencer</strong> in the left sidebar under AI Influencer — your generated character lives there.</li>
<li><strong>Set up a Claude account</strong> (claude.ai) — the AI assistant that writes scripts, creates images and videos, and stitches everything together.</li>
<li><strong>Set up a Higgsfield account</strong> (higgsfield.ai) — the AI image/video engine. You'll connect it to Claude as an MCP connector in Lesson 5.</li>
<li><strong>Have a phone ready</strong> for the Instagram and TikTok accounts.</li>
<li><strong>Optional:</strong> budget $5–$10/day for engagement ads later when you scale. Not needed to start.</li>
<li><strong>Work the lessons in order</strong>, do the work as you go, and keep every research doc and character doc in one folder so you can reuse them.</li>
<li><strong>Start with one offer and one account.</strong> Don't jump ahead — get one working, then scale.</li>
</ol>
<h2>📝 Good to Know</h2>
<p>Every lesson gives you copy-and-paste prompts — you just fill in your details and let the AI do the heavy lifting. All you need to begin is a laptop with internet and a Claude account.</p>`,
  },
  {
    slug: "aiip-tool-stack",
    title: "Tool Stack",
    sort_order: 2,
    phase_slug: "step-1-start-here",
    wistia_video_id: null,
    notes: null,
  },
  {
    slug: "masterclass-l03-research-and-audience",
    title: "Research & Audience",
    sort_order: 3,
    phase_slug: "step-1-start-here",
    wistia_video_id: "lgjb996s8y", // carry-over
    notes: `<h2>🎯 What You'll Learn</h2>
<p>How to deeply research the <strong>audience behind your offer</strong> — who they are, what keeps them up at night, and the exact language they use — so every later step (your influencer's persona, bridge page copy and video scripts) speaks directly to them.</p>
<h2>💡 Why It Matters</h2>
<ul>
<li>Content that mirrors the audience's own words <strong>stops the scroll and converts</strong>; generic content gets ignored.</li>
<li>This research doc becomes the fuel for everything downstream — you'll paste it into Claude when building your character, your bridge page and every script.</li>
<li>Do it once, properly, and you never have to guess what to say again.</li>
</ul>
<h2>🛠️ How to Do It</h2>
<ol>
<li>Take the offer you committed to in Lesson 2 and its sales page URL.</li>
<li>In Claude, run the audience-research prompt: ask it to profile the ideal buyer for your offer — <strong>demographics, pain points, desires, fears, objections, and the phrases they actually use</strong>.</li>
<li>Ask Claude to study the sales page too, so the research matches the promise and mechanism the offer already sells.</li>
<li>Dig into where the audience hangs out — the hooks, comments and complaints they respond to on Instagram and TikTok.</li>
<li>Have Claude condense everything into a single <strong>audience research doc</strong>.</li>
<li>Download it as a PDF and keep it in your project folder — you'll re-attach it in later lessons.</li>
</ol>
<h2>📝 Good to Know</h2>
<ul>
<li>The quality of this doc decides the quality of every script — <strong>don't rush it</strong>.</li>
<li>Real audience language beats clever copywriting: steal the phrases people actually type in comments.</li>
<li>One offer, one audience, one research doc — keep them together so you can reuse them in every later lesson.</li>
</ul>`,
  },

  // ── STEP 2: SELECT YOUR OFFER + BUILD THE BRIDGE ────────────────────────────
  {
    slug: "masterclass-l02-find-a-winning-clickbank-offer",
    title: "Find a Winning ClickBank Affiliate Offer",
    sort_order: 1,
    phase_slug: "step-2-select-offer",
    wistia_video_id: "88sxf2aetx", // carry-over
    notes: `<h2>🎯 What You'll Learn</h2>
<p>How to pick a <strong>proven affiliate offer</strong> to promote on ClickBank — the world's biggest affiliate marketplace — instead of creating your own product.</p>
<h2>💡 Why It Matters</h2>
<ul>
<li>You never build the product, never handle support, and never deal with refunds.</li>
<li>Someone else already created and tested it — you just send traffic and earn commission.</li>
<li>ClickBank has paid out <strong>over $7.3 billion</strong> to affiliates and has 5m+ users — proven demand, proven payouts.</li>
<li>People run this from $500/day up to seven figures a month off a single offer.</li>
</ul>
<h2>🛠️ How to Do It</h2>
<ol>
<li>Go to <strong>clickbank.com → Start here</strong> and create your affiliate account. The onboarding questions don't affect anything — answer roughly and move on.</li>
<li>Inside the dashboard, open the <strong>Affiliate Marketplace</strong>.</li>
<li>Browse the best-performing categories: <strong>E-business &amp; E-marketing, Health &amp; Fitness / Supplements, Self-Help, Make Money Online</strong>. Anything AI-related is performing strongly right now.</li>
<li>Sort by <strong>Gravity (high to low)</strong> — gravity means other affiliates are actively making sales with it.</li>
<li>Filter for:
<ul>
<li>Commission <strong>50%+</strong></li>
<li>Healthy average $/conversion (top offers pay $135–$140 per sale)</li>
<li>Recurring commissions if available (nice, not essential)</li>
</ul>
</li>
<li>Click <strong>View Sales Page</strong> on each shortlisted offer — this is where your traffic ultimately goes. Judge whether the page would convince your audience.</li>
<li>Check the offer's affiliate tools page for approved assets and hooks.</li>
<li>Grab your <strong>affiliate link (hoplink)</strong> for the offer you choose.</li>
</ol>
<h2>📝 Good to Know</h2>
<ul>
<li>Start with <strong>Top Offers</strong> — the safest bet as a beginner.</li>
<li>Don't dismiss "boring" niches; woodworking, survival and sleep-supplement offers convert extremely well.</li>
<li><strong>Pick ONE offer and stay with it.</strong></li>
</ul>`,
  },
  {
    slug: "masterclass-l04-building-your-bridge-page",
    title: "Building Your Bridge Page",
    sort_order: 2,
    phase_slug: "step-2-select-offer",
    wistia_video_id: "w3f0agt235", // carry-over
    notes: `<h2>🎯 What You'll Learn</h2>
<p>How to build a simple <strong>bridge page</strong> in GoHighLevel that sits between your content/ads and the affiliate sales page.</p>
<h2>💡 Why It Matters</h2>
<ul>
<li>Sending cold social traffic straight to a sales page feels salesy and converts badly.</li>
<li>A bridge page <strong>warms the visitor and pre-sells the offer</strong> — they arrive already believing, and conversions go up significantly.</li>
<li>You can also capture emails there and own the audience.</li>
</ul>
<h2>🛠️ How to Do It</h2>
<ol>
<li>Click the link below this video to start a <strong>30-day free GoHighLevel trial</strong> (the public site only offers 14 days). A card is needed but nothing is charged for 30 days, and you can cancel anytime.</li>
<li>Inside GoHighLevel: left sidebar → <strong>Sub-accounts</strong> → <strong>Create Sub-account</strong> → choose <strong>Blank Snapshot</strong> → enter any business name/address → for the account-type question put "this is my own account" → Add Sub-account.</li>
<li>Switch into the sub-account → go to <strong>Sites</strong>.</li>
<li>Open the funnel template link below this video → copy the template URL → click <strong>Add Funnel</strong> and select your new location as the destination. It imports in ~30–60 seconds.</li>
<li>Open the imported funnel → <strong>Edit</strong>.</li>
<li>Rewrite the copy for your offer — paste your offer research into Claude and ask it to rewrite the bridge page copy.</li>
<li>Keep it simple: one clear headline echoing your video hook, a short "why listen to me" paragraph, and <strong>one big obvious CTA button</strong>.</li>
<li>Swap the CTA button link for your ClickBank affiliate link and <strong>publish</strong>.</li>
</ol>
<h2>📝 Good to Know</h2>
<ul>
<li>Keep it deliberately minimal — no long sales letter.</li>
<li>If you own an upgrade, you also get advertorial-style bridge templates you can use instead.</li>
<li>Optional but recommended: add an email opt-in so you can follow up with non-buyers.</li>
</ul>`,
  },
  {
    slug: "aiip-bridge-page-copy",
    title: "Writing Your Bridge Page Copy",
    sort_order: 3,
    phase_slug: "step-2-select-offer",
    wistia_video_id: null,
    notes: null,
  },
  {
    slug: "aiip-bridge-page-images",
    title: "Add Images to Your Bridge Page",
    sort_order: 4,
    phase_slug: "step-2-select-offer",
    wistia_video_id: null,
    notes: null,
  },

  // ── STEP 3: CREATE YOUR AI INFLUENCER ────────────────────────────────────────
  {
    slug: "aiip-finding-reference-image",
    title: "Finding Your Reference Image",
    sort_order: 1,
    phase_slug: "step-3-create-influencer",
    wistia_video_id: null,
    notes: null,
  },
  {
    slug: "masterclass-l05-creating-your-ai-influencer",
    title: "Creating Your AI Influencer (Claude + Higgsfield)",
    sort_order: 2,
    phase_slug: "step-3-create-influencer",
    wistia_video_id: "eeehfkrj0i", // carry-over
    notes: `<h2>🎯 What You'll Learn</h2>
<p>How to build a <strong>photorealistic AI character</strong> that looks like a real person and stays consistent across every piece of content — podcast clips, selfie videos, vintage clips and more — all driven from Claude with the Higgsfield MCP.</p>
<h2>💡 Why It Matters</h2>
<ul>
<li>A consistent, believable face is what makes the account feel like a <strong>real influencer</strong> rather than AI slop.</li>
<li>Once the character is trained, you can drop them into unlimited future scenes and keep the same identity forever.</li>
</ul>
<h2>🛠️ How to Do It</h2>
<ol>
<li>Sign up at <strong>higgsfield.ai</strong> → open the MCP page → copy the MCP URL.</li>
<li>In Claude: <strong>Settings → Connectors → Add custom connector</strong> → paste the URL → name it "Higgsfield" → Connect → Allow. Reopen Claude and confirm it shows as connected — you now have every Higgsfield image, video and audio model available inside Claude.</li>
<li>Paste the character-brief prompt into Claude and say: <em>"Please fill this out for me based on my research for my [YOUR OFFER] offer."</em> Claude completes the full persona brief.</li>
<li><strong>Optional but recommended:</strong> gather 3 realistic reference images from Pinterest/Google Images matching your target demographic. Aim for real and imperfect, not glossy.</li>
<li>Back in Claude, upload the reference images and run the generation prompt, specifying the model: <em>"Use Nano Banana Pro 4 (or ChatGPT Image 2) via the Higgsfield MCP."</em></li>
<li>Review the options Claude returns. Ask for variations until one feels authentic, then pick it: <em>"Option 3."</em></li>
<li>Claude generates additional reference shots in multiple scenarios to lock in a persistent character, then asks to start training. Reply <em>"Yes, please continue training."</em></li>
<li>Higgsfield trains the character (~10 minutes). When done, <strong>save the persona name</strong> — you'll reference it in every later content prompt.</li>
</ol>
<h2>📝 Good to Know</h2>
<ul>
<li>Don't chase perfection — <strong>authentic beats flawless</strong>.</li>
<li>If you bought this offer, an AI influencer has already been generated for you: just upload it into your Higgsfield account and skip the training step.</li>
<li>Name your persona something memorable — you'll call it by name in the content lessons.</li>
</ul>`,
  },
  {
    slug: "aiip-influencer-scenarios",
    title: "Putting Your Influencer in Different Scenarios",
    sort_order: 3,
    phase_slug: "step-3-create-influencer",
    wistia_video_id: null,
    notes: null,
  },
  {
    slug: "aiip-influencer-voice",
    title: "Creating Your Influencer Voice",
    sort_order: 4,
    phase_slug: "step-3-create-influencer",
    wistia_video_id: null,
    notes: null,
  },

  // ── STEP 4: CREATE YOUR CONTENT ──────────────────────────────────────────────
  {
    slug: "aiip-content-types",
    title: "Content Types & What to Make",
    sort_order: 1,
    phase_slug: "step-4-create-content",
    wistia_video_id: null,
    notes: null,
  },
  {
    slug: "masterclass-l09-setting-up-social-media-accounts",
    title: "Setting Up Social Media Accounts",
    sort_order: 2,
    phase_slug: "step-4-create-content",
    wistia_video_id: "8ane4g5cmj", // carry-over
    notes: `<h2>🎯 What You'll Learn</h2>
<p>A short, practical walkthrough of setting up the social media accounts your AI avatar will actually post from — which platforms to prioritise, the dedicated Gmail address trick, what to put in the avatar's profile, how to attach your bridge page as the link in bio, and how to post to Facebook, Instagram and TikTok in a single click using Buffer.</p>
<h2>💡 Why It Matters</h2>
<ul>
<li>Your avatar needs a real home on the platforms before any content strategy matters — <strong>this is the plumbing</strong>.</li>
<li>Instagram and TikTok are where the reach is right now, and Facebook comes free with the same upload — <strong>three times the reach for the same effort</strong>.</li>
<li>A dedicated Gmail keeps the avatar completely separate from your personal accounts, which makes handover clean if you ever sell the asset later.</li>
<li>The link in bio is the <strong>only bridge</strong> between the content and the offer. Without it, every view is wasted.</li>
<li>Follower count is not the goal. The algorithm no longer serves your content mainly to followers — <strong>impressions and profile visits</strong> are what matter.</li>
</ul>
<h2>🛠️ How to Do It</h2>
<ol>
<li><strong>Create the accounts.</strong> Go to Instagram, then TikTok, then Facebook. Use your avatar's name as the handle and upload the avatar's photo. Start posting immediately — do not wait for followers.</li>
<li><strong>Set up a dedicated Gmail address</strong> for the avatar first, and register all three accounts to it. This keeps everything separate and streamlined, and makes the asset transferable.</li>
<li><strong>Add the profile information.</strong> Upload a normal, believable profile photo of your avatar — home office wall, in the car, on a podcast — and write the bio (use the bio generator shown in the course).</li>
<li><strong>Add your bridge page as the link in bio.</strong> In GoHighLevel go to <em>Funnels → your funnel → Edit bridge page</em>, copy the page URL, and paste it as the single link in your avatar's bio.</li>
<li><strong>Keep it to one link.</strong> One avatar per offer, one link in bio. Do not stack multiple links.</li>
<li><strong>Post everywhere in one click.</strong> Use Buffer to schedule to Facebook, Instagram and TikTok at once — roughly $5–6/month for one account, around $18/month for all three. You can load a full month of content in a single sitting.</li>
</ol>
<h2>📝 Good to Know</h2>
<ul>
<li>There are places to buy aged accounts — ignore that entirely when starting out. Create fresh accounts and start.</li>
<li>Do not over-think the setup. There is no magic formula here; the content and the engagement campaign do the heavy lifting.</li>
<li>The profile picture and setting should look <strong>ordinary and human</strong>. Overly polished "brand" imagery hurts believability.</li>
<li>Buffer is the recommended tool, but any multi-platform scheduler that supports all three networks works the same way.</li>
</ul>`,
  },
  {
    slug: "aiip-setup-manychat",
    title: "Setting Up ManyChat",
    sort_order: 3,
    phase_slug: "step-4-create-content",
    wistia_video_id: null,
    notes: null,
  },
  {
    slug: "aiip-green-screen-clips",
    title: "Green Screen Clips",
    sort_order: 4,
    phase_slug: "step-4-create-content",
    wistia_video_id: null,
    notes: null,
  },
  {
    slug: "aiip-hook-demo-clips",
    title: "Hook + Demo Clips",
    sort_order: 5,
    phase_slug: "step-4-create-content",
    wistia_video_id: null,
    notes: null,
  },
  {
    slug: "masterclass-l06-podcast-clips",
    title: "Podcast Clips",
    sort_order: 6,
    phase_slug: "step-4-create-content",
    wistia_video_id: "4lgwwodr19", // carry-over
    notes: `<h2>🎯 What You'll Learn</h2>
<p>How to produce <strong>podcast-style clips</strong> with your AI influencer — scripted in Claude, generated in Higgsfield, optionally rendered in HeyGen, then captioned and posted.</p>
<h2>💡 Why It Matters</h2>
<ul>
<li>Podcast clips are one of the <strong>highest-performing formats</strong>: instant authority, long watch time, heavy trust.</li>
<li>They let you educate and give real value instead of pitching.</li>
<li>They're fast and cheap to make.</li>
</ul>
<h2>🛠️ How to Do It</h2>
<ol>
<li>Copy the podcast-script master prompt into Claude and fill the blanks: <em>"Make this about [TOPIC] for [AUDIENCE]. Use my research above/attached."</em></li>
<li><strong>Re-attach your offer research</strong> (download the earlier Claude research as PDF and upload it) so the script stays on-message.</li>
<li>Review the script and direct it like an editor. Example: <em>"Good, but cut the CTA at the end. Make it more educational. Keep the data point, open with a shocking personal story hook, then education, then CTA. 60 seconds."</em></li>
<li>Once happy, paste the video-generation prompt: <em>"Use Higgsfield MCP and my avatar [PERSONA NAME]"</em> + the approved script. Click <strong>Always allow</strong> when the MCP permission prompt appears.</li>
<li>Higgsfield renders the clip. Long scripts may come back in 4 parts — that's fine. Ask: <em>"Please generate the rest of the clip."</em></li>
<li>For a studio podcast look: in Higgsfield → Image → Nano Banana Pro (or GPT Image 2) → grab a podcast-set reference image from Pinterest/Google → use <strong>Character Swap</strong> to place your avatar into the podcast set → output <strong>16:9</strong>.</li>
<li>Alternative tool: <strong>heygen.com</strong> — create a free account, upload your avatar look, paste the script and render there instead.</li>
<li>Stitch the parts, add captions in the Instagram edit app, then post to Instagram and TikTok.</li>
</ol>
<h2>📝 Good to Know</h2>
<ul>
<li>Always re-attach research before scripting — <strong>accuracy is what earns trust</strong>.</li>
<li>Voice consistency can drift across parts; ask Claude to fix that specific clip and it re-renders instantly.</li>
<li>Direct the AI like a client giving feedback: hook first, data second, education third.</li>
</ul>`,
  },
  {
    slug: "aiip-speaking-clips",
    title: "Speaking Clips",
    sort_order: 7,
    phase_slug: "step-4-create-content",
    wistia_video_id: null,
    notes: null,
  },
  {
    slug: "masterclass-l07-selfie-yapping-videos",
    title: 'Selfie / Yapping Videos',
    sort_order: 8,
    phase_slug: "step-4-create-content",
    wistia_video_id: "sx32e61fe5", // carry-over
    notes: `<h2>🎯 What You'll Learn</h2>
<p>How to recreate the natural <strong>talking-to-camera selfie video</strong> — the most native format on Instagram and TikTok — using your AI influencer.</p>
<h2>💡 Why It Matters</h2>
<ul>
<li>Selfie yapping videos look like a real person filmed them on their phone — which is exactly why they <strong>blend into the feed and get watched</strong>.</li>
<li>They're the fastest format to produce once your avatar exists.</li>
</ul>
<h2>🛠️ How to Do It</h2>
<ol>
<li>In Higgsfield → Image → <strong>Nano Banana Pro</strong> → select one of your avatar images as the reference → prompt a selfie/phone-camera setting in vertical <strong>9:16</strong> → Generate.</li>
<li>Download the generated selfie image.</li>
<li>In HeyGen → <strong>Avatars → Upload look</strong> → upload that image → Create look.</li>
<li>Paste the selfie-script prompt into Claude: <em>"Please make this about my [OFFER] and [PAIN POINT]."</em> Take the script it produces.</li>
<li>In HeyGen: create video → build scene → paste the script → set delivery style (<strong>Enhanced</strong> works well) → Generate. Choose the selfie video format.</li>
<li>Download the video, add captions in the Instagram edit app, and post.</li>
</ol>
<h2>📝 Good to Know</h2>
<ul>
<li>You can render this entirely in Higgsfield instead — HeyGen is just a personal preference for this format.</li>
<li>HeyGen's newer prompt mode lets you say things like <em>"make her walk down the street yapping"</em> and it builds the full storyboard for you.</li>
</ul>`,
  },
  {
    slug: "aiip-viral-slideshows",
    title: "Viral Slideshows",
    sort_order: 9,
    phase_slug: "step-4-create-content",
    wistia_video_id: null,
    notes: null,
  },
  {
    slug: "aiip-viral-carousels",
    title: "Viral Carousels",
    sort_order: 10,
    phase_slug: "step-4-create-content",
    wistia_video_id: null,
    notes: null,
  },
  {
    slug: "aiip-overlay-clips",
    title: "Overlay Clips",
    sort_order: 11,
    phase_slug: "step-4-create-content",
    wistia_video_id: null,
    notes: null,
  },
  {
    slug: "aiip-fast-motion-clips",
    title: "Fast-Motion Clips",
    sort_order: 12,
    phase_slug: "step-4-create-content",
    wistia_video_id: null,
    notes: null,
  },

  // ── STEP 5: TRAFFIC + ADS ────────────────────────────────────────────────────
  {
    slug: "aiip-intro-to-ads",
    title: "Intro to Ads",
    sort_order: 1,
    phase_slug: "step-5-traffic-ads",
    wistia_video_id: null,
    notes: null,
  },
  {
    slug: "aiip-posting-social-media",
    title: "Posting On Social Media",
    sort_order: 2,
    phase_slug: "step-5-traffic-ads",
    wistia_video_id: null,
    notes: null,
  },
  {
    slug: "masterclass-l10-engagement-campaign",
    title: "Engagement Campaign",
    sort_order: 3,
    phase_slug: "step-5-traffic-ads",
    wistia_video_id: "nngsgikr5j", // carry-over
    notes: `<h2>🎯 What You'll Learn</h2>
<p>A full over-the-shoulder build of a <strong>Meta engagement ad campaign</strong> — the paid push behind your organic posts. Why almost every "organic" viral account is really running engagement ads, live proof of reaching nearly 100,000 people for under $300, then the entire campaign setup: budget, ad set structure, audience, placements, using existing posts, and turning off every enhancement Meta tries to sneak on.</p>
<h2>💡 Why It Matters</h2>
<ul>
<li>Meta makes money from advertisers, not free users — so <strong>paid content gets pushed</strong> and organic content mostly does not.</li>
<li>Engagement campaigns run at roughly <strong>$3 per 1,000 people reached</strong>. Even $5/day puts you in front of ~1,500 new people daily, and performance improves the longer it runs.</li>
<li>It gives your posts the initial traction they need to keep climbing instead of dying in the first hour — exactly what Hormozi, Gary Vee and every large account do behind their best posts.</li>
<li>It builds the warm engaged audience your later direct sales campaigns retarget — <strong>the foundation, not an optional extra</strong>.</li>
<li>It compresses your timeline: a few dollars a day makes progress happen in weeks instead of months.</li>
</ul>
<h2>🛠️ How to Do It</h2>
<ol>
<li><strong>Set up Ads Manager.</strong> Connect your avatar's Facebook page and Instagram account as connected assets in Business Manager (page name or URL, then follow the prompts).</li>
<li><strong>Create the campaign.</strong> New campaign → name it "Engagement" → choose manual setup → Continue.</li>
<li><strong>Set the daily budget.</strong> $5, $10, $25, $100 — whatever you can sustain. More spend equals more reach; roughly $3 per 1,000 people.</li>
<li><strong>Build the ad set structure.</strong> Plan ~90 days of content and group posts by week — "Week 1", "Week 2", etc. Each day, add that day's 3 posts into the current week's ad set, then duplicate the ad set for the next week.</li>
<li><strong>Engagement type:</strong> select <strong>Post Engagement</strong>. <strong>Performance goal:</strong> <em>Maximise engagement with post</em>.</li>
<li><strong>Audience.</strong> Top five English-speaking countries (US, UK, Canada, Australia, New Zealand) unless you are targeting a local or non-English market. Set minimum age 22–25 for high-ticket buyers. Leave everything else blank and let Meta work.</li>
<li><strong>Placements: manual.</strong> Turn ON only Facebook Feed, Instagram Feed, Facebook Reels, Instagram Reels. Turn off everything else, including Stories. The interface jumps around — double-check before saving.</li>
<li><strong>Create the ad.</strong> Name it (Post 1, Post 2…) → <strong>Use Existing Post</strong> → pick the Instagram or Facebook post → Continue.</li>
<li><strong>Clean the ad up.</strong> Untick <strong>Multi-Advertiser Ads</strong>, remove the call-to-action button, and click Edit to <strong>turn off every enhancement</strong>. The goal is to keep people on Meta commenting on your post, not clicking away.</li>
<li><strong>Duplicate and scale.</strong> Duplicate with original settings for each additional post, swap in the new post, re-check enhancements are off, then Publish. Add each day's new posts as you create them.</li>
</ol>
<h2>📝 Good to Know</h2>
<ul>
<li><strong>Watch enhancements closely</strong> — Meta re-enables them on duplicated ads. Check every single one before publishing.</li>
<li>The caption matters more than the button. <em>"Comment [keyword] below"</em> is what drives the Meta automation and profile visits.</li>
<li>If your ad account gets restricted, cheap Fiverr "Meta ad ban" fixes work, or simply open a new account. Agency ad accounts exist for advanced use — not needed at this stage.</li>
<li><strong>The lower your CPM, the better your content is.</strong> Improving content lowers cost and increases engagement at the same time.</li>
<li>Direct sales campaigns come later and require a very different, direct style of creative. They retarget everyone this engagement campaign warms up — so run this one first.</li>
</ul>`,
  },
  {
    slug: "aiip-direct-response-ads",
    title: "Direct Response Ads",
    sort_order: 4,
    phase_slug: "step-5-traffic-ads",
    wistia_video_id: null,
    notes: null,
  },

  // ── STEP 6: NEXT STEPS ───────────────────────────────────────────────────────
  {
    slug: "aiip-publishing-strategy",
    title: "The Publishing Strategy",
    sort_order: 1,
    phase_slug: "step-6-next-steps",
    wistia_video_id: null,
    notes: null,
  },
  {
    slug: "aiip-next-steps-scale",
    title: "Next Steps to Scale",
    sort_order: 2,
    phase_slug: "step-6-next-steps",
    wistia_video_id: null,
    notes: null,
  },
];
