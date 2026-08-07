const API_BASE = `${import.meta.env.BASE_URL}api`;

export function getCustomerId(): string | null {
  try {
    return sessionStorage.getItem('aip_customer_id');
  } catch {
    return null;
  }
}

export function getTrackingCode(): string | null {
  try {
    return sessionStorage.getItem('aip_ref');
  } catch {
    return null;
  }
}

export function getBrandTheme(): string | null {
  try {
    return sessionStorage.getItem('aip_brand_theme');
  } catch {
    return null;
  }
}

export async function chargeUpsell(productSlug: string): Promise<{ success: boolean; error?: string }> {
  const customerId = getCustomerId();
  if (!customerId) {
    return { success: false, error: 'No customer session found' };
  }

  try {
    const res = await fetch(`${API_BASE}/stripe/charge-upsell`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customerId,
        productSlug,
        trackingCode: getTrackingCode(),
        brandTheme: getBrandTheme(),
      }),
    });

    const data = await res.json();
    if (data.error) {
      return { success: false, error: data.error };
    }
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || 'Payment failed' };
  }
}
