// 20 ready-to-use advertorial page templates for the DFY Pack.
// Each entry's `html` field is a COMPLETE, self-contained HTML document
// (inline CSS, responsive, Google Font Inter, OG tags, one prominent CTA).
// Customers customise by replacing every [BRACKET PLACEHOLDER].
//
// Templates are produced by five style builders (4 niches each) so every
// document is unique by layout + accent + theme while keeping all
// customer-fill fields as clean bracket placeholders.

export type AdvertorialStyle =
  | "News Article"
  | "Personal Story"
  | "Listicle"
  | "Scientific"
  | "Viral Social Proof";

export type AdvertorialTemplate = {
  id: string;
  number: number;
  style: AdvertorialStyle;
  name: string;
  description: string;
  theme: "light" | "dark";
  html: string;
};

type BuilderCfg = {
  accent: string;
  theme: "light" | "dark";
  kicker: string;
};

function baseDoc(opts: {
  accent: string;
  theme: "light" | "dark";
  instructions: string;
  styles: string;
  body: string;
}): string {
  const dark = opts.theme === "dark";
  const bg = dark ? "#0e0e11" : "#ffffff";
  const fg = dark ? "#ececf2" : "#181820";
  const muted = dark ? "#9a9aa6" : "#5b5b67";
  const card = dark ? "#17171c" : "#f6f6f9";
  const border = dark ? "#28282f" : "#e7e7ee";
  return `<!DOCTYPE html>
<html lang="en">
<!--
  ${opts.instructions}
  HOW TO CUSTOMISE: replace every [BRACKET PLACEHOLDER] with your own copy,
  links and images. Update the <title> and og: meta tags, swap [CTA LINK] for
  your offer URL, and replace [IMAGE URL] / [HERO IMAGE URL] with your assets.
-->
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>[YOUR HEADLINE]</title>
  <meta name="description" content="[YOUR META DESCRIPTION]" />
  <meta property="og:title" content="[YOUR HEADLINE]" />
  <meta property="og:description" content="[YOUR META DESCRIPTION]" />
  <meta property="og:image" content="[OG IMAGE URL]" />
  <meta property="og:type" content="article" />
  <meta name="twitter:card" content="summary_large_image" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
  <style>
    :root {
      --accent: ${opts.accent};
      --bg: ${bg};
      --fg: ${fg};
      --muted: ${muted};
      --card: ${card};
      --border: ${border};
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html { scroll-behavior: smooth; }
    body {
      font-family: 'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
      background: var(--bg); color: var(--fg); line-height: 1.65;
      -webkit-font-smoothing: antialiased;
    }
    img { max-width: 100%; display: block; }
    a { color: inherit; }
    p { margin-bottom: 20px; font-size: 18px; }
    h1, h2, h3 { line-height: 1.2; font-weight: 800; }
    .wrap { max-width: 720px; margin: 0 auto; padding: 0 20px; }
    .muted { color: var(--muted); }
    .kicker {
      color: var(--accent); font-weight: 700; text-transform: uppercase;
      letter-spacing: .14em; font-size: 12px; margin-bottom: 14px;
    }
    .cta {
      display: inline-block; background: var(--accent); color: #fff;
      font-weight: 700; text-decoration: none; padding: 16px 36px;
      border-radius: 10px; font-size: 17px; box-shadow: 0 10px 28px rgba(0,0,0,.18);
      transition: transform .15s ease;
    }
    .cta:hover { transform: translateY(-2px); }
    .cta-wrap { text-align: center; margin: 44px 0; }
    .callout {
      background: var(--card); border: 1px solid var(--border);
      border-left: 4px solid var(--accent); border-radius: 12px;
      padding: 26px; margin: 32px 0;
    }
    ${opts.styles}
    @media (max-width: 600px) {
      .wrap { padding: 0 16px; }
      p { font-size: 16px; }
    }
  </style>
</head>
<body>
${opts.body}
</body>
</html>`;
}

