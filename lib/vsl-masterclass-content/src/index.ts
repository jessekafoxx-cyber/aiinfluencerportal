// VSL Masterclass content. Staged as structured chapters so the page can render
// it cleanly without massive JSX. Every example has been rewritten around
// Greg's Low Ticket Ascension model ($27 front-end → order bumps → $500-ish
// upsells → $5K/mo coaching → $25K-$100K+ Mastermind / Portugal villa) and
// every worked breakdown is rebuilt from Greg's own VSLs. No e-com /
// supplement / health examples remain.

export type Block =
  | { kind: "para"; text: string }
  | { kind: "heading"; text: string; level?: 2 | 3 }
  | { kind: "list"; ordered?: boolean; items: string[] }
  | { kind: "callout"; tone?: "gold" | "neutral" | "danger"; title?: string; text: string }
  | { kind: "table"; columns: string[]; rows: string[][] }
  | { kind: "annotation"; title?: string; rows: { line: string; note: string }[] }
  | { kind: "template"; title: string; body: string };

export type Chapter = {
  slug: string;
  number: string;
  title: string;
  kicker?: string;
  intro?: string;
  blocks: Block[];
};

const foundations: Chapter = {
  slug: "foundations",
  number: "01",
  title: "VSL Foundations & Psychology",
  kicker: "Why a VSL is the most leveraged piece of marketing you will ever build",
  intro:
    "Every other asset in your business is a question. A VSL is the answer. It is the one document that takes a cold stranger from \"who is this guy\" to \"take my money\" without you ever showing up on a sales call. Build it once and it sells while you sleep, while you train, while you sit on a beach in Portugal with your kids.",
  blocks: [
    { kind: "heading", text: "What a VSL actually is", level: 2 },
    {
      kind: "para",
      text:
        "A VSL is not a video. A VSL is a structured argument disguised as a video. The video is just a delivery mechanism. The argument is what does the work: it grabs attention, agitates a problem, breaks the prospect's existing beliefs, installs new ones, proves the new beliefs with receipts, and then offers the only logical next step.",
    },
    {
      kind: "para",
      text:
        "If you understand that, you stop treating the VSL like a creative project and start treating it like a chess opening — every move forces the next move, every section sets up the section after it, and the close becomes inevitable rather than asked for.",
    },
    {
      kind: "heading", text: "Why this matters in a Low Ticket Ascension funnel", level: 2,
    },
    {
      kind: "para",
      text:
        "In our model, the VSL is the engine that drives the whole ladder. A cold prospect lands on a $27 front-end (PDF Farming, Answer Engine Authority, AI Asset Farming, the Marketing Tool). The VSL on that page does the heavy lifting — it builds enough belief to convert a stranger into a buyer for the price of a couple of coffees. Once they are a buyer, every subsequent offer (order bump → $500 upsell → $5K/mo coaching → $25K mastermind → $100K Portugal villa intensive) is sold to a warm, trusting customer who has already seen you deliver.",
    },
    {
      kind: "callout",
      tone: "gold",
      title: "The leverage compounds",
      text:
        "A 1% lift in front-end VSL conversion rate is not a 1% lift in revenue. It is a 1% lift in the size of every single backend offer you sell, forever. That is why we have rewritten our main VSL more times than we can count. The front-end is not the prize. The front-end is the door.",
    },
    { kind: "heading", text: "The four jobs of every VSL", level: 2 },
    {
      kind: "table",
      columns: ["Stage", "Job", "What happens if you skip it"],
      rows: [
        ["Hook", "Stop the scroll. Spike emotion in 3 seconds.", "Nobody watches past second 4. Your CPM doubles."],
        ["Lead", "Sustain the spark. Promise a payoff. Earn the next 30 seconds.", "Drop-off cliff at 0:30. The rest of the script never gets seen."],
        ["Body", "Break old beliefs, install new ones, stack proof.", "Viewers nod along but never feel the urgency to buy."],
        ["Close", "Force a decision. Make staying still feel more painful than acting.", "They say \"interesting\" and never come back."],
      ],
    },
    { kind: "heading", text: "The three psychology levers you will use over and over", level: 2 },
    {
      kind: "list",
      ordered: true,
      items: [
        "Loss aversion — people will do far more to avoid losing what they already have than to gain something new. Our main VSL leans on this when the founder talks about being in A&E with wires on his heart and his wife saying \"I don't recognise you anymore.\" That is not a brag, that is a fear button.",
        "Identity congruence — buyers do not buy products, they buy a version of themselves they already want to be. Our $5K/mo coaching VSL never sells calls or templates, it sells \"the kind of operator who gets 1-1 access to me in Portugal.\"",
        "Future-pacing — once a prospect can vividly see themselves on the other side of the transaction, they will work backwards to justify buying. The Ghost Building storyboard does this in 30 seconds with a single line: \"This is what your business looks like 90 days from now.\"",
      ],
    },
    { kind: "heading", text: "The single biggest mistake in 95% of VSLs", level: 2 },
    {
      kind: "para",
      text:
        "Most operators write their VSL like a brochure: features, benefits, modules, bonuses, price, button. That is selling. The winning VSLs do not sell. They argue. They take a belief the viewer already has — \"I have to grind for years to make real money online,\" \"I need a team to scale,\" \"AI is just a fad,\" \"selling is sleazy\" — and they dismantle it on camera, brick by brick, with proof. By the time the offer appears, the prospect is no longer being sold to. They are completing a logical conclusion they have already arrived at.",
    },
    {
      kind: "callout",
      tone: "neutral",
      title: "Read this twice",
      text:
        "If your prospect can finish your VSL and still believe what they believed at the start, your VSL has failed — even if they bought. Because the next offer up the ladder will not convert. Belief change, not the buy button, is the real KPI.",
    },
  ],
};

const breakBeliefs: Chapter = {
  slug: "break-challenge-rebuild",
  number: "02",
  title: "Break Beliefs · Challenge · Rebuild",
  kicker: "The three-act structure under every VSL that has ever cracked $1M in spend",
  intro:
    "Every persuasive VSL is doing the same three things in the same order. You break a belief the prospect is currently holding. You challenge the way they are currently solving the problem. You rebuild a new belief that only your mechanism can fulfil. If you nail this loop the offer almost sells itself.",
  blocks: [
    {
      kind: "table",
      columns: ["Act", "What you do on screen", "Why the brain accepts it"],
      rows: [
        [
          "1. Break",
          "Name the belief out loud. Then prove, with a single concrete data point, that the belief is the reason they are stuck.",
          "Naming a private thought publicly creates instant trust — \"this person sees me.\" The proof point removes the option to dismiss you.",
        ],
        [
          "2. Challenge",
          "Show the painful cost of staying in the current belief. Quantify it in time, money, identity, or relationships.",
          "Loss is processed ~2.5x harder than gain. A vivid future cost short-circuits \"I'll think about it.\"",
        ],
        [
          "3. Rebuild",
          "Hand them a new belief that is only obvious in hindsight, and that only your mechanism can deliver. Stack 1–3 receipts immediately.",
          "The brain rewards \"aha\" moments with dopamine. Receipts lock the new belief in before scepticism returns.",
        ],
      ],
    },
    {
      kind: "heading",
      text: "Worked example — our Main VSL ($27 front-end)",
      level: 2,
    },
    {
      kind: "annotation",
      title: "Watch the loop fire in under 90 seconds",
      rows: [
        {
          line: "\"I scaled to over $700,000 a month as a one person business…\"",
          note: "BREAK. The belief being killed is \"to scale you need a team.\" One sentence, named directly, with a number that is impossible to ignore.",
        },
        {
          line: "\"…with a client acquisition method that turns $97 buyers into $100K+ premium dream client deals while self liquidating all marketing spend from day one.\"",
          note: "CHALLENGE. The cost of the old belief is hiring, payroll, churn, ad spend that drains the bank account. He is contrasting that pain implicitly with one sentence about self-liquidation.",
        },
        {
          line: "\"AI tools with the correct knowledge to implement are useless, and knowledge on its own is slow to implement…\"",
          note: "BREAK + REBUILD. He kills two beliefs at once — \"AI alone will save me\" and \"a course alone will save me\" — and sets up the rebuild: you need both, married, in one place.",
        },
        {
          line: "\"In a post-AI era trust is harder than ever to build, so the best way to build it is to get prospects results for themselves… aka our low ticket self liquidating offer.\"",
          note: "REBUILD. The new belief is \"results-first marketing beats authority marketing.\" This is the entire foundation of the Low Ticket Ascension model.",
        },
      ],
    },
    {
      kind: "callout",
      tone: "gold",
      title: "The unlock",
      text:
        "Your viewer does not need to agree with you. They only need to feel that you are saying something nobody else is saying. The break-challenge-rebuild loop guarantees that, because by definition, you are inverting the dominant belief in your market.",
    },
    {
      kind: "heading",
      text: "The 5 beliefs you will almost always need to break",
      level: 2,
    },
    {
      kind: "list",
      ordered: true,
      items: [
        "\"I need more time before I can do this.\" — Break with proof of someone busier than them who launched in under 90 minutes.",
        "\"I need to build an audience first.\" — Break with the Ghost Building / faceless model: paid ads on raw, unedited content beat months of organic.",
        "\"I need a sales team to close real money.\" — Break with our founder's solo $700K month and zero sales calls.",
        "\"AI cannot do what I do, my niche is special.\" — Break with the AI Asset Farming proof: 23,500+ everyday people in every niche.",
        "\"Low ticket products do not lead to real money.\" — Break with the ascension story: the $27 buyer is the same person who later writes the $25K-$100K cheque.",
      ],
    },
  ],
};

