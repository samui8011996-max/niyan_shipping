// ===================================================================
// 頁面載入後的 DOM 事件綁定(必須排在最後,確保用到的函式都已載入)
// ===================================================================
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeSettings();
});

document.getElementById("returnDate").value = todayStr("-");

document.getElementById("fileInput").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  setFileDisplays(file.name);
  handleFile(file);
});
document.getElementById("zonedFileInput").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  setFileDisplays(file.name);
  handleFile(file, "zonedStatus");
});
document.getElementById("lineTemplateInput").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const d = document.getElementById("lineTemplateDisplay");
  d.textContent = file.name;
  d.classList.remove("empty"); d.classList.add("has-file");
  handleLineTemplate(file);
});
document.getElementById("bcDetailInput").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const d = document.getElementById("bcDetailDisplay");
  d.textContent = file.name;
  d.classList.remove("empty"); d.classList.add("has-file");
  handleBcDetail(file);
});
