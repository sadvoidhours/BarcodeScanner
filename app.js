const video = document.getElementById("video");
const overlay = document.getElementById("overlay");
const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const torchBtn = document.getElementById("torchBtn");
const exportBtn = document.getElementById("exportBtn");
const clearBtn = document.getElementById("clearBtn");
const statusEl = document.getElementById("status");
const resultsEl = document.getElementById("results");
const emptyStateEl = document.getElementById("emptyState");
const totalCountEl = document.getElementById("totalCount");
const uniqueCountEl = document.getElementById("uniqueCount");
const lastScanEl = document.getElementById("lastScan");

let stream = null;
let animationId = null;
let lastScan = "";
let detector = null;
let torchOn = false;
let lastDetectedAt = 0;
let lastDetectAttemptAt = 0;
let totalScans = 0;
const scanCounts = new Map();

const DETECTION_INTERVAL_MS = 250;
const SCAN_COOLDOWN_MS = 1100;

const beep = new Audio(
  "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA="
);

function setStatus(message) {
  statusEl.textContent = message;
}

function addResult(value, format) {
  const count = (scanCounts.get(value) || 0) + 1;
  scanCounts.set(value, count);

  const existing = resultsEl.querySelector(`li[data-value="${CSS.escape(value)}"]`);
  const now = new Date();
  const timeText = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  if (existing) {
    const countEl = existing.querySelector(".result-count");
    const timeEl = existing.querySelector(".result-time");
    if (countEl) countEl.textContent = `x${count}`;
    if (timeEl) timeEl.textContent = timeText;
    resultsEl.prepend(existing);
    return;
  }

  const li = document.createElement("li");
  li.dataset.value = value;

  const label = document.createElement("span");
  label.textContent = value;

  const meta = document.createElement("div");
  meta.className = "result-meta";

  const formatEl = document.createElement("small");
  formatEl.textContent = format || "Unknown";

  const countEl = document.createElement("small");
  countEl.className = "result-count";
  countEl.textContent = `x${count}`;

  const timeEl = document.createElement("small");
  timeEl.className = "result-time";
  timeEl.textContent = timeText;

  meta.append(formatEl, countEl, timeEl);
  li.append(label, meta);
  resultsEl.prepend(li);
}

function updateStats() {
  totalCountEl.textContent = `${totalScans}`;
  uniqueCountEl.textContent = `${scanCounts.size}`;
  lastScanEl.textContent = lastScan || "-";
  emptyStateEl.hidden = resultsEl.children.length > 0;
}

function setScanningUi(isScanning) {
  document.body.classList.toggle("is-scanning", isScanning);
}

function supportsBarcodeDetector() {
  return "BarcodeDetector" in window;
}

async function initDetector() {
  if (!supportsBarcodeDetector()) {
    setStatus("BarcodeDetector API not supported on this device.");
    return false;
  }

  const formats = await window.BarcodeDetector.getSupportedFormats();
  detector = new window.BarcodeDetector({ formats });
  return true;
}

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    setStatus("Camera access not available in this browser.");
    return;
  }

  if (!detector) {
    const ready = await initDetector();
    if (!ready) return;
  }

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1280 },
        height: { ideal: 720 }
      },
      audio: false
    });

    video.srcObject = stream;
    await video.play();
    setStatus("Scanning for barcodes...");
    startBtn.disabled = true;
    stopBtn.disabled = false;
    torchBtn.disabled = !canToggleTorch();
    setScanningUi(true);
    scanLoop();
  } catch (error) {
    setStatus(`Camera error: ${error.message}`);
  }
}

function stopCamera() {
  if (animationId) {
    cancelAnimationFrame(animationId);
    animationId = null;
  }

  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
    stream = null;
  }

  torchOn = false;
  torchBtn.textContent = "Toggle torch";
  torchBtn.disabled = true;
  startBtn.disabled = false;
  stopBtn.disabled = true;
  setStatus("Camera is idle.");
  setScanningUi(false);
}

function canToggleTorch() {
  const track = stream?.getVideoTracks?.()[0];
  const capabilities = track?.getCapabilities?.();
  return Boolean(capabilities?.torch);
}

async function toggleTorch() {
  const track = stream?.getVideoTracks?.()[0];
  if (!track) return;

  try {
    torchOn = !torchOn;
    await track.applyConstraints({ advanced: [{ torch: torchOn }] });
    torchBtn.textContent = torchOn ? "Torch on" : "Torch off";
  } catch (error) {
    torchOn = false;
    torchBtn.textContent = "Toggle torch";
    setStatus("Torch not available on this device.");
  }
}

function drawOverlay() {
  const ctx = overlay.getContext("2d");
  const width = overlay.width;
  const height = overlay.height;
  ctx.clearRect(0, 0, width, height);

  ctx.strokeStyle = "rgba(255, 179, 71, 0.9)";
  ctx.lineWidth = 4;
  ctx.strokeRect(width * 0.12, height * 0.18, width * 0.76, height * 0.64);
}

async function scanLoop() {
  if (!video.videoWidth || !video.videoHeight || !detector) {
    animationId = requestAnimationFrame(scanLoop);
    return;
  }

  const now = performance.now();
  if (now - lastDetectAttemptAt < DETECTION_INTERVAL_MS) {
    animationId = requestAnimationFrame(scanLoop);
    return;
  }
  lastDetectAttemptAt = now;

  if (overlay.width !== video.videoWidth) {
    overlay.width = video.videoWidth;
    overlay.height = video.videoHeight;
  }

  drawOverlay();

  try {
    const barcodes = await detector.detect(video);
    if (barcodes.length > 0) {
      const { rawValue, format } = barcodes[0];
      if (rawValue && now - lastDetectedAt > SCAN_COOLDOWN_MS) {
        lastScan = rawValue;
        lastDetectedAt = now;
        totalScans += 1;
        beep.currentTime = 0;
        beep.play().catch(() => {});
        addResult(rawValue, format);
        setStatus(`Detected: ${rawValue}`);
        updateStats();
      }
    }
  } catch (error) {
    setStatus("Scanning error. Ensure good lighting and focus.");
  }

  animationId = requestAnimationFrame(scanLoop);
}

startBtn.addEventListener("click", startCamera);
stopBtn.addEventListener("click", stopCamera);
torchBtn.addEventListener("click", toggleTorch);
clearBtn.addEventListener("click", () => {
  resultsEl.innerHTML = "";
  lastScan = "";
  totalScans = 0;
  scanCounts.clear();
  setStatus("Results cleared. Ready to scan.");
  updateStats();
});

exportBtn.addEventListener("click", async () => {
  exportBtn.disabled = true;
  setStatus("Preparing CSV export...");

  try {
    const response = await fetch("/api/export");
    if (!response.ok) {
      throw new Error("Export failed");
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "inventory-export.csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setStatus("CSV downloaded.");
  } catch (error) {
    setStatus("Export failed. Ensure the API is deployed and try again.");
  } finally {
    exportBtn.disabled = false;
  }
});

window.addEventListener("beforeunload", () => {
  stopCamera();
});

updateStats();
