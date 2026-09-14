/**
 * 出貨幫手 - 多試算表接收端 v5
 *
 * 變更摘要(相對 v2):
 *   - 所有試算表 ID 直接寫死在程式碼裡(不走 Script Properties,部署前不用另外設定)
 *   - 永生花新增「黃金運/粉招福」分欄統計,試算表欄位從 7 欄擴充為 8 欄
 *   - 新增「離島•郵局」分類
 *   - 離島•郵局寫入成功後,額外呼叫包貨系統(niyan_packing)API,自動新增/累加
 *     一筆「離島•郵局」平台紀錄(物流固定「郵局」),PACKING_API_URL 寫死在程式碼裡
 *
 * 部署前必做:
 *   部署 → 新增部署 → Web App → 執行身分:我、誰可存取:任何人 → 取得網址貼回前端設定。
 *
 * 支援動作:
 *   body.action === "append"            → 分類訂單寫入(雷雕/黑熊/永生花/注意品項/盆景公仔組/離島•郵局)
 *   body.action === "addProblem"        → 新增/更新問題訂單
 *   body.action === "getProblems"       → 讀所有問題訂單
 *   body.action === "removeProblem"     → 移除問題訂單(rowIndex + orderId 雙重確認)
 *   body.action === "uploadLineRegular" → 一般訂單筆數累加同步到包貨系統「Line禮物」平台卡
 *   body.action === "addReturn"         → 新增/更新包裹退貨紀錄(依平台 + 訂單編號 upsert)
 *   body.action === "getReturns"        → 讀所有包裹退貨紀錄(依平台分組)
 *   body.action === "removeReturn"      → 移除包裹退貨紀錄(rowIndex + orderId 雙重確認)
 */

// ===== 分類對應的廠商試算表設定 =====
// 注意:永生花的 columns 比其他多一欄(從 qty 拆成 goldQty / pinkQty)
// 所有 spreadsheetId 直接寫死,不走 Script Properties
const SHEETS = {
  "雷雕": {
    spreadsheetId: "1yWvDnbI9w1ukexlaZWNAOyPHUS7JKMgGIDPV83wlSQ8",
    sheetName: "雷雕",
    columns: ["date", "name", "address", "phone", "note", "orderId", "qty"],
    headers: ["日期", "姓名", "地址", "電話", "備注", "訂單編號", "數量"],
  },
  "黑熊": {
    spreadsheetId: "1SVuzdacjbJrX82pIRkkdB7B1kD3pF9nggkynzxzUTII",
    sheetName: "黑熊",
    columns: ["date", "name", "address", "phone", "note", "orderId", "qty"],
    headers: ["日期", "姓名", "地址", "電話", "備注", "訂單編號", "數量"],
  },
  "永生花": {
    spreadsheetId: "1ihfosKQwK8B9IA1768tHEACykPxHuTgzqd26kkA2YwM",
    sheetName: "永生花",
    columns: ["date", "name", "address", "phone", "note", "orderId", "goldQty", "pinkQty"],
    headers: ["日期", "姓名", "地址", "電話", "備注", "訂單編號", "黃金數量", "粉福數量"],
  },
  "注意品項": {
    spreadsheetId: "1dPGbWNIcslooHOkYtwIPc-moh88z1UR0aA1gTwZ-prU",
    sheetName: "注意品項",
    columns: ["date", "name", "address", "phone", "note", "orderId", "qty"],
    headers: ["日期", "姓名", "地址", "電話", "備注", "訂單編號", "數量"],
  },
  "盆景公仔組": {
    spreadsheetId: "1hhx_HqK9m9XUxKQlGXcRYdY20Qpfg_zN9vTJW1U44Ts",
    sheetName: "盆景公仔組",
    columns: ["date", "name", "address", "phone", "note", "orderId", "qty"],
    headers: ["日期", "姓名", "地址", "電話", "備注", "訂單編號", "數量"],
  },
  // 離島•郵局:地址含台灣離島縣市(澎湖/金門/連江/馬祖)的訂單,不用黑貓改用郵局寄
  "離島•郵局": {
    spreadsheetId: "1eV6lcWJ1nEs-As32NU6iatYAih-NYQ5WZfGteWDlk5A",
    sheetName: "離島包裹",
    columns: ["date", "name", "address", "phone", "note", "orderId", "qty", "island"],
    headers: ["日期", "姓名", "地址", "電話", "備注", "訂單編號", "數量", "離島縣市"],
  },
};

