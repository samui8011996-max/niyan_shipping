// ===================================================================
// 問題訂單(Tab 3)
// ===================================================================
let problemListCache = [];   // [{rowIndex, createdAt, orderId, type, note}]

function submitProblem() {
  const url = getGsUrl();
  if (!url) {
    setStatus("problemStatus", "warn", "⚠ 尚未設定 Apps Script 網址,請先點右上「⚙ 設定」");
    openSettings();
    return;
  }

  const orderId = document.getElementById("problemOrderId").value.trim();
  if (!orderId) {
    setStatus("problemStatus", "error", "✗ 請輸入訂單編號");
    document.getElementById("problemOrderId").focus();
    return;
  }

  const typeEl = document.querySelector('input[name="problemType"]:checked');
  const type = typeEl ? typeEl.value : "其他";
  const note = document.getElementById("problemNote").value.trim();

  setStatus("problemStatus", "loading", "上傳問題訂單中…");
  document.getElementById("problemSubmitBtn").disabled = true;

  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({
      action: "addProblem",
      problem: { orderId, type, note },
    }),
  })
    .then(r => r.json())
    .then(data => {
      if (data.ok) {
        const msg = data.updated
          ? `✓ 已更新問題訂單 ${orderId}`
          : `✓ 已新增問題訂單 ${orderId}`;
        setStatus("problemStatus", "success", msg);
        clearProblemForm();
        loadProblems();   // 重新載入清單
      } else {
        setStatus("problemStatus", "error", `✗ 上傳失敗:${data.error || "未知錯誤"}`);
      }
    })
    .catch(err => {
      setStatus("problemStatus", "error", `✗ 上傳失敗:${err.message}`);
    })
    .finally(() => {
      document.getElementById("problemSubmitBtn").disabled = false;
    });
}

function clearProblemForm() {
  document.getElementById("problemOrderId").value = "";
  document.getElementById("problemNote").value = "";
  // 重設為第一個選項
  const radios = document.querySelectorAll('input[name="problemType"]');
  if (radios.length) radios[0].checked = true;
  document.getElementById("problemOrderId").focus();
}

function loadProblems() {
  const url = getGsUrl();
  if (!url) {
    document.getElementById("problemListHint").textContent = "尚未設定 Apps Script 網址";
    document.getElementById("problemList").innerHTML =
      `<div class="problem-empty">請先點右上「⚙ 設定」設定網址。</div>`;
    return;
  }

  document.getElementById("problemListHint").textContent = "載入中…";

  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action: "getProblems" }),
  })
    .then(r => r.json())
    .then(data => {
      if (!data.ok) throw new Error(data.error || "讀取失敗");
      problemListCache = data.problems || [];
      renderProblemList();
      // 若出貨單已載入,重新比對警示
      if (loadedRows) checkProblemOrdersAgainstLoaded();
    })
    .catch(err => {
      document.getElementById("problemListHint").textContent = "載入失敗";
      document.getElementById("problemList").innerHTML =
        `<div class="problem-empty">✗ 載入失敗:${err.message}</div>`;
    });
}

function renderProblemList() {
  const list = problemListCache;
  const container = document.getElementById("problemList");
  const hint = document.getElementById("problemListHint");

  // 更新橘色統計卡
  const statEl = document.getElementById("stat-problem-total");
  if (statEl) statEl.textContent = list.length;

  if (list.length === 0) {
    hint.textContent = "目前沒有問題訂單";
    container.innerHTML = `<div class="problem-empty">目前沒有問題訂單 🎉</div>`;
    return;
  }

  hint.textContent = `共 ${list.length} 筆`;

  // 由新到舊排序(rowIndex 越大代表越新加)
  const sorted = list.slice().sort((a, b) => b.rowIndex - a.rowIndex);

  container.innerHTML = sorted.map(p => {
    const safeId = escapeHtml(p.orderId);
    const safeType = escapeHtml(p.type || "—");
    const safeTime = escapeHtml(p.createdAt || "");
    const safeNote = escapeHtml(p.note || "");
    const noteHtml = safeNote
      ? `<div class="pi-note">${safeNote}</div>`
      : "";
    return `
      <div class="problem-item" data-row="${p.rowIndex}" data-id="${safeId}">
        <div class="problem-item-main">
          <div class="problem-item-row1">
            <span class="pi-id">${safeId}</span>
            <span class="pi-type">${safeType}</span>
            <span class="pi-time">${safeTime}</span>
          </div>
          ${noteHtml}
        </div>
        <button class="pi-resolve" onclick="resolveProblem(${p.rowIndex}, '${safeId.replace(/'/g, "\\'")}', this)">
          🗑 刪除
        </button>
      </div>
    `;
  }).join("");
}

