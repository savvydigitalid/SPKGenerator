import React, { useMemo, useState } from "react";

// ================= Helpers =================

const idr = (n) =>
  new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(Math.round(Number(n || 0)));

const todayISO = () => new Date().toISOString().slice(0, 10);

function computeAmounts({ feeInput, grossUp, pphRate, vatRate }) {
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
    // Fee input = DPP (gross) sebelum VAT
    res.gross = Number(feeInput);
    res.withholding = res.gross * r;
    res.vatAmount = res.gross * v;
    res.netToKOL = res.gross - res.withholding + res.vatAmount;
    return res;
  }

  // Gross-up: feeInput = net ke KOL (setelah PPh & +PPN)
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
  res.netToKOL = res.gross - res.withholding + res.vatAmount; // ≈ netTarget
  return res;
}

function deriveRates(form) {
  let pphRate = 0;
  if (form.taxScheme === "UMKM_0_5") pphRate = 0.005;
  else if (form.taxScheme === "PPH23_2") pphRate = 0.02;
  else if (form.taxScheme === "PPH21_custom")
    pphRate = Number(form.pph21Rate || 0);
  else pphRate = 0;
  const vatRate = form.kolPKP ? 0.11 : 0;
  return { pphRate, vatRate };
}

// nomor dokumen simpel
function makeSpkNumber(date, kolName, campaignName) {
  const d = new Date(date);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const cleanKol = (kolName || "KOL").replace(/\s+/g, "").slice(0, 10);
  const cleanCamp = (campaignName || "CMP").replace(/\s+/g, "").slice(0, 10);
  return `SPK/${yyyy}${mm}${dd}/${cleanKol}/${cleanCamp}`;
}

