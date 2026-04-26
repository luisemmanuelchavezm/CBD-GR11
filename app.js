import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";
import { downloadDiagramPng, serializeSvg } from "./modules/diagram-export.js?v=20260426h";
import { decorateDiagram, MERMAID_CONFIG, schemaToMermaid } from "./modules/erd-generator.js?v=20260426h";
import { buildNormalizationSuggestion, formatQualityReport } from "./modules/normalization.js?v=20260426h";
import { parseSqlSchema } from "./modules/sql-parser.js?v=20260426h";

// Controlador principal de la interfaz: conecta eventos, estado de vista y módulos puros.

const sqlInput = document.querySelector("#sql-input");
const mermaidOutput = document.querySelector("#mermaid-output");
const analysisOutput = document.querySelector("#analysis-output");
const renderButton = document.querySelector("#render");
const normalizeButton = document.querySelector("#normalize");
const copyButton = document.querySelector("#copy-mermaid");
const copyMermaidCodeButton = document.querySelector("#copy-mermaid-code");
const downloadMermaidButton = document.querySelector("#download-mermaid");
const downloadPngButton = document.querySelector("#download-png");
const downloadSvgButton = document.querySelector("#download-svg");
const zoomOutButton = document.querySelector("#zoom-out");
const zoomResetButton = document.querySelector("#zoom-reset");
const zoomInButton = document.querySelector("#zoom-in");
const fileInput = document.querySelector("#sql-file");
const themeSelect = document.querySelector("#theme-select");
const diagramShell = document.querySelector(".diagram-shell");
const diagram = document.querySelector("#diagram");
const status = document.querySelector("#status");
const stats = document.querySelector("#stats");

let lastMermaidCode = "";
let currentDiagramMode = "original";

const viewportState = {
  scale: 1,
  minScale: 0.45,
  maxScale: 2.5,
  step: 0.15,
  width: 0,
  height: 0,
  isDragging: false,
  pointerId: null,
  startX: 0,
  startY: 0,
  startScrollLeft: 0,
  startScrollTop: 0,
};

themeSelect.value = localStorage.getItem("erd-theme") ?? "neutral";
applyUiTheme(themeSelect.value);
mermaid.initialize(getMermaidConfig(themeSelect.value));
setStatus("Esperando SQL.");
setActionsEnabled(false);
clearAnalysisOutput();

renderButton.addEventListener("click", handleRender);
normalizeButton.addEventListener("click", handleNormalizationAnalysis);
zoomOutButton.addEventListener("click", () => adjustZoom(-1));
zoomResetButton.addEventListener("click", resetZoom);
zoomInButton.addEventListener("click", () => adjustZoom(1));
copyButton.addEventListener("click", copyMermaidCode);
copyMermaidCodeButton.addEventListener("click", copyMermaidCode);
downloadMermaidButton.addEventListener("click", handleDownloadMermaid);
downloadPngButton.addEventListener("click", handleDownloadPng);
downloadSvgButton.addEventListener("click", handleDownloadSvg);
fileInput.addEventListener("change", handleFileSelection);
diagramShell.addEventListener("pointerdown", handleDiagramPointerDown);
window.addEventListener("pointermove", handleDiagramPointerMove);
window.addEventListener("pointerup", stopDiagramDrag);
window.addEventListener("pointercancel", stopDiagramDrag);
diagramShell.addEventListener("wheel", handleDiagramWheel, { passive: false });
themeSelect.addEventListener("change", handleThemeChange);

// Genera el ERD del script original cargado en la UI.
async function handleRender() {
  const sql = sqlInput.value.trim();

  if (!sql) {
    setStatus("Pega o carga un script SQL antes de generar el ERD.", "error");
    return;
  }

  try {
    const schema = parseSqlSchema(sql);
    clearAnalysisOutput();
    currentDiagramMode = "original";
    await renderSchema(schema, "ERD generado correctamente.");
  } catch (error) {
    resetDiagramState();
    clearAnalysisOutput();
    setStatus(error.message || "No se pudo generar el ERD.", "error");
  }
}