function resolveProblem(rowIndex, orderId, btn) {
  const url = getGsUrl();
  if (!url) {
    setStatus("problemStatus", "warn", "⚠ 尚未設定 Apps Script 網址");
    return;
  }
  if (!confirm(`確定要刪除問題訂單 ${orderId} ?(會從試算表移除)`)) return;

  if (btn) {
    btn.disabled = true;
    btn.textContent = "處理中…";
  }
  setStatus("problemStatus", "loading", `移除問題訂單 ${orderId}…`);

  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action: "removeProblem", rowIndex, orderId }),
  })
    .then(r => r.json())
    .then(data => {
      if (data.ok) {
        setStatus("problemStatus", "success", `✓ 已移除 ${orderId}`);
        loadProblems();
      } else {
        setStatus("problemStatus", "error", `✗ 移除失敗:${data.error || "未知錯誤"}`);
        if (btn) { btn.disabled = false; btn.textContent = "🗑 刪除"; }
      }
    })
    .catch(err => {
      setStatus("problemStatus", "error", `✗ 移除失敗:${err.message}`);
      if (btn) { btn.disabled = false; btn.textContent = "🗑 刪除"; }
    });
}


// ====== 出貨單載入時比對問題訂單 ======
function checkProblemOrdersAgainstLoaded() {
  if (!loadedRows) { hideProblemAlert(); return; }

  // 若清單還沒載過,先靜默載一次再比對
  const url = getGsUrl();
  if (problemListCache.length === 0 && url) {
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: "getProblems" }),
    })
      .then(r => r.json())
      .then(data => {
        if (data.ok) {
          problemListCache = data.problems || [];
          // 同步更新橘色統計卡(即使沒切到問題訂單 tab)
          const statEl = document.getElementById("stat-problem-total");
          if (statEl) statEl.textContent = problemListCache.length;
          doProblemMatch();
        }
      })
      .catch(() => { /* 忽略,不打擾使用者 */ });
    return;
  }
  doProblemMatch();
}

function doProblemMatch() {
  if (!loadedRows || problemListCache.length === 0) {
    hideProblemAlert();
    return;
  }

  // 把今天訂單的所有訂單編號收集起來(set)
  const todayIds = new Set();
  loadedRows.forEach(r => {
    const id = String(r["訂單編號"] ?? "").trim();
    if (id) todayIds.add(id);
  });

  // 找命中的
  const hits = problemListCache.filter(p => todayIds.has(p.orderId));

  if (hits.length === 0) {
    hideProblemAlert();
    return;
  }

  document.getElementById("problemAlertCount").textContent = hits.length;
  document.getElementById("problemAlertList").innerHTML = hits.map(p => {
    const id = escapeHtml(p.orderId);
    const type = escapeHtml(p.type || "—");
    const note = escapeHtml(p.note || "");
    const noteHtml = note ? `<span class="pa-note">${note}</span>` : "";
    return `
      <div class="problem-alert-item">
        <span class="pa-id">${id}</span>
        <span class="pa-type">${type}</span>
        ${noteHtml}
      </div>
    `;
  }).join("");
  document.getElementById("problemAlert").style.display = "block";
}

function hideProblemAlert() {
  const el = document.getElementById("problemAlert");
  if (el) el.style.display = "none";
}


// 切換到問題訂單 tab 時,自動載一次清單
function maybeLoadProblemsOnTabSwitch(name) {
  if (name === "problems" && problemListCache.length === 0) {
    loadProblems();
  }
}
