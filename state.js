// ===================================================================
// 全域可變狀態(跨分頁共用,例如上傳的訂單資料、各分頁的暫存清單)
// ===================================================================
let loadedRows = null;
let lineTemplateData = null;
let bcDetailData = null;
let lastStats = null;              // 最近一次算出來的統計
let lastUnmatchedOrders = [];      // 目前配對後找不到託運單號的訂單清單 [{orderId}]
let unmatchedDeleteSet = new Set(); // 使用者勾選「匯出時直接刪除」的訂單編號
let zonedGroupsCache = [];         // 分區列印:目前預覽列表對應的「獨立出單」品項分組,index 給「下載列印」按鈕用
let zonedMergedRowsCache = [];     // 分區列印:目前「其他合併」的攤平訂單列表,給合併區塊的下載按鈕用
let zonedExpandedLabels = new Set(); // 分區列印:目前展開規格明細的品項標籤,重新渲染清單時保持展開狀態
let zonedMergedDownloaded = false; // 分區列印:「其他合併」是否已經下載過,下載後反顏色提醒
let zonedRegularTotal = 0;         // 分區列印:目前這批資料的一般訂單總筆數,給「總共/已印」字卡用
