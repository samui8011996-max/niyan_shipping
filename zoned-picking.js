// ===================================================================
// 分區列印:依「商品編號」分組(方便撿貨),不再用 ABCD 分區。
// 規則:
//   1. 同商品編號(含別名,見 CODE_ALIASES)分成一組,組內數量加總「超過」門檻(預設 5)
//      → 單獨產生一張黑貓出貨單
//   2. 沒超過門檻的品項,全部併入同一張「其他合併」出貨單
//      (太少的話每個品項各出一張,列印張數暴增,反而不利撿貨)
//   3. 星座(星座貓)、尺寸(小/中/大)是撿貨會拿不同盒子的物理差異,不管有沒有勾選細分,
//      一律先照這兩個拆開,同編號不代表可以合在一起撿貨
//   4. 勾選「同編號內再依顏色/規格細分」時,分組 key 會再多接規格設定全文一起比對,
//      同編號但不同顏色/規格也能各自獨立出一張單
// 商品編號、名稱的權威資料來源是「全商品.xls」;新增別名時對照該表確認是同一實體商品。
// ===================================================================

// 賣場常常同一個實體商品開兩個以上的商品編號(不同活動/版位上架),要當同一品項合併撿貨。
// key = 別名編號,value = 要合併過去的正式(代表)編號,選誰當代表不影響列印結果
const CODE_ALIASES = {
  "322027877": "322387422",  // 6色可選【辦公室小物】胖胖招財招福貓(小)+元寶 → 跟 322387422 是同一個「胖胖貓(小)六色」商品
  "322282246": "322415648",  // 精油貓(一般版,PRODUCT_CODES.OIL_CAT_NORMAL)→ 跟 322415648(精油貓禮盒版,PRODUCT_CODES.OIL_CAT_BOX)是同一個東西
  "322027863": "322413765",  // 消波塊(一般版,PRODUCT_CODES.TETRAPOD_NORMAL)→ 跟 322413765(消波塊禮盒版,PRODUCT_CODES.TETRAPOD_BOX)是同一類,一起分區列印
};

function canonicalCode(code) {
  const c = String(code ?? "").trim();
  return CODE_ALIASES[c] || c;
}

// 有「禮盒版/一般版」別名合併的商品,禮盒版的訂單要排在前面(方便撿貨先出禮盒),
// 新增類似的別名組合時,把禮盒版的商品編號也加進這裡
const GIFT_BOX_CODES = new Set([PRODUCT_CODES.OIL_CAT_BOX, PRODUCT_CODES.TETRAPOD_BOX]);
function isGiftBoxVariant(row) {
  return GIFT_BOX_CODES.has(String(row["商品編號"] ?? "").trim());
}

// 雷雕(客製刻印)不管是辦公室品項、胖胖一對(小)、還是大/中雷雕,一律歸成同一類,
// 不照商品/尺寸拆開 —— 這些訂單撿貨後都是送去同一個雷雕站,重點是「要不要雷雕」,不是雷雕的是什麼商品。
// 判斷邏輯跟 SPECIAL_CATEGORIES 的「雷雕」關鍵字比對規則一致(見 categorizeAll)。
function isLaserItem(row) {
  const hs = [row["商品名稱"], row["規格設定"], row["客製刻印選項"], row["_備註"]]
    .map(s => String(s ?? "")).join(" ");
  return hs.includes("雷雕");
}

// 胖胖招財招福貓「素體」款式非常多(顏色、金運/招福、單隻/一對……都各自開一個商品編號),
// 但撿貨只在乎尺寸(要拿哪個尺寸的箱子/袋子)和金運/招福(公仔款式不同,不能混拿),
// 顏色這種更細的差異才交給展開明細 + 分單處理,所以一律先照「尺寸 + 金運/招福」分,不看商品編號。
// 借用 zoneRank 既有的判斷順序(已經排除雙喵/團圓貓,也已經讓護手霜、消波塊、精油貓等特例組合
// 優先比對命中,不會被這裡的廣義「胖胖貓」關鍵字誤吃掉),確保跟 tab1 出貨表排序邏輯認定一致。
const PANGPANG_ZONE_INDEX = ZONE_ORDER.findIndex(z => z.keys && z.keys[0] === "胖胖貓");
function isPangpangCat(row) {
  return zoneRank(row) === PANGPANG_ZONE_INDEX;
}

// 星座貓(+元寶)常常換季重新上架,商品編號一直換,同一星座卻對到好幾個不同編號;
// 撿貨只在乎星座是哪一個,所以不管有沒有勾「依規格細分」,星座貓一律先照星座拆開,同星座才算同一品項
function zodiacGroupSuffix(row) {
  if (!isZodiacCat(row)) return null;
  const zi = extractZodiac(row);
  return zi === -1 ? "其他星座" : ZODIAC_SIGNS[zi];
}

// 尺寸(小/中/大)一樣是撿貨會拿不同盒子的物理差異,cleanProductName 為了排序把它從名稱去掉了,
// 分組/標籤要靠 extractSize 加回來,不然不同尺寸的胖胖貓會併成同一組、同一個檔名
const SIZE_LABELS = ["小", "中", "大"];
function sizeGroupSuffix(row) {
  const idx = extractSize(row);
  return idx === -1 ? null : SIZE_LABELS[idx];
}