const nineStep: Chapter = {
  slug: "nine-step-structure",
  number: "03",
  title: "The 9-Step VSL Structure",
  kicker: "The skeleton every VSL we ship is built on, in order",
  intro:
    "Every VSL we have ever scaled — Main, AI Asset Farming, AI Flipping, PDF Farming 4.0, Skyrox Elite, LeadClub, Answer Engine Authority, $5K/mo Coaching, Mastermind — uses the same 9 beats. Memorise them. When a VSL underperforms, your first diagnostic is to ask which of the 9 you skipped or under-baked.",
  blocks: [
    {
      kind: "table",
      columns: ["#", "Beat", "What it does", "Length target"],
      rows: [
        ["1", "Pattern Interrupt Hook", "Stops the scroll. Spikes emotion. Earns the next 5 seconds.", "0–5s"],
        ["2", "Big Promise + Drawback Eliminator", "Names the outcome. Removes the assumed cost (\"without showing your face / hiring a team / spending more on ads\").", "5–25s"],
        ["3", "Proof Front-Loaded", "Stripe screenshots, Hyros revenue, press mentions, screen-recorded receipts. Earns the right to keep talking.", "25–75s"],
        ["4", "Origin Story", "Why you. Why now. The relatable bottom you climbed out of (the founder in A&E, agency shut down, wife saying \"I don't know you anymore\").", "75–180s"],
        ["5", "Mechanism Reveal", "The named, ownable system you discovered (Low Ticket Ascension, AI Asset Farming, Domino Marketing System, Answer Engine Authority).", "180–300s"],
        ["6", "Unique Steps Walkthrough", "The 3–5 numbered moves the prospect would do if they bought. Specific enough to feel real, vague enough that they cannot DIY it.", "300–600s"],
        ["7", "Stacked Social Proof", "Wall-of-love montages, Stripe screenshares, member testimonials with screenshots attached, press, awards.", "600–800s"],
        ["8", "Offer Stack + Risk Reversal", "What's inside, what's the price, what's the guarantee. Frame it as a no-brainer next to the cost of doing nothing.", "800–1000s"],
        ["9", "CTA + Urgency", "Direct, repeated, low-friction. \"Click below, get started, see you on the inside.\"", "Last 30s"],
      ],
    },
    {
      kind: "callout",
      tone: "neutral",
      title: "Length is not the variable",
      text:
        "A 4-minute power-punch VSL and a 60-minute deep-dive VSL both use these 9 beats. The only thing that changes is how long you spend on each. Cold traffic with a complex new mechanism = longer. Warm traffic on a simple add-on = shorter.",
    },
    {
      kind: "heading", text: "Diagnostic: which beat is killing your conversion?", level: 2,
    },
    {
      kind: "table",
      columns: ["Drop-off point", "Likely broken beat", "Fix"],
      rows: [
        ["Massive drop in first 5s", "Hook (1)", "Test 5+ new hooks, same script. Lead with peak drama or a number that does not compute."],
        ["Drop between 0:30–1:30", "Promise + Proof (2 + 3)", "Move proof earlier. Make the promise more specific (a number, a timeframe, a drawback eliminator)."],
        ["Drop in middle (3–6 min)", "Mechanism / Walkthrough (5 + 6)", "Add a named mechanism. Add a visual diagram. Number the steps explicitly on screen."],
        ["Get to the offer but no sales", "Offer Stack / Risk Reversal (8)", "Reframe the price against the cost of inaction. Strengthen the guarantee."],
      ],
    },
  ],
};

const slipperySlide: Chapter = {
  slug: "slippery-slide",
  number: "04",
  title: "The Slippery Slide",
  kicker: "How to engineer a VSL the viewer cannot stop watching",
  intro:
    "Joe Sugarman called it the slippery slide: every line of copy exists for one reason — to make the next line impossible to skip. Apply this to a VSL and your retention curve flattens. Ignore it and your viewer leaves at the first dull sentence.",
  blocks: [
    {
      kind: "heading", text: "The 4 mechanics that make a VSL slippery", level: 2,
    },
    {
      kind: "list",
      ordered: true,
      items: [
        "Open loops. Tease something now, pay it off later. \"I'll come back to that in a second\" / \"the third reason is the one nobody talks about — I'll get to it.\" Our Main VSL opens with the line \"I'm going to come back to this in a second… as this is your escape route\" and that single sentence buys him the next 60 seconds.",
        "Forward motion verbs. \"Watch this,\" \"look at this,\" \"check this out,\" \"in a second I'm going to show you,\" \"keep watching for the part where…\" Each one is a tiny scroll-stopper that resets attention.",
        "Specificity over abstraction. \"$394K net profit in March\" beats \"made a lot of money.\" \"23,500+ students\" beats \"thousands of customers.\" Specifics imply truth, abstractions imply BS.",
        "Visual contrast every 2–5 seconds. Never let the viewer's eye sit on the same shot for more than 5 seconds. Cut to a Stripe screenshot, a wall-of-love testimonial, a Hyros graph, an AI-generated b-roll, a piece of press. The script is the audio, the cuts are the slide.",
      ],
    },
    {
      kind: "callout",
      tone: "gold",
      title: "The 3-second test",
      text:
        "Watch your VSL on mute. Every 3 seconds, ask: did the visual change? Did something on screen pull my eye? If the answer is no, you have a flat patch and that is where viewers drop.",
    },
    {
      kind: "heading", text: "Open loop bank — drop these into any VSL", level: 2,
    },
    {
      kind: "list",
      items: [
        "\"In a second I'm going to show you the exact step that broke this whole thing open for me.\"",
        "\"Now before I show you the actual numbers, I need to address the one thing you're probably thinking right now.\"",
        "\"And the wildest part of this whole thing isn't even the money — but I'll get to that.\"",
        "\"I almost didn't share this part on camera. Stay with me, you'll see why.\"",
        "\"There's a third reason this works that nobody talks about — and it's the reason most people fail. I'll cover it in a minute.\"",
      ],
    },
  ],
};

const unorthodoxOS: Chapter = {
  slug: "unorthodox-os-formula",
  number: "05",
  title: "Unorthodox OS — The 8-Section Direct VSL Formula",
  kicker: "The plug-and-play blueprint behind every direct-response VSL",
  intro:
    "When you don't know what to write, write into this 8-section grid. It is the same skeleton behind the Main VSL, the AI Flipping VSL, the AI Asset Farming VSL, and every front-end we have shipped. The numbers in the right column are the rough word counts for a 6-minute VSL.",
  blocks: [
    {
      kind: "table",
      columns: ["Section", "Purpose", "On-brand prompt to start writing", "Words"],
      rows: [
        [
          "1. Pattern Interrupt",
          "A 1-line hook that violates expectation.",
          "\"Imagine generating $X without doing Y, while [counterintuitive fact].\"",
          "20–40",
        ],
        [
          "2. Big Promise + Eliminator",
          "Specific outcome + the painful thing they will NOT have to do.",
          "\"Generate $5K-$10K weeks selling info / coaching / DFY services without sales calls, an audience, or showing your face.\"",
          "40–80",
        ],
        [
          "3. Proof Block",
          "Receipts, specific. Stripe, Hyros, screenshots, press, awards.",
          "\"Here's $43K net profit in 24 hours… here's $700K in March… here's the Forbes feature.\"",
          "80–150",
        ],
        [
          "4. Origin Story",
          "The bottom you climbed out of. Make it relatable to the avatar.",
          "\"I was teaching marketing to graduates in a corporate job at 5am, breathing but not living…\"",
          "200–350",
        ],
        [
          "5. Named Mechanism",
          "The proprietary system the prospect could not have invented.",
          "\"It's called the Low Ticket Ascension Model. Three steps. Here's how each works.\"",
          "150–250",
        ],
        [
          "6. Walkthrough",
          "The 3–5 numbered moves. Specific enough to feel real, vague enough to need you.",
          "\"Step 1 — the self-liquidating $27 offer. Step 2 — the Domino Marketing System. Step 3 — the backend ascension.\"",
          "300–500",
        ],
        [
          "7. Offer + Stack + Reversal",
          "Price, what's inside, money-back guarantee, scarcity if real.",
          "\"All for $27. 30-day money back. Get launched in under 90 minutes from now.\"",
          "150–250",
        ],
        [
          "8. CTA",
          "Direct, repeated, low-friction.",
          "\"Click the button below, see you on the inside.\"",
          "30–60",
        ],
      ],
    },
    {
      kind: "callout",
      tone: "neutral",
      title: "Use the grid as a brief, not a script",
      text:
        "Fill the right column for your offer first. You will end up with bullet points. Only then start writing prose into each section. This stops you from going feature-first and forces you to lead with promise + proof.",
    },
  ],
};

