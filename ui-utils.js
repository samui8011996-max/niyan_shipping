// ===================================================================
// UI 工具
// ===================================================================
function switchTab(name) {
  document.querySelectorAll(".tab").forEach(t => {
    t.classList.toggle("active", t.dataset.tab === name);
  });
  document.querySelectorAll(".tab-panel").forEach(p => {
    p.classList.toggle("active", p.id === `tab-${name}`);
  });
  maybeLoadProblemsOnTabSwitch(name);
  maybeLoadReturnsOnTabSwitch(name);
}

function setStatus(elId, type, msg) {
  const el = document.getElementById(elId);
  el.className = "status " + type;
  if (type === "loading") {
    el.innerHTML = `<span class="spinner"></span>${msg}`;
  } else {
    el.textContent = msg;
  }
}

function todayStr(sep = "") {
  const t = new Date();
  const y = t.getFullYear();
  const m = String(t.getMonth() + 1).padStart(2, "0");
  const d = String(t.getDate()).padStart(2, "0");
  return `${y}${sep}${m}${sep}${d}`;
}


function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// 兩個分頁(一般出貨表、分區列印)其實共用同一份 loadedRows,上傳一次兩邊都能用,
// 不用分別上傳兩次 —— 這裡把兩個檔案顯示徽章一起更新,才不會讓人誤以為另一頁還沒上傳
function setFileDisplays(filename) {
  ["fileDisplay", "zonedFileDisplay"].forEach(id => {
    const d = document.getElementById(id);
    if (!d) return;
    d.textContent = filename;
    d.classList.remove("empty"); d.classList.add("has-file");
  });
}
