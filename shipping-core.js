// ===================================================================
// 核心邏輯 (出貨表)
// ===================================================================
// 一筆訂單可能同時符合多個特殊分類(例如品名同時有「巨物」和「雷雕」關鍵字)
// → 要同時上傳到兩邊廠商試算表,所以回傳「全部命中」的分類,依優先序排列
function categorizeAll(row) {
  const hs = [
    row["商品名稱"] ?? "",
    row["規格設定"] ?? "",
    row["客製刻印選項"] ?? "",
    row["_備註"] ?? "",
  ].map(String).join(" ");
  const matches = [];
  for (const cat of SPECIAL_CATEGORIES) {
    for (const kw of cat.keys) {
      if (hs.includes(kw)) { matches.push(cat.name); break; }
    }
  }
  return matches;
}

// 單一分類(給排序、上色、字卡優先序用):取命中分類中優先序最高的一個
function categorize(row) {
  const matches = categorizeAll(row);
  return matches.length > 0 ? matches[0] : null;
}

// 計算各種數量(含黑熊細分、永生花細分、植物盆)
function computeStats(rows) {
  const counts = Object.fromEntries(SPECIAL_CATEGORIES.map(c => [c.name, 0]));
  rows.forEach(r => {
    const cats = r["_類別列表"] && r["_類別列表"].length ? r["_類別列表"] : (r["_類別"] ? [r["_類別"]] : []);
    cats.forEach(c => { if (counts[c] !== undefined) counts[c]++; });
  });

  // ---- 細分統計 ----
  // bear / plant 的子項是「數量」(給廠商對照用)
  // plantOrders 是「訂單筆數」(給字卡顯示用)
  // flowerCombos 是 Map<"花色|公仔", 累計數量>:
  //   花色由商品編號決定(粉/藍),公仔由規格設定決定(黃金運貓/粉招福貓)
  const bear = { baseball: 0, normal: 0 };
  const flowerCombos = new Map();   // ex: "粉|黃金運貓" => 3
  const plant = { beige: 0, green: 0, other: 0 };
  let plantOrders = 0;
  let offshore = 0;

  rows.forEach(r => {
    if (r["_離島"]) offshore++;

    const code = String(r["商品編號"] ?? "").trim();
    const qty = parseInt(r["數量"], 10) || 1;

    if (code === PRODUCT_CODES.BEAR_BASEBALL) bear.baseball += qty;
    else if (code === PRODUCT_CODES.BEAR_NORMAL) bear.normal += qty;

    // 永生花:商品編號決定花色,規格設定決定公仔
    if (r["_類別"] === "永生花") {
      let color;
      if (code === PRODUCT_CODES.FLOWER_PINK) color = "粉";
      else if (code === PRODUCT_CODES.FLOWER_BLUE) color = "藍";
      else color = "其他";   // 萬一商品編號變了,不要把資料丟掉

      const spec = String(r["規格設定"] ?? "");
      let figure;
      if (spec.includes("黃金運")) figure = "黃金運貓";
      else if (spec.includes("粉招福") || spec.includes("粉招") || spec.includes("粉福")) figure = "粉招福貓";
      else figure = spec.trim() || "(無規格)";   // 找不到就用原文,至少不掉資料

      const key = `${color}|${figure}`;
      flowerCombos.set(key, (flowerCombos.get(key) || 0) + qty);
    }

    if (code === PRODUCT_CODES.PLANT_POT) {
      plantOrders++;
      const spec = String(r["規格設定"] ?? "");
      if (spec.includes("米白")) plant.beige += qty;
      else if (spec.includes("綠")) plant.green += qty;
      else plant.other += qty;
    }
  });

  // 一般訂單 = 不屬於黑熊/盆景公仔組,而且不是離島•郵局(離島改郵局寄,不算一般出貨);永生花算一般訂單
  const excluded = new Set(["黑熊", "盆景公仔組"]);
  const regular = rows.filter(r => !excluded.has(r["_類別"]) && !r["_離島"]).length;

  return { regular, counts, total: rows.length, bear, flowerCombos, plant, plantOrders, offshore };
}

