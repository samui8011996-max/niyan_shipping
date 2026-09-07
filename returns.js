// ===================================================================
// 包裹退貨(Tab 4)
// ===================================================================
// 格式參考「包裹退貨.xlsx」:line禮物/蝦皮/mo 三個平台各自獨立(蝦皮、mo 沒有電聯欄位)
const RETURN_PLATFORMS = ["line禮物", "蝦皮", "mo"];
let returnListCache = { "line禮物": [], "蝦皮": [], "mo": [] };   // { rowIndex, date, orderId, trackingNo, reason, result, contact1~4 }

// 結果欄位固定四種狀態:未結案 是還在處理中,已退貨/結案/移除 算終結狀態
const RETURN_RESULT_OPTIONS = ["未結案", "已退貨", "結案", "移除"];
const RETURN_RESULT_BADGES = {
  "未結案": { cls: "pi-open",     icon: "⏳" },
  "已退貨": { cls: "pi-returned", icon: "📦" },
  "結案":   { cls: "pi-result",   icon: "✅" },
  "移除":   { cls: "pi-removed",  icon: "🗑" },
};
const RETURN_CLOSED_RESULTS = new Set(["結案", "已退貨", "移除"]);

function currentReturnPlatform() {
  const el = document.querySelector('input[name="returnPlatform"]:checked');
  return el ? el.value : "line禮物";
}

// 未結案 = 結果不是「結案/已退貨/移除」這幾種終結狀態(含空白)
function isReturnOpen(record) {
  const v = String(record.result || "").trim();
  return !RETURN_CLOSED_RESULTS.has(v);
}

function isReturnReturned(record) {
  return String(record.result || "").trim() === "已退貨";
}

function returnResultBadgeHtml(result) {
  const v = String(result || "").trim();
  if (!v) return `<span class="pi-open">⏳ 未結案</span>`;
  const b = RETURN_RESULT_BADGES[v];
  if (b) return `<span class="${b.cls}">${b.icon} ${escapeHtml(v)}</span>`;
  // 舊資料裡的自由文字結果(例如「蝦皮退款結案」),沒有對應到固定選項就照原文顯示
  return `<span class="pi-result">${escapeHtml(v)}</span>`;
}

function currentReturnFilter() {
  const el = document.querySelector('input[name="returnFilter"]:checked');
  return el ? el.value : "open";
}

function onReturnFilterChange() {
  renderReturnList();
}

function onReturnPlatformChange() {
  const platform = currentReturnPlatform();
  document.getElementById("returnContactFields").style.display = (platform === "line禮物") ? "" : "none";
  document.getElementById("returnListTitle").textContent = `${platform} 退貨清單`;
  renderReturnList();
}

function submitReturn() {
  const url = getGsUrl();
  if (!url) {
    setStatus("returnStatus", "warn", "⚠ 尚未設定 Apps Script 網址,請先點右上「⚙ 設定」");
    openSettings();
    return;
  }

  const platform = currentReturnPlatform();
  const orderId = document.getElementById("returnOrderId").value.trim();
  if (!orderId) {
    setStatus("returnStatus", "error", "✗ 請輸入訂單編號");
    document.getElementById("returnOrderId").focus();
    return;
  }

  const resultEl = document.querySelector('input[name="returnResult"]:checked');
  const record = {
    date: document.getElementById("returnDate").value.trim(),
    orderId,
    trackingNo: document.getElementById("returnTrackingNo").value.trim(),
    reason: document.getElementById("returnReason").value.trim(),
    result: resultEl ? resultEl.value : "未結案",
  };
  if (platform === "line禮物") {
    record.contact1 = document.getElementById("returnContact1").value.trim();
    record.contact2 = document.getElementById("returnContact2").value.trim();
    record.contact3 = document.getElementById("returnContact3").value.trim();
    record.contact4 = document.getElementById("returnContact4").value.trim();
  }

  setStatus("returnStatus", "loading", "上傳包裹退貨紀錄中…");
  document.getElementById("returnSubmitBtn").disabled = true;

  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action: "addReturn", platform, record }),
  })
    .then(r => r.json())
    .then(data => {
      if (data.ok) {
        const msg = data.updated
          ? `✓ 已更新退貨紀錄 ${orderId}`
          : `✓ 已新增退貨紀錄 ${orderId}`;
        setStatus("returnStatus", "success", msg);
        clearReturnForm();
        loadReturns();
      } else {
        setStatus("returnStatus", "error", `✗ 上傳失敗:${data.error || "未知錯誤"}`);
      }
    })
    .catch(err => {
      setStatus("returnStatus", "error", `✗ 上傳失敗:${err.message}`);
    })
    .finally(() => {
      document.getElementById("returnSubmitBtn").disabled = false;
    });
}