function newsArticle(cfg: BuilderCfg): string {
  return baseDoc({
    accent: cfg.accent,
    theme: cfg.theme,
    instructions: `STYLE A - News Article advertorial (${cfg.kicker}). Looks like a real editorial piece, builds curiosity, then reveals your product as the solution.`,
    styles: `
    .masthead { border-bottom: 1px solid var(--border); padding: 20px 0; }
    .masthead .inner { display: flex; align-items: center; justify-content: space-between; }
    .brand { font-weight: 800; letter-spacing: .04em; color: var(--accent); font-size: 18px; }
    h1.headline { font-size: 40px; margin: 8px 0 18px; }
    .sub { font-size: 20px; }
    .byline { font-size: 14px; margin: 18px 0 26px; }
    figure img { border-radius: 12px; }
    figcaption { font-size: 13px; margin-top: 10px; }
    h2.sec { font-size: 26px; margin: 36px 0 14px; }
    @media (max-width:600px){ h1.headline{font-size:30px;} }`,
    body: `
  <header class="masthead">
    <div class="wrap inner">
      <span class="brand">[YOUR PUBLICATION]</span>
      <span class="muted" style="font-size:13px">${cfg.kicker} &middot; [DATE]</span>
    </div>
  </header>
  <main class="wrap" style="padding-top:40px;padding-bottom:30px">
    <p class="kicker">[CATEGORY LABEL]</p>
    <h1 class="headline">[YOUR HEADLINE]</h1>
    <p class="sub muted">[YOUR SUBHEADLINE - one line that hooks the reader]</p>
    <p class="byline muted">By [AUTHOR NAME] &middot; [DATE] &middot; [READ TIME] min read</p>
    <figure>
      <img src="[HERO IMAGE URL]" alt="[IMAGE ALT TEXT]" />
      <figcaption class="muted">[IMAGE CAPTION]</figcaption>
    </figure>
    <p style="margin-top:28px">[OPENING PARAGRAPH - set the scene and the problem your reader feels.]</p>
    <h2 class="sec">[SUBHEADING 1 - the turning point]</h2>
    <p>[BODY PARAGRAPH - introduce the discovery or insight without naming the product yet.]</p>
    <p>[BODY PARAGRAPH - add detail, a stat, or a quote to build credibility.]</p>
    <h2 class="sec">[SUBHEADING 2 - the solution revealed]</h2>
    <p>[BODY PARAGRAPH - now connect the story to your product.]</p>
    <div class="callout">
      <p style="font-weight:700;margin-bottom:8px;font-size:18px">[YOUR PRODUCT NAME]</p>
      <p class="muted" style="margin:0;font-size:16px">[ONE SENTENCE ON WHY IT'S THE SOLUTION.]</p>
    </div>
    <p>[CLOSING PARAGRAPH - reinforce the benefit and create urgency.]</p>
    <div class="cta-wrap">
      <a class="cta" href="[CTA LINK]">[CTA TEXT - e.g. See It For Yourself]</a>
    </div>
  </main>`,
  });
}

function personalStory(cfg: BuilderCfg): string {
  return baseDoc({
    accent: cfg.accent,
    theme: cfg.theme,
    instructions: `STYLE B - Personal Story / Testimonial advertorial (${cfg.kicker}). First-person transformation story with a before/after section.`,
    styles: `
    .hero { position: relative; }
    .hero img { width: 100%; height: 380px; object-fit: cover; }
    h1.story { font-size: 38px; margin: 30px 0 16px; }
    .author { display: flex; align-items: center; gap: 12px; margin: 22px 0 30px; }
    .author .avatar { width: 48px; height: 48px; border-radius: 50%; object-fit: cover; }
    .ba { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin: 34px 0; }
    .ba .box { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 22px; }
    .ba .label { font-weight: 700; text-transform: uppercase; letter-spacing: .1em; font-size: 12px; margin-bottom: 10px; }
    .ba .before .label { color: var(--muted); }
    .ba .after .label { color: var(--accent); }
    @media (max-width:600px){ .hero img{height:240px;} h1.story{font-size:28px;} .ba{grid-template-columns:1fr;} }`,
    body: `
  <div class="hero">
    <img src="[HERO IMAGE URL]" alt="[IMAGE ALT TEXT]" />
  </div>
  <main class="wrap" style="padding-bottom:30px">
    <p class="kicker" style="margin-top:30px">${cfg.kicker}</p>
    <h1 class="story">[YOUR STORY HEADLINE - "How I went from [BEFORE] to [AFTER]"]</h1>
    <div class="author">
      <img class="avatar" src="[AUTHOR PHOTO URL]" alt="[AUTHOR NAME]" />
      <div>
        <div style="font-weight:700">[AUTHOR NAME]</div>
        <div class="muted" style="font-size:13px">[LOCATION] &middot; [DATE]</div>
      </div>
    </div>
    <p>[OPENING - describe where you were and how it felt. Make it relatable.]</p>
    <p>[THE STRUGGLE - what you tried before and why it didn't work.]</p>
    <div class="ba">
      <div class="box before"><div class="label">Before</div><p class="muted" style="margin:0;font-size:16px">[WHAT LIFE LOOKED LIKE BEFORE.]</p></div>
      <div class="box after"><div class="label">After</div><p style="margin:0;font-size:16px">[WHAT CHANGED AFTER.]</p></div>
    </div>
    <p>[THE TURNING POINT - introduce [YOUR PRODUCT NAME] and the moment it changed.]</p>
    <div class="callout">
      <p style="font-weight:700;margin-bottom:8px;font-size:18px">[YOUR PRODUCT NAME]</p>
      <p class="muted" style="margin:0;font-size:16px">[WHAT IT DID FOR YOU IN ONE SENTENCE.]</p>
    </div>
    <p>[THE RESULT - paint the new reality and invite the reader to do the same.]</p>
    <div class="cta-wrap">
      <a class="cta" href="[CTA LINK]">[CTA TEXT - e.g. Start Your Own Story]</a>
    </div>
  </main>`,
  });
}