// 從商品名稱 + 規格設定 + 客製刻印抓「(小)/(中)/(大)」尺寸(有些品項尺寸是寫在規格設定,不是商品名稱)
// 回傳 0/1/2 讓同尺寸排在一起(小→中→大)
function extractSize(row) {
  const hs = [row["商品名稱"] ?? "", row["規格設定"] ?? "", row["客製刻印選項"] ?? ""].map(String).join(" ");
  const m = hs.match(/[(（]\s*(小|中|大)\s*[)）]/);
  if (!m) return -1;
  return { "小": 0, "中": 1, "大": 2 }[m[1]];
}

// 從規格設定 + 客製刻印 判斷「金運 / 招福」,金運在前
function styleOrder(row) {
  const hs = [row["規格設定"] ?? "", row["客製刻印選項"] ?? "", row["商品名稱"] ?? ""]
    .map(String).join(" ");
  if (hs.includes("金運")) return 0;
  if (hs.includes("招福")) return 1;
  return 2;
}

// 星座貓分組用:是不是星座貓(用清理後的名稱判斷,不受格式差異影響)、以及對到哪個星座
const ZODIAC_SIGNS = ["牡羊座", "金牛座", "雙子座", "巨蟹座", "獅子座", "處女座", "天秤座", "天蠍座", "射手座", "摩羯座", "水瓶座", "雙魚座"];

function isZodiacCat(row) {
  return cleanProductName(row["商品名稱"]).includes("星座貓");
}

function extractZodiac(row) {
  const hs = [row["商品名稱"] ?? "", row["規格設定"] ?? "", row["客製刻印選項"] ?? ""].map(String).join(" ");
  const sign = ZODIAC_SIGNS.find(z => hs.includes(z));
  return sign ? ZODIAC_SIGNS.indexOf(sign) : -1;
}

function matchKeys(hs, keys) {
  return keys.every(k => hs.includes(String(k).replace(/\s+/g, "")));
}

// 一般品項(非黑熊/永生花/盆景/注意品項/雷雕)的分區順序:
//   A 區:注意品項(由 SPECIAL_CATEGORIES 優先序處理,不在這裡) → 其他(不屬於 B、C、D 任一區的品項)
//   B 區:好運禮盒系列 → 護手霜 → 消波塊(禮盒版→一般版) → 精油貓(禮盒版→一般版)
//   C 區:胖胖貓(組內再依小→中→大排序,見下方 extractSize,規則不變)
//   D 區:星座貓(組內再依星座順序排序,見下方 extractZodiac,規則不變)
// 消波塊 / 精油貓有明確商品編號,直接比對編號最準,不再靠關鍵字硬湊。
// 找不到對應區塊的品項回傳 -1,讓它排在 B、C、D 三區之前(即「其他」)。
// 只給下方 handleFile 的單一出貨表排序用;分區列印已改成依商品編號分組(見 buildPickGroups),不再用這組 ABCD 順序。
const ZONE_ORDER = [
  { keys: ["護手霜"] },                        // B1 護手霜
  { code: PRODUCT_CODES.TETRAPOD_BOX },        // B2 消波塊(禮盒版)
  { code: PRODUCT_CODES.TETRAPOD_NORMAL },     // B3 消波塊(一般版)
  { code: PRODUCT_CODES.OIL_CAT_BOX },         // B4 精油貓(禮盒版)
  { code: PRODUCT_CODES.OIL_CAT_NORMAL },      // B5 精油貓(一般版)
  { keys: ["胖胖貓"] },                        // C  胖胖貓
  { keys: ["星座貓"] },                        // D  星座貓
];

function zoneRank(row) {
  const code = String(row["商品編號"] ?? "").trim();
  // 雙喵、團圓貓的商品名稱套用 REPLACE_PATTERNS 後會混進「胖胖貓」字樣
  // (原始名稱是「胖胖招財招福貓…」),要先排除,不然會被 C 區關鍵字誤攔截
  if (A_GROUP_ORDER.some(z => code === z.code)) return -1;
  const hs = rowHaystack(row);
  const idx = ZONE_ORDER.findIndex(z => z.code ? code === z.code : matchKeys(hs, z.keys));
  return idx === -1 ? -1 : idx;
}