const hookBank: Chapter = {
  slug: "hook-bank",
  number: "06",
  title: "Hook Bank",
  kicker: "Plug-and-play hooks for info, coaching and done-for-you offers",
  intro:
    "Every hook below has been re-anchored on our world: low ticket → ascension → premium 1-1. Replace the brackets with your numbers and your niche. Run at least 5 hook variations against the same script before you change anything else.",
  blocks: [
    { kind: "heading", text: "Curiosity hooks", level: 2 },
    {
      kind: "template",
      title: "Hidden cause",
      body:
        "What if the reason you're stuck at $[current MRR] isn't your offer, your funnel, or your traffic — it's the one model you've never been shown that turns $27 buyers into $25K clients?",
    },
    {
      kind: "template",
      title: "Counter-intuitive number",
      body:
        "I scaled to $[your monthly revenue] last month as a one-person business with no sales calls, no team, and no audience. The model is so simple it's almost insulting — and I'll show you all 3 steps in the next 90 seconds.",
    },
    { kind: "heading", text: "Fear / loss-aversion hooks", level: 2 },
    {
      kind: "template",
      title: "The cost of staying still",
      body:
        "Every month you keep selling [your service] the old way — calls, DMs, cold outreach — you're leaving an extra $[realistic monthly delta] on the table. Here's what it looks like to take it back, starting today.",
    },
    {
      kind: "template",
      title: "AI-shift fear",
      body:
        "By 2030, 400 million jobs will be replaced by AI. Coaches and DFY operators who don't install the right ascension model in the next 90 days will quietly disappear. Watch this if you don't want to be one of them.",
    },
    { kind: "heading", text: "Desire / aspirational hooks", level: 2 },
    {
      kind: "template",
      title: "Identity hook",
      body:
        "If you know — really know — that you're the best at what you do, you're 90 minutes away from running an offer ladder that pays you like the best at what you do. Keep watching.",
    },
    {
      kind: "template",
      title: "Lifestyle hook",
      body:
        "What does your week look like when you can charge $5K, $25K, even $100K+ for the work you already love doing — and never get on a sales call to do it? I'll show you the exact model in 4 minutes.",
    },
    { kind: "heading", text: "Shock / pattern-interrupt hooks", level: 2 },
    {
      kind: "template",
      title: "Brutal first line",
      body:
        "Your sales calls are killing your business. Not because you're bad at them — because they're capping how big you can ever get. There's a way to scale to $[stretch number]/month without ever taking another one, and I'll show you exactly how.",
    },
    {
      kind: "template",
      title: "Receipt-first hook",
      body:
        "[Stripe screenshot of $X day]. That was [yesterday / last Tuesday / a random Monday]. No sales calls. No team. No paid ads on the day. Here's the 3-step model that makes that number repeatable.",
    },
    { kind: "heading", text: "Story / empathy hooks", level: 2 },
    {
      kind: "template",
      title: "Relatable bottom",
      body:
        "[X months/years] ago I was [specific painful situation that mirrors the avatar]. Today I run a [solo / lean] business doing $[number]/month using one model nobody in my niche teaches. Here's the whole thing.",
    },
    { kind: "heading", text: "Contrarian / myth-busting hooks", level: 2 },
    {
      kind: "template",
      title: "Belief inversion",
      body:
        "Everyone in [your niche] is telling you to [common bad advice — build an audience / hire a closer / run webinars / cold DM 100 leads a day]. They're wrong, and here's the proof: [single screenshot or stat]. I'll show you what to do instead.",
    },
  ],
};

const leadBank: Chapter = {
  slug: "lead-bank",
  number: "07",
  title: "Lead Bank",
  kicker: "How to bridge the hook into the body without losing the room",
  intro:
    "The lead is the 30–90 seconds after the hook. Its only job is to earn the next 30 seconds. Promise the payoff, drop the first piece of proof, name the new mechanism. These templates assume the hook has already landed.",
  blocks: [
    {
      kind: "template",
      title: "Promise + drawback eliminator",
      body:
        "In the next [4 / 8 / 12] minutes I'll show you the exact 3-step model I use to turn $27 buyers into $25K-$100K clients — without a sales team, without ad spend that drains your bank account, and without ever having to show your face on camera if you don't want to.",
    },
    {
      kind: "template",
      title: "Proof-first lead",
      body:
        "Before I explain anything, here are the numbers from last month: [Stripe / Hyros screenshot]. $[revenue], $[net], [traffic source], zero sales calls. I'm going to walk you through the entire model — same one we used to get there — in the next few minutes.",
    },
    {
      kind: "template",
      title: "Forbes / press authority lead",
      body:
        "I won a global digital business innovation award for this exact model. Forbes USA wrote a full feature on it. I've shared stages with [name]. None of that matters today though — what matters is that you can install the same model in the next 90 minutes. Here's how.",
    },
    {
      kind: "template",
      title: "Story bridge lead",
      body:
        "I want to tell you the 90-second version of how I went from teaching marketing to graduates in a corporate job to doing $[number]/month as a solo operator — because somewhere in that story is the exact moment the model clicked, and I want you to find it before I show you the steps.",
    },
    {
      kind: "template",
      title: "Permission lead (great for $5K coaching / $25K mastermind pages)",
      body:
        "If you're already running a [coaching / DFY / info] business, doing $[X]/month, and you've hit a ceiling you can't break — keep watching. If you're not, this won't apply to you. I'd rather lose you in the first 30 seconds than waste your time.",
    },
  ],
};

const mechanismBank: Chapter = {
  slug: "mechanism-bank",
  number: "08",
  title: "Mechanism Bank",
  kicker: "How to name and frame your proprietary system",
  intro:
    "A mechanism is the named, ownable, repeatable system that delivers the promise. Without one, you are just another guy selling a course. With one, you are the guy who invented the thing. Mechanisms travel: they show up in your VSL, your sales page headline, your email subject lines, your DMs, your podcast intro.",
  blocks: [
    {
      kind: "heading", text: "What makes a mechanism actually work", level: 2,
    },
    {
      kind: "list",
      ordered: true,
      items: [
        "It has a name. Capitalised, ownable, ideally with a number or a metaphor (Low Ticket Ascension, AI Asset Farming, Domino Marketing System, 9-Step VSL, Answer Engine Authority).",
        "It has 3–5 explicit steps. Not 12. Not 17. The brain remembers 3.",
        "It has a visual. A diagram, a ladder, a vending machine, a flywheel — something the prospect can sketch on a napkin after watching.",
        "It has a contrast. It is explicitly not the dominant approach in the market (\"unlike webinar funnels / unlike cold DMs / unlike traditional agencies\").",
      ],
    },
    {
      kind: "heading", text: "Mechanism templates", level: 2,
    },
    {
      kind: "template",
      title: "Three-step ascension mechanism",
      body:
        "It's called [Mechanism Name™]. Three steps.\n\nStep 1 — [self-liquidating front-end]: build a $27 offer that gets prospects a real, fast result so they trust you with their eyes, not your words.\n\nStep 2 — [traffic engine]: run the [Domino / your-name] system on raw, unedited content so cold traffic costs you nothing because the front-end pays for itself.\n\nStep 3 — [backend ascension]: the same buyer who paid $27 today is the same buyer who pays $5K, $25K, $100K+ later — without a single sales call.",
    },
    {
      kind: "template",
      title: "Vending machine analogy (great for info / faceless models)",
      body:
        "Think of each offer like a vending machine. Instead of dispensing snacks, it dispenses pain relief. A prospect with a problem walks up, puts $27 in, and gets the thing that solves it — without ever speaking to you. The more vending machines you have on the internet, the more you get paid. The model is just \"how to put more vending machines in more places, faster.\"",
    },
    {
      kind: "template",
      title: "Faceless / Asset Farm mechanism",
      body:
        "I call it [AI Asset Farming]. We take an AI tool that already exists, wrap it in a $27 product that solves a specific problem, point traffic at it from raw 5-second clips, and let the front-end pay for the ads that bring in the next buyer. Each \"farm\" runs on its own. We just plant more.",
    },
    {
      kind: "template",
      title: "Performance-offer mechanism (rewrites Hormozi's \"Alan\" for our world)",
      body:
        "It's called the [Apex Performance Offer]. We don't sell coaching. We don't sell calls. We install a low-ticket front-end inside your business, plug it into our [Domino Marketing System], and you only pay us a fixed % of the new MRR we generate from the buyers who climb the ladder. If we don't generate net new revenue, you don't pay. The mechanism is what removes the risk.",
    },
  ],
};

const proofBank: Chapter = {
  slug: "proof-bank",
  number: "09",
  title: "Proof Bank",
  kicker: "The receipts that close the gap between \"interesting\" and \"I'll buy\"",
  intro:
    "Proof is not testimonials. Proof is anything that shrinks the perceived gap between what you said and what you can show. Lead with the proof your avatar is already secretly looking for.",
  blocks: [
    {
      kind: "table",
      columns: ["Proof type", "When to use it", "Example from our stack"],
      rows: [
        ["Stripe revenue screenshares", "Earliest in the VSL — they buy you the next 30 seconds.", "Live screenshare of $700K month, $43K-net day, random Tuesday at 9am."],
        ["Hyros / ad-platform receipts", "Use after the promise. Proves the math behind self-liquidation.", "Hyros graph showing $21K/day spend with positive ROAS on day one."],
        ["Wall-of-love testimonials", "Use during the mechanism walkthrough as you describe each step.", "23,500+ student wall, with attached screenshots required for every claim."],
        ["First-sale / first-day proofs", "Use to close the gap for first-time buyers.", "\"James — first sale within minutes of launch.\" \"Sturge — 3 sales in his first 20 minutes.\""],
        ["Press / awards", "Use to anchor authority before the offer.", "Forbes USA feature, Daily Express, Independent, Nasdaq, global digital innovation award."],
        ["Stage proof", "Use to imply top-tier peers.", "Sharing stages with Kevin Harington from Shark Tank, 5+ hours of stage footage."],
        ["Process / behind-the-scenes proof", "Use during the mechanism — shows you actually do the thing.", "Live screen recordings of the founder building an asset farm or shipping an offer."],
      ],
    },
    {
      kind: "heading", text: "How to layer proof so it actually persuades", level: 2,
    },
    {
      kind: "list",
      ordered: true,
      items: [
        "Front-load one piece of revenue proof inside the first 60 seconds. Without it, the rest of the script is dismissed as theory.",
        "Pair every claim with a receipt within ~15 seconds. \"Self-liquidating\" → Hyros screenshot. \"23,500+ students\" → wall of love. \"$700K month\" → live Stripe.",
        "Pre-empt the \"that's just you\" objection with first-sale and first-week proofs from members. Our most converting proof block is not the founder's $700K — it is Sturge's first $27 sale 20 minutes after starting.",
        "End the proof block on identity proof — someone the avatar would like to be. \"Lorna left her car-dealership job last week.\" \"Harry hit his first $10K month after years of buying courses.\"",
      ],
    },
    {
      kind: "callout",
      tone: "danger",
      title: "Receipts attached or it didn't happen",
      text:
        "Our wall of love rule: every single income claim from a member must include a screenshot. Otherwise the testimonial is not published. Adopt the same rule and your proof block does 2x the work, because viewers know other viewers are also being held to it.",
    },
  ],
};