function listicle(cfg: BuilderCfg): string {
  const item = (n: number, featured = false) => `
    <li class="item${featured ? " featured" : ""}">
      <div class="rank">${String(n).padStart(2, "0")}</div>
      <img src="[ITEM ${n} IMAGE URL]" alt="[ITEM ${n} NAME]" />
      <div class="body">
        ${featured ? '<span class="badge">Top Pick</span>' : ""}
        <h3>[ITEM ${n} NAME]</h3>
        <p class="muted" style="font-size:16px;margin-bottom:14px">[ITEM ${n} DESCRIPTION - why it made the list.]</p>
        ${featured ? '<a class="cta" style="padding:12px 26px;font-size:15px" href="[CTA LINK]">[CTA TEXT]</a>' : ""}
      </div>
    </li>`;
  return baseDoc({
    accent: cfg.accent,
    theme: cfg.theme,
    instructions: `STYLE C - Listicle / Roundup advertorial (${cfg.kicker}). Numbered list with a highlighted #1 pick and CTA buttons after the top picks.`,
    styles: `
    h1.title { font-size: 38px; margin: 14px 0 16px; }
    ul.list { list-style: none; margin: 36px 0; display: grid; gap: 20px; }
    .item { display: grid; grid-template-columns: 64px 160px 1fr; gap: 18px; align-items: center;
      background: var(--card); border: 1px solid var(--border); border-radius: 14px; padding: 18px; }
    .item.featured { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent) inset; }
    .item img { width: 160px; height: 120px; object-fit: cover; border-radius: 10px; }
    .rank { font-size: 40px; font-weight: 800; color: var(--accent); text-align: center; }
    .badge { display: inline-block; background: var(--accent); color: #fff; font-size: 11px; font-weight: 700;
      text-transform: uppercase; letter-spacing: .1em; padding: 4px 10px; border-radius: 20px; margin-bottom: 10px; }
    .item h3 { font-size: 20px; margin-bottom: 6px; }
    @media (max-width:600px){ h1.title{font-size:28px;} .item{grid-template-columns:48px 1fr;} .item img{grid-column:1 / -1;width:100%;height:180px;} }`,
    body: `
  <main class="wrap" style="padding-top:44px;padding-bottom:30px">
    <p class="kicker">${cfg.kicker}</p>
    <h1 class="title">[YOUR HEADLINE - e.g. The 5 [CATEGORY] Worth Your Money in 2026]</h1>
    <p class="muted">[INTRO PARAGRAPH - what you tested and how you ranked them.]</p>
    <ul class="list">
      ${item(1, true)}
      ${item(2)}
      ${item(3)}
      ${item(4)}
      ${item(5)}
    </ul>
    <div class="callout">
      <p style="font-weight:700;margin-bottom:8px;font-size:18px">Our #1 Recommendation: [YOUR PRODUCT NAME]</p>
      <p class="muted" style="margin:0;font-size:16px">[WHY IT BEAT THE REST IN ONE SENTENCE.]</p>
    </div>
    <div class="cta-wrap">
      <a class="cta" href="[CTA LINK]">[CTA TEXT - e.g. Get The Top Pick]</a>
    </div>
  </main>`,
  });
}