// A 區(其他)內部:雙喵、團圓貓為同一群組,固定排在其他一般品項最前面,且雙喵 → 團圓貓
const A_GROUP_ORDER = [
  { code: PRODUCT_CODES.DOUBLE_CAT },    // 雙喵
  { code: PRODUCT_CODES.REUNION_CAT },   // 團圓貓
];

function aGroupRank(row) {
  const code = String(row["商品編號"] ?? "").trim();
  const idx = A_GROUP_ORDER.findIndex(z => code === z.code);
  return idx === -1 ? Infinity : idx;
}

// A 區(其他)內:雙手貓(原「圓滾滾幸運貓」,見上方 REPLACE_PATTERNS)一律依顏色排序,
// 不分尺寸(中/大)或團圓版(三入)組合
const A_COLOR_ORDER = ["黃", "黑", "白", "綠", "灰", "粉"];

function isDoubleHandCat(row) {
  return rowHaystack(row).includes("雙手貓");
}

function colorRank(row) {
  const hs = rowHaystack(row);
  const idx = A_COLOR_ORDER.findIndex(c => hs.includes(c));
  return idx === -1 ? Infinity : idx;
}

async function handleFile(file, statusId = "status") {
  setStatus(statusId, "loading", "讀取中…");
  try {
    const data = await file.arrayBuffer();
    const wb = XLSX.read(data, { type: "array" });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { raw: false, defval: "" });

    if (rows.length === 0) throw new Error("訂單表沒有資料");
    const missing = REQUIRED_COLS.filter(c => !(c in rows[0]));
    if (missing.length > 0) throw new Error(`缺少欄位:${missing.join("、")}`);

    rows.forEach(r => {
      r["_備註"] = buildNote(r);
      r["_類別列表"] = categorizeAll(r);
      r["_類別"] = r["_類別列表"][0] || null;
      r["_離島"] = extractOffshoreCounty(r["配送地址"]);
    });

    const prioMap = Object.fromEntries(SPECIAL_CATEGORIES.map(c => [c.name, c.priority]));
rows.sort((a, b) => {
  // 1. 特殊類別優先序(黑熊 > 永生花 > 盆景 > 注意品項 > 雷雕 > 一般)
  const pa = prioMap[a["_類別"]] ?? 0;
  const pb = prioMap[b["_類別"]] ?? 0;
  if (pa !== pb) return pa - pb;

  // 1.2 分區順序(B 好運禮盒系列 → C 胖胖貓 → D 星座貓),優先於下面所有排序規則;
  // -1(其他/不屬於任何分區)一律排在 B、C、D 三區之前
  const ra = zoneRank(a), rb = zoneRank(b);
  if (ra !== rb) return ra - rb;

  // 1.3 A 區(其他)內部特殊分組
  if (ra === -1) {
    // 雙喵、團圓貓固定排在其他一般品項最前面,且雙喵 → 團圓貓
    const aa = aGroupRank(a), ab = aGroupRank(b);
    if (aa !== ab) return aa - ab;

    // 雙手貓一律依顏色排序(黃→黑→白→綠→灰→粉),不分尺寸/團圓版
    if (isDoubleHandCat(a) && isDoubleHandCat(b)) {
      const ca = colorRank(a), cb = colorRank(b);
      if (ca !== cb) return ca - cb;
    }
  }

  // 1.5 尺寸「小→中→大」排在一起,不管品項是什麼(同一分類內優先照尺寸分堆)
  const szA = extractSize(a), szB = extractSize(b);
  if (szA !== -1 && szB !== -1 && szA !== szB) return szA - szB;

  // 1.7 星座貓(雷雕除外):是星座貓字眼的排在一起,同星座再排在一起
  if (a["_類別"] !== "雷雕" && b["_類別"] !== "雷雕") {
    const za = isZodiacCat(a) ? 1 : 0;
    const zb = isZodiacCat(b) ? 1 : 0;
    if (za !== zb) return za - zb;
    if (za && zb) {
      const zi = extractZodiac(a) - extractZodiac(b);
      if (zi !== 0) return zi;
    }
  }

  // 2. 用「清理後的商品名稱」排,讓「【泥研製所||辦公室小物】」和「【辦公室小物】」合併
  const n1 = cleanProductName(a["商品名稱"]).localeCompare(cleanProductName(b["商品名稱"]));
  if (n1 !== 0) return n1;

  // 3. 同品項內:金運 → 招福 → 其他
  const s1 = styleOrder(a) - styleOrder(b);
  if (s1 !== 0) return s1;

  // 4. 最後再依規格設定排(顏色等)
  return String(a["規格設定"] ?? "").localeCompare(String(b["規格設定"] ?? ""));
});

    loadedRows = rows;
    renderStats(computeStats(rows));
    document.getElementById("runBtn").disabled = false;
    const counts = lastStats.counts;
    const uploadableCount = UPLOAD_CATEGORIES.reduce((s, c) => s + (counts[c] ?? 0), 0);
    document.getElementById("uploadBtn").disabled = false;
    document.getElementById("offshorePdfBtn").disabled = !rows.some(r => r["_離島"]);
    document.getElementById("zonedPrintBtn").disabled = false;
    updateZonedStats(rows);
    setStatus(statusId, "success", `✓ 已載入 ${rows.length} 筆資料,可執行匯出`);

    // 載入完成後比對問題訂單清單
    checkProblemOrdersAgainstLoaded();
  } catch (e) {
    loadedRows = null;
    document.getElementById("runBtn").disabled = true;
    document.getElementById("uploadBtn").disabled = true;
    document.getElementById("offshorePdfBtn").disabled = true;
    document.getElementById("zonedPrintBtn").disabled = true;
    setStatus(statusId, "error", `✗ 讀取失敗:${e.message}`);
    resetShippingStats();
    resetZonedStats();
    hideProblemAlert();
  }
}