const offerBank: Chapter = {
  slug: "offer-bank",
  number: "10",
  title: "Offer Bank",
  kicker: "Plug-and-play offer stacks for every rung of the ladder",
  intro:
    "These are the four offer skeletons we use repeatedly. Every one of them is structured to feel like a no-brainer compared to either (a) the cost of inaction, or (b) the next, more expensive rung of the ladder.",
  blocks: [
    {
      kind: "template",
      title: "$27 self-liquidating front-end (PDF Farming / Answer Engine Authority style)",
      body:
        "Here's everything you get today, for $27:\n• The full [System Name] training, structured in short 2–5 minute, no-fluff videos.\n• Your own portal full of every template, AI tool and asset I use to run this.\n• The exact 90-minute launch path so you can be live by tonight.\n• 30-day money-back guarantee — see a clear path to your first sale or every penny back.\n\nThis is the only offer on the page. Nothing else to upgrade to before you're inside.",
    },
    {
      kind: "template",
      title: "$27–$47 order bump (VSL Vault / Ad Research Board style)",
      body:
        "Add the [Order Bump Name] to your order for an extra $[27–47]. You get [the specific deliverable — 5 plug-and-play VSL templates, a daily ad research board, the Hijack system].\n\nThis is a one-time-only price — you won't see it again at this number once you're inside the portal.",
    },
    {
      kind: "template",
      title: "$497 1-on-1 strategy upsell (post-purchase)",
      body:
        "Before you go in and start, you can add a 30-minute private strategy call with me, $497, one-time.\n\nWe'll map your exact offer, your front-end, and the 90-day ascension plan you're going to run. You leave the call with the next 30 days written down for you. If we can't, you don't pay.\n\nThis offer disappears the moment you leave this page.",
    },
    {
      kind: "template",
      title: "$5K/month 1-1 coaching",
      body:
        "Outside of my $250K Portugal villa intensive, this is the only place you can access me in real time.\n\nWhat you get:\n• Direct 1-1 access to me via Slack / WhatsApp.\n• Monthly 1-1 calls where we set the action tasks needed to hit the next revenue milestone.\n• Quarterly 3-day in-person mastermind days in Portugal or Miami — workshops where we build offers, run ads, and close clients in the room together.\n• Lifetime access to the proprietary tools, templates and dashboards we use to run a solo $700K/month operation.\n\n$5,000/month. No sales call required, no minimum term. Cancel any month.",
    },
    {
      kind: "template",
      title: "$25K–$100K+ Mastermind / Portugal Villa Intensive",
      body:
        "3 days, 1-1, with me — at the Portugal villa. Production crew, private chefs, ex-special-forces mindset coach. Done-for-you build of your low-ticket front-end, your Domino Marketing System install, and your backend ascension.\n\nYou leave with the entire system live, not theorised.\n\nApplication-only. We talk first to make sure it's the right move. If it isn't, we don't take you on.",
    },
    {
      kind: "callout",
      tone: "gold",
      title: "Stack rule",
      text:
        "Each rung of the ladder should reference the next one inside its own VSL. Not as a sales pitch — as orientation. The $27 buyer should know the $5K and the $25K exist. That is what makes the ascension psychological as well as financial.",
    },
  ],
};

const ctaBank: Chapter = {
  slug: "cta-bank",
  number: "11",
  title: "CTA Bank",
  kicker: "How to ask for the click without sounding like an infomercial",
  intro:
    "The CTA is not a sentence. It is a habit. Repeat it. Vary the wording. End every section block with a soft CTA, end the VSL with a hard one. The viewer should know exactly what to do, where to click, and what happens next.",
  blocks: [
    {
      kind: "heading", text: "Soft CTAs (use 2–3 times mid-VSL)", level: 2,
    },
    {
      kind: "list",
      items: [
        "\"If that resonates, the link is right below this video.\"",
        "\"Click below and I'll show you the rest from inside the portal.\"",
        "\"You can keep watching, or you can click below and just get started — your call.\"",
      ],
    },
    {
      kind: "heading", text: "Hard CTAs (use at the very end)", level: 2,
    },
    {
      kind: "template",
      title: "$27 front-end CTA",
      body:
        "Click the button below. You'll be inside the portal in under 60 seconds. You'll have the entire [System Name] training, the templates, and your own AI infrastructure waiting for you. 30-day money back, no questions. See you on the inside.",
    },
    {
      kind: "template",
      title: "$5K/mo coaching CTA",
      body:
        "Click below to claim your spot. You'll get an invite within the hour. We'll book your 60-minute onboarding, set your 90-day plan, and you'll be in our 1-1 chat by tomorrow.\n\nIf you've got questions first, the link below also goes straight to my Instagram DMs. Either way, the next move is yours.",
    },
    {
      kind: "template",
      title: "Mastermind / Portugal CTA",
      body:
        "Click below to apply. We'll review and personally reach out to set up a short 1-1 conversation. If it's the right move, you'll have your dates locked in within 7 days. If it isn't, we'll tell you exactly what to focus on instead.",
    },
    {
      kind: "callout",
      tone: "neutral",
      title: "The 3 things every CTA must answer",
      text:
        "1) What do I click? 2) What happens next? 3) What's the safety net? If any one of those is missing, your conversion drops. Read your CTA out loud and make sure all three are there.",
    },
  ],
};

const hormoziAlan: Chapter = {
  slug: "hormozi-alan",
  number: "12",
  title: "The Performance Offer (Hormozi \"Alan\" Rebuilt for Our Model)",
  kicker: "How to make the offer itself the reason they say yes",
  intro:
    "Hormozi's \"Alan\" VSL works because the offer eliminates the only objection that actually matters: risk. We're rewriting it here for our world — instead of a lead-gen agency, the worked example is our Apex Performance Offer for a coach / consultant / DFY operator who has the asset but can't scale it.",
  blocks: [
    { kind: "heading", text: "The 5 ingredients of a true performance offer", level: 2 },
    {
      kind: "table",
      columns: ["Ingredient", "What it does", "On-brand version"],
      rows: [
        [
          "1. Outcome guarantee",
          "We do not get paid unless you do.",
          "We install a $27 front-end + Domino Marketing System into your business. You only pay us % of the net new revenue we generate.",
        ],
        [
          "2. Inverted risk",
          "Our skin is bigger than yours.",
          "We cover the build cost upfront. You cover only ad spend, capped at $X/day until breakeven.",
        ],
        [
          "3. Stupidly specific deliverable",
          "They can imagine the asset before they pay.",
          "1 self-liquidating front-end VSL + landing page + checkout + 5 hooks + 3 ad creatives + automated upsell flow.",
        ],
        [
          "4. Clear go / no-go criteria",
          "Filters out the wrong fit so the right fit feels chosen.",
          "Must already do $25K+/month in [coaching / DFY / info]. Must have a clear 1 thing they sell. Must be willing to ship in 14 days.",
        ],
        [
          "5. Time-bound urgency",
          "Forces a decision.",
          "We take on 3 partners per quarter. Once full, the next slot is 90 days away.",
        ],
      ],
    },
    { kind: "heading", text: "The script — our Apex Performance Offer rewrite", level: 2 },
    {
      kind: "template",
      title: "Worked Hormozi-style script (rewritten for our model)",
      body:
        "Here's the offer.\n\nWe install a complete Low Ticket Ascension front-end into your business. That includes:\n• A 6-minute self-liquidating VSL written specifically for your offer.\n• A landing page + checkout + automated upsell flow.\n• 5 plug-and-play hooks and 3 ad creatives.\n• A 14-day Domino Marketing System launch — engagement campaign + direct response campaign + retargeting.\n\nWe build it. We launch it. We optimise it.\n\nHere's the part that makes it different.\n\nYou pay us $0 to build it. We cover the build cost. You only cover ad spend, capped at $[X]/day until the front-end self-liquidates. From the moment new buyers start coming in, we take a flat % of net new revenue from those buyers — and that's it. No retainer, no setup fee, no \"strategy retainer\" hidden in month 2.\n\nIf we don't generate net new revenue, you don't pay us anything beyond the ad budget.\n\nWe take on 3 partners per quarter. When the slots are full, the next intake is 90 days out. If you'd like one of the slots, click below to apply. We'll do a short 1-1 to make sure it's a fit. If it isn't, we'll tell you exactly what to do instead.",
    },
    {
      kind: "callout",
      tone: "gold",
      title: "Why this re-write outperforms the original \"Alan\"",
      text:
        "Hormozi's lead-gen pitch lives in B2B services. Our market is solopreneur info / coaching / DFY operators. The risk-reversal lever is the same — but the deliverable here is a tangible front-end the prospect can already see being built, not a vague \"leads.\" That makes it easier to imagine, which makes it easier to buy.",
    },
  ],
};