function scientific(cfg: BuilderCfg): string {
  const stat = (n: number) => `
      <div class="stat">
        <div class="num">[STAT ${n}]</div>
        <div class="lbl muted">[STAT ${n} LABEL]</div>
      </div>`;
  return baseDoc({
    accent: cfg.accent,
    theme: cfg.theme,
    instructions: `STYLE D - Scientific / Research-Backed advertorial (${cfg.kicker}). Authority-building layout with data callouts, an expert quote, and an evidence section.`,
    styles: `
    .tag { display:inline-block; border:1px solid var(--border); border-radius:20px; padding:5px 12px;
      font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:.1em; color:var(--accent); margin-bottom:16px; }
    h1.title { font-size: 36px; margin-bottom: 18px; }
    .stats { display: grid; grid-template-columns: repeat(3,1fr); gap: 14px; margin: 32px 0; }
    .stat { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 22px; text-align: center; }
    .stat .num { font-size: 32px; font-weight: 800; color: var(--accent); }
    .stat .lbl { font-size: 13px; margin-top: 6px; }
    blockquote { border-left: 4px solid var(--accent); background: var(--card); border-radius: 0 12px 12px 0;
      padding: 22px 24px; margin: 32px 0; font-size: 19px; font-style: italic; }
    blockquote cite { display:block; font-style:normal; font-size:14px; margin-top:12px; color:var(--muted); }
    .evidence { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 24px; margin: 30px 0; }
    .evidence li { margin: 0 0 12px 20px; font-size: 16px; }
    @media (max-width:600px){ h1.title{font-size:27px;} .stats{grid-template-columns:1fr;} }`,
    body: `
  <main class="wrap" style="padding-top:44px;padding-bottom:30px">
    <span class="tag">${cfg.kicker}</span>
    <h1 class="title">[YOUR HEADLINE - the research-backed claim]</h1>
    <p class="muted">[INTRO - summarise the finding and why it matters, in plain language.]</p>
    <div class="stats">
      ${stat(1)}
      ${stat(2)}
      ${stat(3)}
    </div>
    <p>[BODY PARAGRAPH - explain the mechanism or method behind the result.]</p>
    <blockquote>
      &ldquo;[EXPERT QUOTE THAT VALIDATES THE PRODUCT.]&rdquo;
      <cite>- [EXPERT NAME], [CREDENTIALS]</cite>
    </blockquote>
    <h2 style="font-size:24px;margin:34px 0 14px">The Evidence</h2>
    <div class="evidence">
      <ul>
        <li>[EVIDENCE POINT 1 - a study, data point, or trial result.]</li>
        <li>[EVIDENCE POINT 2.]</li>
        <li>[EVIDENCE POINT 3.]</li>
      </ul>
    </div>
    <div class="callout">
      <p style="font-weight:700;margin-bottom:8px;font-size:18px">[YOUR PRODUCT NAME]</p>
      <p class="muted" style="margin:0;font-size:16px">[HOW IT APPLIES THE RESEARCH IN ONE SENTENCE.]</p>
    </div>
    <div class="cta-wrap">
      <a class="cta" href="[CTA LINK]">[CTA TEXT - e.g. See The Research-Backed Solution]</a>
    </div>
  </main>`,
  });
}