// 金運/招福是不同的公仔款式,實體長得不一樣,撿貨不能混拿,借用既有的 styleOrder 判斷
// (0=金運、1=招福、2=看不出來),一律給明確的分組後綴,不留模糊地帶
function styleGroupSuffix(row) {
  const s = styleOrder(row);
  return s === 0 ? "金運" : s === 1 ? "招福" : "其他公仔";
}

// 「一對」是兩隻一組的組合裝,包裝/撿貨方式跟單隻不一樣,要獨立分開,不能跟單隻同一個尺寸/款式混在一起算
function isPangpangPair(row) {
  return rowHaystack(row).includes("一對");
}

// 組出這筆訂單的分組後綴(依序:星座、尺寸,勾選「依規格細分」時再外加規格設定全文);
// pickGroupKey(分組用) 和 buildPickGroups 的品項標籤共用同一份規則,確保「同一組」跟「同一個標籤」永遠對得上
function groupSuffixParts(row, splitBySpec) {
  const parts = [];
  const zodiac = zodiacGroupSuffix(row);
  if (zodiac) parts.push(zodiac);
  const size = sizeGroupSuffix(row);
  if (size) parts.push(size);
  if (splitBySpec) {
    const spec = String(row["規格設定"] ?? "").trim();
    if (spec) parts.push(spec);
  }
  return parts;
}

function pickGroupKey(row, splitBySpec) {
  // 雷雕最優先判斷:不管商品、尺寸,一律歸同一類
  if (isLaserItem(row)) return "LASER";

  // 星座貓常常換季重新上架、商品編號一直換,但同一個星座其實是同一個實體商品,
  // 撿貨只在乎星座,不在乎是哪一次上架的編號 → 一律只用星座當 key,完全不看商品編號
  const zodiac = zodiacGroupSuffix(row);
  if (zodiac) return `ZODIAC|${zodiac}`;

  // 胖胖貓「素體」款式(顏色/金運招福)一律只看尺寸+款式,不看商品編號;
  // 一對(兩隻一組)另外獨立分開,不跟單隻的同尺寸/款式混在一起
  if (isPangpangCat(row)) {
    const pair = isPangpangPair(row) ? "PAIR" : "SINGLE";
    return `PANGPANG|${pair}|${sizeGroupSuffix(row) || "無尺寸"}|${styleGroupSuffix(row)}`;
  }

  const code = canonicalCode(row["商品編號"]);
  const parts = groupSuffixParts(row, splitBySpec);
  return parts.length ? `${code}|${parts.join("|")}` : code;
}

// 同一張出貨單內部排序:禮盒版優先 → 金運/招福 → 尺寸 → 規格文字,盡量讓同色/同款排在一起方便撿貨
function comparePickGroupRows(a, b) {
  const boxA = isGiftBoxVariant(a) ? 0 : 1;
  const boxB = isGiftBoxVariant(b) ? 0 : 1;
  if (boxA !== boxB) return boxA - boxB;

  const s1 = styleOrder(a) - styleOrder(b);
  if (s1 !== 0) return s1;
  const szA = extractSize(a), szB = extractSize(b);
  if (szA !== -1 && szB !== -1 && szA !== szB) return szA - szB;
  return String(a["規格設定"] ?? "").localeCompare(String(b["規格設定"] ?? ""));
}

