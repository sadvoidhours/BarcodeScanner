const video = document.getElementById("video");
const overlay = document.getElementById("overlay");
const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const torchBtn = document.getElementById("torchBtn");
const exportBtn = document.getElementById("exportBtn");
const clearBtn = document.getElementById("clearBtn");
const clearDbBtn = document.getElementById("clearDbBtn");
const ocrBtn = document.getElementById("ocrBtn");
const scanSizeInput = document.getElementById("scanSize");
const scanSizeValue = document.getElementById("scanSizeValue");
const statusEl = document.getElementById("status");
const resultsEl = document.getElementById("results");
const emptyStateEl = document.getElementById("emptyState");
const totalCountEl = document.getElementById("totalCount");
const uniqueCountEl = document.getElementById("uniqueCount");
const lastScanEl = document.getElementById("lastScan");
const windowsOsInput = document.getElementById("windowsOs");
const productKeyInput = document.getElementById("productKey");

let stream = null;
let animationId = null;
let lastScan = "";
let detector = null;
let torchOn = false;
let lastDetectedAt = 0;
let lastDetectAttemptAt = 0;
let totalScans = 0;
const scanCounts = new Map();
let ocrBusy = false;
let scanScale = 0.76;

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

  const region = getScanRegion(width, height);
  ctx.strokeStyle = "rgba(255, 179, 71, 0.9)";
  ctx.lineWidth = 4;
  ctx.strokeRect(region.x, region.y, region.width, region.height);
}

function getScanRegion(width, height) {
  const normalized = Math.min(Math.max(scanScale, 0.55), 0.9);
  const frameWidth = width * normalized;
  const frameHeight = frameWidth * 0.84;
  const x = (width - frameWidth) / 2;
  const y = (height - frameHeight) / 2;
  return { x, y, width: frameWidth, height: frameHeight };
}

function captureScanRegion() {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) return null;

  const region = getScanRegion(width, height);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(region.width);
  canvas.height = Math.round(region.height);

  const ctx = canvas.getContext("2d");
  ctx.drawImage(
    video,
    region.x,
    region.y,
    region.width,
    region.height,
    0,
    0,
    canvas.width,
    canvas.height
  );

  return canvas;
}

function captureFrame() {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) return null;

  const region = getScanRegion(width, height);
  const maxWidth = 900;
  const scale = Math.min(1, maxWidth / region.width);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(region.width * scale);
  canvas.height = Math.round(region.height * scale);

  const ctx = canvas.getContext("2d");
  ctx.drawImage(
    video,
    region.x,
    region.y,
    region.width,
    region.height,
    0,
    0,
    canvas.width,
    canvas.height
  );
  return canvas;
}

function pickBestOcrLine(text) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  let best = "";
  let bestScore = 0;

  lines.forEach((line) => {
    const cleaned = line.replace(/[^A-Za-z0-9_-]/g, "");
    const score = cleaned.length;
    if (score > bestScore) {
      best = cleaned || line;
      bestScore = score;
    }
  });

  if (bestScore < 4) {
    return "";
  }

  return best;
}

function extractProductKey(text) {
  const normalized = text.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  const match = normalized.match(/[A-Z0-9]{25}/);
  if (!match) return "";

  const key = match[0];
  const groups = key.match(/.{1,5}/g) || [];
  return groups.join("-");
}

function extractWindowsOs(text) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const windowsLine = lines.find((line) => /windows\s*(\d+|xp|vista|server)?/i.test(line));
  if (windowsLine) {
    return windowsLine.replace(/\s{2,}/g, " ");
  }

  return "";
}

function updateOcrFields({ windowsOs, productKey }) {
  if (windowsOs) {
    windowsOsInput.value = windowsOs;
  }
  if (productKey) {
    const groups = productKey.split("-");
    const formatted = [
      `${groups[0] || ""}-${groups[1] || ""}`.trim(),
      `${groups[2] || ""}-${groups[3] || ""}`.trim(),
      `${groups[4] || ""}`.trim()
    ]
      .filter(Boolean)
      .join("\n");
    productKeyInput.value = formatted;
  }
}

async function runOcr() {
  if (ocrBusy) return;
  if (!window.Tesseract) {
    setStatus("OCR engine failed to load. Check your network and refresh.");
    return;
  }

  const frame = captureFrame();
  if (!frame) {
    setStatus("Camera not ready. Start the scanner first.");
    return;
  }

  try {
    ocrBusy = true;
    ocrBtn.disabled = true;
    setStatus("Running OCR... hold steady.");

    const result = await window.Tesseract.recognize(frame, "eng");
    const text = result?.data?.text || "";
    const productKey = extractProductKey(text);
    const windowsOs = extractWindowsOs(text);
    const bestLine = pickBestOcrLine(text);

    if (!productKey && !windowsOs && !bestLine) {
      setStatus("No readable text detected. Try better lighting or zoom.");
      return;
    }

    updateOcrFields({ windowsOs, productKey });

    const displayValue = productKey || windowsOs || bestLine;
    const tag = productKey ? "OCR: Product key" : windowsOs ? "OCR: Windows OS" : "OCR";

    lastScan = displayValue;
    totalScans += 1;
    addResult(displayValue, tag);
    setStatus(`Detected: ${displayValue}`);
    updateStats();
  } catch (error) {
    setStatus("OCR failed. Try again with clearer focus.");
  } finally {
    ocrBusy = false;
    ocrBtn.disabled = false;
  }
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
    const scanFrame = captureScanRegion();
    if (!scanFrame) {
      animationId = requestAnimationFrame(scanLoop);
      return;
    }

    const barcodes = await detector.detect(scanFrame);
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
ocrBtn.addEventListener("click", runOcr);
scanSizeInput.addEventListener("input", (event) => {
  const value = Number(event.target.value || 76);
  scanScale = value / 100;
  scanSizeValue.textContent = `${value}%`;
  if (video.videoWidth && video.videoHeight) {
    drawOverlay();
  }
});
clearBtn.addEventListener("click", () => {
  resultsEl.innerHTML = "";
  lastScan = "";
  totalScans = 0;
  scanCounts.clear();
  setStatus("Results cleared. Ready to scan.");
  updateStats();
});

clearDbBtn.addEventListener("click", async () => {
  const confirmed = window.confirm(
    "Clear the entire database collection? This cannot be undone."
  );
  if (!confirmed) return;

  clearDbBtn.disabled = true;
  setStatus("Clearing database...");

  try {
    const response = await fetch("/api/clear", { method: "POST" });
    if (!response.ok) {
      throw new Error("Clear failed");
    }
    const payload = await response.json();
    resultsEl.innerHTML = "";
    lastScan = "";
    totalScans = 0;
    scanCounts.clear();
    updateStats();
    setStatus(`Database cleared (${payload.deletedCount || 0} items).`);
  } catch (error) {
    setStatus("Clear failed. Ensure the API is deployed and try again.");
  } finally {
    clearDbBtn.disabled = false;
  }
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