function clearReturnForm() {
  document.getElementById("returnDate").value = todayStr("-");
  document.getElementById("returnOrderId").value = "";
  document.getElementById("returnTrackingNo").value = "";
  document.getElementById("returnReason").value = "";
  const defaultResult = document.querySelector('input[name="returnResult"][value="未結案"]');
  if (defaultResult) defaultResult.checked = true;
  ["returnContact1", "returnContact2", "returnContact3", "returnContact4"].forEach(id => {
    document.getElementById(id).value = "";
  });
  document.getElementById("returnOrderId").focus();
}

function loadReturns() {
  const url = getGsUrl();
  if (!url) {
    document.getElementById("returnListHint").textContent = "尚未設定 Apps Script 網址";
    document.getElementById("returnList").innerHTML =
      `<div class="problem-empty">請先點右上「⚙ 設定」設定網址。</div>`;
    return;
  }

  document.getElementById("returnListHint").textContent = "載入中…";

  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action: "getReturns" }),
  })
    .then(r => r.json())
    .then(data => {
      if (!data.ok) throw new Error(data.error || "讀取失敗");
      returnListCache = data.returns || { "line禮物": [], "蝦皮": [], "mo": [] };
      const total = RETURN_PLATFORMS.reduce((s, p) => s + (returnListCache[p] || []).length, 0);
      const openTotal = RETURN_PLATFORMS.reduce(
        (s, p) => s + (returnListCache[p] || []).filter(isReturnOpen).length, 0
      );
      const statEl = document.getElementById("stat-return-total");
      if (statEl) statEl.textContent = total;
      const statOpenEl = document.getElementById("stat-return-open");
      if (statOpenEl) statOpenEl.textContent = openTotal;
      renderReturnList();
    })
    .catch(err => {
      document.getElementById("returnListHint").textContent = "載入失敗";
      document.getElementById("returnList").innerHTML =
        `<div class="problem-empty">✗ 載入失敗:${err.message}</div>`;
    });
}

function renderReturnList() {
  const platform = currentReturnPlatform();
  const filter = currentReturnFilter();
  const list = returnListCache[platform] || [];
  const container = document.getElementById("returnList");
  const hint = document.getElementById("returnListHint");

  // 更新「已結案/未結案/已退貨」篩選籤上的數量
  const openCount = list.filter(isReturnOpen).length;
  const closedCount = list.length - openCount;
  const returnedCount = list.filter(isReturnReturned).length;
  const openCountEl = document.getElementById("returnOpenCount");
  const closedCountEl = document.getElementById("returnClosedCount");
  const returnedCountEl = document.getElementById("returnReturnedCount");
  if (openCountEl) openCountEl.textContent = `(${openCount})`;
  if (closedCountEl) closedCountEl.textContent = `(${closedCount})`;
  if (returnedCountEl) returnedCountEl.textContent = `(${returnedCount})`;

  let filtered, filterLabel;
  if (filter === "closed") {
    filtered = list.filter(r => !isReturnOpen(r));
    filterLabel = "已結案";
  } else if (filter === "returned") {
    filtered = list.filter(isReturnReturned);
    filterLabel = "已退貨";
  } else {
    filtered = list.filter(isReturnOpen);
    filterLabel = "未結案";
  }

  if (list.length === 0) {
    hint.textContent = `${platform} 目前沒有退貨紀錄`;
    container.innerHTML = `<div class="problem-empty">${platform} 目前沒有退貨紀錄 🎉</div>`;
    return;
  }
  if (filtered.length === 0) {
    hint.textContent = `${platform} 沒有${filterLabel}的紀錄`;
    container.innerHTML = `<div class="problem-empty">${platform} 目前沒有${filterLabel}的退貨紀錄 🎉</div>`;
    return;
  }

  hint.textContent = `共 ${list.length} 筆 · ${filterLabel} ${filtered.length} 筆`;

  // 由新到舊排序(rowIndex 越大代表越新加)
  const sorted = filtered.slice().sort((a, b) => b.rowIndex - a.rowIndex);

  container.innerHTML = sorted.map(r => {
    const safeId = escapeHtml(r.orderId || "");
    const safeTracking = escapeHtml(r.trackingNo || "");
    const safeDate = escapeHtml(r.date || "");
    const safeReason = escapeHtml(r.reason || "");

    const resultHtml = returnResultBadgeHtml(r.result);
    const trackingHtml = safeTracking ? `<span class="pi-tracking">${safeTracking}</span>` : "";
    const reasonHtml = safeReason ? `<div class="pi-note">${safeReason}</div>` : "";

    const contactLines = [];
    if (platform === "line禮物") {
      [["第一次電聯", r.contact1], ["第二次電聯", r.contact2], ["第三次電聯", r.contact3], ["第四次電聯", r.contact4]]
        .forEach(([label, val]) => {
          const v = String(val || "").trim();
          if (v) contactLines.push(`<div class="pi-note">${escapeHtml(label)}:${escapeHtml(v)}</div>`);
        });
    }

    return `
      <div class="problem-item" data-row="${r.rowIndex}" data-id="${safeId}">
        <div class="problem-item-main">
          <div class="problem-item-row1">
            <span class="pi-id">${safeId}</span>
            ${trackingHtml}
            ${resultHtml}
            <span class="pi-time">${safeDate}</span>
          </div>
          ${reasonHtml}
          ${contactLines.join("")}
        </div>
        <div class="problem-item-btns">
          <button class="pi-edit" onclick="editReturn(${r.rowIndex})">✏️ 編輯</button>
          <button class="pi-resolve" onclick="removeReturn(${r.rowIndex}, '${safeId.replace(/'/g, "\\'")}', this)">🗑 刪除</button>
        </div>
      </div>
    `;
  }).join("");
}