function renderStats(s) {
  lastStats = s;
  document.getElementById("stat-total").textContent = s.total;
  document.getElementById("stat-regular").textContent = s.regular;
  document.getElementById("stat-offshore").textContent = s.offshore ?? 0;

  // 字卡一律顯示訂單筆數
  SPECIAL_CATEGORIES.forEach(c => {
    const el = document.getElementById(c.uiId);
    if (!el) return;
    el.textContent = s.counts[c.name] ?? 0;
  });

  document.getElementById("statsHint").textContent = `共 ${s.total} 筆訂單`;

  // ===== 廠商對照(每廠商一張卡 + 各自的複製鈕) =====
  // 規則:
  // 1. 每行前面加「今天   」
  // 2. 數量為 0 的子項不顯示
  // 3. 整類別子項全為 0 → 整張卡不出現
  // 4. 永生花:商品編號決定花色,規格設定決定公仔,顯示「粉【黃金運貓】 N個」
  const PREFIX = "今天   ";
  const blocks = [];   // [{ title: "黑熊", lines: [...], cls: "bear" }, ...]

  // 黑熊
  {
    const parts = [];
    if (s.bear.baseball > 0) parts.push(`棒球熊 ${s.bear.baseball} 隻`);
    if (s.bear.normal > 0) parts.push(`一般熊 ${s.bear.normal} 隻`);
    if (parts.length > 0) {
      blocks.push({ title: "黑熊", cls: "bear", lines: [`${PREFIX}${parts.join(",")}`] });
    }
  }

  // 永生花
  if (s.flowerCombos && s.flowerCombos.size > 0) {
    const COLOR_ORDER = { "粉": 0, "藍": 1, "其他": 99 };
    const sorted = Array.from(s.flowerCombos.entries()).sort((a, b) => {
      const [colorA] = a[0].split("|");
      const [colorB] = b[0].split("|");
      const oa = COLOR_ORDER[colorA] ?? 50;
      const ob = COLOR_ORDER[colorB] ?? 50;
      if (oa !== ob) return oa - ob;
      return b[1] - a[1];
    });
    const flowerLines = [];
    for (const [key, qty] of sorted) {
      if (qty <= 0) continue;
      const [color, figure] = key.split("|");
      flowerLines.push(`${PREFIX}${color}【${figure}】 ${qty}個`);
    }
    if (flowerLines.length > 0) {
      blocks.push({ title: "永生花", cls: "flower", lines: flowerLines });
    }
  }

  // 植物盆
  {
    const parts = [];
    if (s.plant.beige > 0) parts.push(`米白盆 ${s.plant.beige} 個`);
    if (s.plant.green > 0) parts.push(`綠盆 ${s.plant.green} 個`);
    if (s.plant.other > 0) parts.push(`其他色 ${s.plant.other} 個`);
    if (parts.length > 0) {
      blocks.push({ title: "植物盆", cls: "plant", lines: [`${PREFIX}${parts.join(",")}`] });
    }
  }

  const container = document.getElementById("vendor-blocks");
  if (blocks.length === 0) {
    container.innerHTML = `<div class="vendor-empty">今天沒有黑熊、永生花、植物盆訂單</div>`;
  } else {
    container.innerHTML = blocks.map(b => {
      // 把要複製的文字塞進 data 屬性,複製鈕會讀
      const copyText = b.lines.join("\n");
      const dataCopy = escapeHtml(copyText);
      const bodyHtml = escapeHtml(copyText);
      return `
        <div class="vendor-block ${b.cls}">
          <div class="vendor-block-header">
            <span class="vendor-block-title">【${b.title}】</span>
            <button class="vendor-block-copy" data-copy="${dataCopy}" onclick="copyVendorBlock(this)">📋 複製</button>
          </div>
          <div class="vendor-block-body">${bodyHtml}</div>
        </div>
      `;
    }).join("");
  }
}