// ===== 問題訂單 =====
const PROBLEM_SHEET_ID = "1lbEXKYvUzFljxdZmBdg1K0GzOahbnBH39bbANMZ34d4";
const PROBLEMS_SHEET = "問題訂單";
const PROBLEMS_HEADERS = ["加入時間", "訂單編號", "問題類別", "備註"];

// ===== 包裹退貨 =====
// 格式參考「包裹退貨.xlsx」:同一張工作表裡橫向並排三個平台區塊(不是分頁簽),
// 各平台筆數不同,絕對不能用 sheet.deleteRow()/getLastRow() 整列處理,
// 否則會把旁邊其他平台的資料錯位或誤刪。
const RETURNS_SHEET_ID = "1bMPA6GQ-tVaju85BFm9ETHOuG6hfGjPQfsDLtTWcEnk";
const RETURNS_SHEET_NAME = "工作表1";
const RETURNS_HEADER_ROW = 1;
const RETURNS_DATA_START_ROW = 2;

const RETURN_BLOCKS = {
  "line禮物": {
    startCol: 1, // A
    columns: ["date", "orderId", "trackingNo", "reason", "result", "contact1", "contact2", "contact3", "contact4"],
    headers: ["日期", "訂單編號", "託運單號", "原因", "結果", "第一次電聯", "第二次電聯", "第三次電聯", "第四次電聯"],
  },
  "蝦皮": {
    startCol: 10, // J(I 到 J 之間無空隔欄)
    columns: ["date", "orderId", "trackingNo", "reason", "result"],
    headers: ["日期", "訂單編號", "託運單號", "原因", "結果"],
  },
  "mo": {
    startCol: 16, // P(N、P 之間留一欄 O 當間隔)
    columns: ["date", "orderId", "trackingNo", "reason", "result"],
    headers: ["日期", "訂單編號", "託運單號", "原因", "結果"],
  },
};

// ===== 離島•郵局 → 自動同步到「包貨系統」(niyan_packing) =====
// 離島訂單改走郵局寄,同步一筆獨立的「離島•郵局」平台紀錄(物流固定填「郵局」),
// 讓包貨系統「今日物流平台」統計卡的綠色郵局字卡能抓到這批數字。
// 用獨立平台名而不是寫進「Line禮物」,是為了不跟包貨系統當天手動送出的
// Line禮物表單互相覆蓋(包貨系統同一天同平台的紀錄,手動送出時是整筆覆蓋、不是合併)。
// 注意:這個網址要跟 niyan_packing-main/index.html 裡的 API_URL 隨時保持一致,
// 包貨系統那邊重新部署(取得新的 /exec 網址)時,這裡也要跟著更新,否則
// UrlFetchApp.fetch 會拿到 Google 的 404 HTML 錯誤頁,後面 JSON.parse 就會丟出
// "Unexpected token '<', "<!DOCTYPE "... is not valid JSON" 這種例外。
const PACKING_API_URL = "https://script.google.com/macros/s/AKfycbzSWZOSlhEO62N4sRmM8QWvRKQQRnyNaT-548oxI5KDLOFo5JZDkGu-Q6R2VluxauQ1/exec";
const PACKING_SYNC_PLATFORM = "離島•郵局";
const PACKING_SYNC_LOGI = "郵局";