function sanitizeFilenamePart(s) {
  return String(s ?? "").replace(/[\\/:*?"<>|]/g, "").trim().slice(0, 40);
}

// 併過 CODE_ALIASES 的品項,不同編號的原始商品名稱往往長得不一樣(例如精油貓禮盒版寫「+精油禮盒」,
// 一般版寫「繽紛好運精油組」);標籤要挑固定的一列當範本,不然同一品項會因為訂單裡誰先出現,
// 每次匯出顯示不同名稱。優先挑「商品編號本身就是代表編號」的那一列,沒有的話才退回第一列。
function pickGroupSampleRow(rows) {
  const canon = canonicalCode(rows[0]["商品編號"]);
  return rows.find(r => String(r["商品編號"] ?? "").trim() === canon) || rows[0];
}

// 完整品項名稱:直接用 _備註(跟 handleFile 一開始算好、實際會印在黑貓出貨單「備註」欄的同一份文字),
// 已經套過 REPLACE/REMOVE 規則清掉「限定登場｜」「不加購」這類雜訊,不是原始規格設定的生文字。
// 結尾的 x數量 展開明細另外顯示件數,這裡拿掉避免重複。
function fullItemLabel(row) {
  const note = String(row["_備註"] ?? "").trim().replace(/\s*[x×]\s*\d+\s*$/i, "").trim();
  return note || cleanProductName(row["商品名稱"]) || "(無品名)";
}

// 拿掉「加購OO: XXX」這段描述(不管有沒有真的加購了什麼),胖胖貓展開明細只在乎顏色/款式,
// 加購精油口味、要不要木片底座這些額外選項不該讓同一個顏色被拆成好幾個假分組
function stripAddonText(text) {
  let s = String(text ?? "")
    .replace(/[,，]?\s*\+?加購[一-鿿A-Za-z0-9]*\s*[:：][^,，]*/g, "");
  // 去掉結尾殘留的逗號/破折號(客製刻印選項是空值時常留下的佔位符),
  // 不然「有加購被濾掉」跟「原本就沒加購」的兩種訂單,結尾會一個有 " -" 一個沒有,誤判成不同分組
  s = s.replace(/[\s,，]*-\s*$/, "");
  return s.replace(/\s+/g, " ").trim();
}

// 展開明細用的顯示文字:一律濾掉加購選項文字(不管哪種品項),加購資訊改用 addonSummary
// 另外彙總成一行(見下方 addonSummaryLine),不然同一個品項會因為加購選項不同被拆成一堆假分組
function breakdownLabel(row) {
  return stripAddonText(fullItemLabel(row)) || fullItemLabel(row);
}

// 從完整品項名稱裡的「加購OO: XXX」擷取簡短描述,例如「+加購精油: 茶樹」→「精油-茶樹」,
// 「+加購木片底座: 木片」→「木片」(欄位名跟選項值重複時只顯示選項值),完全沒有加購欄位 → 「無」
function extractAddonSummary(row) {
  const note = fullItemLabel(row);
  const matches = [...note.matchAll(/\+?加購([一-鿿A-Za-z0-9]*)\s*[:：]\s*([^,，]*)/g)];
  if (matches.length === 0) return "無加購";
  return matches.map(([, kind, val]) => {
    const k = String(kind ?? "").trim();
    const v = String(val ?? "").trim();
    if (!v) return k || "加購";
    if (!k || k.includes(v) || v.includes(k)) return v;
    return `${k}-${v}`;
  }).join("+");
}

// 展開明細分組雖然不看加購,但加購資訊還是要看得到,
// 所以把同一組底下各種加購選項的件數彙總成一行,寫在品名旁邊,例如「無(3) 精油-茶樹(2) 木片(5)」
function addonSummaryLine(rows) {
  const counts = new Map();
  rows.forEach(row => {
    const desc = extractAddonSummary(row);
    const qty = parseInt(row["數量"], 10) || 1;
    counts.set(desc, (counts.get(desc) || 0) + qty);
  });
  return Array.from(counts.entries())
    .sort((a, b) => (a[0] === "無加購" ? -1 : b[0] === "無加購" ? 1 : b[1] - a[1]))
    .map(([desc, qty]) => `${desc}(${qty})`)
    .join("　　");
}

// 展開明細(獨立品項的規格拆分、其他合併的併單明細)共用同一份分組邏輯:
// 用清理過的顯示文字(breakdownLabel)當分組依據兼顯示文字,不用原始規格設定 ——
// 規格設定裡常常一堆「+加購OO: 不加購」這種加購選項雜訊,拿來分組會把同一個品項拆成一堆幾乎一樣的假分組。
// pickGroupKey(row, false) 確保還是先照商品編號/星座/尺寸分開,不會把不同商品混在一起算成同一列。
function buildFineBreakdown(rows) {
  const map = new Map();
  rows.forEach(row => {
    // 分組(哪些列算同一行)用細的 pickGroupKey,不同顏色/規格還是各自一行;
    // 排序用的粗分組(family)另外算,見下面 —— 兩者用途不同,不能共用同一把 key
    const key = `${pickGroupKey(row, false)}::${breakdownLabel(row)}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  });

  const entries = Array.from(map.values()).map(groupRows => ({
    rows: groupRows,
    familyKey: pickGroupFamilyKey(groupRows[0]),
    qty: groupRows.reduce((s, r) => s + (parseInt(r["數量"], 10) || 1), 0),
    fullName: breakdownLabel(groupRows[0]),
    // 分組時已經把加購濾掉了,靠這行補回加購資訊(彙總各種加購選項的件數),不限胖胖貓,全品項都適用
    addonSummary: addonSummaryLine(groupRows),
  }));

  // 同一個粗分組(family,例如胖胖貓同尺寸不管金運/招福,或消波塊禮盒版+一般版合併後同一個 pickGroupKey)
  // 的規格明細要排在一起,不能單純照件數排,不然會被打散到清單各處、看不出是同一個商品。
  // 胖胖貓家族之間優先照尺寸小→中→大排,其他組跟組之間仍照「這組的件數總和」由多到少排,組內再照件數排序。
  const familyTotals = new Map();
  entries.forEach(e => familyTotals.set(e.familyKey, (familyTotals.get(e.familyKey) || 0) + e.qty));

  return entries.sort((a, b) => {
    if (a.familyKey !== b.familyKey) return compareFamilies(a.familyKey, b.familyKey, familyTotals);
    return b.qty - a.qty || a.fullName.localeCompare(b.fullName);
  });
}

// 「獨立出單品項」展開明細 + 分單勾選用:同一群組內商品編號/星座/尺寸都已經一樣,
// 只是規格(通常是顏色)不同,所以直接沿用 buildFineBreakdown。
function buildSpecBreakdown(rows) {
  return buildFineBreakdown(rows);
}

// 「其他合併」展開明細用,同一套分組邏輯
function buildMergedDetailLines(mergedRows) {
  return buildFineBreakdown(mergedRows);
}

// 排序/分群用的「粗分組」key,比 pickGroupKey 更寬鬆:胖胖貓不管金運/招福、單隻/一對,
// 只要同尺寸就算同一家族,排序/展開明細才會看到「同尺寸的都排在一起」,不會被款式或單隻/一對拆散。
// 注意:這只影響排序跟「哪些行放在一起顯示」,實際分行(pickGroupKey)還是有分單隻/一對,
// 出貨單不會把它們的件數混算成同一行。展開明細清單(其他合併、獨立品項規格拆分)
// 跟頂層「獨立出單品項」清單排序都共用這個。
function pickGroupFamilyKey(row) {
  if (isPangpangCat(row)) {
    return `PANGPANG|${sizeGroupSuffix(row) || "無尺寸"}`;
  }
  return pickGroupKey(row, false);
}

function zonedGroupFamilyKey(g) {
  return pickGroupFamilyKey(g.rows[0]);
}

// 家族跟家族之間的排序:如果兩邊都是胖胖貓家族,不管件數多少,一律優先照尺寸小→中→大排,
// 因為使用者要看的是「同尺寸的放一起」,不是「件數多的放前面」;
// 其他情況(非胖胖貓、或胖胖貓跟其他品項比較)還是照「這個家族的件數總和」由多到少排。
function compareFamilies(fa, fb, familyTotals) {
  const SIZE_RANK = { "小": 0, "中": 1, "大": 2 };
  const ma = /^PANGPANG\|(.+)$/.exec(fa);
  const mb = /^PANGPANG\|(.+)$/.exec(fb);
  if (ma && mb) {
    const sa = SIZE_RANK[ma[1]] ?? 99, sb = SIZE_RANK[mb[1]] ?? 99;
    return sa - sb;
  }
  const diff = familyTotals.get(fb) - familyTotals.get(fa);
  return diff !== 0 ? diff : fa.localeCompare(fb);
}

// 「獨立出單品項」清單排序:同一個粗分組(例如胖胖貓同尺寸的金運/招福)排在一起,不會被拆散到清單各處;
// 胖胖貓家族之間優先照尺寸小→中→大排,其他組跟組之間依「這組件數總和」由多到少排,組內再依件數排序。
function sortZonedGroups(list) {
  const familyTotals = new Map();
  list.forEach(g => {
    const fk = zonedGroupFamilyKey(g);
    familyTotals.set(fk, (familyTotals.get(fk) || 0) + g.qty);
  });
  return list.sort((a, b) => {
    const fa = zonedGroupFamilyKey(a), fb = zonedGroupFamilyKey(b);
    if (fa !== fb) return compareFamilies(fa, fb, familyTotals);
    return b.qty - a.qty || a.label.localeCompare(b.label);
  });
}

// 這些「粗分組」不管數量多少,一律獨立出單,不會因為沒超過門檻被併入「其他合併」——
// key 就是 pickGroupKey(row, false) 的輸出,之後有類似需求(某個品項一律要獨立列印撿貨)就加進這個清單。
const FORCE_INDEPENDENT_GROUP_KEYS = new Set([
  "PANGPANG|SINGLE|小|招福",  // 胖胖貓(小)招福
  "322415648|小",             // 精油組(小)(322415648 精油貓禮盒版 + 322282246 精油貓一般版,別名合併後的 key)
  "LASER",                    // 雷雕(不分辦公室/喵客製...等商品,見 isLaserItem)
]);

// 把 exportRows 依商品編號(或編號+規格)分組:
//   ownGroups:數量超過門檻的品項,各自一組 { label, rows, qty }(依名稱排序)
//   mergedGroups:沒超過門檻的品項,同樣各自一組 { label, rows, qty },但依數量由多到少排序
//                (給下方「併單明細」預覽用,方便一眼看出哪些品項被併掉、各併了幾個)
//   mergedRows:mergedGroups 攤平、排序好的版本,直接拿去寫「其他合併」出貨單
function buildPickGroups(exportRows, splitBySpec, threshold) {
  const groups = new Map();
  exportRows.forEach(row => {
    const key = pickGroupKey(row, splitBySpec);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  });

  const ownGroups = [];
  const mergedGroups = [];

  for (const [key, rows] of groups) {
    const qty = rows.reduce((s, r) => s + (parseInt(r["數量"], 10) || 1), 0);
    const sample = pickGroupSampleRow(rows);
    // 雷雕、胖胖貓(依尺寸)這兩組都混了不同商品/顏色/款式,用固定文字當標籤,
    // 不要拿其中一列的品名代表整組,不然會誤導成「這組只有這個商品」
    let label;
    if (isLaserItem(sample)) {
      label = "雷雕客製刻印(不分商品/尺寸)";
    } else if (isPangpangCat(sample)) {
      const namePrefix = isPangpangPair(sample) ? "胖胖貓一對" : "胖胖貓";
      label = `${namePrefix}(${sizeGroupSuffix(sample) || "無尺寸"} ${styleGroupSuffix(sample)})`;
    } else if (canonicalCode(sample["商品編號"]) === PRODUCT_CODES.OIL_CAT_BOX) {
      label = `精油組(${sizeGroupSuffix(sample) || "無尺寸"})`;
    } else {
      const name = cleanProductName(sample["商品名稱"]);
      const suffixParts = groupSuffixParts(sample, splitBySpec);
      label = suffixParts.length ? `${name}(${suffixParts.join(" ")})` : name;
    }
    const entry = { rows: rows.slice().sort(comparePickGroupRows), qty, label };
    const forceIndependent = FORCE_INDEPENDENT_GROUP_KEYS.has(key);
    (qty > threshold || forceIndependent ? ownGroups : mergedGroups).push(entry);
  }

  ownGroups.sort((a, b) => a.label.localeCompare(b.label));
  mergedGroups.sort((a, b) => b.qty - a.qty || a.label.localeCompare(b.label));

  const mergedRows = mergedGroups.flatMap(g => g.rows).sort((a, b) => {
    const n = cleanProductName(a["商品名稱"]).localeCompare(cleanProductName(b["商品名稱"]));
    return n !== 0 ? n : comparePickGroupRows(a, b);
  });

  return { ownGroups, mergedGroups, mergedRows };
}

function getZonedOptions() {
  // 「同編號內再依規格細分」勾選框已拿掉(展開明細 + 分單已經可以手動處理這件事,
  // 不需要一個全域開關),固定不細分,只保留門檻可調
  const splitBySpec = false;
  const thresholdRaw = parseInt(document.getElementById("zonedThreshold")?.value, 10);
  const threshold = Number.isFinite(thresholdRaw) && thresholdRaw > 0 ? thresholdRaw : 5;
  return { splitBySpec, threshold };
}

function getZonedExportRows(rows) {
  const EXCLUDE_FROM_LOCAL = new Set(["黑熊", "盆景公仔組"]);
  return rows.filter(r => !EXCLUDE_FROM_LOCAL.has(r["_類別"]) && !r["_離島"]);
}

// 分區列印分頁的字卡+品項清單:載入訂單(或切換選項)後即時預覽分組結果,不用等下載才知道
function updateZonedStats(rows) {
  const elRegularTotal = document.getElementById("zoned-stat-regular-total");
  if (!elRegularTotal) return;
  if (!rows) { resetZonedStats(); return; }

  const exportRows = getZonedExportRows(rows);
  const { splitBySpec, threshold } = getZonedOptions();
  const { ownGroups, mergedRows } = buildPickGroups(exportRows, splitBySpec, threshold);

  zonedRegularTotal = exportRows.length;

  // 獨立出單品項:依件數由多到少排序(同尺寸的胖胖貓金運/招福會排在一起),每項各自一個下載按鈕
  zonedGroupsCache = sortZonedGroups(ownGroups.slice());
  zonedMergedRowsCache = mergedRows;
  zonedMergedDownloaded = false; // 資料重新產生,先前的下載狀態不再代表目前內容

  renderZonedGroupList(zonedGroupsCache);
  renderZonedMergedBlock(mergedRows, threshold);
}

// 「一般訂單數(總共/已印)」「總出貨單」「已印單數」幾張字卡的共用重算邏輯。
// 出貨單張數用「文件數」計(獨立品項 1 項 = 1 張,其他合併整包算 1 張),不是訂單筆數,
// 才跟使用者實際會按幾次下載對得上;已印訂單數則是把「已下載」品項的實際筆數加總,
// 印了多少就會反映在「一般訂單數」卡片的已印數字上。
// 只要清單有變動(下載/分單/併單)就會重新渲染,渲染時順便重算,不用另外在每個操作裡各呼叫一次。
function updateZonedDocStats() {
  const elTotal = document.getElementById("zoned-stat-total-docs");
  const elPrinted = document.getElementById("zoned-stat-printed-docs");
  const elRegularTotal = document.getElementById("zoned-stat-regular-total");
  const elRegularPrinted = document.getElementById("zoned-stat-regular-printed");
  if (!elTotal || !elPrinted) return;

  const totalDocs = zonedGroupsCache.length + (zonedMergedRowsCache.length > 0 ? 1 : 0);
  const printedDocs = zonedGroupsCache.filter(g => g.downloaded).length + (zonedMergedDownloaded ? 1 : 0);
  elTotal.textContent = totalDocs;
  elPrinted.textContent = printedDocs;

  const printedOrders = zonedGroupsCache.filter(g => g.downloaded).reduce((s, g) => s + g.rows.length, 0)
    + (zonedMergedDownloaded ? zonedMergedRowsCache.length : 0);
  if (elRegularTotal) elRegularTotal.textContent = zonedRegularTotal;
  if (elRegularPrinted) elRegularPrinted.textContent = printedOrders;
}

function resetZonedStats() {
  ["zoned-stat-total-docs", "zoned-stat-printed-docs", "zoned-stat-regular-total", "zoned-stat-regular-printed"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = "—";
  });
  zonedGroupsCache = [];
  zonedMergedRowsCache = [];
  zonedExpandedLabels = new Set();
  zonedMergedDownloaded = false;
  zonedRegularTotal = 0;
  const list = document.getElementById("zonedGroupList");
  if (list) list.innerHTML = `<div class="problem-empty">尚未載入訂單</div>`;
  const merged = document.getElementById("zonedMergedBlock");
  if (merged) merged.innerHTML = "";
}

// 獨立出單品項清單:每項各自的件數/筆數 + 一個「下載列印」按鈕,可以單獨下載那個品項的黑貓出貨單
function renderZonedGroupList(groups) {
  const container = document.getElementById("zonedGroupList");
  if (!container) return;

  // 清單內容變了(下載/併單/分單都會重畫清單),「全選」勾選框跟著重置,不然會殘留舊狀態誤導使用者
  const selectAll = document.getElementById("zonedSelectAllCheckbox");
  if (selectAll) selectAll.checked = false;

  if (groups.length === 0) {
    container.innerHTML = `<div class="problem-empty">目前沒有品項超過門檻,全部併入下方「其他合併」</div>`;
    updateZonedDocStats();
    return;
  }

  container.innerHTML = groups.map((g, idx) => {
    const breakdown = buildSpecBreakdown(g.rows);
    const expanded = zonedExpandedLabels.has(g.label);
    const specRows = breakdown.map((b, si) => `
      <div style="display: flex; align-items: center; gap: 10px; padding: 6px 0; border-bottom: 1px solid var(--border); font-size: 12px;">
        <span style="flex: 1;">${escapeHtml(b.fullName)}${b.addonSummary ? `<span style="color: var(--text-mute); margin-left: 12px;">${escapeHtml(b.addonSummary)}</span>` : ""}</span>
        <button class="btn btn-secondary btn-small" onclick="extractZonedSpec(${idx}, ${si})" style="flex-shrink: 0;">分單</button>
        <span style="color: var(--text); font-weight: 700; white-space: nowrap; flex-shrink: 0;">${b.qty} 件 · ${b.rows.length} 筆</span>
      </div>
    `).join("");

    const downloadedStyle = g.downloaded
      ? "background: var(--cat-green-bg); border-color: var(--cat-green-border);"
      : "";

    return `
      <div class="problem-item" style="flex-direction: column; align-items: stretch; ${downloadedStyle}">
        <div class="problem-item-row1" style="justify-content: space-between; width: 100%;">
          <div style="display: flex; align-items: center; gap: 8px; min-width: 0;">
            <input type="checkbox" class="zoned-checkbox zoned-group-check" data-idx="${idx}">
            <button onclick="toggleZonedDetail(${idx})" style="background: none; border: none; color: inherit; cursor: pointer; display: flex; align-items: center; gap: 8px; font: inherit; padding: 0; text-align: left; min-width: 0;">
              <span id="zonedGroupArrow-${idx}" style="color: var(--accent-2); font-size: 15px; font-weight: 700; flex-shrink: 0;">${expanded ? "▾" : "▸"}</span>
              <span class="pi-id">${escapeHtml(g.label)}</span>
            </button>
          </div>
          <button class="btn btn-secondary btn-small" onclick="downloadZonedGroup(${idx})">${g.downloaded ? "✓ 已下載" : "⬇ 下載列印"}</button>
        </div>
        <div style="font-size: 13px; color: var(--text); font-weight: 600; margin-top: 4px; margin-left: 47px;">共 ${g.qty} 件 · ${g.rows.length} 筆訂單</div>
        <div id="zonedGroupDetail-${idx}" ${expanded ? "" : "hidden"} style="margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--border);">
          <div style="display: flex; flex-direction: column;">
            ${specRows}
          </div>
        </div>
      </div>
    `;
  }).join("");
  updateZonedDocStats();
}

// 展開/收合單一品項的規格明細(不重新產生 innerHTML,不會弄丟已勾選的 checkbox);
// 用 label 記住展開狀態,「抽出」之後重新渲染整份清單時,已經打開的面板不會被關掉
function toggleZonedDetail(idx) {
  const g = zonedGroupsCache[idx];
  const el = document.getElementById(`zonedGroupDetail-${idx}`);
  const arrow = document.getElementById(`zonedGroupArrow-${idx}`);
  if (!el || !g) return;
  el.hidden = !el.hidden;
  if (arrow) arrow.textContent = el.hidden ? "▸" : "▾";
  if (el.hidden) zonedExpandedLabels.delete(g.label);
  else zonedExpandedLabels.add(g.label);
}

// 「其他合併」區塊:品項少的全部擠在同一張出貨單,所以只需要「一個」下載按鈕;
// 明細用 <details> 收合,一律依完整分組(含規格)拆給使用者看,並顯示完整品項名稱,
// 不然同一行可能混了好幾種顏色,看不出併單裡實際裝了什麼
function renderZonedMergedBlock(mergedRows, threshold) {
  const container = document.getElementById("zonedMergedBlock");
  if (!container) return;

  if (mergedRows.length === 0) {
    container.innerHTML = `<div class="problem-empty">目前沒有品項被併單</div>`;
    updateZonedDocStats();
    return;
  }

  const detailLines = buildMergedDetailLines(mergedRows);
  const itemLines = detailLines.map((d, di) => `
    <div style="display: flex; align-items: center; gap: 10px; padding: 6px 0; border-bottom: 1px solid var(--border); font-size: 12px;">
      <input type="checkbox" class="zoned-checkbox zoned-merged-check" data-di="${di}" style="flex-shrink: 0;">
      <span style="flex: 1;">${escapeHtml(d.fullName)}${d.addonSummary ? `<span style="color: var(--text-mute); margin-left: 12px;">${escapeHtml(d.addonSummary)}</span>` : ""}</span>
      <span style="color: var(--text); font-weight: 700; white-space: nowrap; flex-shrink: 0;">${d.qty} 件 · ${d.rows.length} 筆</span>
    </div>
  `).join("");

  const downloadedStyle = zonedMergedDownloaded
    ? "background: var(--cat-green-bg); border-color: var(--cat-green-border);"
    : "";

  container.innerHTML = `
    <div class="problem-item" style="flex-direction: column; align-items: stretch; ${downloadedStyle}">
      <div class="problem-item-row1" style="justify-content: space-between; width: 100%;">
        <span class="pi-id">其他合併(未超過 ${threshold} 個的品項)</span>
        <button class="btn btn-secondary btn-small" onclick="downloadZonedMerged()">${zonedMergedDownloaded ? "✓ 已下載" : "⬇ 下載列印"}</button>
      </div>
      <div style="font-size: 12px; color: var(--text-mute); margin-top: 4px;">
        共 ${detailLines.length} 個品項 · ${mergedRows.length} 筆訂單
      </div>
      <details style="margin-top: 10px;">
        <summary style="cursor: pointer; font-size: 12px; color: var(--accent-2);">展開明細,看併了哪些品項</summary>
        <div style="display: flex; justify-content: flex-end; margin: 8px 0 0;">
          <button onclick="extractZonedMergedSelected()" style="background: none; border: none; cursor: pointer; padding: 4px 2px; font-size: 16px; font-weight: 700; color: var(--accent-2);">分單</button>
        </div>
        <div style="display: flex; flex-direction: column;">
          ${itemLines}
        </div>
      </details>
    </div>
  `;
  updateZonedDocStats();
}

// 「併單」:勾選兩個以上的獨立出單品項,合成一列新的品項(件數加總、rows 合併),
// 跟「分單」相反 —— 分單是從一個品項裡把某個規格拉出來獨立,併單是把好幾個獨立品項揉回同一張出貨單。
// 合併後的品名用「&」把各自的品名接起來,不然沒辦法知道這張單裡混了哪些品項。
function mergeZonedGroups() {
  const checks = document.querySelectorAll(".zoned-group-check:checked");
  if (checks.length < 2) {
    setStatus("zonedStatus", "warn", "請至少勾選 2 個品項才能併單");
    return;
  }

  const picked = Array.from(checks).map(c => zonedGroupsCache[parseInt(c.dataset.idx, 10)]).filter(Boolean);
  const pickedSet = new Set(picked);

  const rows = picked.flatMap(g => g.rows).sort(comparePickGroupRows);
  const qty = picked.reduce((s, g) => s + g.qty, 0);
  const label = picked.map(g => g.label).join(" & ");

  zonedGroupsCache = zonedGroupsCache.filter(g => !pickedSet.has(g));
  zonedGroupsCache.push({ label, rows, qty });
  sortZonedGroups(zonedGroupsCache);

  picked.forEach(g => zonedExpandedLabels.delete(g.label));
  renderZonedGroupList(zonedGroupsCache);
  setStatus("zonedStatus", "success", `✓ 已併單「${label}」,共 ${qty} 件`);
}

// 「全選」勾選框:一口氣把清單裡每一項的勾選框都打開/關掉
function toggleZonedSelectAll(checked) {
  document.querySelectorAll(".zoned-group-check").forEach(cb => { cb.checked = checked; });
}

// 「全部下載」:一次下載所有「打勾」的品項(不是真的不分青紅皂白全部下載,勾選框決定要下載誰;
// 想真的全部下載就先按「全選」再按這顆)。跟 downloadZonedGroup 分開寫,
// 是因為 downloadZonedGroup 下載完會馬上重新渲染清單,如果在迴圈裡逐一呼叫,
// 後面幾個品項的 index 會對不上重新渲染後的清單,所以這裡先把要下載的品項都抓出來,
// 全部寫完檔案才重新渲染一次。
function downloadZonedSelected() {
  const checks = document.querySelectorAll(".zoned-group-check:checked");
  if (checks.length === 0) {
    setStatus("zonedStatus", "warn", "請先勾選要下載的品項(或按「全選」)");
    return;
  }

  const picked = Array.from(checks).map(c => zonedGroupsCache[parseInt(c.dataset.idx, 10)]).filter(Boolean);
  let fileTotal = 0;
  try {
    picked.forEach(g => {
      const prefix = `黑貓出貨表_${sanitizeFilenamePart(g.label)}`;
      const { fileCount } = writeBcatFiles(g.rows, prefix);
      fileTotal += fileCount;
      g.downloaded = true;
    });
    renderZonedGroupList(zonedGroupsCache);
    setStatus("zonedStatus", "success", `✓ 已下載 ${picked.length} 個品項,共 ${fileTotal} 個檔案`);
  } catch (e) {
    setStatus("zonedStatus", "error", `✗ 下載失敗:${e.message}`);
    console.error(e);
  }
}

// 獨立出單清單裡單一品項的下載列印按鈕(整組一起下載);下載成功後反顏色標示「已下載」,
// 方便一眼看出這批品項哪些已經印過、哪些還沒
function downloadZonedGroup(idx) {
  const g = zonedGroupsCache[idx];
  if (!g) return;
  try {
    const prefix = `黑貓出貨表_${sanitizeFilenamePart(g.label)}`;
    const { fileCount } = writeBcatFiles(g.rows, prefix);
    g.downloaded = true;
    renderZonedGroupList(zonedGroupsCache);
    setStatus("zonedStatus", "success", `✓ 已下載「${g.label}」共 ${g.rows.length} 筆(${fileCount} 檔)`);
  } catch (e) {
    setStatus("zonedStatus", "error", `✗ 下載失敗:${e.message}`);
    console.error(e);
  }
}

// 展開明細裡每一列規格自己的「分單」按鈕:點了直接把「這一個規格」從原本的群組拉出來,
// 變成「獨立出單品項」清單裡新的一列(有自己的件數、下載按鈕),不用勾選、不是馬上下載檔案 ——
// 方便先把想拆開撿貨的規格整理出來,確認整份清單長什麼樣子之後,再用各自的下載按鈕或最上面的總下載一次匯出。
function extractZonedSpec(idx, si) {
  const g = zonedGroupsCache[idx];
  if (!g) return;

  const breakdown = buildSpecBreakdown(g.rows);
  const picked = breakdown[si];
  if (!picked) return;

  // 從原本的群組移除被抽出的列,件數跟著重算;內容變了,先前的「已下載」不再算數
  const pickedRowSet = new Set(picked.rows);
  g.rows = g.rows.filter(r => !pickedRowSet.has(r));
  g.qty = g.rows.reduce((s, r) => s + (parseInt(r["數量"], 10) || 1), 0);
  g.downloaded = false;

  // 這個規格變成清單裡新的一列獨立出單品項
  zonedGroupsCache.push({
    label: picked.fullName,
    rows: picked.rows.slice().sort(comparePickGroupRows),
    qty: picked.qty,
  });

  // 原本的群組如果被抽光了(只剩這個規格),從清單移除,避免留下 0 件的空列
  if (g.rows.length === 0) {
    const pos = zonedGroupsCache.indexOf(g);
    if (pos !== -1) zonedGroupsCache.splice(pos, 1);
    zonedExpandedLabels.delete(g.label);
  }

  sortZonedGroups(zonedGroupsCache);
  renderZonedGroupList(zonedGroupsCache);
  setStatus("zonedStatus", "success", `✓ 已分單「${picked.fullName}」,變成獨立出單品項`);
}

// 「其他合併」展開明細裡勾選特定品項後按「分單」:把勾選的全部品項一起從併單裡拉出來,
// 揉成「一個」新的獨立出單品項(品名用「&」把各自的品名接起來),不是各自拆成一堆單獨的品項 ——
// 這幾個原本就是「數量太少不值得單獨出一張」才被併在一起,分單時也應該繼續合在同一張,
// 只是從「其他合併」搬去「獨立出單品項」清單,單獨變成一份可以下載的黑貓出貨單。
function extractZonedMergedSelected() {
  const checks = document.querySelectorAll(".zoned-merged-check:checked");
  if (checks.length === 0) {
    setStatus("zonedStatus", "warn", "請先勾選要分單的品項");
    return;
  }

  const detailLines = buildMergedDetailLines(zonedMergedRowsCache);
  const picked = Array.from(checks).map(c => detailLines[parseInt(c.dataset.di, 10)]).filter(Boolean);
  const pickedRowSet = new Set(picked.flatMap(p => p.rows));

  zonedMergedRowsCache = zonedMergedRowsCache.filter(r => !pickedRowSet.has(r));
  zonedMergedDownloaded = false; // 併單內容變了,先前的「已下載」不再算數

  const rows = picked.flatMap(p => p.rows).sort(comparePickGroupRows);
  const qty = picked.reduce((s, p) => s + p.qty, 0);
  const label = picked.map(p => p.fullName).join(" & ");

  zonedGroupsCache.push({ label, rows, qty });
  sortZonedGroups(zonedGroupsCache);

  const { threshold } = getZonedOptions();
  renderZonedGroupList(zonedGroupsCache);
  renderZonedMergedBlock(zonedMergedRowsCache, threshold);
  setStatus("zonedStatus", "success", `✓ 已分單「${label}」,共 ${qty} 件,變成獨立出單品項`);
}

// 「其他合併」區塊唯一的下載列印按鈕:把所有未超過門檻的品項一次寫成同一張(或同一批)黑貓出貨單;
// 下載成功後反顏色標示「已下載」
function downloadZonedMerged() {
  if (!zonedMergedRowsCache || zonedMergedRowsCache.length === 0) return;
  try {
    const { fileCount } = writeBcatFiles(zonedMergedRowsCache, "黑貓出貨表_其他合併");
    zonedMergedDownloaded = true;
    const { threshold } = getZonedOptions();
    renderZonedMergedBlock(zonedMergedRowsCache, threshold);
    setStatus("zonedStatus", "success", `✓ 已下載「其他合併」共 ${zonedMergedRowsCache.length} 筆(${fileCount} 檔)`);
  } catch (e) {
    setStatus("zonedStatus", "error", `✗ 下載失敗:${e.message}`);
    console.error(e);
  }
}

// 「▶ 下載分區黑貓出貨表」:一次下載目前清單上的每一項(獨立品項全部 + 其他合併),
// 直接用目前的 zonedGroupsCache/zonedMergedRowsCache(如果使用者已經手動分單/併單過,
// 這裡下載的就是調整後的結果,不會跑掉重算一份新的),下載完全部反綠標示已印,避免重複列印。
function generateZonedOutput() {
  if (!loadedRows) return;
  if (zonedGroupsCache.length === 0 && zonedMergedRowsCache.length === 0) {
    setStatus("zonedStatus", "warn", "目前沒有可下載的品項");
    return;
  }

  setStatus("zonedStatus", "loading", "產生分區出貨表中…");
  setTimeout(() => {
    try {
      let fileTotal = 0;
      let problemHitTotal = 0;

      zonedGroupsCache.forEach(g => {
        const prefix = `黑貓出貨表_${sanitizeFilenamePart(g.label)}`;
        const { fileCount, problemHitInExport } = writeBcatFiles(g.rows, prefix);
        fileTotal += fileCount;
        problemHitTotal += problemHitInExport;
        g.downloaded = true;
      });

      if (zonedMergedRowsCache.length > 0) {
        const { fileCount, problemHitInExport } = writeBcatFiles(zonedMergedRowsCache, "黑貓出貨表_其他合併");
        fileTotal += fileCount;
        problemHitTotal += problemHitInExport;
        zonedMergedDownloaded = true;
      }

      const { threshold } = getZonedOptions();
      renderZonedGroupList(zonedGroupsCache);
      renderZonedMergedBlock(zonedMergedRowsCache, threshold);

      let msg = `✓ 分區列印完成,共 ${fileTotal} 個檔案`;
      if (problemHitTotal > 0) msg += `  · 🟧 ${problemHitTotal} 筆問題訂單已橘色反白`;
      setStatus("zonedStatus", "success", msg);
    } catch (e) {
      setStatus("zonedStatus", "error", `✗ 分區列印失敗:${e.message}`);
      console.error(e);
    }
  }, 50);
}

