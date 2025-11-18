import React, { useEffect, useMemo, useRef, useState } from "react";
// App ini pakai dynamic import html2canvas & jsPDF untuk export PDF

/*********************************
 * Safe Storage (tahan sandbox window/localStorage)
 *********************************/
// Cek localStorage dengan sangat defensif (pakai globalThis, bukan window)
function safeStorageAvailable() {
  try {
    const g = typeof globalThis !== "undefined" ? globalThis : undefined;
    const ls = g && g.localStorage ? g.localStorage : null;
    if (!ls) return false;
    const k = `__svy_test_${Math.random().toString(36).slice(2)}__`;
    ls.setItem(k, "1");
    ls.removeItem(k);
    return true;
  } catch (_) {
    return false;
  }
}

const MemoryStore = {};
const HAS_LS = safeStorageAvailable();

const SafeStorage = {
  get(key, def = null) {
    try {
      if (HAS_LS) {
        const v = globalThis.localStorage.getItem(key);
        return v == null ? (key in MemoryStore ? MemoryStore[key] : def) : v;
      }
      return key in MemoryStore ? MemoryStore[key] : def;
    } catch (_) {
      return key in MemoryStore ? MemoryStore[key] : def;
    }
  },
  set(key, val) {
    try {
      if (HAS_LS) {
        globalThis.localStorage.setItem(key, val);
        MemoryStore[key] = val; // mirror ke memory
        return;
      }
      MemoryStore[key] = val;
    } catch (_) {
      MemoryStore[key] = val; // fallback ke memory kalau LS error
    }
  },
  remove(key) {
    try {
      if (HAS_LS) globalThis.localStorage.removeItem(key);
    } catch (_) {
      // ignore
    } finally {
      delete MemoryStore[key];
    }
  },
};

/*********************************
 * Helpers
 *********************************/
const idr = (n) =>
  new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(Math.round(n || 0));

const fmt = (n) =>
  new Intl.NumberFormat("id-ID").format(Math.round(n || 0));

const todayISO = () => new Date().toISOString().slice(0, 10);

function nextSequence(key = "spk_seq") {
  let cur = 0;
  try {
    cur = parseInt(SafeStorage.get(key, "0"), 10) || 0;
  } catch (_) {
    cur = 0;
  }
  cur += 1;
  SafeStorage.set(key, String(cur));
  return cur;
}