const exMain: Chapter = {
  slug: "example-main-vsl",
  number: "13.1",
  title: "Worked Breakdown — our Main VSL ($27 front-end)",
  kicker: "Line by line: how the Main VSL turns a stranger into a $27 buyer in under 90 seconds",
  intro:
    "This is the Main VSL — the one that drives most of the cold traffic into the entire ladder. Notice the structure: belief break inside the first sentence, proof and stakes by sentence 3, mechanism named and walked by sentence 6.",
  blocks: [
    {
      kind: "annotation",
      rows: [
        {
          line: "\"I scaled to over $700,000+ a month as a one person business with a client acquisition method that turns $97 buyers into $100K+ premium dream client deals while self liquidating all marketing spend from day one.\"",
          note: "Beat 1+2+3 fired in a single sentence: pattern interrupt (\"one person business\"), big promise (\"$700K/mo\"), drawback eliminator (\"self liquidating from day one\").",
        },
        {
          line: "\"Now AI tools with the correct knowledge to implement are useless, and knowledge on its own is slow to implement…\"",
          note: "Belief BREAK on the two dominant beliefs in this market — \"AI alone wins\" and \"a course alone wins.\" Sets up the rebuild.",
        },
        {
          line: "\"…so I give you both to work hand in hand to get your own clone of my client acquisition system launched within 90 minutes.\"",
          note: "REBUILD + drawback eliminator (\"90 minutes\"). The viewer now believes a thing they did not believe 10 seconds ago.",
        },
        {
          line: "\"I'm betting on two things in this post-AI era. One is trust is now harder than ever to build… so the best way is to get prospects results for themselves.\"",
          note: "Mechanism setup. Trust = scarcer. Results = the new currency. This is the entire philosophical foundation of Low Ticket Ascension.",
        },
        {
          line: "\"Two, in person experiences and 1-1 backend offers that get clients results AI will never be able to deliver — and sell these for over $100,000 per client on the top end.\"",
          note: "Pre-frames the Portugal Villa / Mastermind without selling it. Plants the entire ladder in the prospect's head before they even buy the front-end.",
        },
        {
          line: "\"Step 1 — I build a low ticket offer that is either done for you, template or info with AI built in to implement faster but all leads to one thing. Our prospects getting insane results / ROI within hours.\"",
          note: "Numbered step 1 of the named mechanism. Specific (low ticket / DFY / template / info) but vague enough that you still need him.",
        },
        {
          line: "\"Step 2 — Domino marketing system. Engagement campaign first, anyone who watches more than 3 seconds gets pushed to direct response, then the low ticket offer.\"",
          note: "Step 2 with a named sub-mechanism. The 3-second filter is a memorable, ownable detail — that's the kind of thing the prospect repeats to a friend.",
        },
        {
          line: "\"Why? The engagement campaign works as a filter and trust builder, which then leads to as low as 42% lower CPMs on your direct response campaign.\"",
          note: "Drops a specific number (42%). Specific = credible. This is also where casual viewers convert from \"interesting\" to \"oh — this is real.\"",
        },
        {
          line: "\"We went from zero to $21,000 a day in ad spend while still profiting on the front end and not costing us a dollar in spend.\"",
          note: "Receipt + drawback eliminator combined. Proves the model with a number, then immediately removes the assumed cost (\"didn't cost us a dollar\").",
        },
        {
          line: "\"Step 3 — they go through our low ticket, see the huge ROI… convert without sales calls our premium backend deals which include our $100K+ Portugal villa intensive.\"",
          note: "Step 3 closes the ascension loop. Note he names the offer (Portugal villa) without selling it. Identity proof for the avatar who already wants in.",
        },
        {
          line: "\"All without sales calls or any team members, I literally run this on my own.\"",
          note: "Identity reinforcement — the avatar who is sick of being told to hire a team is being directly handed permission not to.",
        },
        {
          line: "\"If you're here, and still watching then I believe there's a part of you that wants to do the same. So click below.\"",
          note: "Soft CTA, identity-locked. Not \"buy now\" — \"if part of you wants the same outcome, click.\" Removes the salesman framing.",
        },
        {
          line: "\"You get all the knowledge structured in short 2–5 min no fluff videos, your own account full of templates, AI infrastructure and everything else I use.\"",
          note: "Offer stack delivered as plain inventory, not a brochure. Reads like a friend describing what's inside, not a marketer.",
        },
        {
          line: "\"Now my numbers aren't typical or normal… but even if you could do 5% of them for most of you it would be life changing.\"",
          note: "Pre-empts the \"that's just you\" objection. The 5% reframe is the entire risk reversal — the viewer downgrades the promise themselves and still wants in.",
        },
        {
          line: "\"That's it — check it out below and get started now if you wish, see you on the inside.\"",
          note: "Hard CTA, casual tone, repeated location (\"below\"). \"See you on the inside\" plants identity — the buyer is already a member, they just haven't paid yet.",
        },
      ],
    },
  ],
};

const exAssetFarming: Chapter = {
  slug: "example-asset-farming",
  number: "13.2",
  title: "Worked Breakdown — AI Asset Farming VSL",
  kicker: "How a $97 product is built around a single ownable mechanism",
  intro:
    "AI Asset Farming is the longest VSL we ship, because it teaches a brand new mechanism the prospect has never heard of. The structure is identical to the Main VSL, but every beat is stretched. Watch how the \"vending machine\" analogy does 80% of the persuasion work.",
  blocks: [
    {
      kind: "annotation",
      rows: [
        {
          line: "Opens with founder clips: Bezos, Musk, Zuckerberg on AI as the biggest opportunity of a lifetime.",
          note: "Borrowed authority hook. Spikes credibility before the presenter has said a word. Pure pattern interrupt — viewer wasn't expecting CEOs.",
        },
        {
          line: "\"Could you imagine yourself earning $1K+ per day profit without prior experience using AI, remaining 100% faceless online…\"",
          note: "Big promise + drawback eliminators stacked: no experience, faceless, no sales calls.",
        },
        {
          line: "Live screenshare of Stripe ($720K+ revenue), then Hyros ($394K net), then a random Tuesday at 9am still profitable.",
          note: "Receipt-first proof inside the first 90 seconds. The random-Tuesday detail is the killer — proves it's not a cherry-picked screenshot.",
        },
        {
          line: "Wall-of-love montage: Lorna $682 in profit, Sturge first $27 sale, James first organic sale, Harry first $10K month after years of buying courses.",
          note: "Identity-proof block. Each member is a different stage of the avatar's journey — first sale, first $1K day, first $10K month. Viewer self-selects.",
        },
        {
          line: "\"Think of it like a vending machine. Instead of dispensing snacks, it dispenses pain relief that solves people's problems.\"",
          note: "Mechanism reveal. The vending machine is a sketchable analogy — that's why it sticks. The prospect can now describe it to a friend.",
        },
        {
          line: "Founder's origin story: corporate teaching marketing to graduates → wife saying \"I don't recognise you\" → A&E with wires on his heart → quit → asset farms → $700K/mo.",
          note: "Origin block timed perfectly — comes after enough proof to earn the room, before the walkthrough so the avatar buys into the presenter as the guide.",
        },
        {
          line: "Step 1 — pick a problem. Step 2 — wrap an existing AI tool in a $27 product. Step 3 — point traffic at it from raw 5-second clips.",
          note: "3-step walkthrough. Named, numbered, visual. The 5-second clip detail is identity-locked — nobody else in the niche teaches that.",
        },
        {
          line: "Repeats the wall of love mid-script with new members and new screenshots.",
          note: "Belief stack. Re-proves the mechanism right after the walkthrough so the viewer can't slip into scepticism before the offer.",
        },
        {
          line: "Offer stack: full training + AI infrastructure + templates + community + 30-day money back.",
          note: "Inventory framing — not features, just \"here's what arrives in your account.\" Reads like a delivery slip.",
        },
        {
          line: "\"My results aren't typical, but even 5% of these numbers would be life changing.\"",
          note: "Same 5% reframe as the Main VSL. Pre-empts disclaimer fatigue and converts on its own.",
        },
      ],
    },
  ],
};

const exAiFlipping: Chapter = {
  slug: "example-ai-flipping",
  number: "13.3",
  title: "Worked Breakdown — AI Flipping VSL (High Ticket)",
  kicker: "How a high-ticket coaching VSL leans on macro fear before pivoting to opportunity",
  intro:
    "The AI Flipping VSL is the high-ticket sibling of AI Asset Farming. The structural difference: it leans much harder on macro fear in the first 30 seconds (job loss, AI replacement, cost of living). That fear primes the viewer for an aspirational pivot.",
  blocks: [
    {
      kind: "annotation",
      rows: [
        {
          line: "\"400M jobs lost by 2030. Every 2.2 seconds a job is lost due to AI. Cost of living crisis. Governments increasing taxes.\"",
          note: "Fear hook stack. Each line is a documented stat. Loss-aversion fired hard before any promise is made. Viewer is now scared and looking for an exit.",
        },
        {
          line: "\"I'm going to come back to this in a second… as this is your escape route.\"",
          note: "Open loop. The single most important sentence in the first 30s — buys the next 60 seconds without selling anything yet.",
        },
        {
          line: "\"Everyday people are flipping AI tools in under 60 minutes a day, generating their old monthly salary in single payments of $3K, $5K, $10K…\"",
          note: "Big promise re-anchored on a relatable identity (\"old monthly salary in single payments\"). Specific brackets are deliberately graspable.",
        },
        {
          line: "\"…without any AI experience or even showing their face online.\"",
          note: "Drawback eliminators stacked. Two of the avatar's deepest fears removed in one line.",
        },
        {
          line: "Member montage — Carlos: 0–10K in 3 days. Then 5–6 quick clips of single positive words.",
          note: "Pace + proof. The single-word clip stack is a signature move — keeps the slippery slide moving while loading proof.",
        },
        {
          line: "\"$10,000 a day. $43K net profit in 24 hours. $724K last month working less than 4 hours a day.\"",
          note: "Receipt cluster. Three escalating numbers, each more impressive than the last, each backed by Stripe / Hyros screenshares.",
        },
        {
          line: "\"I won a global digital business innovation award. Forbes USA did a full interview. I'm sharing stages with Kevin Harington from Shark Tank.\"",
          note: "Press / authority block. Stops the avatar from filing this away as \"another guru.\"",
        },
        {
          line: "Founder's origin story: dyslexia, PTSD at 16, 12-hour cold-call days, agency that hit 3,000 clients then crushed him, A&E moment.",
          note: "Origin is longer in this VSL because the price point is higher. Higher price = needs more identity congruence.",
        },
        {
          line: "Mechanism: install existing AI tools into the 277M traditional businesses still without AI, save them, get paid.",
          note: "Mechanism is contrarian — points the viewer at offline traditional businesses, not the saturated online market. That's the new belief being installed.",
        },
        {
          line: "Wall-of-love + first-sale stories from 23,500+ students.",
          note: "Same identity-proof block as Asset Farming, weighted toward members who ascended into bigger programs.",
        },
        {
          line: "Offer + risk reversal + CTA.",
          note: "At the high ticket price point the CTA is application-flavoured (\"if you know you're the best, click\"), not transactional.",
        },
      ],
    },
  ],
};

