// Utilidades compartidas para partir SQL, normalizar identificadores y clonar estructuras.

// Separa una lista SQL por comas respetando los paréntesis internos.
export function splitTopLevel(input) {
  const parts = [];
  let current = "";
  let depth = 0;

  for (const char of input) {
    if (char === "(") {
      depth += 1;
    }

    if (char === ")") {
      depth -= 1;
    }

    if (char === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  if (current.trim()) {
    parts.push(current);
  }

  return parts;
}

// Convierte una lista de nombres de columnas en identificadores limpios.
export function splitIdentifiers(value) {
  return value
    .split(",")
    .map((entry) => normalizeIdentifier(entry))
    .filter(Boolean);
}

// Extrae columnas desde expresiones del tipo (col1, col2).
export function extractColumnList(value) {
  const match = value.match(/\(([^)]+)\)/);
  return splitIdentifiers(match ? match[1] : value);
}

// Parte una definición SQL en tokens simples preservando identificadores con comillas.
export function tokenizeSql(value) {
  return value.match(/"[^"]+"|[^\s]+/g) ?? [];
}

// Elimina comentarios de línea y de bloque antes de parsear el script.
export function stripComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, "\n")
    .replace(/--.*$/gm, "");
}

// Normaliza nombres SQL a un identificador estable para el modelo interno.
export function normalizeIdentifier(value) {
  return value
    .trim()
    .replace(/^"|"$/g, "")
    .split(".")
    .at(-1)
    .replace(/[^A-Za-z0-9_]/g, "_");
}

// Convierte un tipo SQL a una forma compacta apta para Mermaid.
export function normalizeType(value) {
  return value
    .replace(/\s+/g, " ")
    .replace(/[^A-Za-z0-9_,()]/g, "_")
    .replace(/,/g, "_")
    .toUpperCase();
}

// Convierte un tipo SQL a una forma uniforme para regenerar SQL sugerido.
export function normalizeTypeForSql(value) {
  return value.replace(/\s+/g, " ").trim().toUpperCase();
}

// Detecta cuándo ya empezó la parte de restricciones de una columna.
export function isColumnClauseStart(token, nextToken) {
  return (
    token === "DEFAULT" ||
    token === "CHECK" ||
    token === "COLLATE" ||
    token === "CONSTRAINT" ||
    token === "UNIQUE" ||
    (token === "GENERATED" && nextToken === "ALWAYS")
  );
}

// Elimina relaciones duplicadas comparando tablas y columnas origen/destino.
export function dedupeRelationships(relationships) {
  const unique = new Map();

  for (const relationship of relationships) {
    const key = [
      relationship.fromTable,
      relationship.fromColumns.join(","),
      relationship.toTable,
      relationship.toColumns.join(","),
    ].join("|");

    if (!unique.has(key)) {
      unique.set(key, relationship);
    }
  }

  return [...unique.values()];
}

// Clona una tabla con copias profundas de columnas y restricciones.
export function cloneTable(table) {
  return {
    ...table,
    columns: table.columns.map((column) => ({
      ...column,
      references: column.references
        ? {
            table: column.references.table,
            columns: [...column.references.columns],
          }
        : null,
    })),
    uniqueConstraints: table.uniqueConstraints.map((group) => [...group]),
  };
}

// Clona una relación para poder transformar esquemas sin mutar el original.
export function cloneRelationship(relationship) {
  return {
    ...relationship,
    fromColumns: [...relationship.fromColumns],
    toColumns: [...relationship.toColumns],
  };
}

// Genera un nombre libre cuando una tabla nueva colisiona con una existente.
export function resolveAvailableTableName(tableMap, baseName) {
  if (!tableMap.has(baseName)) {
    return baseName;
  }

  let suffix = 2;

  while (tableMap.has(`${baseName}_${suffix}`)) {
    suffix += 1;
  }

  return `${baseName}_${suffix}`;
}