function makeDocNumber(prefix = "SPK", seq, d = new Date()) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${prefix}/${yyyy}/${mm}/${String(seq).padStart(4, "0")}/SVY`;
}

/*********************************
 * Tax Engine
 *********************************/
function computeAmounts({ feeBasis, feeInput, grossUp, pphRate, vatRate }) {
  const r = Number(pphRate || 0); // e.g., 0.005, 0.02
  const v = Number(vatRate || 0); // e.g., 0, 0.11
  const res = {
    gross: 0,
    withholding: 0,
    vatAmount: 0,
    netToKOL: 0,
    payables: 0,
  };

  if (!grossUp) {
    // feeInput = DPP/gross sebelum VAT
    res.gross = Number(feeInput || 0);
    res.withholding = res.gross * r;
    res.vatAmount = res.gross * v;
    res.netToKOL = res.gross - res.withholding + res.vatAmount;
    res.payables = res.netToKOL;
    return res;
  }

  // GROSS-UP MODE: feeInput = target net mendarat ke KOL (setelah PPh & +PPN kalau ada)
  const netTarget = Number(feeInput || 0);
  const factor = 1 - r + v;
  if (factor <= 0) {
    // fallback
    res.gross = netTarget;
    res.withholding = res.gross * r;
    res.vatAmount = res.gross * v;
    res.netToKOL = res.gross - res.withholding + res.vatAmount;
    res.payables = res.netToKOL;
    return res;
  }
  res.gross = netTarget / factor;
  res.withholding = res.gross * r;
  res.vatAmount = res.gross * v;
  res.netToKOL = res.gross - res.withholding + res.vatAmount; // ≈ netTarget
  res.payables = res.netToKOL;
  return res;
}

const DEFAULT_FORM = {
  // Parties
  kolName: "",
  kolAddress: "",
  kolKTP: "",
  kolNPWP: "",
  kolPKP: false,
  kolBankName: "",
  kolBankAcc: "",
  kolBankHolder: "",
  kolEmail: "",

  // Campaign & scope
  companyName: "PT Sarana Visi Internasional",
  companyAddress:
    "Gedung Artha Graha, Jl. Jend. Sudirman Kav 52-53, Senayan, Kebayoran Baru, Jakarta 12190",
  campaignName: "",
  deliverableDesc: "1 (satu) Video TikTok pada akun @...",
  scriptDeadline: todayISO(),
  uploadDeadline: todayISO(),
  spkIssueDate: todayISO(),

  // Payment & tax
  feeBasis: "gross", // gross|net (info)
  feeInput: 0,
  reimburse: 0,
  paymentTerm: "full", // full|dp50
  taxScheme: "UMKM_0_5", // UMKM_0_5 | PPH23_2 | PPH21_custom | NONE
  pph21Rate: 0.03, // default 3% (bisa diubah)
  grossUp: false,

  // Document numbering
  spkNumber: "",
  invoiceNumber: "",
};

function deriveRates(form) {
  let pphRate = 0;
  if (form.taxScheme === "UMKM_0_5") pphRate = 0.005;
  else if (form.taxScheme === "PPH23_2") pphRate = 0.02;
  else if (form.taxScheme === "PPH21_custom")
    pphRate = Number(form.pph21Rate || 0);
  else pphRate = 0;
  const vatRate = form.kolPKP ? 0.11 : 0; // VAT ikut status PKP KOL
  return { pphRate, vatRate };
}

function useAmounts(form) {
  const { pphRate, vatRate } = deriveRates(form);
  return computeAmounts({
    feeBasis: form.feeBasis,
    feeInput: form.feeInput,
    grossUp: form.grossUp,
    pphRate,
    vatRate,
  });
}

/*********************************
 * UI Components kecil
 *********************************/
function ErrorText({ children }) {
  if (!children) return null;
  return <p className="text-xs text-red-600 mt-1">{children}</p>;
}
function Section({ title, children, right }) {
  return (
    <div className="bg-white/90 rounded-2xl shadow p-5 border border-slate-100">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg font-semibold text-slate-800">{title}</h3>
        {right}
      </div>
      {children}
    </div>
  );
}
function Label({ children }) {
  return <label className="text-sm font-medium text-slate-700">{children}</label>;
}
function Input(props) {
  return (
    <input
      {...props}
      className={`w-full rounded-xl border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400 ${
        props.className || ""
      }`}
    />
  );
}
function TextArea(props) {
  return (
    <textarea
      {...props}
      className={`w-full rounded-xl border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400 ${
        props.className || ""
      }`}
    />
  );
}
function Select(props) {
  return (
    <select
      {...props}
      className={`w-full rounded-xl border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400 ${
        props.className || ""
      }`}
    />
  );
}
function Toggle({ checked, onChange }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${
        checked ? "bg-yellow-500 text-white" : "bg-slate-200 text-slate-700"
      }`}
    >
      {checked ? "ON" : "OFF"}
    </button>
  );
}

/*********************************
 * PDF Export (solid + fallback)
 *********************************/
async function downloadDivAsPDF(div, filename) {
  if (!div) {
    alert("Elemen tidak ditemukan untuk diekspor.");
    return;
  }

  try {
    const html2canvas = (await import("html2canvas")).default;
    const { jsPDF } = await import("jspdf");

    // SCALE DIPERKECIL (1.2 ATAU 1.0)
    const scaleValue = 1.2;

    const mainCanvas = await html2canvas(div, {
      scale: scaleValue,    // sebelumnya 2 → SEKARANG 1.2
      useCORS: true,
      backgroundColor: "#ffffff"
    });

    const pdf = new jsPDF("p", "pt", "a4");
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();

    const marginX = 55;
    const marginY = 55;

    const contentWidthPt = pageWidth - marginX * 2;
    const contentHeightPt = pageHeight - marginY * 2 - 10;

    const scale = Math.min(contentWidthPt / mainCanvas.width, 1); 
    const pageHeightPx = contentHeightPt / scale;
    const totalHeightPx = mainCanvas.height;

    let currentY = 0;
    let pageIndex = 0;

    while (currentY < totalHeightPx) {
      const sliceHeightPx = Math.min(pageHeightPx, totalHeightPx - currentY);

      // potong canvas per halaman
      const pageCanvas = document.createElement("canvas");
      pageCanvas.width = mainCanvas.width;
      pageCanvas.height = sliceHeightPx;
      const ctx = pageCanvas.getContext("2d");

      ctx.drawImage(
        mainCanvas,
        0,
        currentY,
        mainCanvas.width,
        sliceHeightPx,
        0,
        0,
        mainCanvas.width,
        sliceHeightPx
      );

      // ↓↓↓ PENTING: PAKAI JPEG + compress quality
      const imgData = pageCanvas.toDataURL("image/jpeg", 0.7);
      const imgWidthPt = contentWidthPt;
      const imgHeightPt = sliceHeightPx * scale;

      if (pageIndex > 0) {
        pdf.addPage();
      }

      pdf.addImage(imgData, "JPEG", marginX, marginY, imgWidthPt, imgHeightPt);

      currentY += sliceHeightPx;
      pageIndex++;
    }

    pdf.save(filename);
  } catch (err) {
    console.error("PDF export failed", err);
    alert("Gagal membuat PDF. Error: " + (err?.message || err));
  }
}

