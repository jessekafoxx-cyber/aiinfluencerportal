export interface TemplateConfig {
  id: string;
  name: string;
  description: string;
  category: "ads" | "social" | "branding" | "content";
  defaultProps: Record<string, any>;
  fields: Array<{
    key: string;
    label: string;
    type: "text" | "textarea" | "color" | "select" | "number" | "slides";
    options?: string[];
    placeholder?: string;
  }>;
  defaultDurationSeconds: number;
  defaultWidth: number;
  defaultHeight: number;
  defaultFps: number;
}

export const TEMPLATES: TemplateConfig[] = [
  {
    id: "kinetic-text",
    name: "Kinetic Text",
    description: "Animated word-by-word text reveal with accent colors. Perfect for attention-grabbing ad hooks.",
    category: "ads",
    defaultProps: {
      headline: "Stop Scrolling This Changes Everything",
      subtext: "Watch Now",
      accentColor: "#E32652",
      backgroundColor: "#0a0a0a",
      textColor: "#ffffff",
      fontFamily: "Oswald, sans-serif",
    },
    fields: [
      { key: "headline", label: "Headline", type: "text", placeholder: "Your headline text..." },
      { key: "subtext", label: "Subtext", type: "text", placeholder: "Call to action..." },
      { key: "accentColor", label: "Accent Color", type: "color" },
      { key: "backgroundColor", label: "Background Color", type: "color" },
      { key: "textColor", label: "Text Color", type: "color" },
      {
        key: "fontFamily",
        label: "Font",
        type: "select",
        options: ["Oswald, sans-serif", "Inter, sans-serif", "Arial, sans-serif", "Georgia, serif"],
      },
    ],
    defaultDurationSeconds: 4,
    defaultWidth: 1920,
    defaultHeight: 1080,
    defaultFps: 30,
  },
  {
    id: "ad-intro",
    name: "Brand Intro",
    description: "Animated brand intro with logo placeholder, name, and tagline. Use for video openings.",
    category: "branding",
    defaultProps: {
      brandName: "Gregory",
      tagline: "Digital Masterclass",
      accentColor: "#E32652",
      backgroundColor: "#0a0a0a",
      textColor: "#ffffff",
      fontFamily: "Oswald, sans-serif",
    },
    fields: [
      { key: "brandName", label: "Brand Name", type: "text", placeholder: "Your brand..." },
      { key: "tagline", label: "Tagline", type: "text", placeholder: "Your tagline..." },
      { key: "accentColor", label: "Accent Color", type: "color" },
      { key: "backgroundColor", label: "Background Color", type: "color" },
      { key: "textColor", label: "Text Color", type: "color" },
      {
        key: "fontFamily",
        label: "Font",
        type: "select",
        options: ["Oswald, sans-serif", "Inter, sans-serif", "Arial, sans-serif", "Georgia, serif"],
      },
    ],
    defaultDurationSeconds: 3,
    defaultWidth: 1920,
    defaultHeight: 1080,
    defaultFps: 30,
  },
  {
    id: "social-post",
    name: "Social Media Ad",
    description: "Animated social media ad with headline, body, and CTA button. Multiple layout options.",
    category: "social",
    defaultProps: {
      headline: "Ready to Scale Your Business?",
      bodyText: "Join thousands of entrepreneurs who have transformed their digital marketing with our proven frameworks.",
      ctaText: "Learn More",
      accentColor: "#E32652",
      backgroundColor: "#0a0a0a",
      textColor: "#ffffff",
      fontFamily: "Inter, sans-serif",
      layout: "centered",
    },
    fields: [
      { key: "headline", label: "Headline", type: "text", placeholder: "Ad headline..." },
      { key: "bodyText", label: "Body Text", type: "textarea", placeholder: "Ad body copy..." },
      { key: "ctaText", label: "CTA Button", type: "text", placeholder: "Learn More..." },
      { key: "layout", label: "Layout", type: "select", options: ["centered", "left-aligned", "split"] },
      { key: "accentColor", label: "Accent Color", type: "color" },
      { key: "backgroundColor", label: "Background Color", type: "color" },
      { key: "textColor", label: "Text Color", type: "color" },
      {
        key: "fontFamily",
        label: "Font",
        type: "select",
        options: ["Inter, sans-serif", "Oswald, sans-serif", "Arial, sans-serif", "Georgia, serif"],
      },
    ],
    defaultDurationSeconds: 5,
    defaultWidth: 1080,
    defaultHeight: 1080,
    defaultFps: 30,
  },
  {
    id: "lower-third",
    name: "Lower Third",
    description: "Animated name and title bar overlay. Use for speaker introductions in videos.",
    category: "content",
    defaultProps: {
      name: "Gregory",
      title: "Digital Marketing Expert",
      accentColor: "#E32652",
      backgroundColor: "#1a1a1a",
      textColor: "#ffffff",
      fontFamily: "Oswald, sans-serif",
      position: "bottom-left",
    },
    fields: [
      { key: "name", label: "Name", type: "text", placeholder: "Speaker name..." },
      { key: "title", label: "Title", type: "text", placeholder: "Title / Role..." },
      {
        key: "position",
        label: "Position",
        type: "select",
        options: ["bottom-left", "bottom-center", "bottom-right"],
      },
      { key: "accentColor", label: "Accent Color", type: "color" },
      { key: "backgroundColor", label: "Background Color", type: "color" },
      { key: "textColor", label: "Text Color", type: "color" },
      {
        key: "fontFamily",
        label: "Font",
        type: "select",
        options: ["Oswald, sans-serif", "Inter, sans-serif", "Arial, sans-serif", "Georgia, serif"],
      },
    ],
    defaultDurationSeconds: 4,
    defaultWidth: 1920,
    defaultHeight: 1080,
    defaultFps: 30,
  },
  {
    id: "text-slideshow",
    name: "Text Slideshow",
    description: "Animated text slides with transitions. Great for educational content, listicles, and story-style ads.",
    category: "content",
    defaultProps: {
      slides: [
        { text: "The #1 Mistake Marketers Make", subtext: "And how to fix it" },
        { text: "They Focus on Tactics", subtext: "Instead of strategy" },
        { text: "Build Systems Not Campaigns", subtext: "That scale automatically" },
        { text: "Start Your Transformation Today" },
      ],
      accentColor: "#E32652",
      backgroundColor: "#0a0a0a",
      textColor: "#ffffff",
      fontFamily: "Oswald, sans-serif",
    },
    fields: [
      { key: "slides", label: "Slides", type: "slides" },
      { key: "accentColor", label: "Accent Color", type: "color" },
      { key: "backgroundColor", label: "Background Color", type: "color" },
      { key: "textColor", label: "Text Color", type: "color" },
      {
        key: "fontFamily",
        label: "Font",
        type: "select",
        options: ["Oswald, sans-serif", "Inter, sans-serif", "Arial, sans-serif", "Georgia, serif"],
      },
    ],
    defaultDurationSeconds: 8,
    defaultWidth: 1080,
    defaultHeight: 1920,
    defaultFps: 30,
  },
];
