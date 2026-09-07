// ===================================================================
// 共用設定常數(商品編號、分類規則、離島關鍵字、範本欄位等)
// ===================================================================
const SENDER_NAME = "LINE禮物-泥研製所";
const ITEM_COUNT = 1;
const ITEM_NAME_CODE = 9;

// REMOVE_REGEX_PATTERNS / REMOVE_PATTERNS / REPLACE_PATTERNS(過濾、刪除關鍵字、替換規則)
// 已搬到 keyword-rules.js,連同 buildNote / cleanFreeText / cleanProductName / rowHaystack 一起

const FIELD_MAPPING = {
  "訂單編號":       "訂單編號",
  "收件人姓名":     "收件人姓名",
  "收件人聯絡電話": "收件人手機",
  "配送地址":       "收件人地址",
};

// 商品編號 → 分類細項 (for 新統計)
// 永生花:商品編號決定花色(粉/藍),規格設定決定裡面公仔(黃金運貓/粉招福貓)
const PRODUCT_CODES = {
  BEAR_BASEBALL:      "322293696",
  BEAR_NORMAL:        "322293717",
  FLOWER_PINK:        "322346457",  // 粉花
  FLOWER_BLUE:        "322329751",  // 藍花
  PLANT_POT:          "322230424",
  TETRAPOD_BOX:       "322413765",  // 消波塊(禮盒版)
  TETRAPOD_NORMAL:    "322027863",  // 消波塊(一般版)
  OIL_CAT_BOX:        "322415648",  // 精油貓(禮盒版)
  OIL_CAT_NORMAL:     "322282246",  // 精油貓(一般版)
  DOUBLE_CAT:         "322384394",  // 雙喵
  REUNION_CAT:        "322329026",  // 團圓貓
};

const SPECIAL_CATEGORIES = [
  { keys: ["黑熊"],       name: "黑熊",       bg: "C62828", fg: "FFFFFF", priority: 5, uiId: "stat-bear" },
  { keys: ["永生花"],     name: "永生花",     bg: "FDD835", fg: "000000", priority: 4, uiId: "stat-flower" },
  { keys: ["盆景公仔組"], name: "盆景公仔組", bg: "2E7D32", fg: "FFFFFF", priority: 3, uiId: "stat-bonsai" },
  { keys: ["兔", "虎", "龍", "名片座", "貓頭鷹", "熊貓", "巨物", "摩艾", "蟾蜍", "躲避屋","媽祖","炭錢水泥招財貓", "12cm"],
    name: "注意品項",   bg: "4DB6D3", fg: "003847", priority: -1, uiId: "stat-notice" },
  { keys: ["雷雕"],       name: "雷雕",       bg: "BDBDBD", fg: "000000", priority: 1, uiId: "stat-laser" },
];

// 要上傳到 Google Sheet 的分類
const UPLOAD_CATEGORIES = ["雷雕", "黑熊", "永生花", "注意品項", "盆景公仔組"];

// 離島•郵局:地址含以下關鍵字 → 不用黑貓寄,改用郵局寄,另外上傳到「離島包裹」試算表
// 澎湖/金門/連江(馬祖)是縣級離島;綠島/蘭嶼(台東縣)、琉球(屏東縣小琉球)是鄉鎮級離島,
// 所以用鄉鎮名比對,不能用「台東縣」「屏東縣」(會誤判整個縣的訂單)
const OFFSHORE_KEYWORDS = ["澎湖", "金門", "連江", "馬祖", "綠島", "蘭嶼", "琉球"];
// 關鍵字後面必須緊接著這個正式行政區尾碼,才算真的命中離島(例如「板橋…金門街」
// 只是路名裡剛好有「金門」兩字,不是金門縣,不能誤判成離島)。
// 「馬祖」不是正式行政區名(官方是連江縣),沒有固定尾碼可比對,維持原本寬鬆比對。
const OFFSHORE_KEYWORD_SUFFIX = {
  "澎湖": "縣", "金門": "縣", "連江": "縣",
  "綠島": "鄉", "蘭嶼": "鄉", "琉球": "鄉",
};
const OFFSHORE_SHEET_URL = "https://docs.google.com/spreadsheets/d/1eV6lcWJ1nEs-As32NU6iatYAih-NYQ5WZfGteWDlk5A/edit";

// 離島出貨貼紙(郵局寄)固定寄件人資訊,貼紙尺寸 100mm x 150mm
const OFFSHORE_SENDER = {
  zip: "356",
  address: "苗栗縣後龍鎮校椅里造豐路311號",
  name: "LINE禮物泥研製所",
  phone: "037480616",
};
const OFFSHORE_LABEL_MM = { w: 100, h: 150 };

// 離島鄉鎮 → 3 碼郵遞區號(收件人地址標籤用,不含 suffix 比對,避免漏抓)
const OFFSHORE_ZIP_MAP = {
  // 澎湖縣
  "馬公": "880", "西嶼": "881", "望安": "882", "七美": "883", "白沙": "884", "湖西": "885",
  // 金門縣
  "金沙": "890", "金湖": "891", "金寧": "892", "金城": "893", "烈嶼": "894", "烏坵": "896",
  // 連江縣(馬祖)
  "南竿": "209", "北竿": "210", "莒光": "211", "東引": "212",
  // 台東縣
  "綠島": "951", "蘭嶼": "952",
  // 屏東縣
  "琉球": "929",
};

function extractOffshoreZip(address) {
  const s = String(address ?? "");
  for (const [town, zip] of Object.entries(OFFSHORE_ZIP_MAP)) {
    if (s.includes(town)) return zip;
  }
  return "";
}

function extractOffshoreCounty(address) {
  const s = String(address ?? "");
  for (const kw of OFFSHORE_KEYWORDS) {
    const idx = s.indexOf(kw);
    if (idx < 0) continue;
    const suffix = OFFSHORE_KEYWORD_SUFFIX[kw];
    if (suffix && s[idx + kw.length] !== suffix) continue;  // 只是路名剛好同字,不是離島縣市
    return kw;
  }
  return null;
}

const TEMPLATE_HEADERS = [
  "收件人姓名", "收件人電話", "收件人手機", "收件人地址",
  "代收金額或到付", "件數", "品名(詳參數表)", "備註", "訂單編號",
  "希望配達時間(詳參數表)", "出貨日期(YYYY/MM/DD)", "預定配達日期(YYYY/MM/DD)",
  "溫層(詳參數表)", "尺寸(詳參數表)",
  "寄件人姓名", "寄件人電話", "寄件人手機", "寄件人地址",
  "保值金額(20001~10萬之間)-會產生額外費用", "品名說明",
  "是否列印(Y/N)", "是否捐贈(Y/N)", "統一編號", "手機載具", "愛心碼",
  "可刷卡(Y/N)", "手機支付(Y/N)"
];

const REQUIRED_COLS = [
  "訂單編號", "收件人姓名", "收件人聯絡電話", "配送地址",
  "商品名稱", "規格設定", "客製刻印選項", "數量"
];