/*********************************
 * Previews
 *********************************/
function SPKPreview({ form, amounts }) {
  const seq = useMemo(
    () =>
      form.spkNumber ||
      makeDocNumber(
        "SPK",
        nextSequence("spk_seq"),
        new Date(form.spkIssueDate)
      ),
    [] // freeze di render pertama
  );
  form.spkNumber = seq;

  const issueDate = new Date(form.spkIssueDate);

  return (
    <div className="spk-print">
      <h2>SURAT PERJANJIAN KERJASAMA</h2>
      <div className="spk-subtitle">
        <span>“SOCIAL MEDIA ENDORSER/INFLUENCER”</span>
        <span>NO: {seq}</span>
      </div>

      <p>
        Pada hari{" "}
        {issueDate.toLocaleDateString("id-ID", {
          weekday: "long",
          day: "2-digit",
          month: "long",
          year: "numeric",
        })}{" "}
        bertempat di Jakarta Selatan, dibuat dan ditandatangani Surat
        Perjanjian Kerjasama (&quot;Perjanjian&quot;), oleh dan antara:
      </p>

      <p>
        <b>David Jr. M</b>, selaku Direktur Savvy Digital beralamat di{" "}
        {form.companyAddress}, mewakili klien dalam kampanye{" "}
        <b>{form.campaignName || "-"}</b>, selanjutnya disebut{" "}
        <b>PIHAK PERTAMA</b>; dengan:
      </p>

      <div className="spk-box">
        <p>
          <b>Nama</b>: {form.kolName || "-"}
        </p>
        <p>
          <b>Alamat</b>: {form.kolAddress || "-"}
        </p>
        <p>
          <b>No. KTP</b>: {form.kolKTP || "-"}
        </p>
        <p>
          <b>No. NPWP</b>: {form.kolNPWP || "-"}
        </p>
      </div>

      <p>
        PIHAK PERTAMA dan PIHAK KEDUA secara bersama-sama disebut
        sebagai &quot;Para Pihak&quot;, dan secara sendiri-sendiri
        disebut sebagai &quot;Pihak&quot;.
      </p>

      <p className="spk-section-title">PASAL 1 - RUANG LINGKUP PEKERJAAN</p>
      <ol>
        <li>
          PIHAK KEDUA akan melakukan pekerjaan sebagai berikut:
          <ul>
            <li>
              {form.deliverableDesc || "-"} sesuai brief yang
              diberikan oleh PIHAK PERTAMA.
            </li>
            <li>
              Mengirimkan insight / hasil posting maksimal 7 (tujuh)
              hari kalender setelah konten tayang.
            </li>
          </ul>
        </li>
        <li>
          Script / storyline diserahkan paling lambat H+3 (tiga hari
          kalender) setelah tanggal perjanjian ini.
        </li>
        <li>
          Draft final video diserahkan paling lambat tanggal{" "}
          {issueDate.toLocaleDateString("id-ID")}.
        </li>
        <li>
          Unggah konten yang telah disetujui PIHAK PERTAMA paling
          lambat tanggal{" "}
          {new Date(form.uploadDeadline).toLocaleDateString("id-ID")}{" "}
          atau pada tanggal lain yang disepakati PIHAK PERTAMA.
        </li>
      </ol>

      <p className="spk-section-title">PASAL 2 - PEMBAYARAN</p>
      <ol>
        <li>
          PIHAK KEDUA wajib mengirim invoice / kwitansi bermaterai
          (digital / cetak) kepada PIHAK PERTAMA setelah kewajiban
          pada Pasal 1 terpenuhi.
        </li>
        <li>
          Pembayaran oleh PIHAK PERTAMA dilakukan selambat-lambatnya
          H+15 (lima belas hari kalender) setelah konten diunggah dan
          seluruh dokumen pendukung diterima dengan lengkap.
        </li>
        <li>
          Remunerasi disepakati sebesar{" "}
          <b>{idr(form.feeInput)}</b> dengan skema{" "}
          {form.grossUp
            ? "gross-up (target net KOL)"
            : "non gross-up"}. Potongan dan penambahan pajak mengikuti
          profil pajak sebagai berikut:
        </li>
      </ol>

      <div className="spk-box">
        <p>
          <b>DPP (Gross)</b>: {idr(amounts.gross)}
        </p>
        <p>
          <b>PPh</b>: {idr(amounts.withholding)}
        </p>
        <p>
          <b>PPN</b>: {idr(amounts.vatAmount)}
        </p>
        <p>
          <b>Net ke KOL</b>: {idr(amounts.netToKOL)}
        </p>
      </div>

      <p>
        Pembayaran akan ditransfer ke rekening berikut:
      </p>
      <div className="spk-box">
        <p>
          <b>Bank</b>: {form.kolBankName || "-"}
        </p>
        <p>
          <b>No. Rekening</b>: {form.kolBankAcc || "-"}
        </p>
        <p>
          <b>a.n.</b> {form.kolBankHolder || form.kolName || "-"}
        </p>
      </div>

      <p className="spk-section-title">
        PASAL 5 - PERNYATAAN DAN JAMINAN
      </p>
      <p>
        PIHAK KEDUA menyatakan akan bertindak secara profesional,
        menjaga nama baik PIHAK PERTAMA dan klien, serta tidak
        melakukan tindakan yang dapat merugikan reputasi Para Pihak.
        PIHAK KEDUA bertanggung jawab penuh atas seluruh konten,
        pernyataan, dan tindakan yang dilakukan di akun media sosial
        miliknya sepanjang terkait dengan pelaksanaan Perjanjian ini.
      </p>
      <p>
        PIHAK KEDUA tidak akan membocorkan rahasia dagang, data
        internal, maupun informasi lain milik PIHAK PERTAMA dan/atau
        klien tanpa persetujuan tertulis terlebih dahulu dari PIHAK
        PERTAMA. Apabila PIHAK KEDUA gagal memenuhi kewajiban pada
        Pasal 1, maka PIHAK KEDUA dinyatakan wanprestasi dan wajib
        mengembalikan remunerasi yang telah diterima (apabila ada)
        kepada PIHAK PERTAMA.
      </p>

      <p className="spk-section-title">PASAL 6 - PENUTUP</p>
      <p>
        Segala perselisihan yang timbul dari Perjanjian ini akan
        diselesaikan terlebih dahulu secara musyawarah untuk mufakat.
        Apabila tidak tercapai mufakat, Para Pihak sepakat untuk
        memilih domisili hukum tetap pada Pengadilan di wilayah
        Jakarta Selatan.
      </p>
      <p>
        Perubahan atas Perjanjian ini hanya dapat dilakukan secara
        tertulis dan ditandatangani oleh Para Pihak, dan menjadi
        bagian yang tidak terpisahkan dari Perjanjian ini.
      </p>

      <div className="spk-signature-row">
        <div className="spk-signature-block">
          <p>
            Jakarta, {issueDate.toLocaleDateString("id-ID")}
          </p>
          <p className="spk-signature-label">
            Savvy Digital – PIHAK PERTAMA
          </p>
          <p className="spk-signature-name">David Jr. M</p>
        </div>
        <div className="spk-signature-block">
          <p>&nbsp;</p>
          <p className="spk-signature-label">PIHAK KEDUA</p>
          <p className="spk-signature-name">
            {form.kolName || "(Nama KOL)"}
          </p>
        </div>
      </div>
    </div>
  );
}


