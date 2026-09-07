// ===================================================================
// Tab 2: 物流單號回填 (保留原邏輯)
// ===================================================================
async function handleLineTemplate(file) {
  setStatus("logisticsStatus", "loading", "讀取 LINE 模板中…");
  lastUnmatchedOrders = [];
  unmatchedDeleteSet.clear();
  renderUnmatchedSection();
  try {
    const data = await file.arrayBuffer();
    const wb = XLSX.read(data, { type: "array", cellStyles: true });
    const sheetName = wb.SheetNames.includes("Template") ? "Template" : wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
    if (aoa.length < 2) throw new Error("LINE 模板沒有訂單");

    const headers = aoa[0];
    const orderIdCol = headers.findIndex(h => String(h).trim() === "訂單編號");
    const carrierCol = headers.findIndex(h => String(h).includes("貨運業者代碼"));
    const trackingCol = headers.findIndex(h => String(h).includes("物流單編號"));
    const productCol = headers.findIndex(h => String(h).includes("商品明細"));

    if (orderIdCol < 0) throw new Error("找不到「訂單編號」欄位");
    if (carrierCol < 0) throw new Error("找不到「貨運業者代碼」欄位");
    if (trackingCol < 0) throw new Error("找不到「物流單編號」欄位");

    const orders = [];
    for (let i = 1; i < aoa.length; i++) {
      const oid = String(aoa[i][orderIdCol] ?? "").trim();
      if (!oid) continue;
      const product = productCol >= 0 ? String(aoa[i][productCol] ?? "").trim() : "";
      orders.push({ rowIdx: i, orderId: oid, product });
    }

    lineTemplateData = { wb, sheetName, orders, carrierCol, trackingCol };
    document.getElementById("stat-line-total").textContent = orders.length;
    checkBothLoaded();
    setStatus("logisticsStatus", "success", `✓ LINE 模板已載入 ${orders.length} 筆`);
  } catch (e) {
    lineTemplateData = null;
    setStatus("logisticsStatus", "error", `✗ LINE 模板讀取失敗:${e.message}`);
    document.getElementById("stat-line-total").textContent = "—";
    document.getElementById("logisticsRunBtn").disabled = true;
  }
}