// Ejecuta el análisis, rellena paneles de salida y muestra el esquema normalizado.
async function handleNormalizationAnalysis() {
  const sql = sqlInput.value.trim();

  if (!sql) {
    setStatus("Pega o carga un script SQL antes de analizar la normalización.", "error");
    return;
  }

  try {
    const schema = parseSqlSchema(sql);

    if (!schema.tables.length) {
      throw new Error("No encontré tablas CREATE TABLE en el script.");
    }

    const suggestion = buildNormalizationSuggestion(schema);

    analysisOutput.value = formatQualityReport(suggestion.analysis, schema);
    currentDiagramMode = "normalized";

    await renderSchema(
      suggestion.normalizedSchema,
      suggestion.analysis.recommendations.length
        ? "Informe generado y ERD normalizado renderizado."
        : "Informe generado. No se detectó una descomposición adicional; se muestra el ERD actual.",
      suggestion.analysis.issues.length ? "error" : "success"
    );
  } catch (error) {
    analysisOutput.value = "";
    resetDiagramState();
    setStatus(error.message || "No se pudo analizar la normalización.", "error");
  }
}

// Renderiza un esquema ya procesado con Mermaid y actualiza el estado visible.
async function renderSchema(schema, successMessage, tone = "success") {
  if (!schema.tables.length) {
    throw new Error("No encontré tablas CREATE TABLE en el script.");
  }

  mermaid.initialize(getMermaidConfig(themeSelect.value));
  const mermaidCode = schemaToMermaid(schema);
  const renderId = `erd-${crypto.randomUUID()}`;
  const { svg } = await mermaid.render(renderId, mermaidCode);

  diagram.className = "";
  diagram.innerHTML = wrapSvgWithViewport(svg);

  const renderedSvg = diagram.querySelector("svg");
  decorateDiagram(renderedSvg, schema);
  initializeViewport(renderedSvg);
  mermaidOutput.value = mermaidCode;
  lastMermaidCode = mermaidCode;
  stats.textContent = buildStatsSummary(schema);
  setStatus(successMessage, tone);
  setActionsEnabled(true);
}

// Reaplica el tema actual y vuelve a renderizar el modo activo si ya hay SQL cargado.
async function handleThemeChange() {
  localStorage.setItem("erd-theme", themeSelect.value);
  applyUiTheme(themeSelect.value);

  if (!sqlInput.value.trim()) {
    setStatus(`Tema ${themeSelect.value} preparado.`, "success");
    return;
  }

  if (currentDiagramMode === "normalized") {
    await handleNormalizationAnalysis();
    return;
  }

  await handleRender();
}

// Lee el archivo seleccionado y lo inyecta en el textarea principal.
async function handleFileSelection(event) {
  const [file] = event.target.files ?? [];

  if (!file) {
    return;
  }

  sqlInput.value = await file.text();
  currentDiagramMode = "original";
  clearAnalysisOutput();
  setStatus(`Archivo ${file.name} cargado.`, "success");
  event.target.value = "";
}

// Descarga el código Mermaid tal como fue generado en la última renderización.
function handleDownloadMermaid() {
  if (!lastMermaidCode) {
    return;
  }

  downloadFile("erd.mmd", lastMermaidCode, "text/plain;charset=utf-8");
}

// Exporta el diagrama actual a PNG usando el módulo de serialización.
async function handleDownloadPng() {
  const svg = diagram.querySelector("svg");

  if (!svg) {
    return;
  }

  try {
    await downloadDiagramPng(svg, getDiagramBackgroundColor());
    setStatus("Imagen PNG descargada.", "success");
  } catch (error) {
    setStatus(error.message || "No se pudo descargar la imagen PNG.", "error");
  }
}

// Descarga el SVG actual con estilos inline para conservar la apariencia.
function handleDownloadSvg() {
  const svg = diagram.querySelector("svg");

  if (!svg) {
    return;
  }

  downloadFile("erd.svg", serializeSvg(svg, getDiagramBackgroundColor()), "image/svg+xml;charset=utf-8");
}

// Envuelve el SVG en un contenedor escalable para el viewport con zoom.
function wrapSvgWithViewport(svgMarkup) {
  return `<div class="diagram-canvas">${svgMarkup}</div>`;
}

// Inicializa medidas base del diagrama para las operaciones de zoom y centrado.
function initializeViewport(svg) {
  if (!svg) {
    return;
  }

  const viewBox = svg.viewBox?.baseVal;
  const fallbackWidth = parseFloat(svg.getAttribute("width")) || svg.getBoundingClientRect().width || 1200;
  const fallbackHeight = parseFloat(svg.getAttribute("height")) || svg.getBoundingClientRect().height || 800;

  viewportState.width = viewBox?.width || fallbackWidth;
  viewportState.height = viewBox?.height || fallbackHeight;
  viewportState.scale = 1;
  syncViewportSize();
  centerViewport();
}