function viralSocial(cfg: BuilderCfg): string {
  const comment = (n: number) => `
      <div class="cmt">
        <img src="[COMMENTER ${n} AVATAR URL]" alt="[COMMENTER ${n} NAME]" />
        <div>
          <div class="name">[COMMENTER ${n} NAME] <span class="muted" style="font-weight:400">&middot; [TIME]</span></div>
          <p style="margin:4px 0 0;font-size:15px">[COMMENT ${n} TEXT - a glowing review or reaction.]</p>
        </div>
      </div>`;
  return baseDoc({
    accent: cfg.accent,
    theme: cfg.theme,
    instructions: `STYLE E - Viral Social Proof advertorial (${cfg.kicker}). Leverages FOMO with a trending header, a social post mockup, comments and urgency.`,
    styles: `
    .trend { text-align:center; padding: 18px 0; }
    .trend .hash { font-size: 30px; font-weight: 800; color: var(--accent); }
    .trend .meta { font-size: 13px; }
    h1.title { font-size: 34px; margin: 10px 0 20px; text-align:center; }
    .post { background: var(--card); border: 1px solid var(--border); border-radius: 16px; overflow: hidden; margin: 26px 0; }
    .post .top { display:flex; align-items:center; gap:10px; padding: 14px 16px; }
    .post .top img { width: 40px; height: 40px; border-radius: 50%; }
    .post .top .h { font-weight:700; font-size:14px; }
    .post .media img { width:100%; height: 360px; object-fit: cover; }
    .post .stats { padding: 12px 16px; font-size: 14px; font-weight:600; }
    .comments { display:grid; gap:16px; margin: 26px 0; }
    .cmt { display:flex; gap:12px; }
    .cmt img { width: 38px; height:38px; border-radius:50%; }
    .cmt .name { font-weight:700; font-size:14px; }
    .urgency { text-align:center; background: var(--accent); color:#fff; border-radius:12px; padding:18px; font-weight:700; margin: 30px 0; }
    @media (max-width:600px){ h1.title{font-size:26px;} .post .media img{height:260px;} }`,
    body: `
  <main class="wrap" style="padding-top:36px;padding-bottom:30px">
    <div class="trend">
      <div class="hash">[#YOUR HASHTAG]</div>
      <div class="meta muted">${cfg.kicker} &middot; [VIEW COUNT] views &middot; Trending now</div>
    </div>
    <h1 class="title">[YOUR HEADLINE - "Why everyone is talking about [PRODUCT]"]</h1>
    <div class="post">
      <div class="top">
        <img src="[POSTER AVATAR URL]" alt="[POSTER HANDLE]" />
        <div><div class="h">[POSTER HANDLE]</div><div class="muted" style="font-size:12px">[PLATFORM] &middot; [DATE]</div></div>
      </div>
      <div class="media"><img src="[POST IMAGE URL]" alt="[IMAGE ALT TEXT]" /></div>
      <div class="stats">[LIKE COUNT] likes &middot; [COMMENT COUNT] comments &middot; [SHARE COUNT] shares</div>
    </div>
    <p>[INTRO - describe the buzz and why people can't stop sharing it.]</p>
    <div class="comments">
      ${comment(1)}
      ${comment(2)}
      ${comment(3)}
    </div>
    <div class="callout">
      <p style="font-weight:700;margin-bottom:8px;font-size:18px">[YOUR PRODUCT NAME]</p>
      <p class="muted" style="margin:0;font-size:16px">[WHY IT'S GOING VIRAL IN ONE SENTENCE.]</p>
    </div>
    <div class="urgency">[URGENCY LINE - e.g. Selling out fast - [STOCK] left at this price]</div>
    <div class="cta-wrap">
      <a class="cta" href="[CTA LINK]">[CTA TEXT - e.g. Get Yours Before It's Gone]</a>
    </div>
  </main>`,
  });
}

type Spec = {
  style: AdvertorialStyle;
  name: string;
  description: string;
  cfg: BuilderCfg;
  build: (cfg: BuilderCfg) => string;
};

