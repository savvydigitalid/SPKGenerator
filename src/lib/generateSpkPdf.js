import savvyLogo from "../assets/savvy-logo.svg";
import { deriveRates, idr, makeSpkNumber, parseISODateAsLocal } from "./spk";

async function loadImageDataUrl(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Canvas 2D context unavailable"));
        return;
      }
      ctx.drawImage(image, 0, 0);
      resolve(canvas.toDataURL("image/png"));
    };
    image.onerror = () => reject(new Error("Failed to load logo image"));
    image.src = src;
  });
}

// ================= PDF SPK (jsPDF, anti kepotong) =================

export async function generateSpkPdf(form, amounts) {
  const { jsPDF } = await import("jspdf");

  const doc = new jsPDF("p", "pt", "a4");
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  const marginX = 55;
  const marginY = 120;
  const usableWidth = pageWidth - marginX * 2;

  const lineGap = 14;
  const boxLineHeight = 13;

  let y = marginY;
  const bottomLimit = pageHeight - marginY - 20; // buffer

  let logoDataUrl = null;
  try {
    logoDataUrl = await loadImageDataUrl(savvyLogo);
  } catch {
    logoDataUrl = null;
  }

  const drawHeader = () => {
    if (logoDataUrl) {
      doc.addImage(logoDataUrl, "PNG", marginX, 36, 92, 46);
    }

    doc.setFont("Helvetica", "bold");
    doc.setTextColor(20, 20, 20);
    doc.setFontSize(11);
    doc.text("Savvy Digital", pageWidth - marginX, 50, { align: "right" });
    doc.setFont("Helvetica", "normal");
    doc.setFontSize(9.5);
    doc.text(
      "Gedung Artha Graha, Jl. Jend. Sudirman Kav 52-53, Senayan, Jakarta",
      pageWidth - marginX,
      66,
      { align: "right", maxWidth: 260 }
    );
    doc.setDrawColor(205);
    doc.setLineWidth(1);
    doc.line(marginX, 92, pageWidth - marginX, 92);
  };

  const addTextBlock = (text, options = {}) => {
    const {
      bold = false,
      align = "left",
      size = 11,
      lineHeight = lineGap,
    } = options;

    doc.setFont("Times", bold ? "bold" : "normal");
    doc.setFontSize(size);

    const lines = doc.splitTextToSize(text, usableWidth);

    // Widow/orphan control: kalau sisa space cuma muat 1 baris,
    // dan paragraf >1 baris, mending pindah ke halaman baru.
    const remainingLinesFit = Math.floor((bottomLimit - y) / lineHeight);
    if (lines.length > 1 && remainingLinesFit > 0 && remainingLinesFit <= 1) {
      doc.addPage();
      drawHeader();
      y = marginY;
    }

    lines.forEach((line) => {
      if (y + lineHeight > bottomLimit) {
        doc.addPage();
        drawHeader();
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
      drawHeader();
      y = marginY;
    }
    doc.setFont("Times", "bold");
    doc.setFontSize(12);
    doc.text(title.toUpperCase(), marginX, y);
    y += lineGap;
  };

  const addDetailLines = (lines) => {
    const indentX = marginX + 10;
    doc.setFont("Times", "normal");
    doc.setFontSize(10.5);
    lines.forEach((line) => {
      const wrapped = doc.splitTextToSize(line, usableWidth - 20);
      wrapped.forEach((wLine) => {
        if (y + boxLineHeight > bottomLimit) {
          doc.addPage();
          drawHeader();
          y = marginY;
        }
        doc.text(wLine, indentX, y);
        y += boxLineHeight;
      });
    });
    y += 6;
  };

  // ====== ISI SPK ======
  drawHeader();

  const issueDate = parseISODateAsLocal(form.spkIssueDate);
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
  doc.setFont("Times", "bold");
  doc.setFontSize(14);
  doc.text("SURAT PERJANJIAN KERJA SAMA", pageWidth / 2, y, {
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
    `Pada hari ${issueDateStr} bertempat di Jakarta Selatan dibuat dan ditandatangani Surat Perjanjian Kerja Sama ("Perjanjian"), oleh dan antara:`
  );

  addTextBlock(
    `David Jr. M, selaku Direktur Savvy Digital beralamat di ${form.companyAddress}, mewakili klien dalam kampanye ${form.campaignName ||
      "-"}, selanjutnya disebut PIHAK PERTAMA; dengan:`
  );

  addDetailLines([
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
    )}. Unggah konten yang telah disetujui PIHAK PERTAMA paling lambat tanggal ${parseISODateAsLocal(
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

  addDetailLines([
    `DPP (Gross): ${idr(amounts.gross)}`,
    `PPh (${(pphRate * 100).toFixed(2)}%): ${idr(amounts.withholding)}`,
    `PPN (${(vatRate * 100).toFixed(2)}%): ${idr(amounts.vatAmount)}`,
    `Net ke KOL: ${idr(amounts.netToKOL)}`,
  ]);

  addTextBlock(`Pembayaran akan ditransfer ke rekening berikut:`);

  addDetailLines([
    `Bank: ${form.kolBankName || "-"}`,
    `No. Rekening: ${form.kolBankAcc || "-"}`,
    `a.n. ${form.kolBankHolder || form.kolName || "-"}`,
  ]);

  // PASAL 3
  addSectionTitle("Pasal 3 - Pernyataan dan Jaminan");
  addTextBlock(
    `PIHAK KEDUA menyatakan akan bertindak secara profesional, menjaga nama baik PIHAK PERTAMA dan klien, serta tidak melakukan tindakan yang dapat merugikan reputasi Para Pihak. PIHAK KEDUA bertanggung jawab penuh atas seluruh konten, pernyataan, dan tindakan yang dilakukan di akun media sosial miliknya sepanjang terkait dengan pelaksanaan Perjanjian ini.`
  );
  addTextBlock(
    `PIHAK KEDUA tidak akan membocorkan rahasia dagang, data internal, maupun informasi lain milik PIHAK PERTAMA dan/atau klien tanpa persetujuan tertulis terlebih dahulu dari PIHAK PERTAMA. Apabila PIHAK KEDUA gagal memenuhi kewajiban pada Pasal 1, maka PIHAK KEDUA dinyatakan wanprestasi dan wajib mengembalikan remunerasi yang telah diterima (apabila ada) kepada PIHAK PERTAMA.`
  );

  // PASAL 4
  addSectionTitle("Pasal 4 - Penutup");
  addTextBlock(
    `Segala perselisihan yang timbul dari Perjanjian ini akan diselesaikan terlebih dahulu secara musyawarah untuk mufakat. Apabila tidak tercapai mufakat, Para Pihak sepakat untuk memilih domisili hukum tetap pada Pengadilan di wilayah Jakarta Selatan.`
  );
  addTextBlock(
    `Perubahan atas Perjanjian ini hanya dapat dilakukan secara tertulis dan ditandatangani oleh Para Pihak, dan menjadi bagian yang tidak terpisahkan dari Perjanjian ini.`
  );

  // Tanda tangan
  if (y + 80 > bottomLimit) {
    doc.addPage();
    drawHeader();
    y = marginY;
  }

  const dateStr = issueDate.toLocaleDateString("id-ID");
  addTextBlock(`Jakarta, ${dateStr}`);

  if (y + 80 > bottomLimit) {
    doc.addPage();
    drawHeader();
    y = marginY;
  }

  doc.setFont("Times", "normal");
  doc.setFontSize(11);

  const leftX = marginX;
  const rightX = marginX + usableWidth / 2 + 40;

  if (y + 60 > bottomLimit) {
    doc.addPage();
    drawHeader();
    y = marginY;
  }

  doc.text("Savvy Digital – PIHAK PERTAMA", leftX, y);
  doc.text("PIHAK KEDUA", rightX, y);
  y += 60;

  doc.setFont("Times", "bold");
  doc.text("David Jr. M", leftX, y);
  doc.text(form.kolName || "(Nama KOL)", rightX, y);

  const filenameSafe = `SPK_${form.kolName || "KOL"}_${form.campaignName ||
    "Campaign"}.pdf`;
  doc.save(filenameSafe);
}