const exSkyrox: Chapter = {
  slug: "example-skyrox",
  number: "13.4",
  title: "Worked Breakdown — Skyrox Elite VSL",
  kicker: "How a premium $5K-$10K backend VSL uses identity gating instead of hard selling",
  intro:
    "Skyrox Elite is a backend offer for already-warm buyers. The VSL behaves accordingly — it does not chase the cold viewer, it gates the wrong viewer out and pulls the right viewer in by name.",
  blocks: [
    {
      kind: "annotation",
      rows: [
        {
          line: "Opens with: \"This isn't for everyone. If you're not already doing $25K+/month, please close this video.\"",
          note: "Identity gate hook. Counter-intuitive — telling people to leave instantly increases the perceived value of staying.",
        },
        {
          line: "\"You're here because the front-end works. The numbers are coming in. But you've hit the ceiling solo and you don't want a 40-person team.\"",
          note: "Mirror-the-thought lead. Names the avatar's exact internal monologue — earns the next 60s instantly.",
        },
        {
          line: "Proof: existing Skyrox member case studies — \"Member X went from $40K → $180K/mo in 90 days, no new hires.\"",
          note: "Identity-matched proof. Receipts are sized to the avatar (not the founder's $700K), so the avatar can imagine themselves in the screenshot.",
        },
        {
          line: "Mechanism: \"It's the operating system I run my own business on, given to you 1-1.\"",
          note: "Mechanism is the access itself, not a course. At this price the buyer is paying for proximity, and the script names that explicitly.",
        },
        {
          line: "Walkthrough: weekly 1-1, Slack/WhatsApp access, quarterly Portugal mastermind, lifetime tool access.",
          note: "Inventory framing again — but each item is a status object, not a feature. \"Quarterly Portugal mastermind\" sells itself.",
        },
        {
          line: "Risk reversal: \"No long-term lock-in. Cancel any month.\"",
          note: "Removes the only remaining objection at this price point — duration of commitment.",
        },
        {
          line: "CTA: \"Click below. We'll have you onboarded inside 7 days.\"",
          note: "Concrete next-step. Time-bound. No application friction because the gate at the top already filtered the room.",
        },
      ],
    },
  ],
};

const exLeadClub: Chapter = {
  slug: "example-leadclub",
  number: "13.5",
  title: "Worked Breakdown — LeadClub Agency VSL",
  kicker: "How an agency / DFY VSL is built when the buyer wants leads, not lessons",
  intro:
    "LeadClub is a DFY agency VSL. The buyer here isn't an info learner — they want a finished thing. The structure inverts: less mechanism teaching, more deliverable specificity, more proof per minute.",
  blocks: [
    {
      kind: "annotation",
      rows: [
        {
          line: "Opens with: a Hyros-style screenshare of cost per qualified appointment dropping from $X to $Y.",
          note: "Receipt-first hook. DFY buyers want to see numbers, not stories. Lead with proof or lose them.",
        },
        {
          line: "\"You don't need another course. You don't need another funnel template. You need leads in the calendar by next Friday.\"",
          note: "Belief BREAK + identity gate in one line. Anyone who wants to learn leaves; anyone who wants the result stays.",
        },
        {
          line: "Mechanism: the Domino Marketing System installed for you, not by you.",
          note: "Same core mechanism, repackaged as DFY. Re-uses brand equity from the front-end.",
        },
        {
          line: "Deliverable list: campaigns built, creatives shot, copy written, retargeting wired, weekly optimisation reports.",
          note: "Specific deliverables. Each line is a thing the buyer can imagine seeing in their own ad account by Friday.",
        },
        {
          line: "Performance frame: \"Pay a flat % of net new revenue. If we don't deliver, you don't pay.\"",
          note: "Hormozi-style risk reversal applied to the agency model. Inverts the agency norm of upfront retainers.",
        },
        {
          line: "Capacity scarcity: \"3 partners per quarter. Slots fill 30 days out.\"",
          note: "Real, specific scarcity. Not \"limited time only\" — a number the buyer can see and verify.",
        },
        {
          line: "CTA: \"Click below to apply. Short call to confirm fit. If it's the right move, you're live in 14 days.\"",
          note: "Application CTA + time-bound install promise. Removes the \"how long until I see results\" objection upfront.",
        },
      ],
    },
  ],
};

const exPdfFarming: Chapter = {
  slug: "example-pdf-farming",
  number: "13.6",
  title: "Worked Breakdown — PDF Farming 4.0 VSL",
  kicker: "How a niche-specific $97 product VSL converts cold beginners",
  intro:
    "PDF Farming 4.0 is the original AI Asset Farm — a $97 product that turns ChatGPT-generated PDFs into a faceless income stream. The VSL is built for absolute beginners and uses radical specificity to overcome \"this can't be that simple\" disbelief.",
  blocks: [
    {
      kind: "annotation",
      rows: [
        {
          line: "Hook: \"My first $27 sale came from a PDF I made in 14 minutes with ChatGPT.\"",
          note: "Specific (14 minutes), low (just $27), real (ChatGPT). Three details that make the entire claim believable in one sentence.",
        },
        {
          line: "\"I thought it was a glitch. Then 3 minutes later, another one. Then later that day, a $207 order came in. I never spoke to a single one of them.\"",
          note: "Story-as-proof. Builds disbelief deliberately so the buyer's own scepticism becomes the demonstration.",
        },
        {
          line: "Mechanism: \"PDF Farming\" — pick a problem, generate a PDF that solves it, sell it from a faceless 5-second TikTok.\"",
          note: "Three steps, all sketchable, all under-15-minute tasks. Lowers perceived effort to the point where \"why not\" beats \"why.\"",
        },
        {
          line: "Walkthrough with screenshares: the presenter actually generates a PDF on screen, sets up the page, pushes a clip live.",
          note: "Behind-the-scenes proof. Beginner buyers need to see the screen, not just hear it. Removes \"I won't know how\" objection.",
        },
        {
          line: "Wall-of-love: 23,500+ students, with deliberately small first wins (\"my first $9 sale,\" \"my first $27 day\").",
          note: "Identity-matched proof for beginners. Big numbers would intimidate; small first wins normalise success.",
        },
        {
          line: "Offer: $97, full system, AI tools included, 30-day money back, lifetime access.",
          note: "Beginner-priced. Risk reversal is mandatory at this avatar's confidence level.",
        },
      ],
    },
  ],
};

const exGhostBuilding: Chapter = {
  slug: "example-ghost-building",
  number: "13.7",
  title: "Worked Breakdown — Ghost Building V1 (Storyboard)",
  kicker: "How a faceless launch storyboard maps directly onto the 9-step structure",
  intro:
    "Ghost Building V1 is the storyboard for a faceless cold-traffic VSL — the script lives entirely in shot-by-shot annotations because the operator never appears on camera. Same 9 beats, different delivery.",
  blocks: [
    {
      kind: "annotation",
      rows: [
        {
          line: "Shot 1 (0–3s): Aerial drone shot of empty office at 6am, voiceover: \"This is what your business looks like 90 days from now.\"",
          note: "Pattern interrupt + future pace in one shot. Hook AND big promise compressed into 3 seconds. No talking head needed.",
        },
        {
          line: "Shot 2 (3–10s): Stripe screenshare with daily revenue ticking up, voiceover continues: \"Without you, your team, or a single sales call.\"",
          note: "Proof block #1. Receipts before the avatar even knows who's talking — which, in a faceless build, is the whole point.",
        },
        {
          line: "Shot 3 (10–25s): Cut to AI b-roll of a busy operator running calls, then a hard cut to the same operator on a beach. \"You can keep doing it the old way. Or you can install the model that runs without you.\"",
          note: "Belief BREAK delivered through visual contrast, not script. The avatar feels the choice rather than being told it.",
        },
        {
          line: "Shot 4 (25–60s): Animated mechanism diagram of the Domino → Front-end → Backend ladder.",
          note: "Mechanism reveal as motion graphics. Sketchable, ownable, memorable. This is the slippery slide doing its work.",
        },
        {
          line: "Shot 5 (1:00–3:00): 3-step walkthrough — each step a single illustrated panel + voice-over + screen-recorded proof.",
          note: "Walkthrough beat. Same 3-step structure as our other VSLs, but every step is a still + voice-over rather than a talking head.",
        },
        {
          line: "Shot 6 (3:00–4:30): Wall-of-love stitched as a fast scrolling vertical reel.",
          note: "Identity proof block. Faceless VSLs need MORE proof because there's no face to anchor trust to.",
        },
        {
          line: "Shot 7 (4:30–5:30): Offer stack as on-screen list with price reveal at the end.",
          note: "Offer stack delivered visually. Voiceover repeats price + guarantee + 30-day window. Hits the same beats as a talking head.",
        },
        {
          line: "Shot 8 (5:30–end): Big animated CTA button with on-screen text \"Click here to get started.\"",
          note: "CTA is literally a button on screen. Faceless VSLs collapse the ambiguity by making the next click visible.",
        },
      ],
    },
  ],
};