function InvoicePreview({ form, amounts }) {
  const invSeq = useMemo(
    () =>
      form.invoiceNumber ||
      makeDocNumber("INV", nextSequence("inv_seq"), new Date(form.spkIssueDate)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );
  form.invoiceNumber = invSeq;
  const totalLine = (form.reimburse || 0) + (form.feeInput || 0);
  const net = amounts.netToKOL + Number(form.reimburse || 0);

  return (
    <div className="p-8 text-slate-900 bg-white">
      <div className="flex items-center justify-between mb-6 text-sm">
        <div>
          <h2 className="text-xl font-bold">INVOICE</h2>
          <p>No: {invSeq}</p>
        </div>
        <div className="text-right">
          <p>
            Tanggal:{" "}
            {new Date(form.spkIssueDate).toLocaleDateString("id-ID")}
          </p>
          <p>
            Untuk: <b>PT Sarana Visi Internasional</b>
          </p>
          <p>Campaign: {form.campaignName || "-"}</p>
          <p>
            Dari: <b>{form.kolName || "-"}</b>
          </p>
        </div>
      </div>

      <table className="w-full text-sm border mb-4" style={{ borderCollapse: "collapse" }}>
        <thead className="bg-slate-100">
          <tr>
            <th className="border px-2 py-1 text-left">No</th>
            <th className="border px-2 py-1 text-left">Description</th>
            <th className="border px-2 py-1 text-right">Cost</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="border px-2 py-1">1</td>
            <td className="border px-2 py-1">
              {form.deliverableDesc || "1x TikTok video"}
            </td>
            <td className="border px-2 py-1 text-right">{idr(form.feeInput)}</td>
          </tr>
          {Number(form.reimburse || 0) > 0 && (
            <tr>
              <td className="border px-2 py-1">2</td>
              <td className="border px-2 py-1">
                Reimburse produk (sesuai struk)
              </td>
              <td className="border px-2 py-1 text-right">
                {idr(form.reimburse)}
              </td>
            </tr>
          )}
        </tbody>
        <tfoot>
          <tr>
            <td className="border px-2 py-1 text-right" colSpan={2}>
              <b>Subtotal</b>
            </td>
            <td className="border px-2 py-1 text-right">{idr(totalLine)}</td>
          </tr>
          <tr>
            <td className="border px-2 py-1 text-right" colSpan={2}>
              PPh ({fmt(deriveRates(form).pphRate * 100)}%)
            </td>
            <td className="border px-2 py-1 text-right">
              - {idr(amounts.withholding)}
            </td>
          </tr>
          <tr>
            <td className="border px-2 py-1 text-right" colSpan={2}>
              PPN ({fmt(deriveRates(form).vatRate * 100)}%)
            </td>
            <td className="border px-2 py-1 text-right">
              + {idr(amounts.vatAmount)}
            </td>
          </tr>
          <tr>
            <td className="border px-2 py-1 text-right" colSpan={2}>
              <b>Total Dibayarkan (net + reimburse)</b>
            </td>
            <td className="border px-2 py-1 text-right">
              <b>{idr(net)}</b>
            </td>
          </tr>
        </tfoot>
      </table>

      <div className="text-sm mb-4">
        <p>
          <b>Metode pembayaran</b>:{" "}
          {form.paymentTerm === "dp50"
            ? "DP 50% in advance / pelunasan setelah tayang"
            : "Full payment"}
        </p>
        <p>
          <b>Rekening</b>: {form.kolBankName || "-"} /{" "}
          {form.kolBankAcc || "-"} a.n.{" "}
          {form.kolBankHolder || form.kolName || "-"}
        </p>
        <p>
          <b>Identitas</b>: KTP {form.kolKTP || "-"} | NPWP{" "}
          {form.kolNPWP || "-"} | Alamat {form.kolAddress || "-"}
        </p>
      </div>

      <div className="mt-8 text-sm">
        <p>Prepared by,</p>
        <div className="h-12" />
        <p className="font-semibold">
          {form.kolName || "(Nama KOL)"} – KOL
        </p>
      </div>
    </div>
  );
}

/*********************************
 * App + Diagnostics
 *********************************/
export default function App() {
  const [form, setForm] = useState(() => {
    try {
      const saved = SafeStorage.get("spk_form");
      return saved ? { ...DEFAULT_FORM, ...JSON.parse(saved) } : { ...DEFAULT_FORM };
    } catch (_) {
      return { ...DEFAULT_FORM };
    }
  });
  const [errors, setErrors] = useState({});
  const [exporting, setExporting] = useState(false);
  const amounts = useAmounts(form);

  const spkRef = useRef(null);
  const invRef = useRef(null);

  useEffect(() => {
    try {
      SafeStorage.set("spk_form", JSON.stringify(form));
    } catch (_) {}
  }, [form]);

  function setField(k, v) {
    setForm((prev) => ({ ...prev, [k]: v }));
  }

  function validate() {
    const e = {};
    if (!form.kolName) e.kolName = "Nama KOL wajib.";
    if (!form.kolAddress) e.kolAddress = "Alamat KTP wajib.";
    if (!form.kolKTP) e.kolKTP = "Nomor KTP wajib.";
    if (!form.campaignName) e.campaignName = "Nama campaign wajib.";
    if (!form.deliverableDesc) e.deliverableDesc = "Deskripsi deliverable wajib.";
    if (!(Number(form.feeInput) > 0)) e.feeInput = "Nominal fee harus > 0.";

    if (form.taxScheme === "PPH23_2" && !form.kolNPWP)
      e.kolNPWP = "NPWP disarankan untuk PPh23.";
    if (
      form.taxScheme === "PPH21_custom" &&
      (form.pph21Rate <= 0 || form.pph21Rate > 0.5)
    )
      e.pph21Rate = "Tarif PPh21 tidak valid.";

    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleGenerate(which) {
    if (!validate()) {
      alert("Cek kembali input yang wajib.");
      return;
    }
    setExporting(true);
    try {
      if (which === "spk") {
        await downloadDivAsPDF(
          spkRef.current,
          `SPK_${form.kolName || "KOL"}_${form.campaignName || "Campaign"}.pdf`
        );
      } else if (which === "invoice") {
        await downloadDivAsPDF(
          invRef.current,
          `INVOICE_${form.kolName || "KOL"}_${form.campaignName || "Campaign"}.pdf`
        );
      }
    } finally {
      setExporting(false);
    }
  }

  function clearAll() {
    SafeStorage.remove("spk_form");
    setForm({
      ...DEFAULT_FORM,
      spkIssueDate: todayISO(),
      scriptDeadline: todayISO(),
      uploadDeadline: todayISO(),
    });
    setErrors({});
  }

  // Diagnostics
  const diagSimpleRef = useRef(null);
  const diagLongRef = useRef(null);

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-10 bg-[#0b1b3b] text-white shadow">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <h1 className="font-bold tracking-wide">
            Savvy SPK &amp; Invoice Generator
          </h1>
          <div className="flex items-center gap-2 text-sm">
            <button
              onClick={clearAll}
              className="bg-white text-[#0b1b3b] rounded-xl px-3 py-1.5 font-medium"
            >
              Reset Form
            </button>
            <button
              onClick={() => handleGenerate("spk")}
              disabled={exporting}
              className={`rounded-xl px-3 py-1.5 font-bold ${
                exporting
                  ? "bg-yellow-300 cursor-wait"
                  : "bg-yellow-400 hover:bg-yellow-500"
              } text-[#0b1b3b]`}
            >
              {exporting ? "Processing…" : "Download SPK PDF"}
            </button>
            <button
              onClick={() => handleGenerate("invoice")}
              disabled={exporting}
              className={`rounded-xl px-3 py-1.5 font-bold ${
                exporting
                  ? "bg-yellow-300 cursor-wait"
                  : "bg-yellow-400 hover:bg-yellow-500"
              } text-[#0b1b3b]`}
            >
              {exporting ? "Processing…" : "Download Invoice PDF"}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto p-4 grid md:grid-cols-2 gap-4">
        {/* Left: Form */}
        <div className="space-y-4">
          <Section title="① Data KOL">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <Label>Nama KOL *</Label>
                <Input
                  value={form.kolName}
                  onChange={(e) => setField("kolName", e.target.value)}
                  placeholder="Nama lengkap"
                />
                <ErrorText>{errors.kolName}</ErrorText>
              </div>
              <div>
                <Label>Email (opsional)</Label>
                <Input
                  value={form.kolEmail}
                  onChange={(e) => setField("kolEmail", e.target.value)}
                  placeholder="email@contoh.com"
                />
              </div>
              <div className="col-span-2">
                <Label>Alamat KTP *</Label>
                <TextArea
                  rows={3}
                  value={form.kolAddress}
                  onChange={(e) => setField("kolAddress", e.target.value)}
                  placeholder="Alamat sesuai KTP"
                />
                <ErrorText>{errors.kolAddress}</ErrorText>
              </div>
              <div>
                <Label>No. KTP *</Label>
                <Input
                  value={form.kolKTP}
                  onChange={(e) => setField("kolKTP", e.target.value)}
                  placeholder="16 digit"
                />
                <ErrorText>{errors.kolKTP}</ErrorText>
              </div>
              <div>
                <Label>No. NPWP (opsional)</Label>
                <Input
                  value={form.kolNPWP}
                  onChange={(e) => setField("kolNPWP", e.target.value)}
                  placeholder="NPWP"
                />
                <ErrorText>{errors.kolNPWP}</ErrorText>
              </div>
              <div>
                <Label>PKP?</Label>
                <div className="mt-1">
                  <Toggle
                    checked={form.kolPKP}
                    onChange={(v) => setField("kolPKP", v)}
                  />
                </div>
              </div>
              <div />
              <div>
                <Label>Bank</Label>
                <Input
                  value={form.kolBankName}
                  onChange={(e) => setField("kolBankName", e.target.value)}
                  placeholder="BCA/BNI/BRI"
                />
              </div>
              <div>
                <Label>No. Rekening</Label>
                <Input
                  value={form.kolBankAcc}
                  onChange={(e) => setField("kolBankAcc", e.target.value)}
                  placeholder="1234567890"
                />
              </div>
              <div className="col-span-2">
                <Label>Atas Nama</Label>
                <Input
                  value={form.kolBankHolder}
                  onChange={(e) => setField("kolBankHolder", e.target.value)}
                  placeholder="Nama pemilik rekening"
                />
              </div>
            </div>
          </Section>

          <Section title="② Campaign & Scope">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <Label>Nama Campaign *</Label>
                <Input
                  value={form.campaignName}
                  onChange={(e) => setField("campaignName", e.target.value)}
                  placeholder="Cimory Q4"
                />
                <ErrorText>{errors.campaignName}</ErrorText>
              </div>
              <div>
                <Label>Tanggal Perjanjian</Label>
                <Input
                  type="date"
                  value={form.spkIssueDate}
                  onChange={(e) => setField("spkIssueDate", e.target.value)}
                />
              </div>
              <div className="col-span-2">
                <Label>Deskripsi Deliverable *</Label>
                <TextArea
                  rows={2}
                  value={form.deliverableDesc}
                  onChange={(e) =>
                    setField("deliverableDesc", e.target.value)
                  }
                  placeholder="1 (satu) Video TikTok pada akun TikTok @username sesuai brief"
                />
                <ErrorText>{errors.deliverableDesc}</ErrorText>
              </div>
              <div>
                <Label>Deadline Script</Label>
                <Input
                  type="date"
                  value={form.scriptDeadline}
                  onChange={(e) =>
                    setField("scriptDeadline", e.target.value)
                  }
                />
              </div>
              <div>
                <Label>Deadline Upload</Label>
                <Input
                  type="date"
                  value={form.uploadDeadline}
                  onChange={(e) =>
                    setField("uploadDeadline", e.target.value)
                  }
                />
              </div>
            </div>
          </Section>

          <Section
            title="③ Pembayaran & Pajak"
            right={
              <div className="text-xs text-slate-500">
                Hitungan live di panel kanan
              </div>
            }
          >
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <Label>Fee (angka acuan) *</Label>
                <Input
                  type="number"
                  min={0}
                  value={form.feeInput}
                  onChange={(e) =>
                    setField("feeInput", Number(e.target.value))
                  }
                  placeholder="contoh 5000000"
                />
                <ErrorText>{errors.feeInput}</ErrorText>
              </div>
              <div>
                <Label>Reimburse (opsional)</Label>
                <Input
                  type="number"
                  min={0}
                  value={form.reimburse}
                  onChange={(e) =>
                    setField("reimburse", Number(e.target.value))
                  }
                  placeholder="0"
                />
              </div>
              <div>
                <Label>Fee Basis</Label>
                <Select
                  value={form.feeBasis}
                  onChange={(e) => setField("feeBasis", e.target.value)}
                >
                  <option value="gross">Gross (DPP sebelum pajak)</option>
                  <option value="net">Net (target mendarat ke KOL)</option>
                </Select>
              </div>
              <div>
                <Label>Gross-Up?</Label>
                <div className="mt-1">
                  <Toggle
                    checked={form.grossUp}
                    onChange={(v) => setField("grossUp", v)}
                  />
                </div>
              </div>
              <div>
                <Label>Skema Pajak</Label>
                <Select
                  value={form.taxScheme}
                  onChange={(e) =>
                    setField("taxScheme", e.target.value)
                  }
                >
                  <option value="UMKM_0_5">Final UMKM 0.5%</option>
                  <option value="PPH23_2">PPh 23 Jasa 2%</option>
                  <option value="PPH21_custom">PPh 21 (custom)</option>
                  <option value="NONE">Tanpa PPh</option>
                </Select>
              </div>
              {form.taxScheme === "PPH21_custom" && (
                <div>
                  <Label>Tarif PPh21 (0.5% - 50%)</Label>
                  <Input
                    type="number"
                    step="0.1"
                    value={form.pph21Rate * 100}
                    onChange={(e) =>
                      setField("pph21Rate", Number(e.target.value) / 100)
                    }
                  />
                  <ErrorText>{errors.pph21Rate}</ErrorText>
                </div>
              )}
              <div>
                <Label>Term Pembayaran</Label>
                <Select
                  value={form.paymentTerm}
                  onChange={(e) =>
                    setField("paymentTerm", e.target.value)
                  }
                >
                  <option value="full">Full payment</option>
                  <option value="dp50">DP 50% + pelunasan</option>
                </Select>
              </div>
            </div>
            <div className="mt-3 text-xs text-slate-500">
              <p>
                Catatan: Jika <b>PKP</b> aktif pada KOL, PPN 11% akan
                terhitung otomatis.
              </p>
              <p>
                Mode <b>Gross-Up</b>: fee dianggap target{" "}
                <i>net mendarat</i> (setelah PPh & +PPN bila PKP).
              </p>
            </div>
          </Section>
        </div>

        {/* Right: Live Preview */}
        <div className="space-y-4">
          <Section title="Live Breakdown & Checks">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="bg-slate-100 rounded-xl p-3">
                <p>DPP (Gross)</p>
                <p className="text-lg font-semibold">
                  {idr(amounts.gross)}
                </p>
              </div>
              <div className="bg-slate-100 rounded-xl p-3">
                <p>PPh ({fmt(deriveRates(form).pphRate * 100)}%)</p>
                <p className="text-lg font-semibold">
                  {idr(amounts.withholding)}
                </p>
              </div>
              <div className="bg-slate-100 rounded-xl p-3">
                <p>PPN ({fmt(deriveRates(form).vatRate * 100)}%)</p>
                <p className="text-lg font-semibold">
                  {idr(amounts.vatAmount)}
                </p>
              </div>
              <div className="bg-slate-100 rounded-xl p-3">
                <p>Net to KOL</p>
                <p className="text-lg font-semibold">
                  {idr(amounts.netToKOL)}
                </p>
              </div>
            </div>
            <div className="mt-3 space-y-1 text-xs">
              {form.taxScheme === "PPH23_2" && !form.kolNPWP && (
                <p className="text-amber-700 bg-amber-100 border border-amber-200 rounded px-2 py-1">
                  Disarankan isi NPWP untuk PPh23.
                </p>
              )}
              {form.grossUp && form.feeBasis !== "net" && (
                <p className="text-amber-700 bg-amber-100 border border-amber-200 rounded px-2 py-1">
                  Gross-up aktif, sebaiknya Fee Basis = Net agar target
                  tepat.
                </p>
              )}
            </div>
          </Section>

          <Section
            title="Preview SPK"
            right={
              <button
                onClick={() =>
                  downloadDivAsPDF(
                    spkRef.current,
                    `SPK_${form.kolName || "KOL"}_${
                      form.campaignName || "Campaign"
                    }.pdf`
                  )
                }
                disabled={exporting}
                className="text-xs bg-yellow-400 px-3 py-1.5 rounded-xl font-semibold disabled:opacity-60"
              >
                Download
              </button>
            }
          >
            <div ref={spkRef} className="bg-white border rounded-xl">
              <SPKPreview form={form} amounts={amounts} />
            </div>
          </Section>

          <Section
            title="Preview Invoice"
            right={
              <button
                onClick={() =>
                  downloadDivAsPDF(
                    invRef.current,
                    `INVOICE_${form.kolName || "KOL"}_${
                      form.campaignName || "Campaign"
                    }.pdf`
                  )
                }
                disabled={exporting}
                className="text-xs bg-yellow-400 px-3 py-1.5 rounded-xl font-semibold disabled:opacity-60"
              >
                Download
              </button>
            }
          >
            <div ref={invRef} className="bg-white border rounded-xl">
              <InvoicePreview form={form} amounts={amounts} />
            </div>
          </Section>

          <Section
            title="Diagnostics & Tests"
            right={
              <div className="flex gap-2 text-xs">
                <button
                  className="bg-slate-200 rounded-lg px-2 py-1"
                  onClick={() =>
                    downloadDivAsPDF(
                      diagSimpleRef.current,
                      "TEST_simple.pdf"
                    )
                  }
                >
                  Run Simple
                </button>
                <button
                  className="bg-slate-200 rounded-lg px-2 py-1"
                  onClick={() =>
                    downloadDivAsPDF(
                      diagLongRef.current,
                      "TEST_long.pdf"
                    )
                  }
                >
                  Run Long
                </button>
                <button
                  className="bg-slate-200 rounded-lg px-2 py-1"
                  onClick={() => {
                    const a = nextSequence("__test_seq__");
                    const b = nextSequence("__test_seq__");
                    alert(
                      `Storage OK: seq increments ${a} -> ${b} (LS:${
                        HAS_LS ? "on" : "off"
                      })`
                    );
                  }}
                >
                  Test Storage
                </button>
              </div>
            }
          >
            <div className="space-y-3 text-sm">
              <div
                ref={diagSimpleRef}
                className="bg-white border rounded-xl p-4"
              >
                <h4 className="font-semibold mb-2">Simple Test</h4>
                <p>Halo! Ini test sederhana 1 halaman untuk cek export.</p>
              </div>
              <div
                ref={diagLongRef}
                className="bg-white border rounded-xl p-4"
              >
                <h4 className="font-semibold mb-2">
                  Long Test (Multi-page)
                </h4>
                <ul className="list-disc ml-6">
                  {Array.from({ length: 120 }).map((_, i) => (
                    <li key={i}>
                      Baris ke-{i + 1}: Lorem ipsum dolor sit amet,
                      consectetur adipiscing elit.
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </Section>
        </div>
      </main>

      <footer className="text-center text-xs text-slate-500 py-6">
        Savvy OS • SPK &amp; Invoice Generator (MVP)
      </footer>
    </div>
  );
}