// ================= PDF SPK (jsPDF, anti kepotong) =================

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
  const bottomLimit = pageHeight - marginY - 20; // buffer

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

    // Widow/orphan control: kalau sisa space cuma muat 1 baris,
    // dan paragraf >1 baris, mending pindah ke halaman baru.
    const remainingLinesFit = Math.floor((bottomLimit - y) / lineHeight);
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

    doc.setDrawColor(180);
    doc.setLineWidth(0.8);
    doc.roundedRect(marginX, y, usableWidth, boxHeight, 4, 4, "S");

    let innerY = y + boxPadding + boxLineHeight - 3;
    doc.setFont("Helvetica", "normal");
    doc.setFontSize(10.5);

    allLines.forEach((line) => {
      if (innerY > bottomLimit) {
        doc.addPage();
        y = marginY;
        innerY = y + boxPadding + boxLineHeight - 3;
        doc.roundedRect(marginX, y, usableWidth, boxHeight, 4, 4, "S");
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
  const spkNumber = makeSpkNumber(
    form.spkIssueDate,
    form.kolName,
    form.campaignName
  );

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

  doc.text(`NO: ${spkNumber}`, pageWidth / 2, y, {
    align: "center",
  });
  y += lineGap * 2;

  addTextBlock(
    `Pada hari ${issueDateStr} bertempat di Jakarta Selatan dibuat dan ditandatangani Surat Perjanjian Kerjasama ("Perjanjian"), oleh dan antara:`
  );

  addTextBlock(
    `David Jr. M, selaku Direktur Savvy Digital beralamat di ${form.companyAddress}, mewakili klien dalam kampanye ${form.campaignName ||
      "-"}, selanjutnya disebut PIHAK PERTAMA; dengan:`
  );

  addBox([
    `Nama: ${form.kolName || "-"}`,
    `Alamat: ${form.kolAddress || "-"}`,
    `No. KTP: ${form.kolKTP || "-"}`,
    `No. NPWP: ${form.kolNPWP || "-"}`,
  ]);

  addTextBlock(
    `PIHAK PERTAMA dan PIHAK KEDUA secara bersama-sama disebut sebagai "Para Pihak", dan secara sendiri-sendiri disebut sebagai "Pihak".`
  );

  // PASAL 1
  addSectionTitle("Pasal 1 - Ruang Lingkup Pekerjaan");
  addTextBlock(
    `PIHAK KEDUA akan melakukan pekerjaan sebagai berikut:`
  );
  addTextBlock(
    `• ${form.deliverableDesc ||
      "1 (satu) konten sesuai brief PIHAK PERTAMA."}`
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

  // PASAL 2
  addSectionTitle("Pasal 2 - Pembayaran");
  addTextBlock(
    `PIHAK KEDUA wajib mengirim invoice / kwitansi bermaterai (digital / cetak) kepada PIHAK PERTAMA setelah kewajiban pada Pasal 1 terpenuhi.`
  );
  addTextBlock(
    `Pembayaran oleh PIHAK PERTAMA dilakukan selambat-lambatnya H+15 (lima belas hari kalender) setelah konten diunggah dan seluruh dokumen pendukung diterima dengan lengkap.`
  );

  const { pphRate, vatRate } = deriveRates(form);
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
    `PPh (${(pphRate * 100).toFixed(2)}%): ${idr(amounts.withholding)}`,
    `PPN (${(vatRate * 100).toFixed(2)}%): ${idr(amounts.vatAmount)}`,
    `Net ke KOL: ${idr(amounts.netToKOL)}`,
  ]);

  addTextBlock(`Pembayaran akan ditransfer ke rekening berikut:`);

  addBox([
    `Bank: ${form.kolBankName || "-"}`,
    `No. Rekening: ${form.kolBankAcc || "-"}`,
    `a.n. ${form.kolBankHolder || form.kolName || "-"}`,
  ]);

  // PASAL 5
  addSectionTitle("Pasal 5 - Pernyataan dan Jaminan");
  addTextBlock(
    `PIHAK KEDUA menyatakan akan bertindak secara profesional, menjaga nama baik PIHAK PERTAMA dan klien, serta tidak melakukan tindakan yang dapat merugikan reputasi Para Pihak. PIHAK KEDUA bertanggung jawab penuh atas seluruh konten, pernyataan, dan tindakan yang dilakukan di akun media sosial miliknya sepanjang terkait dengan pelaksanaan Perjanjian ini.`
  );
  addTextBlock(
    `PIHAK KEDUA tidak akan membocorkan rahasia dagang, data internal, maupun informasi lain milik PIHAK PERTAMA dan/atau klien tanpa persetujuan tertulis terlebih dahulu dari PIHAK PERTAMA. Apabila PIHAK KEDUA gagal memenuhi kewajiban pada Pasal 1, maka PIHAK KEDUA dinyatakan wanprestasi dan wajib mengembalikan remunerasi yang telah diterima (apabila ada) kepada PIHAK PERTAMA.`
  );

  // PASAL 6
  addSectionTitle("Pasal 6 - Penutup");
  addTextBlock(
    `Segala perselisihan yang timbul dari Perjanjian ini akan diselesaikan terlebih dahulu secara musyawarah untuk mufakat. Apabila tidak tercapai mufakat, Para Pihak sepakat untuk memilih domisili hukum tetap pada Pengadilan di wilayah Jakarta Selatan.`
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

  const filenameSafe = `SPK_${form.kolName || "KOL"}_${form.campaignName ||
    "Campaign"}.pdf`;
  doc.save(filenameSafe);
}

// ================= UI KECIL =================

const Label = ({ children }) => (
  <label className="text-sm font-medium text-slate-700">{children}</label>
);
const Input = (props) => (
  <input
    {...props}
    className={
      "w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400 " +
      (props.className || "")
    }
  />
);
const TextArea = (props) => (
  <textarea
    {...props}
    className={
      "w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400 " +
      (props.className || "")
    }
  />
);
const Select = (props) => (
  <select
    {...props}
    className={
      "w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400 " +
      (props.className || "")
    }
  />
);
const ErrorText = ({ children }) =>
  children ? (
    <p className="mt-1 text-xs text-red-600">{children}</p>
  ) : null;

// ================= PREVIEW SPK DI LAYAR =================

function SpkPreviewCard({ form, amounts }) {
  const issueDate = new Date(form.spkIssueDate);
  const spkNumber = makeSpkNumber(
    form.spkIssueDate,
    form.kolName,
    form.campaignName
  );

  return (
    <div className="bg-white rounded-2xl border shadow-sm p-6 text-sm leading-relaxed max-h-[80vh] overflow-auto">
      <h2 className="text-center font-bold text-lg">
        SURAT PERJANJIAN KERJASAMA
      </h2>
      <p className="text-center text-sm">
        “SOCIAL MEDIA ENDORSER/INFLUENCER”
      </p>
      <p className="text-center text-sm mb-4">NO: {spkNumber}</p>

      <p className="mb-2">
        Pada hari{" "}
        {issueDate.toLocaleDateString("id-ID", {
          weekday: "long",
          day: "2-digit",
          month: "long",
          year: "numeric",
        })}{" "}
        bertempat di Jakarta Selatan dibuat dan ditandatangani Surat
        Perjanjian Kerjasama ("Perjanjian"), oleh dan antara:
      </p>
      <p className="mb-2">
        <b>David Jr. M</b>, selaku Direktur Savvy Digital beralamat di{" "}
        {form.companyAddress}, mewakili klien dalam kampanye{" "}
        <b>{form.campaignName || "-"}</b>, selanjutnya disebut{" "}
        <b>PIHAK PERTAMA</b>; dengan:
      </p>
      <div className="border rounded-lg p-3 mb-2">
        <p>Nama: {form.kolName || "-"}</p>
        <p>Alamat: {form.kolAddress || "-"}</p>
        <p>No. KTP: {form.kolKTP || "-"}</p>
        <p>No. NPWP: {form.kolNPWP || "-"}</p>
      </div>
      <p className="mb-2">
        PIHAK PERTAMA dan PIHAK KEDUA secara bersama-sama disebut
        sebagai "Para Pihak", dan secara sendiri-sendiri disebut
        sebagai "Pihak".
      </p>

      <h3 className="mt-3 font-semibold">
        PASAL 1 - RUANG LINGKUP PEKERJAAN
      </h3>
      <ul className="list-disc ml-4 mb-2">
        <li>
          PIHAK KEDUA akan melakukan pekerjaan sebagai berikut:
          <ul className="list-disc ml-4">
            <li>
              {form.deliverableDesc ||
                "1 (satu) konten sesuai brief PIHAK PERTAMA."}
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
      </ul>

      <h3 className="mt-3 font-semibold">PASAL 2 - PEMBAYARAN</h3>
      <p className="mb-2">
        PIHAK KEDUA wajib mengirim invoice / kwitansi bermaterai
        (digital / cetak) kepada PIHAK PERTAMA setelah kewajiban pada
        Pasal 1 terpenuhi.
      </p>
      <p className="mb-2">
        Pembayaran oleh PIHAK PERTAMA dilakukan selambat-lambatnya
        H+15 (lima belas hari kalender) setelah konten diunggah dan
        seluruh dokumen pendukung diterima dengan lengkap.
      </p>
      <p className="mb-2">
        Remunerasi disepakati sebesar <b>{idr(form.feeInput)}</b> dengan
        skema{" "}
        {form.grossUp ? "gross-up (target net KOL)" : "non gross-up"}.
      </p>
      <div className="border rounded-lg p-3 mb-2">
        <p>DPP (Gross): {idr(amounts.gross)}</p>
        <p>PPh: {idr(amounts.withholding)}</p>
        <p>PPN: {idr(amounts.vatAmount)}</p>
        <p>Net ke KOL: {idr(amounts.netToKOL)}</p>
      </div>

      <p className="mb-2">Pembayaran akan ditransfer ke rekening berikut:</p>
      <div className="border rounded-lg p-3 mb-2">
        <p>Bank: {form.kolBankName || "-"}</p>
        <p>No. Rekening: {form.kolBankAcc || "-"}</p>
        <p>a.n. {form.kolBankHolder || form.kolName || "-"}</p>
      </div>

      <h3 className="mt-3 font-semibold">
        PASAL 5 - PERNYATAAN DAN JAMINAN
      </h3>
      <p className="mb-2">
        PIHAK KEDUA menyatakan akan bertindak secara profesional,
        menjaga nama baik PIHAK PERTAMA dan klien, serta tidak
        melakukan tindakan yang dapat merugikan reputasi Para Pihak.
        PIHAK KEDUA bertanggung jawab penuh atas seluruh konten,
        pernyataan, dan tindakan yang dilakukan di akun media sosial
        miliknya sepanjang terkait dengan pelaksanaan Perjanjian ini.
      </p>
      <p className="mb-2">
        PIHAK KEDUA tidak akan membocorkan rahasia dagang, data
        internal, maupun informasi lain milik PIHAK PERTAMA dan/atau
        klien tanpa persetujuan tertulis terlebih dahulu dari PIHAK
        PERTAMA. Apabila PIHAK KEDUA gagal memenuhi kewajiban pada
        Pasal 1, maka PIHAK KEDUA dinyatakan wanprestasi dan wajib
        mengembalikan remunerasi yang telah diterima (apabila ada)
        kepada PIHAK PERTAMA.
      </p>

      <h3 className="mt-3 font-semibold">PASAL 6 - PENUTUP</h3>
      <p className="mb-2">
        Segala perselisihan yang timbul dari Perjanjian ini akan
        diselesaikan terlebih dahulu secara musyawarah untuk mufakat.
        Apabila tidak tercapai mufakat, Para Pihak sepakat untuk
        memilih domisili hukum tetap pada Pengadilan di wilayah
        Jakarta Selatan.
      </p>
      <p className="mb-4">
        Perubahan atas Perjanjian ini hanya dapat dilakukan secara
        tertulis dan ditandatangani oleh Para Pihak, dan menjadi
        bagian yang tidak terpisahkan dari Perjanjian ini.
      </p>

      <div className="flex justify-between mt-6">
        <div>
          <p>Jakarta, {issueDate.toLocaleDateString("id-ID")}</p>
          <p className="font-semibold mt-6">Savvy Digital – PIHAK PERTAMA</p>
          <p className="mt-10 font-semibold">David Jr. M</p>
        </div>
        <div>
          <p>&nbsp;</p>
          <p className="font-semibold mt-6">PIHAK KEDUA</p>
          <p className="mt-10 font-semibold">
            {form.kolName || "(Nama KOL)"}
          </p>
        </div>
      </div>
    </div>
  );
}

// ================= MAIN APP =================

const DEFAULT_FORM = {
  kolName: "",
  kolAddress: "",
  kolKTP: "",
  kolNPWP: "",
  kolBankName: "",
  kolBankAcc: "",
  kolBankHolder: "",
  kolPKP: false,

  companyAddress:
    "Gedung Artha Graha, Jl. Jend. Sudirman Kav 52-53, Senayan, Jakarta",
  campaignName: "",
  deliverableDesc: "1 (satu) Video TikTok pada akun @ ...",
  spkIssueDate: todayISO(),
  uploadDeadline: todayISO(),

  feeInput: 0,
  taxScheme: "UMKM_0_5",
  pph21Rate: 0.03,
  grossUp: false,
};

export default function App() {
  const [form, setForm] = useState(DEFAULT_FORM);
  const [errors, setErrors] = useState({});
  const { pphRate, vatRate } = deriveRates(form);
  const amounts = useMemo(
    () =>
      computeAmounts({
        feeInput: form.feeInput,
        grossUp: form.grossUp,
        pphRate,
        vatRate,
      }),
    [form.feeInput, form.grossUp, pphRate, vatRate]
  );
  const [exporting, setExporting] = useState(false);

  const validate = () => {
    const e = {};
    if (!form.kolName) e.kolName = "Nama KOL wajib.";
    if (!form.kolAddress) e.kolAddress = "Alamat KTP wajib.";
    if (!form.kolKTP) e.kolKTP = "No. KTP wajib.";
    if (!form.campaignName) e.campaignName = "Nama campaign wajib.";
    if (!form.deliverableDesc) e.deliverableDesc = "Deskripsi wajib.";
    if (!form.feeInput || Number(form.feeInput) <= 0)
      e.feeInput = "Fee harus > 0.";
    if (form.taxScheme === "PPH21_custom") {
      if (
        !form.pph21Rate ||
        Number(form.pph21Rate) <= 0 ||
        Number(form.pph21Rate) > 0.5
      ) {
        e.pph21Rate = "Tarif PPh21 tidak valid.";
      }
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleChange = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleDownloadSpk = async () => {
    if (!validate()) {
      alert("Masih ada field wajib yang kosong / salah.");
      return;
    }
    try {
      setExporting(true);
      await generateSpkPdf(form, amounts);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-[#0b1b3b] text-white py-3 px-4 shadow">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <h1 className="font-bold">
            Savvy Digital — SPK Generator (Beta)
          </h1>
          <button
            onClick={handleDownloadSpk}
            disabled={exporting}
            className={`rounded-lg px-4 py-2 text-sm font-semibold ${
              exporting
                ? "bg-yellow-300 cursor-wait"
                : "bg-yellow-400 hover:bg-yellow-500"
            } text-[#0b1b3b]`}
          >
            {exporting ? "Membuat PDF…" : "Download SPK PDF"}
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto p-4 grid md:grid-cols-2 gap-4">
        {/* FORM */}
        <div className="space-y-4">
          <div className="bg-white rounded-2xl shadow p-4 border">
            <h2 className="font-semibold mb-3 text-slate-800">
              ① Data KOL
            </h2>
            <div className="space-y-3 text-sm">
              <div>
                <Label>Nama KOL *</Label>
                <Input
                  value={form.kolName}
                  onChange={(e) =>
                    handleChange("kolName", e.target.value)
                  }
                  placeholder="Nama lengkap"
                />
                <ErrorText>{errors.kolName}</ErrorText>
              </div>
              <div>
                <Label>Alamat KTP *</Label>
                <TextArea
                  rows={3}
                  value={form.kolAddress}
                  onChange={(e) =>
                    handleChange("kolAddress", e.target.value)
                  }
                />
                <ErrorText>{errors.kolAddress}</ErrorText>
              </div>
              <div>
                <Label>No. KTP *</Label>
                <Input
                  value={form.kolKTP}
                  onChange={(e) =>
                    handleChange("kolKTP", e.target.value)
                  }
                />
                <ErrorText>{errors.kolKTP}</ErrorText>
              </div>
              <div>
                <Label>No. NPWP (opsional)</Label>
                <Input
                  value={form.kolNPWP}
                  onChange={(e) =>
                    handleChange("kolNPWP", e.target.value)
                  }
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Bank</Label>
                  <Input
                    value={form.kolBankName}
                    onChange={(e) =>
                      handleChange("kolBankName", e.target.value)
                    }
                  />
                </div>
                <div>
                  <Label>No. Rekening</Label>
                  <Input
                    value={form.kolBankAcc}
                    onChange={(e) =>
                      handleChange("kolBankAcc", e.target.value)
                    }
                  />
                </div>
                <div>
                  <Label>a.n.</Label>
                  <Input
                    value={form.kolBankHolder}
                    onChange={(e) =>
                      handleChange("kolBankHolder", e.target.value)
                    }
                  />
                </div>
                <div className="flex items-center gap-2 mt-4">
                  <input
                    type="checkbox"
                    checked={form.kolPKP}
                    onChange={(e) =>
                      handleChange("kolPKP", e.target.checked)
                    }
                  />
                  <span className="text-xs">
                    KOL berstatus PKP (kena PPN)
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow p-4 border">
            <h2 className="font-semibold mb-3 text-slate-800">
              ② Campaign & Pekerjaan
            </h2>
            <div className="space-y-3 text-sm">
              <div>
                <Label>Nama Campaign *</Label>
                <Input
                  value={form.campaignName}
                  onChange={(e) =>
                    handleChange("campaignName", e.target.value)
                  }
                />
                <ErrorText>{errors.campaignName}</ErrorText>
              </div>
              <div>
                <Label>Alamat Savvy / Klien</Label>
                <TextArea
                  rows={2}
                  value={form.companyAddress}
                  onChange={(e) =>
                    handleChange("companyAddress", e.target.value)
                  }
                />
              </div>
              <div>
                <Label>Deskripsi Pekerjaan *</Label>
                <TextArea
                  rows={2}
                  value={form.deliverableDesc}
                  onChange={(e) =>
                    handleChange("deliverableDesc", e.target.value)
                  }
                />
                <ErrorText>{errors.deliverableDesc}</ErrorText>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Tanggal SPK</Label>
                  <Input
                    type="date"
                    value={form.spkIssueDate}
                    onChange={(e) =>
                      handleChange("spkIssueDate", e.target.value)
                    }
                  />
                </div>
                <div>
                  <Label>Deadline Upload Konten</Label>
                  <Input
                    type="date"
                    value={form.uploadDeadline}
                    onChange={(e) =>
                      handleChange("uploadDeadline", e.target.value)
                    }
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow p-4 border">
            <h2 className="font-semibold mb-3 text-slate-800">
              ③ Fee & Pajak
            </h2>
            <div className="space-y-3 text-sm">
              <div>
                <Label>
                  Nominal (bruto / net tergantung skema) *
                </Label>
                <Input
                  type="number"
                  value={form.feeInput}
                  onChange={(e) =>
                    handleChange(
                      "feeInput",
                      e.target.value ? Number(e.target.value) : 0
                    )
                  }
                />
                <ErrorText>{errors.feeInput}</ErrorText>
              </div>
              <div>
                <Label>Skema Pajak</Label>
                <Select
                  value={form.taxScheme}
                  onChange={(e) =>
                    handleChange("taxScheme", e.target.value)
                  }
                >
                  <option value="UMKM_0_5">
                    UMKM 0.5% (PPh Final)
                  </option>
                  <option value="PPH23_2">PPh23 2%</option>
                  <option value="PPH21_custom">
                    PPh21 custom (isi manual)
                  </option>
                  <option value="NONE">Tanpa PPh</option>
                </Select>
              </div>
              {form.taxScheme === "PPH21_custom" && (
                <div>
                  <Label>Tarif PPh21 (misal 0.05 = 5%)</Label>
                  <Input
                    type="number"
                    step="0.001"
                    value={form.pph21Rate}
                    onChange={(e) =>
                      handleChange(
                        "pph21Rate",
                        e.target.value ? Number(e.target.value) : 0
                      )
                    }
                  />
                  <ErrorText>{errors.pph21Rate}</ErrorText>
                </div>
              )}
              <div className="flex items-center gap-2 mt-2">
                <input
                  type="checkbox"
                  checked={form.grossUp}
                  onChange={(e) =>
                    handleChange("grossUp", e.target.checked)
                  }
                />
                <span className="text-xs">
                  Gross-up (angka di atas = net yang mendarat ke KOL)
                </span>
              </div>
              <div className="mt-2 border rounded-lg p-3 bg-slate-50 text-xs">
                <p>DPP (Gross): {idr(amounts.gross)}</p>
                <p>PPh: {idr(amounts.withholding)}</p>
                <p>PPN: {idr(amounts.vatAmount)}</p>
                <p>Net ke KOL: {idr(amounts.netToKOL)}</p>
              </div>
            </div>
          </div>
        </div>

        {/* PREVIEW */}
        <div className="space-y-4">
          <SpkPreviewCard form={form} amounts={amounts} />
        </div>
      </main>
    </div>
  );
}