// =============================================================
// 入口
// =============================================================
function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const action = body.action || "append";

    switch (action) {
      case "append":            return handleAppend(body);
      case "addProblem":        return handleAddProblem(body);
      case "getProblems":       return handleGetProblems();
      case "removeProblem":     return handleRemoveProblem(body);
      case "uploadLineRegular": return handleUploadLineRegular(body);
      case "addReturn":         return handleAddReturn(body);
      case "getReturns":        return handleGetReturns();
      case "removeReturn":      return handleRemoveReturn(body);
      default:
        return jsonResponse({ ok: false, error: "未知 action: " + action });
    }
  } catch (err) {
    return jsonResponse({ ok: false, error: err.toString() });
  }
}

function doGet() {
  return jsonResponse({ ok: true, message: "出貨幫手接收端運作中 v5" });
}


// =============================================================
// 1. 分類訂單寫入
// =============================================================
function handleAppend(body) {
  const targets = body.targets || {};
  const results = {};
  let totalWritten = 0;

  for (const [category, rows] of Object.entries(targets)) {
    if (!Array.isArray(rows) || rows.length === 0) continue;

    const cfg = SHEETS[category];
    if (!cfg) {
      results[category] = { ok: false, error: `未知分類: ${category}` };
      continue;
    }

    try {
      const ss = SpreadsheetApp.openById(cfg.spreadsheetId);
      let sheet = ss.getSheetByName(cfg.sheetName);

      // 若工作表不存在,自動建立並補表頭
      if (!sheet) {
        sheet = ss.insertSheet(cfg.sheetName);
        sheet.getRange(1, 1, 1, cfg.headers.length).setValues([cfg.headers]);
        sheet.setFrozenRows(1);
      } else if (category === "永生花") {
        // 永生花特殊處理:若舊表只有 7 欄,自動升級為 8 欄(在原數量欄旁多加一欄)
        // 不改動既有資料,只把表頭補成新版
        const lastCol = sheet.getLastColumn();
        if (lastCol < cfg.headers.length) {
          // 只補表頭,不動資料(舊資料的數量會留在第 7 欄,新資料用新格式寫入)
          sheet.getRange(1, 1, 1, cfg.headers.length).setValues([cfg.headers]);
        }
      }

      const values = rows.map(r => cfg.columns.map(k => r[k] ?? ""));
      sheet.getRange(sheet.getLastRow() + 1, 1, values.length, values[0].length)
           .setValues(values);

      results[category] = { ok: true, count: values.length };
      totalWritten += values.length;

      // 離島•郵局寫入成功後,順便同步到包貨系統的「離島•郵局」平台卡
      if (category === "離島•郵局") {
        results[category].packingSync = syncOffshoreToPacking(rows);
      }
    } catch (err) {
      results[category] = { ok: false, error: err.toString() };
    }
  }

  return jsonResponse({ ok: true, totalWritten: totalWritten, results: results });
}

