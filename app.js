// Neotech final con mejoras: libera mic, libs locales, resize 3D, búsqueda, selector rendimiento
let audioCtx, analyser, dataArray, source, currentStream;
let running = false;
let paused = false;
let frozen = false;
let maxFreq = 0;
let samples = [];
let modeDocente = false;
let currentLang = "es";

// UI refs
const btnStart = document.getElementById("btn-start");
const btnStop = document.getElementById("btn-stop");
const btnFreeze = document.getElementById("btn-freeze");
const btnPause = document.getElementById("btn-pause");
const btnExport = document.getElementById("btn-export");
const btnMode = document.getElementById("btn-mode");
const btnToggle3d = document.getElementById("btn-toggle-3d");
const deviceSelect = document.getElementById("inputDevice");
const perfMode = document.getElementById("perfMode");

const btnHome = document.getElementById("btn-home");
const btnVoz = document.getElementById("btn-voz");
const btnTheme = document.getElementById("btn-theme");
const btnPlus = document.getElementById("btn-plus");
const btnMinus = document.getElementById("btn-minus");
const btnLang = document.getElementById("btn-lang");
const btnFocus = document.getElementById("btn-focus");
const btnSearch = document.getElementById("btn-search");
const searchOverlay = document.getElementById("search-overlay");
const searchClose = document.getElementById("search-close");
const searchInput = document.getElementById("search-input");

const freqValueEl = document.getElementById("freq-value");
const freqMaxEl = document.getElementById("freq-max");
const freqSamplesEl = document.getElementById("freq-samples");
const historyBody = document.getElementById("history-body");

const canvas2d = document.getElementById("freqCanvas");
const ctx2d = canvas2d.getContext("2d");

// 3D vars
let scene, camera, renderer, controls, geometry, mesh;
let SPECTRUM_SIZE = 96;
let HISTORY_DEPTH = 80;
let heightData = [];
let show3D = true;

// load devices
async function loadDevices() {
  if (!navigator.mediaDevices?.enumerateDevices) return;
  const devices = await navigator.mediaDevices.enumerateDevices();
  const audioInputs = devices.filter(d => d.kind === "audioinput");
  deviceSelect.innerHTML = "";
  audioInputs.forEach((d, idx) => {
    const opt = document.createElement("option");
    opt.value = d.deviceId;
    opt.textContent = d.label || `Micrófono ${idx+1}`;
    deviceSelect.appendChild(opt);
  });
}
loadDevices();

// start
btnStart.addEventListener("click", async () => {
  if (running) return;
  try {
    const devId = deviceSelect.value || undefined;
    const constraints = devId ? { audio: { deviceId: { exact: devId } } } : { audio: true };
    currentStream = await navigator.mediaDevices.getUserMedia(constraints);

    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.8;

    source = audioCtx.createMediaStreamSource(currentStream);
    source.connect(analyser);

    dataArray = new Uint8Array(analyser.frequencyBinCount);

    running = true;
    paused = false;
    btnStart.disabled = true;
    btnStop.disabled = false;
    btnFreeze.disabled = false;
    btnPause.disabled = false;
    btnExport.disabled = false;

    draw();
  } catch (e) {
    alert("No se pudo acceder al micrófono");
    console.error(e);
  }
});

// stop
btnStop.addEventListener("click", () => {
  running = false;
  btnStart.disabled = false;
  btnStop.disabled = true;
  btnFreeze.disabled = true;
  btnPause.disabled = true;
  if (currentStream) {
    currentStream.getTracks().forEach(t => t.stop());
    currentStream = null;
  }
  freqValueEl.textContent = "-- Hz";
});

// freeze
btnFreeze.addEventListener("click", () => {
  frozen = !frozen;
  btnFreeze.textContent = frozen ? "🧊 Descongelar" : "🧊 Congelar máx.";
});

// pause
btnPause.addEventListener("click", () => {
  paused = !paused;
  btnPause.textContent = paused ? "▶️ Reanudar" : "⏸️ Pausar";
});

// export
btnExport.addEventListener("click", () => {
  if (samples.length === 0) {
    alert("No hay datos para exportar.");
    return;
  }
  const csv = ["timestamp_ms,frecuencia_hz,frecuencia_max_congelada_hz"]
    .concat(samples.map(s => `${s.time},${s.freq.toFixed(2)},${s.frozenMax.toFixed(2)}`))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "frecuencias.csv";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
});

// mode
btnMode.addEventListener("click", () => {
  modeDocente = !modeDocente;
  document.getElementById("history-card").style.display = modeDocente ? "none" : "block";
  btnMode.textContent = modeDocente ? "🧑‍🎓 Modo estudiante" : "👨‍🏫 Modo docente";
});