const exAnswerEngine: Chapter = {
  slug: "example-answer-engine",
  number: "13.8",
  title: "Worked Breakdown — Answer Engine Authority ($27)",
  kicker: "How a 90-second power-punch VSL still hits all 9 beats",
  intro:
    "The Answer Engine Authority VSL is a sub-2-minute power punch. Look how every one of the 9 beats is still present — they are just compressed. Use this as your blueprint for any short-form $27 front-end where the offer is simple and the avatar is already pain-aware.",
  blocks: [
    {
      kind: "annotation",
      rows: [
        {
          line: "\"Listen. If you're not showing up in AI search right now, your business is basically dead.\"",
          note: "Hook + belief BREAK in one line. \"Basically dead\" is the pattern interrupt — most copy softens this; this doesn't.",
        },
        {
          line: "\"Google, Siri, Alexa, even ChatGPT… they don't care about your website. They pick one answer. And guess what? It's probably not you.\"",
          note: "Challenge / cost-of-old-belief beat. Names the loss, sharpens it with rhythm. Three repetitions of the same idea (none of them care) hammers it home.",
        },
        {
          line: "\"That's why 90% of businesses stay invisible while their smarter competitors get chosen, trusted, and paid.\"",
          note: "Loss aversion + identity injection. \"Smarter competitors\" makes the avatar self-rank — they have to choose which side of the line they're on.",
        },
        {
          line: "\"Outdated SEO is worthless in 2025. Keyword stuffing, backlinks — trash. The only thing that matters now is Answer Engine Optimization.\"",
          note: "Mechanism reveal. Named (\"Answer Engine Optimization\"), contrasted explicitly with the dominant approach.",
        },
        {
          line: "\"A complete system that shows you how to: find the questions buyers are asking AI, structure your knowledge so machines recognise you, turn AI search into nonstop leads.\"",
          note: "3-step walkthrough, compressed. Each step is a one-liner. The brain still gets the structure.",
        },
        {
          line: "\"I could charge $497 for this. But today, you can grab the full system for just $27.\"",
          note: "Anchor + price reveal in one sentence. The $497 anchor makes $27 feel like a no-brainer — without ever being heavy-handed.",
        },
        {
          line: "\"And if you don't see a clear path to becoming the chosen answer in 30 days, every penny back.\"",
          note: "Risk reversal — short, specific, no friction. The 30-day frame is identity-bound, not just temporal.",
        },
        {
          line: "\"Stay invisible and watch your competitors eat your lunch… or click the button and finally make AI work for you. The smart ones will act now.\"",
          note: "Hard CTA + identity-locked urgency. Final line splits the room. \"The smart ones\" makes inaction feel like a self-image cost.",
        },
      ],
    },
    {
      kind: "callout",
      tone: "gold",
      title: "Use this as your short-form template",
      text:
        "Any time you have a simple $27 offer for a pain-aware buyer, you can use this skeleton verbatim and just swap the niche language. It is the closest thing to a copy-paste plug-and-play VSL in this masterclass.",
    },
  ],
};

const exCoaching: Chapter = {
  slug: "example-5k-coaching",
  number: "13.9",
  title: "Worked Breakdown — $5K/mo Coaching VSL",
  kicker: "How a backend VSL talks to someone who already knows you",
  intro:
    "The $5K/mo coaching VSL is a different beast. It is not selling — it is qualifying. The viewer has already consumed the front-end, the email sequences, and probably 10+ hours of our content. The job here is to remove friction, not build belief.",
  blocks: [
    {
      kind: "annotation",
      rows: [
        {
          line: "\"Outside of my $250K one-on-one intensive in Portugal, this is the only place you can access me in real time.\"",
          note: "Anchor first sentence. Plants a $250K reference price before the $5K is mentioned. The $5K now feels like a discount.",
        },
        {
          line: "\"Look, this is a really simple offer and there's a high chance if you hit this page, you either consume an absolute ton of content or you've come through one of my low ticket offers, so you kind of know what we do.\"",
          note: "Permission lead. Skips re-pitching the model. Respects the viewer's time and confirms they're qualified to be here.",
        },
        {
          line: "\"I work with you 1-1 via Slack or WhatsApp, with 1-1 calls where we set the action tasks needed to be done to hit that next revenue milestone.\"",
          note: "Specific deliverable. \"Action tasks\" is operator language — confirms the conversation level.",
        },
        {
          line: "\"Not only that, I'm proactive not reactive. We log everything on your own portal, and can even link into some of your tools so I can help you overcome hurdles before you even hit them.\"",
          note: "Differentiator. Proactive coaching is rare. The portal + tool integration detail is the unique edge.",
        },
        {
          line: "\"Every 6 months, in-person 1-1 mastermind days in Portugal or Miami — you'll get more done in 3 days than you do in a month.\"",
          note: "Backend offer pre-frame + identity object. The \"Portugal / Miami\" reference is status-loaded and sticks in the avatar's head.",
        },
        {
          line: "\"I don't do online communities. I do personal 1-1 help.\"",
          note: "Anti-positioning. Names what every other coaching offer is, and explicitly is not that. Sharpens identity.",
        },
        {
          line: "\"60-minute onboarding call with me, exclusive portal, your personal tracker.\"",
          note: "Concrete first 7 days. Removes the \"what happens after I pay\" objection. This is what backend buyers actually want to know.",
        },
        {
          line: "\"Click below. Either go ahead and join, or DM me on Instagram first if you've got questions.\"",
          note: "Two-CTA close. Lowers friction for fence-sitters by giving them a path that isn't \"buy now.\"",
        },
      ],
    },
  ],
};

const exMastermind: Chapter = {
  slug: "example-mastermind",
  number: "13.10",
  title: "Worked Breakdown — High-Ticket Mastermind / Forbes Example",
  kicker: "How the top of the ladder VSL sells without selling",
  intro:
    "At $25K-$100K+, you are not selling on the page. You are pre-qualifying for a 1-1 conversation. The VSL exists to make the right buyer pre-sell themselves before the call. Notice how the Mastermind script is almost entirely identity, lifestyle, and specificity — and almost no \"buy now\" language.",
  blocks: [
    {
      kind: "annotation",
      rows: [
        {
          line: "\"This is for solopreneurs, coaches, and experts who want to scale to $1M/month — without employees, without complexity.\"",
          note: "Identity gate. The avatar self-selects in the first sentence. Anyone outside the bracket leaves; anyone inside leans in.",
        },
        {
          line: "\"Over 90 days, you'll work directly with me to install the Low-Ticket Ascension Operating System.\"",
          note: "Time-bound + 1-1 frame. \"Directly with me\" is the differentiator that justifies the price.",
        },
        {
          line: "\"Most scaling advice is broken. It's either too complex, too team-heavy, or it burns cash without results.\"",
          note: "Belief BREAK at the right level. Different from the $27 break — this one targets sophisticated operators who've already heard the basics.",
        },
        {
          line: "\"This is how I scaled to $724K/month with zero employees.\"",
          note: "Single piece of identity-matched proof. At this level, one credible number does more than 50 testimonials.",
        },
        {
          line: "\"Phase 1 — 90-minute private kickoff. Phase 2 — monthly 1-1 calls + Slack/WhatsApp. Phase 3 — quarterly Portugal masterminds. Phase 4 — lifetime tool access.\"",
          note: "4-phase walkthrough. Same numbered structure as the front-end VSLs, scaled to a 90-day deliverable.",
        },
        {
          line: "\"$5,000/month. No specific dollar guarantee — but the system is proven. Results depend on execution.\"",
          note: "Honest risk frame. At this price, hard guarantees feel suspicious. \"Execution-dependent\" is more credible than \"results guaranteed.\"",
        },
        {
          line: "\"FAQs: Can I book a call to see if this is a fit? Yes — fill in the application, and we'll hop on a 1-on-1.\"",
          note: "Application gate as the CTA. The application is the offer. Buying the call is the buying decision.",
        },
        {
          line: "Forbes USA feature, global digital business innovation award, Kevin Harington stage references.",
          note: "Authority block sprinkled throughout, not stacked. At this price point the buyer needs steady reassurance, not a single proof dump.",
        },
      ],
    },
  ],
};

const miniGenerator: Chapter = {
  slug: "mini-vsl-input-generator",
  number: "14",
  title: "Mini VSL Input Generator (on-brand prompts)",
  kicker: "Three drop-in prompts to pre-fill a VSL brief from one document",
  intro:
    "These prompts are rewritten so they only ever produce VSLs for our world: info, coaching, or done-for-you services on a low-ticket-to-high-ticket ladder. They will refuse to produce e-com / supplement / health output. Paste them into Claude or ChatGPT, attach your offer brief, and let it fill in the blanks before you write a word of script.",
  blocks: [
    {
      kind: "template",
      title: "Prompt 1 — INFO product VSL ($27 front-end)",
      body:
        "You are a senior direct-response copywriter who only writes VSLs for low-ticket info, coaching, and done-for-you offers on a low-to-high ticket ascension ladder. You never reference e-commerce, supplements, or health products. The writer is selling a digital info product priced under $100. Read the attached creative brief and fill in each bracket below. Keep every answer crisp, specific, and grounded in receipts the brief actually contains.\n\n[Target Market — who is the operator we're selling to? Income, current MRR, niche, biggest current frustration]\n[Urgent Problem — what is breaking right now in their business if they don't fix this?]\n[Ultra-Specific Promise — single biggest outcome we're promising, with a number]\n[Mechanism Name — the proprietary system we're naming]\n[Mechanism 3 Steps — written as Step 1, Step 2, Step 3]\n[Drawback Eliminator — without doing X, hiring Y, paying Z]\n[Proof Receipts — Stripe, Hyros, Forbes, awards, member wins, with attached numbers]\n[Spokesperson Story — past pain that mirrors avatar, turning point, refinement, current result]\n[Test Group / Wall of Love — what early members achieved, with numbers]\n[Offer Stack — what's inside, structured as inventory not features]\n[Price + Risk Reversal + Urgency]\n[CTA — what they click, what arrives next, what's the safety net]\n\nDo not write the script yet. Just return the filled brief as a single structured document.",
    },
    {
      kind: "template",
      title: "Prompt 2 — EXPERT / COACHING VSL ($1K-$5K backend)",
      body:
        "You are a senior direct-response copywriter who only writes backend coaching / consulting VSLs for the low-to-high ticket ascension model. You never reference e-com or physical products. The viewer of this VSL has already bought a front-end product and consumed multiple hours of the spokesperson's content. Your job is to qualify them, not re-pitch them. Read the attached brief and fill in each bracket.\n\n[Target Market — current MRR, what's working, what's the ceiling]\n[Big Promise — a specific revenue / freedom outcome over 90 days]\n[Risk Mitigator — how is risk eliminated at this price point]\n[Authority — proof of operator's results delivered at this level]\n[Key Objections — 2–3 sophisticated objections specific to a buyer at this price]\n[Spokesperson Track Record — biggest concrete result for self and clients]\n[Unique Solution — named system, 3–5 components]\n[Primary Differentiator — the one claim nobody else can make]\n[Onboarding Detail — what happens in the first 7 days after they pay]\n[CTA Incentive — value of the conversation itself, even if they don't buy]\n[Urgency Amplifier — capacity, intake schedule, time-bound install]\n\nReturn the filled brief as a structured document.",
    },
    {
      kind: "template",
      title: "Prompt 3 — DONE-FOR-YOU VSL ($25K-$100K+ install / mastermind)",
      body:
        "You are a senior direct-response copywriter for high-ticket DFY and mastermind offers in the low-to-high ticket ascension model. You never write for e-com, supplements, or health. The viewer of this VSL is an existing operator looking to outsource the build of their front-end and ascension system, or join an in-person mastermind. Read the attached brief and fill in each bracket.\n\n[Avatar — operator's revenue, team size, time available, biggest current bottleneck]\n[Current Pain — vivid description of what their week looks like at the bottleneck]\n[Desired Future — vivid description of what their week looks like 90 days post-install]\n[Spokesperson Discovery Motive — why the operator built this DFY service]\n[Hidden Cause Of The Bottleneck — the structural reason most operators stay stuck]\n[Failed Solutions — what they have tried, why each failed, drawbacks]\n[The DFY Build — concrete deliverables: VSL, page, checkout, ads, optimisation]\n[Performance / Risk Frame — what % of revenue, what is capped, what is guaranteed]\n[Proof — case studies of similar-sized operators who ascended, with numbers]\n[Capacity Scarcity — how many partners per quarter, real intake schedule]\n[CTA — application, fit call, install timeline]\n\nReturn the filled brief as a single structured document.",
    },
    {
      kind: "callout",
      tone: "neutral",
      title: "How to use these prompts",
      text:
        "Run prompt 1 (or 2, or 3) on your offer brief. Take the filled output, paste it into Claude/ChatGPT and ask: \"now write a 6-minute VSL using the 9-Step VSL Structure and the Unorthodox OS 8-section formula.\" You will get a draft you can edit, not generate from cold.",
    },
  ],
};