// 同步離島這批件數到包貨系統:當天已有「離島•郵局」平台紀錄就累加合併,沒有就新增一筆
// (不能每次都直接新增,不然同一天上傳多次,包貨系統看板上的「離島•郵局」卡只會顯示
//  最後一次上傳的數字,不是當天累計 —— 統計卡的綠色郵局總數雖然還是對的,但卡片數字會誤導人)
function syncOffshoreToPacking(rows) {
  const qty = rows.reduce((s, r) => s + (parseInt(r.qty, 10) || 1), 0);
  if (qty <= 0) return { ok: true, skipped: true };

  const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");

  try {
    const readRes = callPackingApi("readAll", {});
    if (!readRes.ok) return readRes;

    const platforms = (readRes.data && readRes.data.platforms) || [];
    const existing = platforms.find(p =>
      String(p["平台"]) === PACKING_SYNC_PLATFORM &&
      String(p["日期"]).slice(0, 10) === today
    );

    if (existing) {
      const prevDetail = Array.isArray(existing["明細"]) ? existing["明細"] : [];
      const prevPost = prevDetail.find(d => d.物流 === PACKING_SYNC_LOGI);
      const newQty = (prevPost ? Number(prevPost.件數) || 0 : 0) + qty;
      const newDetail = prevDetail.filter(d => d.物流 !== PACKING_SYNC_LOGI);
      newDetail.push({ 物流: PACKING_SYNC_LOGI, 件數: newQty });
      const newTotal = newDetail.reduce((s, d) => s + (Number(d.件數) || 0), 0);
      return callPackingApi("updatePlatform", {
        id: existing.id,
        "明細": newDetail,
        "總件數": newTotal,
        "備註": "",
      });
    }

    return callPackingApi("addPlatform", {
      "日期": today,
      "平台": PACKING_SYNC_PLATFORM,
      "明細": [{ 物流: PACKING_SYNC_LOGI, 件數: qty }],
      "總件數": qty,
      "備註": "",
    });
  } catch (err) {
    return { ok: false, error: err.toString() };
  }
}

function callPackingApi(action, payload) {
  const res = UrlFetchApp.fetch(PACKING_API_URL, {
    method: "post",
    contentType: "text/plain;charset=utf-8",
    payload: JSON.stringify({ action: action, payload: payload }),
    muteHttpExceptions: true,
  });
  return JSON.parse(res.getContentText());
}


// =============================================================
// 1b. 一般訂單(Line禮物)→ 自動同步到「包貨系統」(niyan_packing)
// =============================================================
// 出貨幫手上傳一般訂單筆數時,累加合併到包貨系統當天的「Line禮物」平台卡
// (物流固定填「黑貓」;跟離島•郵局的同步邏輯一樣用累加合併,不會整筆覆蓋掉
//  包貨系統當天手動送出的 Line禮物表單資料)
const LINE_REGULAR_PLATFORM = "Line禮物";
const LINE_REGULAR_LOGI = "黑貓";

function handleUploadLineRegular(body) {
  const date = String(body.date || "").trim();
  const count = parseInt(body.count, 10) || 0;

  if (!date) return jsonResponse({ ok: false, error: "缺少日期" });
  if (count <= 0) return jsonResponse({ ok: true, updated: false, total: 0, skipped: true });

  try {
    const readRes = callPackingApi("readAll", {});
    if (!readRes.ok) return jsonResponse({ ok: false, error: readRes.error || "讀取包貨系統失敗" });

    const platforms = (readRes.data && readRes.data.platforms) || [];
    const existing = platforms.find(p =>
      String(p["平台"]) === LINE_REGULAR_PLATFORM &&
      String(p["日期"]).slice(0, 10) === date
    );

    if (existing) {
      const prevDetail = Array.isArray(existing["明細"]) ? existing["明細"] : [];
      const prevPost = prevDetail.find(d => d.物流 === LINE_REGULAR_LOGI);
      const newQty = (prevPost ? Number(prevPost.件數) || 0 : 0) + count;
      const newDetail = prevDetail.filter(d => d.物流 !== LINE_REGULAR_LOGI);
      newDetail.push({ 物流: LINE_REGULAR_LOGI, 件數: newQty });
      const newTotal = newDetail.reduce((s, d) => s + (Number(d.件數) || 0), 0);

      const res = callPackingApi("updatePlatform", {
        id: existing.id,
        "明細": newDetail,
        "總件數": newTotal,
        "備註": "",
      });
      if (!res.ok) return jsonResponse({ ok: false, error: res.error || "更新包貨系統失敗" });
      return jsonResponse({ ok: true, updated: true, total: newTotal });
    }

    const res = callPackingApi("addPlatform", {
      "日期": date,
      "平台": LINE_REGULAR_PLATFORM,
      "明細": [{ 物流: LINE_REGULAR_LOGI, 件數: count }],
      "總件數": count,
      "備註": "",
    });
    if (!res.ok) return jsonResponse({ ok: false, error: res.error || "新增包貨系統紀錄失敗" });
    return jsonResponse({ ok: true, updated: false, total: count });
  } catch (err) {
    return jsonResponse({ ok: false, error: err.toString() });
  }
}