// Sincroniza el tamaño escalado del canvas interno con el factor de zoom actual.
function syncViewportSize() {
  const canvas = diagram.querySelector(".diagram-canvas");
  const svg = diagram.querySelector("svg");

  if (!canvas || !svg || !viewportState.width || !viewportState.height) {
    updateZoomControls();
    return;
  }

  const scaledWidth = viewportState.width * viewportState.scale;
  const scaledHeight = viewportState.height * viewportState.scale;

  canvas.style.width = `${scaledWidth}px`;
  canvas.style.height = `${scaledHeight}px`;
  svg.style.width = `${scaledWidth}px`;
  svg.style.height = `${scaledHeight}px`;
  updateZoomControls();
}

// Centra el scroll del viewport una vez renderizado el diagrama.
function centerViewport() {
  const maxLeft = Math.max(0, diagramShell.scrollWidth - diagramShell.clientWidth);
  const maxTop = Math.max(0, diagramShell.scrollHeight - diagramShell.clientHeight);

  diagramShell.scrollLeft = maxLeft / 2;
  diagramShell.scrollTop = maxTop / 2;
}

// Ajusta el zoom relativo hacia dentro o hacia fuera.
function adjustZoom(direction) {
  applyZoom(viewportState.scale + direction * viewportState.step);
}

// Devuelve el viewport al zoom base del 100%.
function resetZoom() {
  applyZoom(1);
}

// Aplica el nuevo zoom manteniendo un punto de enfoque estable en pantalla.
function applyZoom(nextScale, focusPoint = null) {
  const svg = diagram.querySelector("svg");

  if (!svg || !viewportState.width || !viewportState.height) {
    return;
  }

  const boundedScale = Math.min(viewportState.maxScale, Math.max(viewportState.minScale, Number(nextScale.toFixed(2))));

  if (boundedScale === viewportState.scale) {
    return;
  }

  const rect = diagramShell.getBoundingClientRect();
  const localFocus = focusPoint ?? { x: rect.width / 2, y: rect.height / 2 };
  const contentX = diagramShell.scrollLeft + localFocus.x;
  const contentY = diagramShell.scrollTop + localFocus.y;
  const ratio = boundedScale / viewportState.scale;

  viewportState.scale = boundedScale;
  syncViewportSize();
  diagramShell.scrollLeft = Math.max(0, contentX * ratio - localFocus.x);
  diagramShell.scrollTop = Math.max(0, contentY * ratio - localFocus.y);
}

// Activa o desactiva los controles de zoom según el estado del diagrama.
function updateZoomControls() {
  const hasDiagram = Boolean(lastMermaidCode);

  zoomOutButton.disabled = !hasDiagram || viewportState.scale <= viewportState.minScale;
  zoomInButton.disabled = !hasDiagram || viewportState.scale >= viewportState.maxScale;
  zoomResetButton.disabled = !hasDiagram;
  zoomResetButton.textContent = `${Math.round(viewportState.scale * 100)}%`;
}

// Inicia el arrastre manual del viewport cuando el usuario pulsa sobre el diagrama.
function handleDiagramPointerDown(event) {
  if (event.button !== 0 || !diagram.querySelector("svg")) {
    return;
  }

  event.preventDefault();
  viewportState.isDragging = true;
  viewportState.pointerId = event.pointerId;
  viewportState.startX = event.clientX;
  viewportState.startY = event.clientY;
  viewportState.startScrollLeft = diagramShell.scrollLeft;
  viewportState.startScrollTop = diagramShell.scrollTop;
  diagramShell.classList.add("is-dragging");

  if (diagramShell.setPointerCapture) {
    diagramShell.setPointerCapture(event.pointerId);
  }
}

// Desplaza el viewport mientras el usuario arrastra el diagrama.
function handleDiagramPointerMove(event) {
  if (!viewportState.isDragging || event.pointerId !== viewportState.pointerId) {
    return;
  }

  event.preventDefault();
  diagramShell.scrollLeft = viewportState.startScrollLeft - (event.clientX - viewportState.startX);
  diagramShell.scrollTop = viewportState.startScrollTop - (event.clientY - viewportState.startY);
}

