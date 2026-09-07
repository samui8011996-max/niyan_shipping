// ===================================================================
// 離島出貨貼紙 PDF(100mm x 150mm,寄件人固定、收件人放大放下面)
// 多筆訂單時壓成同一個 PDF,一筆一頁
// ===================================================================
function wrapCanvasText(ctx, text, maxWidth) {
  const chars = String(text ?? "").split("");
  const lines = [];
  let line = "";
  for (const ch of chars) {
    const test = line + ch;
    if (line && ctx.measureText(test).width > maxWidth) {
      lines.push(line);
      line = ch;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines.length > 0 ? lines : [""];
}

async function ensureFontsLoaded() {
  if (!document.fonts) return;
  try {
    await Promise.all([
      document.fonts.load('400 100px "Noto Sans TC"'),
      document.fonts.load('700 100px "Noto Sans TC"'),
    ]);
    await document.fonts.ready;
  } catch (_) { /* 字型載入失敗就用瀏覽器預設字型,不擋流程 */ }
}

function drawOffshoreLabel(row) {
  const DPI = 300;
  const mmToPx = mm => Math.round(mm / 25.4 * DPI);
  const W = mmToPx(OFFSHORE_LABEL_MM.w);
  const H = mmToPx(OFFSHORE_LABEL_MM.h);

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#000000";
  ctx.textBaseline = "top";

  const marginX = mmToPx(8);
  const contentW = W - marginX * 2;
  let y = mmToPx(8);

  // ---- 寄件人(固定資訊,字較小) ----
  const senderFontPx = mmToPx(3.6);
  ctx.font = `${senderFontPx}px "Noto Sans TC", sans-serif`;
  [
    "寄件人",
    OFFSHORE_SENDER.name,
    `${OFFSHORE_SENDER.zip} ${OFFSHORE_SENDER.address}`,
    OFFSHORE_SENDER.phone,
  ].forEach(line => {
    wrapCanvasText(ctx, line, contentW).forEach(l => {
      ctx.fillText(l, marginX, y);
      y += senderFontPx * 1.35;
    });
  });

  // ---- 分隔線 ----
  y += mmToPx(6);
  ctx.strokeStyle = "#000000";
  ctx.lineWidth = mmToPx(0.3);
  ctx.beginPath();
  ctx.moveTo(marginX, y);
  ctx.lineTo(W - marginX, y);
  ctx.stroke();
  y += mmToPx(10);

  // ---- 收件人(放大,放在寄件人下面) ----
  const recvLabelFontPx = mmToPx(6);
  const recvFontPx = mmToPx(8.5);

  ctx.font = `bold ${recvLabelFontPx}px "Noto Sans TC", sans-serif`;
  ctx.fillText("收件人", marginX, y);
  y += recvLabelFontPx * 1.4;

  ctx.font = `bold ${recvFontPx}px "Noto Sans TC", sans-serif`;
  const name = String(row["收件人姓名"] ?? "").trim();
  wrapCanvasText(ctx, name, contentW).forEach(l => {
    ctx.fillText(l, marginX, y);
    y += recvFontPx * 1.4;
  });

  y += mmToPx(4);
  const addr = String(row["配送地址"] ?? "").trim();
  const zip = extractOffshoreZip(addr);
  const addrWithZip = zip ? `${zip} ${addr}` : addr;
  wrapCanvasText(ctx, addrWithZip, contentW).forEach(l => {
    ctx.fillText(l, marginX, y);
    y += recvFontPx * 1.4;
  });

  y += mmToPx(4);
  const phone = String(row["收件人聯絡電話"] ?? "").trim();
  wrapCanvasText(ctx, phone, contentW).forEach(l => {
    ctx.fillText(l, marginX, y);
    y += recvFontPx * 1.4;
  });

  // ---- 備註(小字,訂單編號 + 訂購商品,跟黑貓備註同一套 _備註) ----
  y += mmToPx(6);
  const noteLabelFontPx = mmToPx(3.6);
  ctx.font = `bold ${noteLabelFontPx}px "Noto Sans TC", sans-serif`;
  ctx.fillText("備註", marginX, y);
  y += noteLabelFontPx * 1.4;

  const noteFontPx = mmToPx(3.2);
  ctx.font = `${noteFontPx}px "Noto Sans TC", sans-serif`;
  const orderId = String(row["訂單編號"] ?? "").trim();
  const productNote = String(row["_備註"] ?? "").trim();
  [
    `訂單編號:${orderId}`,
    `${productNote}`,
  ].forEach(line => {
    wrapCanvasText(ctx, line, contentW).forEach(l => {
      ctx.fillText(l, marginX, y);
      y += noteFontPx * 1.35;
    });
  });

  return canvas;
}

async function generateOffshorePdf() {
  if (!loadedRows) return;
  const rows = loadedRows.filter(r => r["_離島"]);
  if (rows.length === 0) {
    setStatus("status", "warn", "⚠ 目前沒有離島•郵局的訂單");
    return;
  }
  if (!window.jspdf || !window.jspdf.jsPDF) {
    setStatus("status", "error", "✗ PDF 產生元件載入失敗,請檢查網路連線後重新整理頁面");
    return;
  }

  const btn = document.getElementById("offshorePdfBtn");
  btn.disabled = true;
  setStatus("status", "loading", `產生離島貼紙 PDF 中(${rows.length} 筆)…`);

  try {
    await ensureFontsLoaded();

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({
      orientation: "portrait",
      unit: "mm",
      format: [OFFSHORE_LABEL_MM.w, OFFSHORE_LABEL_MM.h],
    });

    rows.forEach((row, idx) => {
      if (idx > 0) doc.addPage([OFFSHORE_LABEL_MM.w, OFFSHORE_LABEL_MM.h], "portrait");
      const canvas = drawOffshoreLabel(row);
      const imgData = canvas.toDataURL("image/jpeg", 0.92);
      doc.addImage(imgData, "JPEG", 0, 0, OFFSHORE_LABEL_MM.w, OFFSHORE_LABEL_MM.h);
    });

    doc.save(`離島出貨貼紙_${todayStr()}.pdf`);
    setStatus("status", "success", `✓ 已產生離島貼紙 PDF(共 ${rows.length} 頁)`);
  } catch (e) {
    setStatus("status", "error", `✗ 產生 PDF 失敗:${e.message}`);
    console.error(e);
  } finally {
    btn.disabled = false;
  }
}
