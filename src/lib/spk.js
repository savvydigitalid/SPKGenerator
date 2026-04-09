export const idr = (n) =>
  new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(Math.round(Number(n || 0)));

export function parseISODateAsLocal(isoDate) {
  if (!isoDate || typeof isoDate !== "string") return new Date(NaN);
  const [year, month, day] = isoDate.split("-").map(Number);
  if (!year || !month || !day) return new Date(NaN);
  return new Date(year, month - 1, day);
}

export function todayISO() {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const dd = String(today.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function computeAmounts({ feeInput, grossUp, pphRate, vatRate }) {
  const r = Number(pphRate || 0);
  const v = Number(vatRate || 0);

  const res = {
    gross: 0,
    withholding: 0,
    vatAmount: 0,
    netToKOL: 0,
  };

  if (!feeInput || Number(feeInput) <= 0) return res;

  if (!grossUp) {
    res.gross = Number(feeInput);
    res.withholding = res.gross * r;
    res.vatAmount = res.gross * v;
    res.netToKOL = res.gross - res.withholding + res.vatAmount;
    return res;
  }

  const netTarget = Number(feeInput);
  const factor = 1 - r + v;
  if (factor <= 0) {
    res.gross = netTarget;
    res.withholding = res.gross * r;
    res.vatAmount = res.gross * v;
    res.netToKOL = res.gross - res.withholding + res.vatAmount;
    return res;
  }

  res.gross = netTarget / factor;
  res.withholding = res.gross * r;
  res.vatAmount = res.gross * v;
  res.netToKOL = res.gross - res.withholding + res.vatAmount;
  return res;
}

export function deriveRates(form) {
  let pphRate = 0;
  if (form.taxScheme === "UMKM_0_5") pphRate = 0.005;
  else if (form.taxScheme === "PPH23_2") pphRate = 0.02;
  else if (form.taxScheme === "PPH21_custom") pphRate = Number(form.pph21Rate || 0);
  else pphRate = 0;
  const vatRate = form.kolPKP ? 0.11 : 0;
  return { pphRate, vatRate };
}

export function makeSpkNumber(date, kolName, campaignName) {
  const d = parseISODateAsLocal(date);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const cleanKol = (kolName || "KOL").replace(/\s+/g, "").slice(0, 10);
  const cleanCamp = (campaignName || "CMP").replace(/\s+/g, "").slice(0, 10);
  return `SPK/${yyyy}${mm}${dd}/${cleanKol}/${cleanCamp}`;
}