// Finaliza el modo de arrastre y libera la captura del puntero.
function stopDiagramDrag(event) {
  if (!viewportState.isDragging) {
    return;
  }

  if (event && viewportState.pointerId !== null && event.pointerId !== viewportState.pointerId) {
    return;
  }

  if (viewportState.pointerId !== null && diagramShell.releasePointerCapture && diagramShell.hasPointerCapture?.(viewportState.pointerId)) {
    diagramShell.releasePointerCapture(viewportState.pointerId);
  }

  viewportState.isDragging = false;
  viewportState.pointerId = null;
  diagramShell.classList.remove("is-dragging");
}

// Permite acercar o alejar el diagrama usando la rueda del mouse.
function handleDiagramWheel(event) {
  if (!diagram.querySelector("svg")) {
    return;
  }

  event.preventDefault();
  applyZoom(viewportState.scale + (event.deltaY < 0 ? viewportState.step : -viewportState.step), {
    x: event.clientX - diagramShell.getBoundingClientRect().left,
    y: event.clientY - diagramShell.getBoundingClientRect().top,
  });
}

// Resume estadísticas del esquema para mostrarlas en la cabecera de salida.
function buildStatsSummary(schema) {
  const factCount = schema.tables.filter((table) => table.semanticType === "fact").length;
  const dimensionCount = schema.tables.filter((table) => table.semanticType === "dimension").length;
  const junctionCount = schema.tables.filter((table) => table.semanticType === "junction").length;
  const oneToOneCount = schema.relationships.filter((relationship) => relationship.relationshipKind === "one-to-one").length;
  const reflexiveCount = schema.relationships.filter((relationship) => relationship.isReflexive).length;

  return [
    `${schema.tables.length} tablas`,
    `${schema.relationships.length} relaciones`,
    `${oneToOneCount} 1:1`,
    `${schema.derivedRelationships.length} N:M`,
    `${reflexiveCount} reflexivas`,
    `${factCount} hechos`,
    `${dimensionCount} dimensiones`,
    `${junctionCount} puente`,
  ].join(" · ");
}

// Mezcla el tema elegido con la configuración base del renderer Mermaid.
function getMermaidConfig(theme) {
  return {
    ...MERMAID_CONFIG,
    theme,
  };
}

// Refleja el tema elegido en el atributo data del body para activar CSS.
function applyUiTheme(theme) {
  document.body.dataset.uiTheme = theme;
}

// Limpia el panel textual del informe de análisis.
function clearAnalysisOutput() {
  analysisOutput.value = "";
}

// Muestra mensajes de estado con variantes visuales de éxito o error.
function setStatus(message, tone = "idle") {
  status.textContent = message;
  status.classList.toggle("is-error", tone === "error");
  status.classList.toggle("is-success", tone === "success");
}

// Habilita o bloquea acciones según exista un diagrama renderizado.
function setActionsEnabled(enabled) {
  copyButton.disabled = !enabled;
  copyMermaidCodeButton.disabled = !enabled;
  downloadMermaidButton.disabled = !enabled;
  downloadPngButton.disabled = !enabled;
  downloadSvgButton.disabled = !enabled;
  updateZoomControls();
}

// Restablece el estado del visor cuando una operación falla o se limpia la vista.
function resetDiagramState() {
  lastMermaidCode = "";
  mermaidOutput.value = "";
  diagram.className = "diagram-empty";
  diagram.innerHTML = "<p>No se pudo generar el diagrama.</p>";
  stats.textContent = "";
  currentDiagramMode = "original";
  viewportState.scale = 1;
  viewportState.width = 0;
  viewportState.height = 0;
  viewportState.isDragging = false;
  viewportState.pointerId = null;
  diagramShell.classList.remove("is-dragging");
  setActionsEnabled(false);
}

// Descarga un contenido arbitrario generando un enlace temporal al blob.
function downloadFile(fileName, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

// Copia al portapapeles el último código Mermaid generado.
async function copyMermaidCode() {
  if (!lastMermaidCode) {
    return;
  }

  await navigator.clipboard.writeText(lastMermaidCode);
  setStatus("Código Mermaid copiado.", "success");
}

// Obtiene el color de fondo actual del viewport para las exportaciones.
function getDiagramBackgroundColor() {
  return getComputedStyle(diagramShell).backgroundColor || "#ffffff";
}
