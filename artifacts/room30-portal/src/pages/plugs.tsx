import { PortalLayout } from "@/components/portal-layout";
import { PORTAL_PAGE_CLASS } from "@/components/portal-page";
import { ExternalLink, Shield, CreditCard, Scale, Globe, Headphones, AlertTriangle } from "lucide-react";

const plugs = [
  {
    category: "Course Protection",
    icon: Shield,
    color: "#C9A44C",
    contacts: [
      {
        name: "Coming Soon",
        role: "Anti-Piracy & Takedown Service",
        description: "Takes down all fake retailers, pirated copies, and unauthorized resellers of the course. DMCA takedowns, platform reports, and ongoing monitoring.",
        tags: ["DMCA", "Takedowns", "Monitoring"],
      },
    ],
  },
  {
    category: "Payment Recovery",
    icon: CreditCard,
    color: "#3B82F6",
    contacts: [
      {
        name: "Coming Soon",
        role: "Failed Payment Recovery Team",
        description: "Handles all failed payment recovery - dunning sequences, card update outreach, and win-back campaigns. Recovers revenue you'd otherwise lose.",
        tags: ["Dunning", "Recovery", "Retention"],
      },
    ],
  },
  {
    category: "Legal & Compliance",
    icon: Scale,
    color: "#10B981",
    contacts: [
      {
        name: "Coming Soon",
        role: "Payment Processor Holds Specialist",
        description: "Lawyer who specializes in resolving payment processor holds, reserves, and account freezes. Stripe, PayPal, and merchant account disputes.",
        tags: ["Holds", "Disputes", "Compliance"],
      },
    ],
  },
  {
    category: "Chargebacks & Disputes",
    icon: AlertTriangle,
    color: "#F59E0B",
    contacts: [
      {
        name: "Coming Soon",
        role: "Chargeback Prevention & Response",
        description: "Manages chargeback disputes, evidence submission, and prevention strategies. Keeps your dispute rate low and merchant account healthy.",
        tags: ["Chargebacks", "Evidence", "Prevention"],
      },
    ],
  },
  {
    category: "Tech & Infrastructure",
    icon: Globe,
    color: "#8B5CF6",
    contacts: [
      {
        name: "Coming Soon",
        role: "Funnel & Tech Support",
        description: "Technical support for your funnels, hosting, email deliverability, and automation stack. When things break, these are the people to call.",
        tags: ["Funnels", "Hosting", "Email"],
      },
    ],
  },
  {
    category: "Customer Support",
    icon: Headphones,
    color: "#EC4899",
    contacts: [
      {
        name: "Coming Soon",
        role: "White-Label Support Team",
        description: "Outsourced customer support team that handles refund requests, access issues, and general inquiries on your behalf. Trained on your product.",
        tags: ["Support", "Refunds", "Outsourced"],
      },
    ],
  },
];

export default function Plugs() {
  return (
    <PortalLayout>
      <div className={PORTAL_PAGE_CLASS}>
        <div className="mb-10">
          <p className="text-[12px] text-white/55 tracking-[0.2em] uppercase font-medium mb-2">
            Resources
          </p>
          <h1
            className="text-[28px] md:text-[36px] font-bold uppercase tracking-[0.01em] text-white leading-tight"
            style={{ fontFamily: "var(--app-font-display)" }}
          >
            My Plugs
          </h1>
          <div className="w-12 h-1 bg-[#C9A44C] mt-3 mb-4" />
          <p className="text-white/50 text-[15px] max-w-[600px]">
            These are the people and teams I personally use and trust to handle critical parts of the business. 
            I'll be updating this list as I vet new providers.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {plugs.map((section, i) => (
            <div
              key={i}
              className="bg-[#111111] border border-white/[0.06] rounded-xl overflow-hidden"
            >
              <div className="px-5 py-4 border-b border-white/[0.06] flex items-center gap-3">
                <div
                  className="w-9 h-9 rounded-lg flex items-center justify-center"
                  style={{ backgroundColor: section.color + "15" }}
                >
                  <section.icon className="w-4.5 h-4.5" style={{ color: section.color }} />
                </div>
                <h2 className="text-[15px] font-bold text-white uppercase tracking-wide">
                  {section.category}
                </h2>
              </div>

              {section.contacts.map((contact, j) => (
                <div key={j} className="p-5">
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div>
                      <p className="text-white font-semibold text-[15px]">{contact.name}</p>
                      <p className="text-white/65 text-[12px] mt-0.5">{contact.role}</p>
                    </div>
                    {contact.name !== "Coming Soon" && (
                      <button className="flex-shrink-0 text-white/45 hover:text-white/50 transition-colors">
                        <ExternalLink className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                  <p className="text-white/50 text-[13px] leading-relaxed mb-4">
                    {contact.description}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {contact.tags.map((tag) => (
                      <span
                        key={tag}
                        className="text-[10px] font-medium uppercase tracking-wider px-2 py-1 rounded-full"
                        style={{
                          backgroundColor: section.color + "12",
                          color: section.color,
                          border: `1px solid ${section.color}25`,
                        }}
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>

        <div className="mt-8 p-5 bg-[#111111] border border-white/[0.06] rounded-xl">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-full bg-[#C9A44C]/15 flex items-center justify-center flex-shrink-0 mt-0.5">
              <span className="text-[14px]">💡</span>
            </div>
            <div>
              <p className="text-white font-semibold text-[14px] mb-1">Know someone who should be on this list?</p>
              <p className="text-white/65 text-[13px]">
                If you've worked with an amazing provider in any of these categories, send a quick note via the chat bubble in the bottom right - I'm always looking for great people to recommend.
              </p>
            </div>
          </div>
        </div>
      </div>
    </PortalLayout>
  );
}
