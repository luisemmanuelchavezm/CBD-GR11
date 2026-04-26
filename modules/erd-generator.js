import { normalizeType } from "./schema-utils.js";

// Generación del código Mermaid y decoración visual del SVG resultante.

export const MERMAID_CONFIG = {
  startOnLoad: false,
  securityLevel: "loose",
  theme: "base",
  er: {
    useMaxWidth: false,
    layoutDirection: "LR",
    entityPadding: 14,
    minEntityWidth: 220,
    minEntityHeight: 70,
    diagramPadding: 40,
  },
  flowchart: {
    useMaxWidth: false,
    curve: "basis",
    rankSpacing: 120,
    nodeSpacing: 80,
    padding: 30,
  },
  themeVariables: {
    background: "#f6f7fb",
    primaryColor: "#ffffff",
    primaryTextColor: "#1f2933",
    primaryBorderColor: "#243b53",
    lineColor: "#52606d",
    tertiaryColor: "#d9e2ec",
    fontFamily: "'Segoe UI', sans-serif",
  },
};

// Traduce el esquema enriquecido a sintaxis Mermaid erDiagram.
export function schemaToMermaid(schema) {
  const orderedSchema = orderSchemaForRendering(schema);
  const lines = ["erDiagram"];

  for (const table of orderedSchema.tables) {
    lines.push(`  ${table.name} {`);

    for (const column of orderColumnsForRendering(table.columns)) {
      const flags = [column.isPrimaryKey ? "PK" : "", column.isForeignKey ? "FK" : ""].filter(Boolean).join(", ");
      const suffix = flags ? ` \"${flags}\"` : "";
      lines.push(`    ${normalizeType(column.type)} ${column.name}${suffix}`);
    }

    lines.push("  }");
  }

  for (const relationship of orderedSchema.relationships) {
    const label = relationship.label ? ` : \"${relationship.label}\"` : "";
    lines.push(`  ${relationship.toTable} ${relationship.cardinality} ${relationship.fromTable}${label}`);
  }

  return lines.join("\n");
}

// Ordena tablas y relaciones para que el código generado sea más estable y legible.
export function orderSchemaForRendering(schema) {
  const tables = [...schema.tables].sort((left, right) => {
    const leftScore = scoreTable(left, schema.relationships);
    const rightScore = scoreTable(right, schema.relationships);

    if (leftScore !== rightScore) {
      return rightScore - leftScore;
    }

    return left.name.localeCompare(right.name);
  });

  const relationships = [...schema.relationships].sort((left, right) => {
    const leftKey = `${left.toTable}-${left.fromTable}-${left.label}`;
    const rightKey = `${right.toTable}-${right.fromTable}-${right.label}`;
    return leftKey.localeCompare(rightKey);
  });

  return {
    ...schema,
    tables,
    relationships,
  };
}

// Prioriza PK, FK y columnas importantes antes de las demás al dibujar cada tabla.
export function orderColumnsForRendering(columns) {
  return [...columns].sort((left, right) => {
    const leftScore = scoreColumn(left);
    const rightScore = scoreColumn(right);

    if (leftScore !== rightScore) {
      return rightScore - leftScore;
    }

    return left.name.localeCompare(right.name);
  });
}

// Aplica clases y estilos visuales al SVG ya renderizado por Mermaid.
export function decorateDiagram(diagramElement, schema) {
  diagramElement.setAttribute("class", "diagram-canvas");
  applyEntityStyles(diagramElement, schema);
  applyRelationshipStyles(diagramElement, schema);
}

// Puntúa tablas para decidir un orden de aparición consistente en el diagrama.
function scoreTable(table, relationships) {
  let score = table.columns.length;

  if (table.semanticType === "fact") {
    score += 20;
  }

  if (table.semanticType === "dimension") {
    score += 10;
  }

  if (table.isJunctionTable) {
    score -= 10;
  }

  const relationshipCount = relationships.filter(
    (relationship) => relationship.fromTable === table.name || relationship.toTable === table.name
  ).length;

  score += relationshipCount * 2;

  return score;
}

// Puntúa columnas según su importancia estructural dentro de la entidad.
function scoreColumn(column) {
  if (column.isPrimaryKey) {
    return 30;
  }

  if (column.isForeignKey) {
    return 20;
  }

  if (!column.nullable) {
    return 10;
  }

  return 0;
}

// Marca cada entidad con su semántica y ajusta relleno y borde visual.
function applyEntityStyles(diagramElement, schema) {
  const entityNodes = [...diagramElement.querySelectorAll('[id^="entity-"]')];

  for (const node of entityNodes) {
    const titleElement = node.querySelector(".er.entityLabel");
    const tableName = titleElement?.textContent?.trim();
    const table = schema.tables.find((entry) => entry.name === tableName);

    if (!table) {
      continue;
    }

    node.setAttribute("data-semantic-type", table.semanticType);
    node.setAttribute("data-table-name", table.name);

    const shape = node.querySelector("rect") || node.querySelector("polygon");

    if (shape) {
      const palette = getTablePalette(table);
      shape.style.fill = palette.fill;
      shape.style.stroke = palette.stroke;
      shape.style.strokeWidth = "1.5px";
    }
  }
}

// Resalta el trazo de las relaciones según su cardinalidad lógica.
function applyRelationshipStyles(diagramElement, schema) {
  const edgePaths = [...diagramElement.querySelectorAll("path")];

  for (const path of edgePaths) {
    const title = path.parentElement?.querySelector("title")?.textContent ?? "";
    const relationship = schema.relationships.find((entry) => title.includes(`${entry.toTable}${entry.fromTable}`));

    if (!relationship) {
      continue;
    }

    path.style.stroke = relationship.relationshipKind === "one-to-one" ? "#486581" : "#9f1239";
    path.style.strokeWidth = relationship.relationshipKind === "one-to-one" ? "2px" : "2.5px";
  }
}

// Devuelve la paleta visual usada para cada tipo semántico de tabla.
function getTablePalette(table) {
  if (table.isJunctionTable) {
    return { fill: "#fde68a", stroke: "#92400e" };
  }

  if (table.semanticType === "fact") {
    return { fill: "#fecdd3", stroke: "#9f1239" };
  }

  if (table.semanticType === "dimension") {
    return { fill: "#bfdbfe", stroke: "#1d4ed8" };
  }

  return { fill: "#ffffff", stroke: "#243b53" };
}
