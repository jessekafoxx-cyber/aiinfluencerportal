export type KpiState = {
  v: number;
  stackValue: number | null;
  aov: number | null;
  items: { label: string; amount: number; recurring: boolean }[];
  backend: number;
  backendDurationMonths: number | null;
  backendRecurring: boolean;
  conversionPct: number;
  monthlyGoal: string | null;
};

export function parseKpiState(html: string | null | undefined): KpiState | null {
  if (!html) return null;
  const m = html.match(/<!--\s*KPI_STATE:([\s\S]*?)-->/);
  if (!m) return null;
  try {
    const obj = JSON.parse(m[1]);
    return {
      v: obj.v || 1,
      stackValue: obj.stackValue ?? null,
      aov: typeof obj.aov === "number" ? obj.aov : null,
      items: Array.isArray(obj.items) ? obj.items : [],
      backend: typeof obj.backend === "number" ? obj.backend : 15000,
      backendDurationMonths: obj.backendDurationMonths ?? null,
      backendRecurring: !!obj.backendRecurring,
      conversionPct: typeof obj.conversionPct === "number" ? obj.conversionPct : 3,
      monthlyGoal: obj.monthlyGoal ?? null,
    };
  } catch {
    return null;
  }
}

export type KpiDerived = {
  aov: number;
  breakEvenCac: number;
  maxHtSpend: number;
  maxBlendedLtCac: number;
  backend: number;
  convPct: number;
};

export function deriveKpis(state: KpiState): KpiDerived {
  const aov = state.aov ?? 0;
  const backend = state.backend ?? 0;
  const convPct = state.conversionPct ?? 0;
  return {
    aov,
    breakEvenCac: aov,
    maxHtSpend: backend / 5,
    maxBlendedLtCac: aov + (backend * (convPct / 100)) / 5,
    backend,
    convPct,
  };
}

export function fmtKpiMoney(n: number, opts: { decimals?: number } = {}): string {
  const d = opts.decimals ?? (Math.abs(n) >= 1000 ? 0 : 2);
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })}`;
}
