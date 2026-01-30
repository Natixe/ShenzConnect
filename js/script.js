const card = document.getElementById("card");
const tiltArea = document.getElementById("tiltArea");
const reflection = document.getElementById("reflection");
const isFinePointer = matchMedia("(hover: hover) and (pointer: fine)").matches;
const isTouchDevice = matchMedia("(pointer: coarse)").matches;

// Redirection Discord
document.querySelector(".glitch-text").addEventListener("click", function() {
    window.open("https://discord.gg/thCahmw4tW", "_blank");
});

const CONFIG = {
    mouse: { tilt: 26, move: 11, smooth: 0.12, zone: 1.45 },
    touch: { tilt: 24, move: 10, smooth: 0.14, zone: 1.25 },
    gyro:  { tilt: 36, move: 16, smooth: 0.18 }
};

const MOBILE_FPS = 25;
const MOBILE_FRAME_DT = 1000 / MOBILE_FPS;

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const lerp  = (a, b, t) => a + (b - a) * t;

let targetNX = 0, targetNY = 0;
let currNX = 0, currNY = 0;
let raf = 0;
let gyroEnabled = false;

// Variables pour le cache de position (Optimisation PC)
let cardRect = null;
let cardWidthHalf = 0;
let cardHeightHalf = 0;
let cardCenterX = 0;
let cardCenterY = 0;

// Throttle variables
let settleFrames = 0;
const SETTLE_EPS = 0.0009;
const SETTLE_NEED = 10;
let lastOrient = 0;
const ORIENT_MIN_DT = 16;
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

    // Utilisation de toFixed pour éviter les sous-pixels inutiles
    card.style.transform = `
        perspective(1200px)
        rotateX(${rotateX.toFixed(2)}deg)
        rotateY(${rotateY.toFixed(2)}deg)
        translateX(${tx.toFixed(2)}px)
        translateY(${ty.toFixed(2)}px)
        translateZ(0)
    `;

    const px = (nx + 0.5) * 100;
    const py = (ny + 0.5) * 100;
    reflection.style.setProperty("--px", px.toFixed(2) + "%");
    reflection.style.setProperty("--py", py.toFixed(2) + "%");
}

function tick(now) {
    if (isTouchDevice && (now - lastFrame < MOBILE_FRAME_DT)) {
        raf = requestAnimationFrame(tick);
        return;
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
    card.style.transform = "perspective(1200px) rotateX(0deg) rotateY(0deg) translateX(0px) translateY(0px) translateZ(0)";
    reflection.style.setProperty("--px", "50%");
    reflection.style.setProperty("--py", "50%");
}

/* =========================
   ✅ OPTIMISATION GÉOMÉTRIE
   On calcule la position UNE fois, pas à chaque mouvement
========================== */
function updateCardMetrics() {
    if (!card) return;
    const r = card.getBoundingClientRect();
    cardRect = r;
    cardWidthHalf = r.width / 2;
    cardHeightHalf = r.height / 2;
    cardCenterX = r.left + cardWidthHalf;
    cardCenterY = r.top + cardHeightHalf;
}

// Mettre à jour au chargement et au resize
window.addEventListener("resize", updateCardMetrics);
// Aussi au scroll car cela change la position relative au viewport
window.addEventListener("scroll", updateCardMetrics, { passive: true });
// Et une fois au début
updateCardMetrics();


/* =========================
   ✅ MODE PC (souris)
========================== */
tiltArea.addEventListener("mouseenter", updateCardMetrics); // Sécurité supplémentaire

tiltArea.addEventListener("mousemove", (e) => {
    if (gyroEnabled) return;
    
    // Si metrics pas encore calculés (cas rare), on le fait
    if (!cardRect) updateCardMetrics();

    const cfg = CONFIG.mouse;
    
    // Calcul basé sur les valeurs en cache (plus de Reflow !)
    const dx = (e.clientX - cardCenterX) / (cardWidthHalf * cfg.zone);
    const dy = (e.clientY - cardCenterY) / (cardHeightHalf * cfg.zone);

    targetNX = clamp(dx, -1, 1) * 0.5;
    targetNY = clamp(dy, -1, 1) * 0.5;

    startRaf();
});

tiltArea.addEventListener("mouseleave", () => {
    if (gyroEnabled) return;
    resetCard();
});

/* =========================
   ✅ MODE MOBILE (gyro)
========================== */
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
const needsIOSPermission = isIOS && window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === "function";
const ORIENT_EVENT = ("ondeviceorientationabsolute" in window) ? "deviceorientationabsolute" : "deviceorientation";

function getScreenAngle() {
    return (screen.orientation && typeof screen.orientation.angle === "number")
        ? screen.orientation.angle
        : (typeof window.orientation === "number" ? window.orientation : 0);
}

function mapToScreenAxes(gamma, beta, angle) {
    const a = ((angle % 360) + 360) % 360;
    if (a === 0)   return { x: gamma,  y: beta };
    if (a === 90)  return { x: beta,   y: -gamma };
    if (a === 180) return { x: -gamma, y: -beta };
    return { x: -beta, y: gamma };
}

const DEADZONE = 0.02;
const SENSOR_FILTER = 0.22;
let filtX = 0, filtY = 0;
let gyroRangeX = 22; // Base value
let gyroRangeY = 22; // Base value
let calibUntil = 0;
let calibDone = true;
let maxAbsX = 0, maxAbsY = 0;

function startCalibration(ms = 1200) {
    calibUntil = performance.now() + ms;
    calibDone = false;
    maxAbsX = 0; maxAbsY = 0;
    gyroRangeX = 22; gyroRangeY = 22;
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
    if (needsIOSPermission && !fromUserGesture) return false;
    try {
        if (needsIOSPermission) {
            const res = await DeviceOrientationEvent.requestPermission();
            if (res !== "granted") return false;
        }
        window.addEventListener(ORIENT_EVENT, onDeviceOrientation, { passive: true, capture: true });
        gyroEnabled = true;
        startCalibration(1200);
        startRaf();
        return true;
    } catch (err) {
        console.warn("Gyro fail:", err);
        return false;
    }
}

if (isTouchDevice) {
    enableGyro({ fromUserGesture: false });
    const gestureEnable = () => enableGyro({ fromUserGesture: true });
    window.addEventListener("pointerdown", gestureEnable, { once: true, passive: true });
    window.addEventListener("touchstart", gestureEnable, { once: true, passive: true });
    window.addEventListener("click", gestureEnable, { once: true });
}

const reCalib = () => { if (gyroEnabled) startCalibration(700); };
window.addEventListener("orientationchange", reCalib, { passive: true });
if (screen.orientation && screen.orientation.addEventListener) {
    screen.orientation.addEventListener("change", reCalib);
}

/* Fallback Touch */
tiltArea.addEventListener("touchmove", (e) => {
    if (gyroEnabled) return;
    if (!cardRect) updateCardMetrics();
    
    const cfg = CONFIG.touch;
    const t = e.touches[0];
    
    // Utilisation des metrics en cache
    const dx = (t.clientX - cardCenterX) / (cardWidthHalf * cfg.zone);
    const dy = (t.clientY - cardCenterY) / (cardHeightHalf * cfg.zone);
    
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
   TEXTE SLOT MACHINE
========================== */
const KEY = "glitch8_history";
const CHUNK = 10;
const CHARSET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+-=[]{}?/\\|⌁∆∑πΩΦΨ⟊⟡¢";
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
        }
    }
    requestAnimationFrame(frame);
}

const el = document.getElementById("screen");
animateSlot(el, randChunk(CHUNK), 2000);