const editingSop: Chapter = {
  slug: "editing-production-sop",
  number: "15",
  title: "VSL Editing & Production SOP",
  kicker: "How to edit a VSL so the script's 9 beats actually land on screen",
  intro:
    "A great script can be killed by a bad edit. These rules exist because we have shipped enough VSLs to know which mistakes destroy retention. Apply them all, every time.",
  blocks: [
    { kind: "heading", text: "Pacing rules", level: 2 },
    {
      kind: "table",
      columns: ["Section", "Rule", "Why"],
      rows: [
        ["First 60 seconds", "Scene change every 2–3 seconds.", "Buys the slippery slide into the body of the VSL."],
        ["After 60 seconds", "Scene change every 3–5 seconds.", "Sustains attention without inducing motion sickness."],
        ["Anywhere", "No static talking-head clip longer than 5 seconds without a cut, zoom or insert.", "Static talking heads are where viewers leave."],
        ["Transitions", "Hard cuts, simple fades, light slide. No flashy plugins.", "Flashy transitions read as amateur. Hard cuts read as authority."],
      ],
    },
    { kind: "heading", text: "Spokesperson visibility rules", level: 2 },
    {
      kind: "list",
      ordered: true,
      items: [
        "Show the spokesperson immediately at 0:00.",
        "Re-introduce them at ~0:05, ~0:10 and ~0:20.",
        "At least 4 on-screen appearances in the first 60 seconds.",
        "After the first minute, re-anchor the spokesperson every 30–45 seconds. The viewer should never forget who they are listening to.",
      ],
    },
    { kind: "heading", text: "Footage rules", level: 2 },
    {
      kind: "list",
      items: [
        "Avoid polished stock footage. iPhone-style, real-feeling clips perform better.",
        "Use AI-generated b-roll for niche shots (e.g. \"operator in hospital bed\", \"fictional client at desk\"). Make it look raw, not glossy.",
        "Stripe / Hyros screenshares: zoom in on the number, hold for 2 seconds, cut. Do not pan around.",
        "Wall-of-love montages: vertical scrolling reel works best for faceless VSLs; horizontal grid for talking-head VSLs.",
      ],
    },
    { kind: "heading", text: "Emotional matching", level: 2 },
    {
      kind: "table",
      columns: ["Script section", "Color / lighting", "Motion"],
      rows: [
        ["Pain / break-belief beats", "Cooler tones, lower light, slower exposure.", "Slow-motion, longer holds."],
        ["Mechanism / walkthrough beats", "Neutral, daylight balanced.", "Steady, deliberate cuts."],
        ["Proof / future-pace beats", "Brighter, warmer.", "Faster, energetic cuts."],
        ["Offer / CTA beats", "On-screen graphics with brand colors.", "Static button shot held for the full CTA."],
      ],
    },
    {
      kind: "callout",
      tone: "gold",
      title: "The 10-second post-roll rule",
      text:
        "Hold the final CTA button on screen for 10 seconds AFTER the audio ends. Most viewers do not click while you are still talking — they click when the room goes quiet. Cut that off and you cut your conversion.",
    },
  ],
};

const v1Ad: Chapter = {
  slug: "v1-facebook-ad",
  number: "16",
  title: "V1 Facebook Ad Structure (Hook → Lead → Mechanism → Proof → Offer)",
  kicker: "The 5-beat ad that feeds the front-end VSL",
  intro:
    "Ads that send to a $27 VSL fail when they try to be the VSL. The ad's job is single: produce a 3-second-watch event that triggers the engagement → direct-response handoff inside the Domino Marketing System. Use this structure for every cold-traffic V1 ad.",
  blocks: [
    {
      kind: "table",
      columns: ["Beat", "Length", "Job", "On-brand example"],
      rows: [
        [
          "1. Hook",
          "0–3s",
          "Stop the scroll. Earn the next 5 seconds.",
          "\"$394K net profit in March — running solo, 4 hours a day. Watch this.\"",
        ],
        [
          "2. Lead",
          "3–10s",
          "Promise the payoff. Drop one specific.",
          "\"3-step model. No team, no calls, no audience. Here it is.\"",
        ],
        [
          "3. Mechanism",
          "10–30s",
          "Name the system + 3 steps in one breath.",
          "\"It's called Low Ticket Ascension. Step 1 self-liquidating $27 offer. Step 2 Domino traffic. Step 3 backend.\"",
        ],
        [
          "4. Proof",
          "30–45s",
          "One receipt. Stripe, Hyros, member, press.",
          "Live screenshare of $21K/day spend running profitable on day one.",
        ],
        [
          "5. Offer + CTA",
          "45–60s",
          "Direct hand-off to the VSL.",
          "\"Click the link. Watch the full breakdown. You can be live tonight.\"",
        ],
      ],
    },
    {
      kind: "callout",
      tone: "neutral",
      title: "Engagement campaign first, always",
      text:
        "Run this ad inside an engagement campaign first. Anyone who watches >3 seconds gets pushed to the direct-response campaign that pushes the VSL. This is what gets our CPMs as low as 42% below the niche baseline.",
    },
  ],
};

const checklist: Chapter = {
  slug: "final-checklist",
  number: "17",
  title: "Final Checklist (Ship This Before You Run Ads)",
  kicker: "If a single box is unchecked, fix it before you spend a dollar on traffic",
  intro:
    "The single biggest reason a VSL underperforms is that it shipped before it was actually finished. Run this checklist line by line. If any box is unchecked, do not turn ads on — go back and fix it. You only get to spend the impression once.",
  blocks: [
    { kind: "heading", text: "Script checks", level: 2 },
    {
      kind: "list",
      items: [
        "Hook lands a clear pattern interrupt in the first 3 seconds.",
        "Big promise + drawback eliminator in the first 25 seconds.",
        "First piece of revenue proof appears before 90 seconds.",
        "Origin story is relatable to the avatar, not to a different operator.",
        "Mechanism is named, capitalised, and has 3 sketchable steps.",
        "Each step in the walkthrough has a numbered, on-screen marker.",
        "Wall-of-love proof block re-fires at least once in the second half.",
        "Offer is delivered as inventory, not features.",
        "Risk reversal is explicit, time-bound, and friction-free.",
        "CTA tells the viewer what they click, what arrives next, and what the safety net is.",
      ],
    },
    { kind: "heading", text: "Edit checks", level: 2 },
    {
      kind: "list",
      items: [
        "Scene changes every 2–3 seconds in the first minute.",
        "Spokesperson appears at least 4 times in the first 60 seconds.",
        "No static shot held longer than 5 seconds.",
        "Stripe / Hyros / press screenshares zoom in on the number, not pan around.",
        "Final CTA button held on screen for 10 seconds after audio ends.",
      ],
    },
    { kind: "heading", text: "Funnel checks", level: 2 },
    {
      kind: "list",
      items: [
        "Order bumps offered on checkout (VSL Vault, Ad Research Board, etc.).",
        "$497 1-1 strategy upsell offered post-purchase, single page, time-locked.",
        "$5K/mo coaching CTA visible inside the portal once the buyer is in.",
        "Mastermind / Portugal application visible at the top of the ladder for repeat buyers.",
        "Hyros (or equivalent) attribution wired before traffic goes live.",
      ],
    },
    {
      kind: "callout",
      tone: "gold",
      title: "Ship it",
      text:
        "Once the boxes are all checked: run the engagement campaign first, push 3-second viewers into the direct response campaign, send the VSL the traffic. Read the data after 7 days, not 7 hours. Then iterate on whichever beat in the 9-step is leaking the hardest.",
    },
  ],
};

export const VSL_MASTERCLASS_CHAPTERS: Chapter[] = [
  foundations,
  breakBeliefs,
  nineStep,
  slipperySlide,
  unorthodoxOS,
  hookBank,
  leadBank,
  mechanismBank,
  proofBank,
  offerBank,
  ctaBank,
  hormoziAlan,
  exMain,
  exAssetFarming,
  exAiFlipping,
  exSkyrox,
  exLeadClub,
  exPdfFarming,
  exGhostBuilding,
  exAnswerEngine,
  exCoaching,
  exMastermind,
  miniGenerator,
  editingSop,
  v1Ad,
  checklist,
];
