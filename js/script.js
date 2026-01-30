const card = document.getElementById("card");
const tiltArea = document.getElementById("tiltArea");
const reflection = document.getElementById("reflection");
const isFinePointer  = matchMedia("(hover: hover) and (pointer: fine)").matches;
const isTouchDevice  = matchMedia("(pointer: coarse)").matches;
// Ajout du redirection vers Discord
document.querySelector(".glitch-text").addEventListener("click", function() {
    window.open("https://discord.gg/thCahmw4tW", "_blank");
});
// ✅ Réglages par mode (amplitude + smooth + zone)
const CONFIG = {
  mouse: { tilt: 26, move: 11, smooth: 0.12, zone: 1.45 },
  touch: { tilt: 24, move: 10, smooth: 0.14, zone: 1.25 }, // fallback touch (sans gyro)
  gyro:  { tilt: 36, move: 16, smooth: 0.18 }              // gyro : + fort
};
// Valeurs “de base”
const BASE_RANGE_X = 22; // gamma
const BASE_RANGE_Y = 22; // beta
// ✅ Limite FPS sur téléphone (25fps)
const MOBILE_FPS = 25;
const MOBILE_FRAME_DT = 1000 / MOBILE_FPS;
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const lerp  = (a, b, t) => a + (b - a) * t;
let targetNX = 0, targetNY = 0; // [-0.5..0.5]
let currNX = 0, currNY = 0;
let raf = 0;
let gyroEnabled = false;
// ✅ Stop RAF quand stable
let settleFrames = 0;
const SETTLE_EPS = 0.0009;
const SETTLE_NEED = 10;
// ✅ Throttle gyro events
let lastOrient = 0;
const ORIENT_MIN_DT = 16; // ~60Hz max (RAF mobile reste à 25fps)
// ✅ Throttle RAF (25fps mobile)
let lastFrame = 0;
function getCfg() {
  if (gyroEnabled) return CONFIG.gyro;
  if (isTouchDevice) return CONFIG.touch;
  return CONFIG.mouse;
}
function setTransformFromNormalized(nx, ny, cfg) {
  const rotateX = ny * cfg.tilt;
  const rotateY = nx * -cfg.tilt;
  const tx = nx * cfg.move;
  const ty = ny * cfg.move;
  card.style.transform = `
    perspective(1200px)
    rotateX(${rotateX}deg)
    rotateY(${rotateY}deg)
    translateX(${tx}px)
    translateY(${ty}px)
    translateZ(0)
  `;
  const px = (nx + 0.5) * 100;
  const py = (ny + 0.5) * 100;
  reflection.style.setProperty("--px", px.toFixed(2) + "%");
  reflection.style.setProperty("--py", py.toFixed(2) + "%");
}
function tick(now) {
  // ✅ Si mobile -> 25fps
  if (isTouchDevice) {
    if (now - lastFrame < MOBILE_FRAME_DT) {
      raf = requestAnimationFrame(tick);
      return;
    }
  }
  lastFrame = now;
  const cfg = getCfg();
  currNX = lerp(currNX, targetNX, cfg.smooth);
  currNY = lerp(currNY, targetNY, cfg.smooth);
  setTransformFromNormalized(currNX, currNY, cfg);
  const d = Math.abs(currNX - targetNX) + Math.abs(currNY - targetNY);
  if (d < SETTLE_EPS) settleFrames++;
  else settleFrames = 0;
  if (settleFrames >= SETTLE_NEED) {
    currNX = targetNX;
    currNY = targetNY;
    setTransformFromNormalized(currNX, currNY, cfg);
    stopRaf();
    return;
  }
  raf = requestAnimationFrame(tick);
}
function startRaf() {
  if (!raf) {
    settleFrames = 0;
    lastFrame = 0;
    raf = requestAnimationFrame(tick);
  }
}
function stopRaf() {
  cancelAnimationFrame(raf);
  raf = 0;
}
function resetCard() {
  stopRaf();
  targetNX = targetNY = currNX = currNY = 0;
  card.style.transform =
    "perspective(1200px) rotateX(0deg) rotateY(0deg) translateX(0px) translateY(0px) translateZ(0)";
  reflection.style.setProperty("--px", "50%");
  reflection.style.setProperty("--py", "50%");
}
/* =========================
   ✅ MODE PC (souris)
========================== */
tiltArea.addEventListener("mousemove", (e) => {
  if (gyroEnabled) return;
  const cfg = CONFIG.mouse;
  const r = card.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  const dx = (e.clientX - cx) / ((r.width  / 2) * cfg.zone);
  const dy = (e.clientY - cy) / ((r.height / 2) * cfg.zone);
  targetNX = clamp(dx, -1, 1) * 0.5;
  targetNY = clamp(dy, -1, 1) * 0.5;
  startRaf();
});
tiltArea.addEventListener("mouseleave", () => {
  if (gyroEnabled) return;
  resetCard();
});
/* =========================
   ✅ MODE MOBILE (gyro) — Optimisé iPhone + Samsung
   - Auto-start si possible
   - iOS: demande permission au 1er tap n'importe où (sans overlay)
========================== */
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
const needsIOSPermission =
  isIOS &&
  window.DeviceOrientationEvent &&
  typeof DeviceOrientationEvent.requestPermission === "function";