function resetShippingStats() {
  lastStats = null;
  ["stat-total", "stat-regular", "stat-bonsai", "stat-offshore"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = "—";
  });
  SPECIAL_CATEGORIES.forEach(c => {
    const el = document.getElementById(c.uiId);
    if (el) el.textContent = "—";
  });
  document.getElementById("statsHint").textContent = "";
  const container = document.getElementById("vendor-blocks");
  if (container) container.innerHTML = `<div class="vendor-empty">載入訂單後顯示…</div>`;
}

function copyVendorBlock(btn) {
  const text = btn.getAttribute("data-copy") || "";
  navigator.clipboard.writeText(text).then(() => {
    const orig = btn.textContent;
    btn.textContent = "✓ 已複製";
    setTimeout(() => { btn.textContent = orig; }, 1200);
  });
}

const MAX_ROWS_PER_FILE = 100;

// 把一批已排序好的訂單資料寫成一或多份黑貓出貨表 xlsx(超過 MAX_ROWS_PER_FILE 自動分檔);
// filePrefix 例如 "黑貓出貨表" 或 "黑貓出貨表_A區",回傳實際檔案數與命中的問題訂單數,給呼叫端組出狀態訊息
function writeBcatFiles(rows, filePrefix) {
  const today = todayStr();
  const total = rows.length;
  const fileCount = Math.ceil(total / MAX_ROWS_PER_FILE);
  const catMap = Object.fromEntries(
    SPECIAL_CATEGORIES.map(c => [c.name, { bg: c.bg, fg: c.fg }])
  );

  // 問題訂單橘色樣式 (優先於分類色)
  const PROBLEM_STYLE = { bg: "FF8F00", fg: "FFFFFF" };
  const problemIds = new Set(problemListCache.map(p => p.orderId));
  let problemHitInExport = 0;

  for (let part = 0; part < fileCount; part++) {
    const start = part * MAX_ROWS_PER_FILE;
    const end = Math.min(start + MAX_ROWS_PER_FILE, total);
    const chunk = rows.slice(start, end);

    const aoa = [TEMPLATE_HEADERS.slice()];
    const rowStyles = [];

    chunk.forEach(row => {
      const newRow = new Array(TEMPLATE_HEADERS.length).fill("");
      for (const [src, dst] of Object.entries(FIELD_MAPPING)) {
        const col = TEMPLATE_HEADERS.indexOf(dst);
        if (col >= 0) newRow[col] = row[src] ?? "";
      }
      newRow[TEMPLATE_HEADERS.indexOf("備註")] = row["_備註"];
      newRow[TEMPLATE_HEADERS.indexOf("寄件人姓名")] = SENDER_NAME;
      newRow[TEMPLATE_HEADERS.indexOf("件數")] = ITEM_COUNT;
      newRow[TEMPLATE_HEADERS.indexOf("品名(詳參數表)")] = ITEM_NAME_CODE;
      aoa.push(newRow);

      // 問題訂單優先 → 橘色;否則才用原本分類顏色
      const orderId = String(row["訂單編號"] ?? "").trim();
      if (orderId && problemIds.has(orderId)) {
        rowStyles.push(PROBLEM_STYLE);
        problemHitInExport++;
      } else {
        rowStyles.push(row["_類別"] ? catMap[row["_類別"]] : null);
      }
    });

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    rowStyles.forEach((style, i) => {
      if (!style) return;
      const excelRow = i + 1;
      for (let c = 0; c < TEMPLATE_HEADERS.length; c++) {
        const addr = XLSX.utils.encode_cell({ r: excelRow, c });
        if (!ws[addr]) ws[addr] = { t: "s", v: "" };
        ws[addr].s = {
          fill: { patternType: "solid", fgColor: { rgb: style.bg } },
          font: { color: { rgb: style.fg }, bold: true },
        };
      }
    });

    ws["!cols"] = TEMPLATE_HEADERS.map(h => {
      if (h === "收件人地址" || h === "備註") return { wch: 32 };
      if (h === "收件人姓名" || h === "寄件人姓名") return { wch: 14 };
      if (h === "訂單編號") return { wch: 22 };
      if (h === "收件人手機") return { wch: 13 };
      return { wch: 10 };
    });

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "空白傳託運單資料表");

    const filename = fileCount === 1
      ? `${filePrefix}_${today}.xlsx`
      : `${filePrefix}_${today}_${part + 1}_共${fileCount}.xlsx`;
    XLSX.writeFile(wb, filename, { cellStyles: true, bookType: "xlsx" });
  }

  return { fileCount, problemHitInExport };
}