// =============================================================
// 2. 問題訂單
// =============================================================
function ensureProblemsSheet() {
  const ss = SpreadsheetApp.openById(PROBLEM_SHEET_ID);
  let sheet = ss.getSheetByName(PROBLEMS_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(PROBLEMS_SHEET);
    sheet.getRange(1, 1, 1, PROBLEMS_HEADERS.length).setValues([PROBLEMS_HEADERS]);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, PROBLEMS_HEADERS.length)
         .setBackground("#1a1f2b").setFontColor("#f778ba").setFontWeight("bold");
    sheet.setColumnWidth(1, 140);  // 加入時間
    sheet.setColumnWidth(2, 180);  // 訂單編號
    sheet.setColumnWidth(3, 140);  // 問題類別
    sheet.setColumnWidth(4, 320);  // 備註
  } else {
    // 既存的工作表若還是舊的 3 欄表頭(處理方式),自動升級為新的 4 欄表頭
    const firstRow = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 3)).getValues()[0];
    const headerStr = firstRow.map(v => String(v || "").trim()).join("|");
    const isLegacy = headerStr.includes("處理方式") && !headerStr.includes("問題類別");
    if (isLegacy) {
      sheet.getRange(1, 1, 1, PROBLEMS_HEADERS.length).setValues([PROBLEMS_HEADERS]);
      sheet.getRange(1, 1, 1, PROBLEMS_HEADERS.length)
           .setBackground("#1a1f2b").setFontColor("#f778ba").setFontWeight("bold");
    }
  }
  return sheet;
}

function handleAddProblem(body) {
  const p = body.problem || {};
  const orderId = String(p.orderId || "").trim();
  let type = String(p.type || p.action || "").trim();
  const note = String(p.note || "").trim();

  if (!orderId) return jsonResponse({ ok: false, error: "缺少訂單編號" });
  if (!type) type = "其他";

  const sheet = ensureProblemsSheet();
  const now = new Date();
  const timestamp = Utilities.formatDate(now, Session.getScriptTimeZone(), "yyyy/MM/dd HH:mm");

  const lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    const ids = sheet.getRange(2, 2, lastRow - 1, 1).getValues();
    for (let i = 0; i < ids.length; i++) {
      if (String(ids[i][0] || "").trim() === orderId) {
        const rowNum = i + 2;
        sheet.getRange(rowNum, 1, 1, 4).setValues([[timestamp, orderId, type, note]]);
        return jsonResponse({ ok: true, updated: true, rowIndex: rowNum });
      }
    }
  }

  sheet.appendRow([timestamp, orderId, type, note]);
  return jsonResponse({ ok: true, updated: false, rowIndex: sheet.getLastRow() });
}

function handleGetProblems() {
  const sheet = ensureProblemsSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return jsonResponse({ ok: true, problems: [] });

  const data = sheet.getRange(2, 1, lastRow - 1, 4).getValues();
  const problems = [];
  data.forEach((row, idx) => {
    const orderId = String(row[1] || "").trim();
    if (!orderId) return;
    const createdAt = row[0] instanceof Date
      ? Utilities.formatDate(row[0], Session.getScriptTimeZone(), "yyyy/MM/dd HH:mm")
      : String(row[0] || "");
    problems.push({
      rowIndex: idx + 2,
      createdAt: createdAt,
      orderId: orderId,
      type: String(row[2] || "").trim(),
      note: String(row[3] || "").trim(),
    });
  });
  return jsonResponse({ ok: true, problems: problems });
}

