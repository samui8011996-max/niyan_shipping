// ===================================================================
// 試算表網址(從 localStorage 讀;沒設定過就退回下方寫死的預設網址)
// ===================================================================
const SHEET_URL_KEYS = {
  "雷雕":       "niyan_sheet_url_laser",
  "黑熊":       "niyan_sheet_url_bear",
  "注意品項":   "niyan_sheet_url_notice",
  "盆景公仔組": "niyan_sheet_url_bonsai",
  "離島•郵局":  "niyan_sheet_url_offshore",
  "問題訂單":   "niyan_sheet_url_problem",
  "包裹退貨":   "niyan_sheet_url_returns",
};

// 寫死的預設試算表網址,對應 gs 後端 SHEETS 設定裡的 spreadsheetId
const DEFAULT_SHEET_URLS = {
  "雷雕":       "https://docs.google.com/spreadsheets/d/1yWvDnbI9w1ukexlaZWNAOyPHUS7JKMgGIDPV83wlSQ8/edit",
  "黑熊":       "https://docs.google.com/spreadsheets/d/1SVuzdacjbJrX82pIRkkdB7B1kD3pF9nggkynzxzUTII/edit",
  "永生花":     "https://docs.google.com/spreadsheets/d/1ihfosKQwK8B9IA1768tHEACykPxHuTgzqd26kkA2YwM/edit",
  "注意品項":   "https://docs.google.com/spreadsheets/d/1dPGbWNIcslooHOkYtwIPc-moh88z1UR0aA1gTwZ-prU/edit",
  "盆景公仔組": "https://docs.google.com/spreadsheets/d/1hhx_HqK9m9XUxKQlGXcRYdY20Qpfg_zN9vTJW1U44Ts/edit",
  "離島•郵局":  OFFSHORE_SHEET_URL,
  "問題訂單":   "https://docs.google.com/spreadsheets/d/1lbEXKYvUzFljxdZmBdg1K0GzOahbnBH39bbANMZ34d4/edit",
  "包裹退貨":   "https://docs.google.com/spreadsheets/d/1bMPA6GQ-tVaju85BFm9ETHOuG6hfGjPQfsDLtTWcEnk/edit",
};

function getSheetUrl(category) {
  const key = SHEET_URL_KEYS[category];
  const stored = key ? (localStorage.getItem(key) || "") : "";
  if (stored) return stored;
  return DEFAULT_SHEET_URLS[category] || "";
}

function openSheet(category) {
  const url = getSheetUrl(category);
  if (url) {
    window.open(url, "_blank");
  } else {
    setStatus("status", "warn", `⚠ 尚未設定「${category}」試算表網址,請先點「⚙ 設定」`);
    openSettings();
  }
}

function openProblemSheet() {
  const url = getSheetUrl("問題訂單");
  if (url) {
    window.open(url, "_blank");
  } else {
    setStatus("status", "warn", "⚠ 尚未設定「問題訂單」試算表網址,請先點「⚙ 設定」");
    openSettings();
  }
}

function openReturnsSheet() {
  const url = getSheetUrl("包裹退貨");
  if (url) {
    window.open(url, "_blank");
  } else {
    setStatus("returnStatus", "warn", "⚠ 尚未設定「包裹退貨」試算表網址,請先點「⚙ 設定」");
    openSettings();
  }
}