// toggle 3D
btnToggle3d.addEventListener("click", () => {
  show3D = !show3D;
  document.getElementById("card-3d").style.display = show3D ? "block" : "none";
});

// perf selector
perfMode.addEventListener("change", () => {
  const val = perfMode.value;
  if (val === "high") {
    SPECTRUM_SIZE = 128;
    HISTORY_DEPTH = 100;
  } else if (val === "low") {
    SPECTRUM_SIZE = 64;
    HISTORY_DEPTH = 50;
  } else {
    SPECTRUM_SIZE = 96;
    HISTORY_DEPTH = 80;
  }
  heightData = [];
  init3D(true);
});

// device change live
deviceSelect.addEventListener("change", async () => {
  if (!running) return;
  const devId = deviceSelect.value;
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: devId } } });
  const newSource = audioCtx.createMediaStreamSource(stream);
  source.disconnect();
  source = newSource;
  source.connect(analyser);
  if (currentStream) currentStream.getTracks().forEach(t => t.stop());
  currentStream = stream;
});

// top controls
btnHome.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
btnTheme.addEventListener("click", () => document.body.classList.toggle("theme-light"));
btnPlus.addEventListener("click", () => {
  const c = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--font-base") || "16");
  document.documentElement.style.setProperty("--font-base", Math.min(c + 1, 22) + "px");
});
btnMinus.addEventListener("click", () => {
  const c = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--font-base") || "16");
  document.documentElement.style.setProperty("--font-base", Math.max(c - 1, 12) + "px");
});
btnFocus.addEventListener("click", () => document.body.classList.toggle("focus-mode"));
btnSearch.addEventListener("click", () => {
  searchOverlay.classList.add("show");
  searchInput.focus();
});
if (searchClose) {
  searchClose.addEventListener("click", () => searchOverlay.classList.remove("show"));
  searchOverlay.addEventListener("click", (e) => {
    if (e.target === searchOverlay) searchOverlay.classList.remove("show");
  });
}
btnLang.addEventListener("click", () => {
  currentLang = currentLang === "es" ? "en" : "es";
  applyLang();
});
btnVoz.addEventListener("click", () => {
  const text = `La frecuencia actual es ${freqValueEl.textContent}`;
  if ("speechSynthesis" in window) {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = currentLang === "es" ? "es-ES" : "en-US";
    speechSynthesis.speak(u);
  } else {
    alert(text);
  }
});

// search real
if (searchInput) {
  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const q = searchInput.value.toLowerCase();
      if (!q) return;
      const target = [...document.querySelectorAll("h1,h2,h3,p,span,td")]
        .find(n => n.textContent.toLowerCase().includes(q));
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "center" });
        searchOverlay.classList.remove("show");
      }
    }
  });
}

// lang
function applyLang() {
  const dict = {
    es: {
      title: "📡 Medidor de frecuencia (2D + 3D)",
      subtitle: "Selector de micrófono, pausa de análisis, 3D local, historial y exportación.",
      start: "🎙️ Iniciar medición",
      stop: "⏹️ Detener"
    },
    en: {
      title: "📡 Frequency meter (2D + 3D)",
      subtitle: "Mic selector, analysis pause, local 3D, history and CSV.",
      start: "🎙️ Start measuring",
      stop: "⏹️ Stop"
    }
  };
  const t = dict[currentLang];
  document.querySelectorAll("[data-i18n]").forEach(el => {
    const key = el.getAttribute("data-i18n");
    if (t[key]) el.textContent = t[key];
  });
}

// draw loop
function draw() {
  if (!running) return;
  requestAnimationFrame(draw);
  if (paused) return;
  analyser.getByteFrequencyData(dataArray);
  draw2D(dataArray);
  let maxVal = -1, maxIndex = -1;
  for (let i=0;i<dataArray.length;i++) {
    if (dataArray[i] > maxVal) {
      maxVal = dataArray[i];
      maxIndex = i;
    }
  }
  const freq = indexToFrequency(maxIndex, audioCtx.sampleRate, analyser.fftSize);
  if (!isNaN(freq) && freq > 0) {
    freqValueEl.textContent = freq.toFixed(1) + " Hz";
    if (!frozen && freq > maxFreq) maxFreq = freq;
    freqMaxEl.textContent = maxFreq.toFixed(1) + " Hz";
    samples.push({ time: performance.now().toFixed(0), freq, frozenMax: maxFreq });
    freqSamplesEl.textContent = samples.length;
    updateHistory();
    push3DData(Array.from(dataArray));
  }
}

