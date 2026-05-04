/**
 * 出貨幫手 - 多試算表接收端 v5
 *
 * 變更摘要(相對 v2):
 *   - 所有試算表 ID 改從 Script Properties 讀(不寫死,可安全分享程式碼)
 *   - 永生花新增「黃金運/粉招福」分欄統計,試算表欄位從 7 欄擴充為 8 欄
 *
 * 部署前必做:
 *   1. 試算表自己準備 6 個(雷雕、黑熊、永生花、注意品項、盆景公仔組、問題訂單)
 *   2. 在 Apps Script 編輯器:左側「專案設定」(齒輪) → 最下方「指令碼屬性」 → 新增以下 6 個 key:
 *        SHEET_ID_LASER       (雷雕)
 *        SHEET_ID_BEAR        (黑熊)
 *        SHEET_ID_FLOWER      (永生花)
 *        SHEET_ID_NOTICE      (注意品項)
 *        SHEET_ID_BONSAI      (盆景公仔組)
 *        SHEET_ID_PROBLEM     (問題訂單)
 *      Value 填試算表 URL 中 /d/ 跟 /edit 中間那一段。
 *   3. 部署 → 新增部署 → Web App → 執行身分:我、誰可存取:任何人 → 取得網址貼回前端設定。
 *
 * 支援動作:
 *   body.action === "append"          → 分類訂單寫入(雷雕/黑熊/永生花/注意品項/盆景公仔組)
 *   body.action === "addProblem"      → 新增/更新問題訂單
 *   body.action === "getProblems"     → 讀所有問題訂單
 *   body.action === "removeProblem"   → 移除問題訂單(rowIndex + orderId 雙重確認)
 */

// ===== 試算表 ID 從 Script Properties 讀 =====
function getSheetId(propKey) {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty(propKey);
  if (!id) {
    throw new Error(
      `尚未設定 Script Property「${propKey}」。請到「專案設定 → 指令碼屬性」新增。`
    );
  }
  return id;
}

// ===== 五個分類對應的廠商試算表設定 =====
// 注意:永生花的 columns 比其他多一欄(從 qty 拆成 goldQty / pinkQty)
const SHEETS = {
  "雷雕": {
    propKey: "SHEET_ID_LASER",
    sheetName: "雷雕",
    columns: ["date", "name", "address", "phone", "note", "orderId", "qty"],
    headers: ["日期", "姓名", "地址", "電話", "備注", "訂單編號", "數量"],
  },
  "黑熊": {
    propKey: "SHEET_ID_BEAR",
    sheetName: "黑熊",
    columns: ["date", "name", "address", "phone", "note", "orderId", "qty"],
    headers: ["日期", "姓名", "地址", "電話", "備注", "訂單編號", "數量"],
  },
  "永生花": {
    propKey: "SHEET_ID_FLOWER",
    sheetName: "永生花",
    columns: ["date", "name", "address", "phone", "note", "orderId", "goldQty", "pinkQty"],
    headers: ["日期", "姓名", "地址", "電話", "備注", "訂單編號", "黃金數量", "粉福數量"],
  },
  "注意品項": {
    propKey: "SHEET_ID_NOTICE",
    sheetName: "注意品項",
    columns: ["date", "name", "address", "phone", "note", "orderId", "qty"],
    headers: ["日期", "姓名", "地址", "電話", "備注", "訂單編號", "數量"],
  },
  "盆景公仔組": {
    propKey: "SHEET_ID_BONSAI",
    sheetName: "盆景公仔組",
    columns: ["date", "name", "address", "phone", "note", "orderId", "qty"],
    headers: ["日期", "姓名", "地址", "電話", "備注", "訂單編號", "數量"],
  },
};

// ===== 問題訂單 =====
const PROBLEM_PROP_KEY = "SHEET_ID_PROBLEM";
const PROBLEMS_SHEET = "問題訂單";
const PROBLEMS_HEADERS = ["加入時間", "訂單編號", "問題類別", "備註"];


// =============================================================
// 入口
// =============================================================
function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const action = body.action || "append";

    switch (action) {
      case "append":        return handleAppend(body);
      case "addProblem":    return handleAddProblem(body);
      case "getProblems":   return handleGetProblems();
      case "removeProblem": return handleRemoveProblem(body);
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
      const ssId = getSheetId(cfg.propKey);
      const ss = SpreadsheetApp.openById(ssId);
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
    } catch (err) {
      results[category] = { ok: false, error: err.toString() };
    }
  }

  return jsonResponse({ ok: true, totalWritten: totalWritten, results: results });
}


// =============================================================
// 2. 問題訂單
// =============================================================
function ensureProblemsSheet() {
  const ssId = getSheetId(PROBLEM_PROP_KEY);
  const ss = SpreadsheetApp.openById(ssId);
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
// Util
// =============================================================
function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
