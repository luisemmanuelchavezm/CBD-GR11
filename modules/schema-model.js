import { dedupeRelationships } from "./schema-utils.js";

// Enriquecimiento del modelo: semántica de tablas, cardinalidades y relaciones derivadas.

// Completa el esquema con metadatos útiles para renderizar y analizar el ERD.
export function materializeSchema(tables, relationships) {
  const tableMap = new Map(tables.map((table) => [table.name, table]));
  const enrichedRelationships = dedupeRelationships(relationships).map((relationship) =>
    enrichRelationship(relationship, tableMap)
  );
  const enrichedTables = tables.map((table) => enrichTable(table, enrichedRelationships));
  const derivedRelationships = deriveManyToManyRelationships(enrichedTables, enrichedRelationships);

  return {
    tables: enrichedTables,
    relationships: enrichedRelationships,
    derivedRelationships,
  };
}

// Comprueba si un conjunto de columnas está cubierto por una restricción UNIQUE.
export function columnsAreUnique(table, columns) {
  if (!table || !columns.length) {
    return false;
  }

  const normalizedColumns = [...columns].sort().join("|");

  return table.uniqueConstraints.some((group) => [...group].sort().join("|") === normalizedColumns);
}

// Clasifica una tabla según su forma y las relaciones que la rodean.
function enrichTable(table, relationships) {
  const relatedRelationships = relationships.filter(
    (relationship) => relationship.fromTable === table.name || relationship.toTable === table.name
  );
  const foreignKeyColumns = table.columns.filter((column) => column.isForeignKey);
  const nonForeignKeyColumns = table.columns.filter((column) => !column.isForeignKey);
  const lowerName = table.name.toLowerCase();
  const lowerColumnNames = table.columns.map((column) => column.name.toLowerCase());
  const hasMeasures = lowerColumnNames.some((column) => /total|amount|price|quantity|subtotal|cost|value/.test(column));
  const hasTime = lowerColumnNames.some((column) => /date|time|created|updated/.test(column));
  const hasDescriptors = lowerColumnNames.some((column) => /name|title|code|type|status|category/.test(column));
  const isJunctionTable =
    foreignKeyColumns.length === 2 &&
    columnsAreUnique(
      table,
      foreignKeyColumns.map((column) => column.name)
    ) &&
    nonForeignKeyColumns.every((column) => isBridgeSupportColumn(column));
  let semanticType = "standard";

  if (isJunctionTable) {
    semanticType = "junction";
  } else if (
    hasMeasures ||
    hasTime ||
    /invoice|order|line|detail|transaction|payment|sale|fact/.test(lowerName)
  ) {
    semanticType = "fact";
  } else if (
    hasDescriptors &&
    table.columns.length <= 6 &&
    relatedRelationships.length <= 3 &&
    !/line|detail|event|log/.test(lowerName)
  ) {
    semanticType = "dimension";
  }

  return {
    ...table,
    semanticType,
    isJunctionTable,
  };
}

// Permite columnas de soporte típicas en tablas puente sin dejar de tratarlas como N:M.
function isBridgeSupportColumn(column) {
  return (
    column.isPrimaryKey ||
    /^(created|updated|last_update|created_at|updated_at|timestamp|order|position|sort|active|enabled|status)$/i.test(
      column.name
    )
  );
}

// Calcula cardinalidad y tipo lógico de cada relación foránea.
function enrichRelationship(relationship, tableMap) {
  const fromTable = tableMap.get(relationship.fromTable);
  const fromIsUnique = columnsAreUnique(fromTable, relationship.fromColumns);
  const cardinality = fromIsUnique
    ? relationship.nullable
      ? "||--o|"
      : "||--||"
    : relationship.nullable
      ? "||--o{"
      : "||--|{";

  return {
    ...relationship,
    cardinality,
    relationshipKind: fromIsUnique ? "one-to-one" : "one-to-many",
    isReflexive: relationship.fromTable === relationship.toTable,
  };
}

// Detecta tablas puente y deriva relaciones N:M informativas para el reporte.
function deriveManyToManyRelationships(tables, relationships) {
  const derived = [];

  for (const table of tables) {
    if (!table.isJunctionTable) {
      continue;
    }

    const links = relationships.filter((relationship) => relationship.fromTable === table.name);

    if (links.length !== 2) {
      continue;
    }

    const [left, right] = links;

    derived.push({
      fromTable: left.toTable,
      toTable: right.toTable,
      cardinality: "}|--|{",
      label: `N:M via ${table.name}`,
      relationshipKind: "many-to-many",
      bridgeTable: table.name,
      isReflexive: left.toTable === right.toTable,
    });
  }

  return dedupeDerivedRelationships(derived);
}

// Quita relaciones N:M repetidas producidas por la misma tabla puente.
function dedupeDerivedRelationships(relationships) {
  const unique = new Map();

  for (const relationship of relationships) {
    const key = [relationship.bridgeTable, relationship.fromTable, relationship.toTable].sort().join("|");

    if (!unique.has(key)) {
      unique.set(key, relationship);
    }
  }

  return [...unique.values()];
}