function draw2D(arr) {
  ctx2d.fillStyle = "#020617";
  ctx2d.fillRect(0,0,canvas2d.width,canvas2d.height);
  const w = canvas2d.width;
  const h = canvas2d.height;
  const barW = (w / arr.length) * 2.1;
  let x = 0;
  for (let i=0;i<arr.length;i++) {
    const v = arr[i];
    const barH = (v/255)*h;
    ctx2d.fillStyle = "rgba(56,189,248,0.9)";
    ctx2d.fillRect(x, h - barH, barW, barH);
    x += barW + 1;
  }
}

function updateHistory() {
  const last = samples.slice(-10).reverse();
  historyBody.innerHTML = last.map((s, idx) => `<tr>
    <td>${idx+1}</td>
    <td>${s.time}</td>
    <td>${s.freq.toFixed(1)}</td>
    <td>${s.frozenMax.toFixed(1)}</td>
  </tr>`).join("");
}

// 3D
function init3D(reset=false) {
  const container = document.getElementById("scene3d");
  const fallback = document.getElementById("scene3d-fallback");
  if (!container) return;

  if (reset && renderer) {
    container.innerHTML = "";
    renderer.dispose();
    renderer = null;
  }

  if (!window.THREE) {
    if (fallback) fallback.textContent = "No se encontró THREE en /libs.";
    return;
  }
  if (fallback) fallback.remove();

  const w = container.clientWidth;
  const h = container.clientHeight;

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(45, w/h, 0.1, 1000);
  camera.position.set(-40, 35, 70);
  camera.lookAt(0,0,0);

  renderer = new THREE.WebGLRenderer({ antialias:true });
  renderer.setSize(w,h);
  container.appendChild(renderer.domElement);

  geometry = new THREE.PlaneGeometry(60, 40, HISTORY_DEPTH-1, SPECTRUM_SIZE-1);
  geometry.rotateX(-Math.PI/2);

  const colors = [];
  for (let i=0;i<geometry.attributes.position.count;i++) {
    colors.push(0,0.5,1);
  }
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));

  const material = new THREE.MeshPhongMaterial({
    vertexColors:true,
    side:THREE.DoubleSide,
    shininess:25
  });

  mesh = new THREE.Mesh(geometry, material);
  scene.add(mesh);

  const light = new THREE.DirectionalLight(0xffffff, 1.1);
  light.position.set(10,40,30);
  scene.add(light);
  scene.add(new THREE.AmbientLight(0x303030, 0.4));

  if (THREE.OrbitControls) {
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
  }

  animate3D();

  // resize handler
  window.addEventListener("resize", () => {
    if (!renderer || !camera) return;
    const w2 = container.clientWidth;
    const h2 = container.clientHeight;
    camera.aspect = w2 / h2;
    camera.updateProjectionMatrix();
    renderer.setSize(w2, h2);
  });
}

function animate3D() {
  requestAnimationFrame(animate3D);
  if (renderer && scene && camera && show3D) {
    if (controls) controls.update();
    renderer.render(scene, camera);
  }
}

function push3DData(arr) {
  if (!geometry) return;
  const slice = arr.slice(0, SPECTRUM_SIZE);
  heightData.unshift(slice);
  if (heightData.length > HISTORY_DEPTH) heightData.pop();
  const pos = geometry.attributes.position;
  const colAttr = geometry.attributes.color;
  for (let z=0; z<HISTORY_DEPTH; z++) {
    const col = heightData[z];
    for (let y=0; y<SPECTRUM_SIZE; y++) {
      const idx = z * SPECTRUM_SIZE + y;
      let h = 0;
      let intensity = 0;
      if (col && typeof col[y] !== "undefined") {
        intensity = col[y] / 255;
        h = intensity * 4.0;
      }
      const x = pos.getX(idx);
      const zz = pos.getZ(idx);
      pos.setXYZ(idx, x, h, zz);

      const c = heatColor(intensity);
      colAttr.setXYZ(idx, c.r, c.g, c.b);
    }
  }
  pos.needsUpdate = true;
  colAttr.needsUpdate = true;
}

function heatColor(t) {
  if (t < 0.25) return {r:0, g:t*4, b:1};
  if (t < 0.5)  return {r:0, g:1, b:1-(t-0.25)*4};
  if (t < 0.75) return {r:(t-0.5)*4, g:1, b:0};
  return {r:1, g:1-(t-0.75)*4, b:0};
}

function indexToFrequency(index, sampleRate, fftSize) {
  return (index * sampleRate) / fftSize;
}

init3D();