function editReturn(rowIndex) {
  const platform = currentReturnPlatform();
  const record = (returnListCache[platform] || []).find(r => r.rowIndex === rowIndex);
  if (!record) return;

  document.getElementById("returnDate").value = record.date || "";
  document.getElementById("returnOrderId").value = record.orderId || "";
  document.getElementById("returnTrackingNo").value = record.trackingNo || "";
  document.getElementById("returnReason").value = record.reason || "";
  const resultVal = String(record.result || "").trim();
  const resultRadios = document.querySelectorAll('input[name="returnResult"]');
  let matched = false;
  resultRadios.forEach(el => {
    if (el.value === resultVal) { el.checked = true; matched = true; }
  });
  if (!matched) {
    // 舊資料或自由文字結果沒有對應到固定選項,先預設回到「未結案」
    const fallback = document.querySelector('input[name="returnResult"][value="未結案"]');
    if (fallback) fallback.checked = true;
  }
  if (platform === "line禮物") {
    document.getElementById("returnContact1").value = record.contact1 || "";
    document.getElementById("returnContact2").value = record.contact2 || "";
    document.getElementById("returnContact3").value = record.contact3 || "";
    document.getElementById("returnContact4").value = record.contact4 || "";
  }

  setStatus("returnStatus", "warn", `✎ 編輯中:${record.orderId}(修改後點「送出退貨紀錄」會覆蓋更新這一列)`);
  document.querySelector(".tabs")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function removeReturn(rowIndex, orderId, btn) {
  const url = getGsUrl();
  if (!url) {
    setStatus("returnStatus", "warn", "⚠ 尚未設定 Apps Script 網址");
    return;
  }
  const platform = currentReturnPlatform();
  if (!confirm(`確定要刪除 ${platform} 的退貨紀錄 ${orderId} ?(會從試算表移除)`)) return;

  if (btn) {
    btn.disabled = true;
    btn.textContent = "處理中…";
  }
  setStatus("returnStatus", "loading", `移除退貨紀錄 ${orderId}…`);

  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action: "removeReturn", platform, rowIndex, orderId }),
  })
    .then(r => r.json())
    .then(data => {
      if (data.ok) {
        setStatus("returnStatus", "success", `✓ 已移除 ${orderId}`);
        loadReturns();
      } else {
        setStatus("returnStatus", "error", `✗ 移除失敗:${data.error || "未知錯誤"}`);
        if (btn) { btn.disabled = false; btn.textContent = "🗑 刪除"; }
      }
    })
    .catch(err => {
      setStatus("returnStatus", "error", `✗ 移除失敗:${err.message}`);
      if (btn) { btn.disabled = false; btn.textContent = "🗑 刪除"; }
    });
}


function maybeLoadReturnsOnTabSwitch(name) {
  const total = RETURN_PLATFORMS.reduce((s, p) => s + (returnListCache[p] || []).length, 0);
  if (name === "returns" && total === 0) {
    loadReturns();
  }
}