function generateOutput() {
  if (!loadedRows) return;
  setStatus("status", "loading", "產生出貨表中…");
  setTimeout(() => {
    try {
      const EXCLUDE_FROM_LOCAL = new Set(["黑熊", "盆景公仔組"]);
      const exportRows = loadedRows.filter(r => !EXCLUDE_FROM_LOCAL.has(r["_類別"]) && !r["_離島"]);

      if (exportRows.length === 0) {
        setStatus("status", "warn",
          `⚠ 全部 ${loadedRows.length} 筆都屬於黑熊/盆景公仔組/離島•郵局,已不下載本地表(請用一鍵上傳)`);
        return;
      }

      const excludedCount = loadedRows.length - exportRows.length;
      const today = todayStr();
      const { fileCount, problemHitInExport } = writeBcatFiles(exportRows, "黑貓出貨表");

      let msg = fileCount === 1
        ? `✓ 已下載黑貓出貨表_${today}.xlsx  (${exportRows.length} 筆)`
        : `✓ 已下載 ${fileCount} 個檔案  (共 ${exportRows.length} 筆)`;
      if (excludedCount > 0) msg += `  · 另 ${excludedCount} 筆(黑熊/盆景/離島)請用上傳`;
      if (problemHitInExport > 0) msg += `  · 🟧 ${problemHitInExport} 筆問題訂單已橘色反白`;
      setStatus("status", "success", msg);
    } catch (e) {
      setStatus("status", "error", `✗ 匯出失敗:${e.message}`);
      console.error(e);
    }
  }, 50);
}