const ORIENT_EVENT = ("ondeviceorientationabsolute" in window)
  ? "deviceorientationabsolute"
  : "deviceorientation";
// Orientation écran (portrait/landscape)
function getScreenAngle() {
  return (screen.orientation && typeof screen.orientation.angle === "number")
    ? screen.orientation.angle
    : (typeof window.orientation === "number" ? window.orientation : 0);
}
// Map gamma/beta -> axes écran
function mapToScreenAxes(gamma, beta, angle) {
  const a = ((angle % 360) + 360) % 360;
  if (a === 0)   return { x: gamma,  y: beta };
  if (a === 90)  return { x: beta,   y: -gamma };
  if (a === 180) return { x: -gamma, y: -beta };
  return { x: -beta, y: gamma }; // 270
}
// Anti-jitter
const DEADZONE = 0.02;
const SENSOR_FILTER = 0.22;
let filtX = 0, filtY = 0;
// Auto-calibration (range adapte iPhone/Samsung)
let gyroRangeX = BASE_RANGE_X;
let gyroRangeY = BASE_RANGE_Y;
let calibUntil = 0;
let calibDone = true;
let maxAbsX = 0, maxAbsY = 0;
function startCalibration(ms = 1200) {
  calibUntil = performance.now() + ms;
  calibDone = false;
  maxAbsX = 0;
  maxAbsY = 0;
  gyroRangeX = BASE_RANGE_X;
  gyroRangeY = BASE_RANGE_Y;
}
function finalizeCalibration() {
  gyroRangeX = clamp(maxAbsX * 1.15, 18, 45);
  gyroRangeY = clamp(maxAbsY * 1.15, 18, 45);
  calibDone = true;
}
function applyDeadzone(v) {
  return Math.abs(v) < DEADZONE ? 0 : v;
}
function onDeviceOrientation(e) {
  if (document.hidden) return;
  const now = performance.now();
  if (now - lastOrient < ORIENT_MIN_DT) return;
  lastOrient = now;
  const gamma = (typeof e.gamma === "number") ? e.gamma : 0;
  const beta  = (typeof e.beta  === "number") ? e.beta  : 0;
  const { x, y } = mapToScreenAxes(gamma, beta, getScreenAngle());
  if (!calibDone) {
    maxAbsX = Math.max(maxAbsX, Math.abs(x));
    maxAbsY = Math.max(maxAbsY, Math.abs(y));
    if (now >= calibUntil) finalizeCalibration();
  }
  // filtre capteur
  filtX = lerp(filtX, x, SENSOR_FILTER);
  filtY = lerp(filtY, y, SENSOR_FILTER);
  let nx = clamp(filtX / gyroRangeX, -1, 1) * 0.5;
  let ny = clamp(filtY / gyroRangeY, -1, 1) * 0.5;
  nx = applyDeadzone(nx);
  ny = applyDeadzone(ny);
  targetNX = nx;
  targetNY = ny;
  startRaf();
}
async function enableGyro({ fromUserGesture = false } = {}) {
  if (!window.DeviceOrientationEvent) return false;
  // iOS: impossible sans geste
  if (needsIOSPermission && !fromUserGesture) {
    return false;
  }
  try {
    if (needsIOSPermission) {
      const res = await DeviceOrientationEvent.requestPermission();
      if (res !== "granted") return false;
    }
    window.addEventListener(ORIENT_EVENT, onDeviceOrientation, { passive: true, capture: true });
    gyroEnabled = true;
    // calibration au démarrage
    startCalibration(1200);
    startRaf();
    return true;
  } catch (err) {
    console.warn("Gyro non activé:", err);
    return false;
  }
}
// Essayez d'activer dès le chargement (Android/Samsung OK souvent)
if (isTouchDevice) {
  enableGyro({ fromUserGesture: false });
  // iOS Safari: on déclenche la permission au 1er geste utilisateur, sans overlay
  const gestureEnable = () => enableGyro({ fromUserGesture: true });
  window.addEventListener("pointerdown", gestureEnable, { once: true, passive: true });
  window.addEventListener("touchstart", gestureEnable, { once: true, passive: true });
  // fallback si certains devices ne déclenchent pas bien touchstart
  window.addEventListener("click", gestureEnable, { once: true });
}
// Recalibre si l'orientation écran change (portrait/landscape)
const reCalib = () => { if (gyroEnabled) startCalibration(700); };
window.addEventListener("orientationchange", reCalib, { passive: true });
if (screen.orientation && screen.orientation.addEventListener) {
  screen.orientation.addEventListener("change", reCalib);
}
/* ✅ Fallback si gyro non dispo/refusé : toucher = “curseur” */
tiltArea.addEventListener("touchmove", (e) => {
  if (gyroEnabled) return;
  const cfg = CONFIG.touch;
  const t = e.touches[0];
  const r = card.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  const dx = (t.clientX - cx) / ((r.width  / 2) * cfg.zone);
  const dy = (t.clientY - cy) / ((r.height / 2) * cfg.zone);
  targetNX = clamp(dx, -1, 1) * 0.5;
  targetNY = clamp(dy, -1, 1) * 0.5;
  startRaf();
}, { passive: true });
tiltArea.addEventListener("touchend", () => {
  if (gyroEnabled) return;
  resetCard();
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) stopRaf();
});
/* =========================
   ✅ TEXTE SLOT MACHINE
========================== */
const KEY = "glitch8_history";
const CHUNK = 10;
const CHARSET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZ" +
  "abcdefghijklmnopqrstuvwxyz" +
  "0123456789" +
  "!@#$%^&*()_+-=[]{}?/\\|" +
  "⌁" +
  "∆∑πΩΦΨ" +
  "⟊⟡¢";