function handleRemoveProblem(body) {
  const rowIndex = parseInt(body.rowIndex, 10);
  const orderId = String(body.orderId || "").trim();

  const sheet = ensureProblemsSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return jsonResponse({ ok: false, error: "清單是空的" });

  let target = -1;
  if (rowIndex >= 2 && rowIndex <= lastRow) {
    const oid = String(sheet.getRange(rowIndex, 2).getValue() || "").trim();
    if (!orderId || oid === orderId) target = rowIndex;
  }
  if (target < 0 && orderId) {
    const data = sheet.getRange(2, 2, lastRow - 1, 1).getValues();
    for (let i = 0; i < data.length; i++) {
      if (String(data[i][0] || "").trim() === orderId) { target = i + 2; break; }
    }
  }

  if (target < 0) return jsonResponse({ ok: false, error: "找不到對應的問題訂單" });

  sheet.deleteRow(target);
  return jsonResponse({ ok: true, deletedRow: target });
}


// =============================================================
// 3. 包裹退貨
// =============================================================
function getReturnsSheet() {
  const ss = SpreadsheetApp.openById(RETURNS_SHEET_ID);
  let sheet = ss.getSheetByName(RETURNS_SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(RETURNS_SHEET_NAME);

  // 每個平台區塊的表頭若還是空的才補(不動既有資料/表頭)
  for (const cfg of Object.values(RETURN_BLOCKS)) {
    const existing = sheet.getRange(RETURNS_HEADER_ROW, cfg.startCol, 1, cfg.headers.length).getValues()[0];
    const isEmpty = existing.every(v => String(v || "").trim() === "");
    if (isEmpty) {
      sheet.getRange(RETURNS_HEADER_ROW, cfg.startCol, 1, cfg.headers.length).setValues([cfg.headers]);
    }
  }
  sheet.setFrozenRows(1);
  return sheet;
}

// 只看該平台區塊自己的欄位範圍,找出最後一筆有資料的列號
// (三個平台橫向並排在同一張表,不能用 sheet.getLastRow(),那是整張表的最後一列)
function getBlockLastRow(sheet, cfg) {
  const maxRows = sheet.getMaxRows();
  if (maxRows < RETURNS_DATA_START_ROW) return RETURNS_HEADER_ROW;
  const values = sheet.getRange(
    RETURNS_DATA_START_ROW, cfg.startCol,
    maxRows - RETURNS_DATA_START_ROW + 1, cfg.columns.length
  ).getValues();
  let lastRow = RETURNS_HEADER_ROW;
  for (let i = 0; i < values.length; i++) {
    if (values[i].some(v => String(v || "").trim() !== "")) {
      lastRow = RETURNS_DATA_START_ROW + i;
    }
  }
  return lastRow;
}

function handleAddReturn(body) {
  const platform = String(body.platform || "").trim();
  const cfg = RETURN_BLOCKS[platform];
  if (!cfg) return jsonResponse({ ok: false, error: "未知平台: " + platform });

  const r = body.record || {};
  const orderId = String(r.orderId || "").trim();
  if (!orderId) return jsonResponse({ ok: false, error: "缺少訂單編號" });

  const sheet = getReturnsSheet();
  const values = cfg.columns.map(k => r[k] ?? "");
  const orderIdColIdx = cfg.columns.indexOf("orderId");
  const lastRow = getBlockLastRow(sheet, cfg);

  // 同平台若已有相同訂單編號,直接更新該列,不新增重複列
  if (lastRow >= RETURNS_DATA_START_ROW) {
    const ids = sheet.getRange(
      RETURNS_DATA_START_ROW, cfg.startCol + orderIdColIdx,
      lastRow - RETURNS_DATA_START_ROW + 1, 1
    ).getValues();
    for (let i = 0; i < ids.length; i++) {
      if (String(ids[i][0] || "").trim() === orderId) {
        const rowNum = RETURNS_DATA_START_ROW + i;
        sheet.getRange(rowNum, cfg.startCol, 1, values.length).setValues([values]);
        return jsonResponse({ ok: true, updated: true, rowIndex: rowNum });
      }
    }
  }

  const newRow = Math.max(lastRow + 1, RETURNS_DATA_START_ROW);
  sheet.getRange(newRow, cfg.startCol, 1, values.length).setValues([values]);
  return jsonResponse({ ok: true, updated: false, rowIndex: newRow });
}

function handleGetReturns() {
  const sheet = getReturnsSheet();
  const result = {};

  for (const [platform, cfg] of Object.entries(RETURN_BLOCKS)) {
    const lastRow = getBlockLastRow(sheet, cfg);
    const list = [];
    if (lastRow >= RETURNS_DATA_START_ROW) {
      const values = sheet.getRange(
        RETURNS_DATA_START_ROW, cfg.startCol,
        lastRow - RETURNS_DATA_START_ROW + 1, cfg.columns.length
      ).getValues();
      values.forEach((row, idx) => {
        const rec = {};
        let hasData = false;
        cfg.columns.forEach((key, colIdx) => {
          let v = row[colIdx];
          if (v instanceof Date) v = Utilities.formatDate(v, Session.getScriptTimeZone(), "yyyy-MM-dd");
          v = (v === null || v === undefined) ? "" : String(v);
          if (v.trim() !== "") hasData = true;
          rec[key] = v;
        });
        if (hasData) {
          rec.rowIndex = RETURNS_DATA_START_ROW + idx;
          list.push(rec);
        }
      });
    }
    result[platform] = list;
  }

  return jsonResponse({ ok: true, returns: result });
}

function handleRemoveReturn(body) {
  const platform = String(body.platform || "").trim();
  const cfg = RETURN_BLOCKS[platform];
  if (!cfg) return jsonResponse({ ok: false, error: "未知平台: " + platform });

  const rowIndex = parseInt(body.rowIndex, 10);
  const orderId = String(body.orderId || "").trim();

  const sheet = getReturnsSheet();
  const lastRow = getBlockLastRow(sheet, cfg);
  if (lastRow < RETURNS_DATA_START_ROW) return jsonResponse({ ok: false, error: "清單是空的" });

  const orderIdColIdx = cfg.columns.indexOf("orderId");
  let target = -1;
  if (rowIndex >= RETURNS_DATA_START_ROW && rowIndex <= lastRow) {
    const oid = String(sheet.getRange(rowIndex, cfg.startCol + orderIdColIdx).getValue() || "").trim();
    if (!orderId || oid === orderId) target = rowIndex;
  }
  if (target < 0 && orderId) {
    const ids = sheet.getRange(
      RETURNS_DATA_START_ROW, cfg.startCol + orderIdColIdx,
      lastRow - RETURNS_DATA_START_ROW + 1, 1
    ).getValues();
    for (let i = 0; i < ids.length; i++) {
      if (String(ids[i][0] || "").trim() === orderId) { target = RETURNS_DATA_START_ROW + i; break; }
    }
  }
  if (target < 0) return jsonResponse({ ok: false, error: "找不到對應的退貨紀錄" });

  // 不能用 sheet.deleteRow(),那會影響到同一列旁邊其他平台的欄位。
  // 只把該平台欄位範圍內、目標列以下的資料整塊往上搬一列,最後一列清空。
  const numCols = cfg.columns.length;
  if (target < lastRow) {
    const below = sheet.getRange(target + 1, cfg.startCol, lastRow - target, numCols).getValues();
    sheet.getRange(target, cfg.startCol, lastRow - target, numCols).setValues(below);
  }
  sheet.getRange(lastRow, cfg.startCol, 1, numCols).clearContent();

  return jsonResponse({ ok: true, deletedRow: target });
}


// =============================================================
// Util
// =============================================================
function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