// 點「未結案退貨」字卡 → 切到未結案篩選籤,並捲動到清單
function filterReturnsToOpen() {
  const el = document.querySelector('input[name="returnFilter"][value="open"]');
  if (el) el.checked = true;
  renderReturnList();
  document.getElementById("returnList")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

// ===================================================================
// 設定
// ===================================================================
// Apps Script 網址寫死,不再開放使用者設定/儲存
const GS_URL = "https://script.google.com/macros/s/AKfycbyhkiaQaoMSFlHDEDcdA6iosXdkaX3EqlHxKpDMrKVEQnU1B9vADyZzcVIuGoQg3VI/exec";

function openSettings() {
  for (const cat of Object.keys(SHEET_URL_KEYS)) {
    const el = document.getElementById("sheetUrl_" + cat);
    if (el) el.value = getSheetUrl(cat);
  }
  document.getElementById("settingsModal").classList.add("show");
}
function closeSettings() { document.getElementById("settingsModal").classList.remove("show"); }

function saveSettings() {
  // 驗證每個試算表網址(允許留空)
  for (const cat of Object.keys(SHEET_URL_KEYS)) {
    const el = document.getElementById("sheetUrl_" + cat);
    if (!el) continue;
    const v = el.value.trim();
    if (v && !v.startsWith("https://docs.google.com/spreadsheets/")) {
      setStatus("status", "error", `✗「${cat}」網址格式不正確,應以 https://docs.google.com/spreadsheets/ 開頭`);
      return;
    }
  }

  // 通過驗證,寫入
  for (const [cat, storageKey] of Object.entries(SHEET_URL_KEYS)) {
    const el = document.getElementById("sheetUrl_" + cat);
    if (!el) continue;
    const v = el.value.trim();
    if (v) localStorage.setItem(storageKey, v);
    else localStorage.removeItem(storageKey);
  }

  setStatus("status", "success", "✓ 設定已儲存");
  closeSettings();
}

function getGsUrl() { return GS_URL; }

// ===================================================================
// 一鍵上傳分類訂單(雷雕/黑熊/永生花/注意品項/盆景)到廠商試算表
// ===================================================================
function uploadAllToSheet() {
  if (!loadedRows) return;
  const url = getGsUrl();
  if (!url) {
    setStatus("status", "warn", "⚠ 尚未設定 Apps Script 網址,請先點「⚙ 設定」");
    openSettings();
    return;
  }

  const today = todayStr("/");
  const targets = {};
  let totalCount = 0;

  UPLOAD_CATEGORIES.forEach(cat => {
    // 用完整命中清單比對,一筆訂單如果同時符合兩個分類(例如巨物+雷雕),
    // 兩邊廠商試算表都要收到這筆
    const catRows = loadedRows.filter(r => (r["_類別列表"] || []).includes(cat));
    if (catRows.length > 0) {
      targets[cat] = catRows.map(r => {
        const base = {
          date: today,
          name: r["收件人姓名"] ?? "",
          address: r["配送地址"] ?? "",
          phone: r["收件人聯絡電話"] ?? "",
          note: r["_備註"],
          orderId: r["訂單編號"] ?? "",
        };
        if (cat === "永生花") {
          // 永生花拆成黃金運 / 粉招福兩欄(由「規格設定」判斷裡面公仔的顏色)
          const qty = parseInt(r["數量"], 10) || 1;
          const spec = String(r["規格設定"] ?? "");
          let goldQty = 0, pinkQty = 0;
          if (spec.includes("黃金運")) goldQty = qty;
          else if (spec.includes("粉招福") || spec.includes("粉招") || spec.includes("粉福")) pinkQty = qty;
          else goldQty = qty;  // 都不符合就放黃金運欄,至少不掉資料
          base.goldQty = goldQty;
          base.pinkQty = pinkQty;
        } else {
          base.qty = r["數量"] ?? 1;
        }
        return base;
      });
      totalCount += catRows.length;
    }
  });

  // 離島•郵局:地址含離島縣市的訂單,獨立於商品分類之外,額外上傳到離島包裹試算表
  const offshoreRows = loadedRows.filter(r => r["_離島"]);
  if (offshoreRows.length > 0) {
    targets["離島•郵局"] = offshoreRows.map(r => ({
      date: today,
      name: r["收件人姓名"] ?? "",
      address: r["配送地址"] ?? "",
      phone: r["收件人聯絡電話"] ?? "",
      note: "",
      orderId: r["訂單編號"] ?? "",
      qty: r["數量"] ?? 1,
      island: r["_離島"],
    }));
    totalCount += offshoreRows.length;
  }

if (totalCount === 0) {
  // 沒有分類訂單，但還是要上傳一般訂單數
  uploadLineRegular();
  return;
}

  const catSummary = Object.entries(targets).map(([c, rs]) => `${c} ${rs.length}`).join(" · ");
  setStatus("status", "loading", `上傳中(${catSummary})…`);
  document.getElementById("uploadBtn").disabled = true;

  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action: "append", targets }),
  })
    .then(r => r.json())
.then(data => {
      if (data.ok) {
        const breakdown = Object.entries(data.results || {})
          .map(([c, r]) => {
            if (!r.ok) return `${c} 失敗(${r.error})`;
            let s = `${c} ${r.count}`;
            if (r.packingSync) {
              s += r.packingSync.ok ? "(已同步包貨郵局)" : `(包貨同步失敗:${r.packingSync.error || "未知錯誤"})`;
            }
            return s;
          })
          .join(" · ");
        setStatus("status", "success", `✓ 已上傳 ${data.totalWritten} 筆 · ${breakdown}`);
        uploadLineRegular();  // ← 加這行
      } else {
        setStatus("status", "error", `✗ 上傳失敗:${data.error || "未知錯誤"}`);
      }
    })
    .catch(err => {
      setStatus("status", "error", `✗ 上傳失敗:${err.message}`);
    })
    .finally(() => {
      document.getElementById("uploadBtn").disabled = false;
    });
}


  function uploadLineRegular() {
  if (!lastStats) return;
  const url = getGsUrl();
  if (!url) return;
  const count = lastStats.regular;
  if (count <= 0) return;
  const today = todayStr("-");
  const btn = document.getElementById("uploadLineBtn");
  if (btn) { btn.disabled = true; }

  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({
      action: "uploadLineRegular",
      date: today,
      count: count
    })
  })
    .then(r => r.json())
    .then(data => {
      if (data.ok) {
        const msg = data.updated
          ? `✓ 已上傳，Line禮物 今日累計 ${data.total} 筆`
          : `✓ 已上傳，Line禮物 今日 ${data.total} 筆`;
        setStatus("status", "success", msg);
      } else {
        setStatus("status", "error", `✗ Line禮物上傳失敗：${data.error || "未知錯誤"}`);
      }
    })
    .catch(err => setStatus("status", "error", `✗ Line禮物上傳失敗：${err.message}`))
    .finally(() => {
      if (btn) { btn.disabled = false; }
    });
}