const rand = (n) => (Math.random() * n) | 0;
function randChunk(len = CHUNK) {
  let s = "";
  for (let i = 0; i < len; i++) s += CHARSET[rand(CHARSET.length)];
  return s;
}
function animateSlot(el, finalText, duration = 2000) {
  const len = finalText.length;
  const settleTimes = Array.from({ length: len }, (_, i) => ((i + 1) / len) * duration);
  const start = performance.now();
  function frame(now) {
    const t = now - start;
    let out = "";
    for (let i = 0; i < len; i++) {
      out += (t >= settleTimes[i]) ? finalText[i] : CHARSET[rand(CHARSET.length)];
    }
    el.textContent = out;
    el.dataset.text = out;
    if (t < duration) {
      requestAnimationFrame(frame);
    } else {
      el.textContent = finalText;
      el.dataset.text = finalText;
      try {
        const history = JSON.parse(localStorage.getItem(KEY) || "[]");
        history.push({ value: finalText, at: new Date().toISOString() });
        if (history.length > 300) history.splice(0, history.length - 300);
        localStorage.setItem(KEY, JSON.stringify(history));
      } catch (_) {}
    }
  }
  requestAnimationFrame(frame);
}
const el = document.getElementById("screen");
animateSlot(el, randChunk(CHUNK), 2000);