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
 * PDF Export (for Invoice & tests)
 *********************************/
async function downloadDivAsPDF(div, filename) {
  if (!div) {
    alert("Elemen tidak ditemukan untuk diekspor.");
    return;
  }

  try {
    const html2pdf = (await import("html2pdf.js")).default;

    const opt = {
      margin: [55, 55, 55, 55], // atas, kiri, bawah, kanan (pt)
      filename,
      image: { type: "jpeg", quality: 0.8 },
      html2canvas: {
        scale: 2,
        useCORS: true,
        backgroundColor: "#ffffff",
      },
      jsPDF: {
        unit: "pt",
        format: "a4",
        orientation: "portrait",
      },
      pagebreak: {
        mode: ["css", "legacy"],
      },
    };

    await html2pdf().set(opt).from(div).save();
  } catch (err) {
    console.error("PDF export failed", err);
    alert("Gagal membuat PDF. Detail: " + (err?.message || err));
  }
}

/*********************************
 * PDF Export khusus SPK (teks jsPDF, anti-glitch)
 *********************************/
async function generateSpkPdf(form, amounts) {
  const { jsPDF } = await import("jspdf");

  const doc = new jsPDF("p", "pt", "a4");
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  const marginX = 55;
  const marginY = 55;
  const usableWidth = pageWidth - marginX * 2;

  const lineGap = 14;
  const boxLineHeight = 13;

  let y = marginY;
  const bottomLimit = pageHeight - marginY - 20; // buffer ekstra biar gak kepotong

 const addTextBlock = (text, options = {}) => {
  const {
    bold = false,
    align = "left",
    size = 11,
    lineHeight = lineGap,
  } = options;

  doc.setFont("Helvetica", bold ? "bold" : "normal");
  doc.setFontSize(size);

  const lines = doc.splitTextToSize(text, usableWidth);

  // --- Widow/orphan control ---
  // Hitung kira-kira berapa baris masih muat di halaman ini
  const remainingLinesFit = Math.floor((bottomLimit - y) / lineHeight);

  // Kalau paragraf punya >1 baris,
  // tapi space tersisa cuma muat 1 baris (atau kurang),
  // geser seluruh paragraf ke halaman baru
  if (lines.length > 1 && remainingLinesFit > 0 && remainingLinesFit <= 1) {
    doc.addPage();
    y = marginY;
  }

  lines.forEach((line) => {
    if (y + lineHeight > bottomLimit) {
      doc.addPage();
      y = marginY;
    }
    doc.text(line, marginX, y, { align });
    y += lineHeight;
  });

  y += 4;
};

  const addSectionTitle = (title) => {
    if (y + lineGap > bottomLimit) {
      doc.addPage();
      y = marginY;
    }
    doc.setFont("Helvetica", "bold");
    doc.setFontSize(11);
    doc.text(title.toUpperCase(), marginX, y);
    y += lineGap;
  };

  const addBox = (lines) => {
    const boxPadding = 8;
    const innerWidth = usableWidth - boxPadding * 2;

    // hitung tinggi isi box
    let allLines = [];
    lines.forEach((l) => {
      const pieces = doc.splitTextToSize(l, innerWidth);
      allLines = allLines.concat(pieces);
    });

    const boxHeight = allLines.length * boxLineHeight + boxPadding * 2;

    if (y + boxHeight > bottomLimit) {
      doc.addPage();
      y = marginY;
    }

    // gambar kotak
    doc.setDrawColor(180);
    doc.setLineWidth(0.8);
    doc.roundedRect(
      marginX,
      y,
      usableWidth,
      boxHeight,
      4,
      4,
      "S"
    );

    let innerY = y + boxPadding + boxLineHeight - 3;
    doc.setFont("Helvetica", "normal");
    doc.setFontSize(10.5);

    allLines.forEach((line) => {
      if (innerY > bottomLimit) {
        // kalau isi box terlalu panjang (jarang), pindah halaman
        doc.addPage();
        y = marginY;
        innerY = y + boxPadding + boxLineHeight - 3;
        doc.roundedRect(
          marginX,
          y,
          usableWidth,
          boxHeight,
          4,
          4,
          "S"
        );
      }
      doc.text(line, marginX + boxPadding, innerY);
      innerY += boxLineHeight;
    });

    y += boxHeight + 8;
  };

  // ====== ISI SPK ======

  const issueDate = new Date(form.spkIssueDate);
  const issueDateStr = issueDate.toLocaleDateString("id-ID", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

  // Judul
  doc.setFont("Helvetica", "bold");
  doc.setFontSize(14);
  doc.text("SURAT PERJANJIAN KERJASAMA", pageWidth / 2, y, {
    align: "center",
  });
  y += lineGap * 1.8;

  doc.setFontSize(11);
  doc.text('"SOCIAL MEDIA ENDORSER/INFLUENCER"', pageWidth / 2, y, {
    align: "center",
  });
  y += lineGap * 1.4;

  doc.text(`NO: ${form.spkNumber || "-"}`, pageWidth / 2, y, {
    align: "center",
  });
  y += lineGap * 2;

  // Pembukaan
  addTextBlock(
    `Pada hari ${issueDateStr} bertempat di Jakarta Selatan dibuat dan ditandatangani Surat Perjanjian Kerjasama ("Perjanjian"), oleh dan antara:`
  );

  addTextBlock(
    `David Jr. M, selaku Direktur Savvy Digital beralamat di ${form.companyAddress}, mewakili klien dalam kampanye ${form.campaignName || "-"}, selanjutnya disebut PIHAK PERTAMA; dengan:`
  );

  // Data KOL
  addBox([
    `Nama: ${form.kolName || "-"}`,
    `Alamat: ${form.kolAddress || "-"}`,
    `No. KTP: ${form.kolKTP || "-"}`,
    `No. NPWP: ${form.kolNPWP || "-"}`,
  ]);

  addTextBlock(
    `PIHAK PERTAMA dan PIHAK KEDUA secara bersama-sama disebut sebagai "Para Pihak", dan secara sendiri-sendiri disebut sebagai "Pihak".`
  );

  // Pasal 1
  addSectionTitle("Pasal 1 - Ruang Lingkup Pekerjaan");
  addTextBlock(
    `PIHAK KEDUA akan melakukan pekerjaan sebagai berikut:`
  );
  addTextBlock(
    `• ${form.deliverableDesc || "1 (satu) konten sesuai brief PIHAK PERTAMA."}`
  );
  addTextBlock(
    `• Mengirimkan insight / hasil posting maksimal 7 (tujuh) hari kalender setelah konten tayang.`
  );

  addTextBlock(
    `Script / storyline diserahkan paling lambat H+3 (tiga hari kalender) setelah tanggal perjanjian ini. Draft final video diserahkan paling lambat tanggal ${issueDate.toLocaleDateString(
      "id-ID"
    )}. Unggah konten yang telah disetujui PIHAK PERTAMA paling lambat tanggal ${new Date(
      form.uploadDeadline
    ).toLocaleDateString(
      "id-ID"
    )} atau pada tanggal lain yang disepakati PIHAK PERTAMA.`
  );

  // Pasal 2
  addSectionTitle("Pasal 2 - Pembayaran");
  addTextBlock(
    `PIHAK KEDUA wajib mengirim invoice / kwitansi bermaterai (digital / cetak) kepada PIHAK PERTAMA setelah kewajiban pada Pasal 1 terpenuhi.`
  );
  addTextBlock(
    `Pembayaran oleh PIHAK PERTAMA dilakukan selambat-lambatnya H+15 (lima belas hari kalender) setelah konten diunggah dan seluruh dokumen pendukung diterima dengan lengkap.`
  );

  const schemeText = form.grossUp
    ? "dengan skema gross-up (target net KOL)."
    : "dengan skema non gross-up.";
  addTextBlock(
    `Remunerasi disepakati sebesar ${idr(
      form.feeInput
    )} ${schemeText} Potongan dan penambahan pajak mengikuti profil pajak sebagai berikut:`
  );

  addBox([
    `DPP (Gross): ${idr(amounts.gross)}`,
    `PPh: ${idr(amounts.withholding)}`,
    `PPN: ${idr(amounts.vatAmount)}`,
    `Net ke KOL: ${idr(amounts.netToKOL)}`,
  ]);

  addTextBlock(`Pembayaran akan ditransfer ke rekening berikut:`);

  addBox([
    `Bank: ${form.kolBankName || "-"}`,
    `No. Rekening: ${form.kolBankAcc || "-"}`,
    `a.n. ${form.kolBankHolder || form.kolName || "-"}`,
  ]);

  // Pasal 5
  addSectionTitle("Pasal 5 - Pernyataan dan Jaminan");
  addTextBlock(
    `PIHAK KEDUA menyatakan akan bertindak secara profesional, menjaga nama baik PIHAK PERTAMA dan klien, serta tidak melakukan tindakan yang dapat merugikan reputasi Para Pihak. PIHAK KEDUA bertanggung jawab penuh atas seluruh konten, pernyataan, dan tindakan yang dilakukan di akun media sosial miliknya sepanjang terkait dengan pelaksanaan Perjanjian ini.`
  );
  addTextBlock(
    `PIHAK KEDUA tidak akan membocorkan rahasia dagang, data internal, maupun informasi lain milik PIHAK PERTAMA dan/atau klien tanpa persetujuan tertulis terlebih dahulu dari PIHAK PERTAMA. Apabila PIHAK KEDUA gagal memenuhi kewajiban pada Pasal 1, maka PIHAK KEDUA dinyatakan wanprestasi dan wajib mengembalikan remunerasi yang telah diterima (apabila ada) kepada PIHAK PERTAMA.`
  );

  // Pasal 6
  addSectionTitle("Pasal 6 - Penutup");
  addTextBlock(
    `Segala perselisihan yang timbul dari Perjanjian ini akan diselesaikan dahulu secara musyawarah untuk mufakat. Apabila tidak tercapai mufakat, Para Pihak sepakat untuk memilih domisili hukum tetap pada Pengadilan di wilayah Jakarta Selatan.`
  );
  addTextBlock(
    `Perubahan atas Perjanjian ini hanya dapat dilakukan secara tertulis dan ditandatangani oleh Para Pihak, dan menjadi bagian yang tidak terpisahkan dari Perjanjian ini.`
  );

  // Tanda tangan
  if (y + 80 > bottomLimit) {
    doc.addPage();
    y = marginY;
  }

  const dateStr = issueDate.toLocaleDateString("id-ID");
  addTextBlock(`Jakarta, ${dateStr}`);

  if (y + 80 > bottomLimit) {
    doc.addPage();
    y = marginY;
  }

  doc.setFont("Helvetica", "normal");
  doc.setFontSize(11);
  const leftX = marginX;
  const rightX = marginX + usableWidth / 2 + 40;

  if (y + 60 > bottomLimit) {
    doc.addPage();
    y = marginY;
  }

  doc.text("Savvy Digital – PIHAK PERTAMA", leftX, y);
  doc.text("PIHAK KEDUA", rightX, y);
  y += 60;

  doc.setFont("Helvetica", "bold");
  doc.text("David Jr. M", leftX, y);
  doc.text(form.kolName || "(Nama KOL)", rightX, y);

  const filenameSafe = `SPK_${form.kolName || "KOL"}_${form.campaignName || "Campaign"}.pdf`;
  doc.save(filenameSafe);
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
        // SPK pakai jsPDF teks (anti-glitch)
        await generateSpkPdf(form, amounts);
      } else if (which === "invoice") {
        // Invoice pakai html2pdf dari DOM
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
    placeholder="Nomor KTP"
  />
  <ErrorText>{errors.kolKTP}</ErrorText>
</div>