const SPECS: Spec[] = [
  // STYLE A - News Article
  { style: "News Article", name: "Tech Gadget Discovery", description: "Editorial 'new gadget everyone's talking about' angle for tech and electronics offers.", cfg: { accent: "#2563eb", theme: "light", kicker: "Technology" }, build: newsArticle },
  { style: "News Article", name: "Health & Wellness Breakthrough", description: "News-style breakthrough story for supplements, devices and wellness products.", cfg: { accent: "#059669", theme: "light", kicker: "Health" }, build: newsArticle },
  { style: "News Article", name: "Finance & Investing Insight", description: "Money-section angle for finance, investing and money-making offers.", cfg: { accent: "#0f766e", theme: "dark", kicker: "Money" }, build: newsArticle },
  { style: "News Article", name: "Lifestyle Productivity Hack", description: "Lifestyle-desk article framing a product as a smarter way to live or work.", cfg: { accent: "#d97706", theme: "light", kicker: "Lifestyle" }, build: newsArticle },

  // STYLE B - Personal Story
  { style: "Personal Story", name: "Weight Loss / Fitness Journey", description: "First-person before/after transformation for fitness and weight-loss offers.", cfg: { accent: "#e11d48", theme: "light", kicker: "Transformation" }, build: personalStory },
  { style: "Personal Story", name: "Side Hustle / Income Story", description: "'How I built a second income' narrative for biz-opp and income offers.", cfg: { accent: "#16a34a", theme: "dark", kicker: "Income Story" }, build: personalStory },
  { style: "Personal Story", name: "Skincare / Beauty Transformation", description: "Personal glow-up story for beauty, skincare and anti-aging products.", cfg: { accent: "#db2777", theme: "light", kicker: "Beauty" }, build: personalStory },
  { style: "Personal Story", name: "Career / Lifestyle Change", description: "Life-pivot story for coaching, courses and lifestyle-design offers.", cfg: { accent: "#7c3aed", theme: "light", kicker: "My Story" }, build: personalStory },

  // STYLE C - Listicle
  { style: "Listicle", name: "Product Comparison Roundup", description: "Head-to-head ranked comparison that crowns your product the winner.", cfg: { accent: "#2563eb", theme: "light", kicker: "Buyer's Guide" }, build: listicle },
  { style: "Listicle", name: "Best of 2026", description: "'Best of the year' roundup format for any product category.", cfg: { accent: "#ca8a04", theme: "dark", kicker: "Best of 2026" }, build: listicle },
  { style: "Listicle", name: "Expert Recommendations", description: "'What the experts actually use' curated picks list.", cfg: { accent: "#0891b2", theme: "light", kicker: "Expert Picks" }, build: listicle },
  { style: "Listicle", name: "Problem-Solution List", description: "'5 fixes for [problem]' list that lands on your product as the best fix.", cfg: { accent: "#dc2626", theme: "light", kicker: "Quick Fixes" }, build: listicle },

  // STYLE D - Scientific
  { style: "Scientific", name: "Clinical Study Format", description: "Clinical-trial styling with stats and findings for health and supplement offers.", cfg: { accent: "#0d9488", theme: "light", kicker: "Clinical Findings" }, build: scientific },
  { style: "Scientific", name: "Expert Panel Review", description: "Authority panel review with expert quotes for premium products.", cfg: { accent: "#4f46e5", theme: "dark", kicker: "Expert Review" }, build: scientific },
  { style: "Scientific", name: "Data-Driven Breakdown", description: "Stat-heavy breakdown that uses numbers to justify the purchase.", cfg: { accent: "#2563eb", theme: "light", kicker: "By The Numbers" }, build: scientific },
  { style: "Scientific", name: "Industry Report Style", description: "Whitepaper / industry-report framing for B2B and high-ticket offers.", cfg: { accent: "#334155", theme: "light", kicker: "Industry Report" }, build: scientific },

  // STYLE E - Viral Social Proof
  { style: "Viral Social Proof", name: "TikTok Viral Product", description: "TikTok 'this blew up' angle with post mockup and comments.", cfg: { accent: "#ec4899", theme: "dark", kicker: "TikTok Made Me Buy It" }, build: viralSocial },
  { style: "Viral Social Proof", name: "Instagram Trending", description: "Instagram-style trending post with social proof and urgency.", cfg: { accent: "#d946ef", theme: "light", kicker: "Trending on Instagram" }, build: viralSocial },
  { style: "Viral Social Proof", name: "Reddit / Forum Discovery", description: "'Found this on Reddit' discovery angle with community reactions.", cfg: { accent: "#ea580c", theme: "light", kicker: "Spotted on Reddit" }, build: viralSocial },
  { style: "Viral Social Proof", name: "Celebrity / Influencer Spotted", description: "'Spotted on a celeb / influencer' social-proof angle.", cfg: { accent: "#9333ea", theme: "dark", kicker: "As Seen On" }, build: viralSocial },
];

export const ADVERTORIAL_TEMPLATES: AdvertorialTemplate[] = SPECS.map((s, i) => ({
  id: `adv-${String(i + 1).padStart(2, "0")}`,
  number: i + 1,
  style: s.style,
  name: s.name,
  description: s.description,
  theme: s.cfg.theme,
  html: s.build(s.cfg),
}));

export const ADVERTORIAL_STYLES: AdvertorialStyle[] = [
  "News Article",
  "Personal Story",
  "Listicle",
  "Scientific",
  "Viral Social Proof",
];