async function handleBcDetail(file) {
  setStatus("logisticsStatus", "loading", "讀取黑貓明細中…");
  lastUnmatchedOrders = [];
  unmatchedDeleteSet.clear();
  renderUnmatchedSection();
  try {
    const data = await file.arrayBuffer();
    const wb = XLSX.read(data, { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

    let headerRow = -1;
    for (let i = 0; i < Math.min(10, aoa.length); i++) {
      const row = aoa[i].map(v => String(v ?? ""));
      if (row.some(v => v.includes("訂單編號")) && row.some(v => v.includes("託運單號"))) {
        headerRow = i;
        break;
      }
    }
    if (headerRow < 0) throw new Error("找不到「訂單編號」+「託運單號」的表頭列");

    const headers = aoa[headerRow].map(v => String(v ?? "").trim());
    const orderIdCol = headers.findIndex(h => h.includes("訂單編號"));
    const trackingCol = headers.findIndex(h => h.includes("託運單號"));

    const map = new Map();
    for (let i = headerRow + 1; i < aoa.length; i++) {
      const oid = String(aoa[i][orderIdCol] ?? "").trim();
      const track = String(aoa[i][trackingCol] ?? "").trim();
      if (oid && track) map.set(oid, track);
    }

    bcDetailData = map;
    checkBothLoaded();
    setStatus("logisticsStatus", "success", `✓ 黑貓明細已載入 ${map.size} 筆託運單號`);
  } catch (e) {
    bcDetailData = null;
    setStatus("logisticsStatus", "error", `✗ 黑貓明細讀取失敗:${e.message}`);
    document.getElementById("logisticsRunBtn").disabled = true;
  }
}

function checkBothLoaded() {
  if (lineTemplateData && bcDetailData) {
    let matched = 0;
    const unmatchedOrders = [];
    lineTemplateData.orders.forEach(o => {
      if (bcDetailData.has(o.orderId)) matched++;
      else unmatchedOrders.push(o);
    });
    const unmatched = unmatchedOrders.length;
    document.getElementById("stat-matched").textContent = matched;
    document.getElementById("stat-unmatched").textContent = unmatched;

    lastUnmatchedOrders = unmatchedOrders;
    // 重新載入檔案時,把勾選記錄限縮到還存在的未配對訂單(避免殘留舊的勾選狀態)
    const stillUnmatchedIds = new Set(unmatchedOrders.map(o => o.orderId));
    unmatchedDeleteSet = new Set([...unmatchedDeleteSet].filter(id => stillUnmatchedIds.has(id)));
    renderUnmatchedSection();

    if (matched > 0) {
      document.getElementById("logisticsRunBtn").disabled = false;
      const msg = unmatched > 0
        ? `✓ 兩個檔案都已載入,配對成功 ${matched} 筆,${unmatched} 筆未配對`
        : `✓ 兩個檔案都已載入,全部 ${matched} 筆配對成功`;
      setStatus("logisticsStatus", unmatched > 0 ? "warn" : "success", msg);
    } else {
      document.getElementById("logisticsRunBtn").disabled = true;
      setStatus("logisticsStatus", "error", "✗ 沒有任何訂單配對成功,檢查兩個檔案是否正確");
    }
  }
}

function renderUnmatchedSection() {
  const section = document.getElementById("unmatchedSection");
  const hint = document.getElementById("unmatchedHint");
  const list = document.getElementById("unmatchedList");

  if (lastUnmatchedOrders.length === 0) {
    section.style.display = "none";
    list.innerHTML = "";
    return;
  }

  section.style.display = "";
  hint.textContent = unmatchedDeleteSet.size > 0
    ? `共 ${lastUnmatchedOrders.length} 筆 · 已勾選 ${unmatchedDeleteSet.size} 筆待刪除`
    : `共 ${lastUnmatchedOrders.length} 筆`;

  list.innerHTML = lastUnmatchedOrders.map(o => {
    const safeId = escapeHtml(o.orderId);
    const checked = unmatchedDeleteSet.has(o.orderId) ? "checked" : "";
    const product = cleanFreeText(o.product);
    return `
      <div class="problem-item">
        <div class="problem-item-main">
          <div class="problem-item-row1">
            <span class="pi-id">${safeId}</span>
          </div>
          ${product ? `<div class="pi-note">${escapeHtml(product)}</div>` : ""}
        </div>
        <label class="pi-delete-check">
          <input type="checkbox" data-order-id="${safeId}" ${checked} onchange="onUnmatchedCheckChange(this)">
          匯出時刪除
        </label>
      </div>
    `;
  }).join("");
}

function onUnmatchedCheckChange(el) {
  const orderId = el.dataset.orderId;
  if (el.checked) unmatchedDeleteSet.add(orderId);
  else unmatchedDeleteSet.delete(orderId);

  const hint = document.getElementById("unmatchedHint");
  hint.textContent = unmatchedDeleteSet.size > 0
    ? `共 ${lastUnmatchedOrders.length} 筆 · 已勾選 ${unmatchedDeleteSet.size} 筆待刪除`
    : `共 ${lastUnmatchedOrders.length} 筆`;
}

function toggleAllUnmatched(checked) {
  if (checked) {
    lastUnmatchedOrders.forEach(o => unmatchedDeleteSet.add(o.orderId));
  } else {
    unmatchedDeleteSet.clear();
  }
  renderUnmatchedSection();
}

function generateLogistics() {
  if (!lineTemplateData || !bcDetailData) return;
  setStatus("logisticsStatus", "loading", "產生 LINE 物流單號表中…");

  setTimeout(() => {
    try {
      const { wb, sheetName, orders, carrierCol, trackingCol } = lineTemplateData;
      const origWs = wb.Sheets[sheetName];
      const aoa = XLSX.utils.sheet_to_json(origWs, { header: 1, defval: "" });
      const headerRow = aoa[0];
      const colCount = headerRow.length;

      const matched = [];
      const unmatched = [];
      let deletedCount = 0;
      orders.forEach(o => {
        const track = bcDetailData.get(o.orderId);
        if (!track && unmatchedDeleteSet.has(o.orderId)) {
          // 使用者勾選「匯出時刪除」的未配對訂單,直接跳過、不寫進檔案
          deletedCount++;
          return;
        }

        const rowData = aoa[o.rowIdx].slice();
        while (rowData.length < colCount) rowData.push("");

        if (track) {
          rowData[carrierCol] = "T_CAT";
          rowData[trackingCol] = String(track);
          matched.push(rowData);
        } else {
          rowData[carrierCol] = "";
          rowData[trackingCol] = "";
          unmatched.push(rowData);
        }
      });

      const newAoa = [headerRow, ...matched, ...unmatched];
      const newWs = XLSX.utils.aoa_to_sheet(newAoa);

      const redFill = { patternType: "solid", fgColor: { rgb: "FFCDD2" } };
      const redFont = { color: { rgb: "B71C1C" }, bold: true };

      for (let i = 0; i < unmatched.length; i++) {
        const excelRow = matched.length + 1 + i;
        for (let c = 0; c < colCount; c++) {
          const addr = XLSX.utils.encode_cell({ r: excelRow, c });
          if (!newWs[addr]) newWs[addr] = { t: "s", v: "" };
          newWs[addr].s = { fill: redFill, font: redFont };
        }
      }

      if (origWs["!cols"]) newWs["!cols"] = origWs["!cols"];
      newWs["!freeze"] = { xSplit: 0, ySplit: 1 };
      wb.Sheets[sheetName] = newWs;

      const today = todayStr();
      const filename = `LINE物流單號_${today}.xlsx`;
      XLSX.writeFile(wb, filename, { cellStyles: true, bookType: "xlsx" });

      let msg = `✓ 已下載:${filename}  (填入 ${matched.length} 筆)`;
      if (unmatched.length > 0) msg += `,另有 ${unmatched.length} 筆未對應(已紅色反白排在最下面)`;
      if (deletedCount > 0) msg += `,已刪除 ${deletedCount} 筆勾選的未配對訂單`;
      setStatus("logisticsStatus", "success", msg);
    } catch (e) {
      setStatus("logisticsStatus", "error", `✗ 匯出失敗:${e.message}`);
      console.error(e);
    }
  }, 50);
}

