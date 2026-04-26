// Exportación del ERD a SVG y PNG preservando texto y estilos calculados.

// Convierte el SVG visible en un PNG descargable usando un canvas temporal.
export async function downloadDiagramPng(svg, backgroundColor) {
  const serializedSvg = serializeSvg(svg, backgroundColor);
  const svgBlob = new Blob([serializedSvg], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(svgBlob);

  try {
    const image = await loadImage(url);
    const { width, height } = getSvgExportSize(svg);
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");

    if (!context) {
      throw new Error("El navegador no pudo preparar el lienzo para exportar el PNG.");
    }

    canvas.width = width;
    canvas.height = height;
    context.fillStyle = backgroundColor || "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);

    const pngBlob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));

    if (!pngBlob) {
      throw new Error("No se pudo convertir el diagrama a PNG.");
    }

    const pngUrl = URL.createObjectURL(pngBlob);

    try {
      const link = document.createElement("a");
      link.href = pngUrl;
      link.download = "erd.png";
      link.click();
    } finally {
      URL.revokeObjectURL(pngUrl);
    }
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Serializa el SVG actual a un string exportable con estilos inline.
export function serializeSvg(svg, backgroundColor) {
  const clone = svg.cloneNode(true);
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");

  const { width, height } = getSvgExportSize(svg);
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));

  if (!clone.getAttribute("viewBox")) {
    clone.setAttribute("viewBox", `0 0 ${width} ${height}`);
  }

  clone.style.background = backgroundColor || "#ffffff";
  inlineComputedSvgStyles(svg, clone);
  replaceForeignObjectsWithSvgText(svg, clone);

  return new XMLSerializer().serializeToString(clone);
}

// Copia estilos computados al clon del SVG para que sobrevivan fuera del DOM.
function inlineComputedSvgStyles(sourceSvg, targetSvg) {
  const sourceElements = [sourceSvg, ...sourceSvg.querySelectorAll("*")];
  const targetElements = [targetSvg, ...targetSvg.querySelectorAll("*")];
  const styleProperties = [
    "fill",
    "stroke",
    "stroke-width",
    "stroke-dasharray",
    "stroke-linecap",
    "stroke-linejoin",
    "opacity",
    "color",
    "font-family",
    "font-size",
    "font-weight",
    "font-style",
    "letter-spacing",
    "text-anchor",
    "dominant-baseline",
    "paint-order",
  ];

  for (let index = 0; index < Math.min(sourceElements.length, targetElements.length); index += 1) {
    const computedStyle = getComputedStyle(sourceElements[index]);
    const inlineStyle = styleProperties
      .map((property) => {
        const value = computedStyle.getPropertyValue(property);
        return value ? `${property}:${value}` : "";
      })
      .filter(Boolean)
      .join(";");

    if (inlineStyle) {
      targetElements[index].setAttribute("style", inlineStyle);
    }
  }
}

// Sustituye foreignObject por text nativo para mejorar compatibilidad al exportar.
function replaceForeignObjectsWithSvgText(sourceSvg, targetSvg) {
  const sourceForeignObjects = [...sourceSvg.querySelectorAll("foreignObject")];
  const targetForeignObjects = [...targetSvg.querySelectorAll("foreignObject")];

  for (let index = 0; index < Math.min(sourceForeignObjects.length, targetForeignObjects.length); index += 1) {
    const replacement = buildSvgTextFromForeignObject(sourceForeignObjects[index]);

    if (replacement) {
      targetForeignObjects[index].replaceWith(replacement);
    } else {
      targetForeignObjects[index].remove();
    }
  }
}

// Reconstruye un nodo text SVG equivalente al contenido HTML de Mermaid.
function buildSvgTextFromForeignObject(sourceForeignObject) {
  const textContent = sourceForeignObject.textContent?.replace(/\s+/g, " ").trim();

  if (!textContent) {
    return null;
  }

  const width = parseFloat(sourceForeignObject.getAttribute("width")) || 0;
  const height = parseFloat(sourceForeignObject.getAttribute("height")) || 0;
  const textNode = document.createElementNS("http://www.w3.org/2000/svg", "text");
  const styledElement = sourceForeignObject.querySelector("span, p, div") || sourceForeignObject;
  const computedStyle = getComputedStyle(styledElement);

  textNode.textContent = textContent;
  textNode.setAttribute("x", String(width / 2));
  textNode.setAttribute("y", String(height / 2));
  textNode.setAttribute("text-anchor", computedStyle.textAlign === "left" ? "start" : "middle");
  textNode.setAttribute("dominant-baseline", "middle");
  textNode.setAttribute(
    "style",
    [
      `fill:${computedStyle.color || computedStyle.fill || "#111111"}`,
      `font-family:${computedStyle.fontFamily}`,
      `font-size:${computedStyle.fontSize}`,
      `font-weight:${computedStyle.fontWeight}`,
      `font-style:${computedStyle.fontStyle}`,
      `letter-spacing:${computedStyle.letterSpacing}`,
    ].join(";")
  );

  if (computedStyle.textAlign === "left") {
    textNode.setAttribute("x", "0");
  }

  return textNode;
}

// Calcula el tamaño real que debe usarse al exportar el diagrama.
function getSvgExportSize(svg) {
  const viewBox = svg.viewBox?.baseVal;
  const width = Math.max(1, Math.ceil(viewBox?.width || parseFloat(svg.getAttribute("width")) || svg.getBoundingClientRect().width || 1200));
  const height = Math.max(1, Math.ceil(viewBox?.height || parseFloat(svg.getAttribute("height")) || svg.getBoundingClientRect().height || 800));

  return { width, height };
}

// Carga el SVG serializado como imagen antes de pintarlo en canvas.
function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("No se pudo preparar la imagen del diagrama para la descarga."));
    image.src = url;
  });
}
