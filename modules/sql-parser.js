import { materializeSchema } from "./schema-model.js";
import {
  extractColumnList,
  isColumnClauseStart,
  normalizeIdentifier,
  splitIdentifiers,
  splitTopLevel,
  stripComments,
  tokenizeSql,
} from "./schema-utils.js";

// Parser principal del dump SQL a un modelo de tablas y relaciones.

// Lee el script completo, detecta tablas, claves y herencia, y devuelve el esquema materializado.
export function parseSqlSchema(sql) {
  const cleanedSql = stripComments(sql);
  const tableMap = new Map();
  const relationships = [];
  const inheritanceLinks = [];

  for (const statement of extractCreateTableStatements(cleanedSql)) {
    const tableName = normalizeIdentifier(statement.tableName);
    const body = statement.body;
    const tableTail = statement.tail;
    const definitions = splitTopLevel(body);
    const columns = [];
    const primaryKeys = new Set();
    const uniqueConstraints = [];

    for (const rawDefinition of definitions) {
      const definition = rawDefinition.trim();

      if (!definition) {
        continue;
      }

      if (/^(CONSTRAINT\s+)?[\w"_]+\s+PRIMARY\s+KEY/i.test(definition) || /^PRIMARY\s+KEY/i.test(definition)) {
        for (const columnName of extractColumnList(definition)) {
          primaryKeys.add(columnName);
        }
        continue;
      }

      if (/^(CONSTRAINT\s+)?[\w"_]+\s+UNIQUE/i.test(definition) || /^UNIQUE/i.test(definition)) {
        uniqueConstraints.push(extractColumnList(definition));
        continue;
      }

      if (/^(CONSTRAINT\s+)?[\w"_]+\s+FOREIGN\s+KEY/i.test(definition) || /^FOREIGN\s+KEY/i.test(definition)) {
        const inlineRelationship = parseForeignKeyDefinition(tableName, definition);

        if (inlineRelationship) {
          relationships.push(inlineRelationship);
        }
        continue;
      }

      if (/^(CONSTRAINT\s+)?[\w"_]+\s+CHECK\b/i.test(definition) || /^CHECK\b/i.test(definition)) {
        continue;
      }

      const column = parseColumnDefinition(definition);

      if (!column) {
        continue;
      }

      if (column.isPrimaryKey) {
        primaryKeys.add(column.name);
      }

      if (column.references) {
        relationships.push({
          fromTable: tableName,
          fromColumns: [column.name],
          toTable: column.references.table,
          toColumns: column.references.columns,
          nullable: column.nullable,
          label: column.name,
        });
      }

      columns.push(column);
    }

    for (const column of columns) {
      column.isPrimaryKey = primaryKeys.has(column.name);
      column.isUnique = column.isUnique || uniqueConstraints.some((group) => group.length === 1 && group[0] === column.name);
    }

    tableMap.set(tableName, {
      name: tableName,
      columns,
      uniqueConstraints,
      semanticType: "standard",
      isJunctionTable: false,
      partitionParent: null,
      isPartitionedParent: false,
    });

    const inheritsMatch = tableTail.match(/\bINHERITS\s*\(([^)]+)\)/i);

    if (inheritsMatch) {
      for (const parentName of splitIdentifiers(inheritsMatch[1])) {
        inheritanceLinks.push({ parentTableName: parentName, childTableName: tableName, kind: "inherits" });
      }
    }
  }

  for (const match of cleanedSql.matchAll(/ALTER\s+TABLE(?:\s+ONLY)?\s+([\w".]+)\s+ADD\s+CONSTRAINT\s+[\w"_]+\s+FOREIGN\s+KEY\s*\(([^)]+)\)\s+REFERENCES\s+([\w".]+)\s*\(([^)]+)\)/gi)) {
    const fromTable = normalizeIdentifier(match[1]);
    const fromColumns = splitIdentifiers(match[2]);
    const toTable = normalizeIdentifier(match[3]);
    const toColumns = splitIdentifiers(match[4]);
    const nullable = fromColumns.some((columnName) => {
      const table = tableMap.get(fromTable);
      const column = table?.columns.find((entry) => entry.name === columnName);
      return column ? column.nullable : true;
    });

    for (const columnName of fromColumns) {
      const table = tableMap.get(fromTable);
      const column = table?.columns.find((entry) => entry.name === columnName);

      if (column) {
        column.isForeignKey = true;
      }
    }

    relationships.push({
      fromTable,
      fromColumns,
      toTable,
      toColumns,
      nullable,
      label: fromColumns.join(", "),
    });
  }

  for (const match of cleanedSql.matchAll(/ALTER\s+TABLE(?:\s+ONLY)?\s+([\w".]+)\s+ADD\s+CONSTRAINT\s+[\w"_]+\s+UNIQUE\s*\(([^)]+)\)/gi)) {
    const tableName = normalizeIdentifier(match[1]);
    const table = tableMap.get(tableName);
    const columns = splitIdentifiers(match[2]);

    if (!table) {
      continue;
    }

    table.uniqueConstraints.push(columns);

    if (columns.length === 1) {
      const column = table.columns.find((entry) => entry.name === columns[0]);

      if (column) {
        column.isUnique = true;
      }
    }
  }

  for (const match of cleanedSql.matchAll(/ALTER\s+TABLE(?:\s+ONLY)?\s+([\w".]+)\s+ADD\s+(?:CONSTRAINT\s+[\w"_]+\s+)?PRIMARY\s+KEY\s*\(([^)]+)\)/gi)) {
    const tableName = normalizeIdentifier(match[1]);
    const table = tableMap.get(tableName);
    const columns = splitIdentifiers(match[2]);

    if (!table) {
      continue;
    }

    for (const columnName of columns) {
      const column = table.columns.find((entry) => entry.name === columnName);

      if (column) {
        column.isPrimaryKey = true;
        column.nullable = false;
      }
    }

    if (!table.uniqueConstraints.some((group) => [...group].sort().join("|") === [...columns].sort().join("|"))) {
      table.uniqueConstraints.push(columns);
    }
  }

  for (const match of cleanedSql.matchAll(/ALTER\s+TABLE(?:\s+ONLY)?\s+([\w".]+)\s+ATTACH\s+PARTITION\s+([\w".]+)/gi)) {
    const parentTableName = normalizeIdentifier(match[1]);
    const childTableName = normalizeIdentifier(match[2]);
    inheritanceLinks.push({ parentTableName, childTableName, kind: "partition" });
  }

  for (const { parentTableName, childTableName, kind } of inheritanceLinks) {
    const parentTable = tableMap.get(parentTableName);
    const childTable = tableMap.get(childTableName);

    if (!parentTable || !childTable) {
      continue;
    }

    parentTable.isPartitionedParent = true;
    childTable.partitionParent = parentTableName;
    childTable.partitionKind = kind;

    inheritParentColumns(parentTable, childTable);

    const parentPrimaryKeyColumns = parentTable.columns.filter((column) => column.isPrimaryKey).map((column) => column.name);

    if (!childTable.columns.some((column) => column.isPrimaryKey) && parentPrimaryKeyColumns.length) {
      for (const columnName of parentPrimaryKeyColumns) {
        const childColumn = childTable.columns.find((column) => column.name === columnName);

        if (childColumn) {
          childColumn.isPrimaryKey = true;
          childColumn.nullable = false;
        }
      }

      if (
        !childTable.uniqueConstraints.some(
          (group) => [...group].sort().join("|") === [...parentPrimaryKeyColumns].sort().join("|")
        )
      ) {
        childTable.uniqueConstraints.push(parentPrimaryKeyColumns);
      }
    }

    propagateParentRelationshipsToChild(parentTable, childTable, relationships);
  }

  return materializeSchema([...tableMap.values()], relationships);
}

// Recorre CREATE TABLE respetando paréntesis anidados para aislar cada definición.
function extractCreateTableStatements(sql) {
  const statements = [];
  const pattern = /CREATE\s+TABLE\s+([\w".]+)/gi;
  let match = pattern.exec(sql);

  while (match) {
    const tableName = match[1];
    const nameEndIndex = pattern.lastIndex;
    const openingParenIndex = sql.indexOf("(", nameEndIndex);

    if (openingParenIndex === -1) {
      match = pattern.exec(sql);
      continue;
    }

    let depth = 1;
    let cursor = openingParenIndex + 1;

    while (cursor < sql.length && depth > 0) {
      const char = sql[cursor];

      if (char === "(") {
        depth += 1;
      } else if (char === ")") {
        depth -= 1;
      }

      cursor += 1;
    }

    if (depth !== 0) {
      break;
    }

    const semicolonIndex = sql.indexOf(";", cursor);
    const statementEndIndex = semicolonIndex === -1 ? sql.length : semicolonIndex;

    statements.push({
      tableName,
      body: sql.slice(openingParenIndex + 1, cursor - 1),
      tail: sql.slice(cursor, statementEndIndex).trim(),
    });

    pattern.lastIndex = statementEndIndex + 1;
    match = pattern.exec(sql);
  }

  return statements;
}

// Replica en una tabla hija las relaciones heredadas o particionadas de su tabla padre.
function propagateParentRelationshipsToChild(parentTable, childTable, relationships) {
  const parentOutgoingRelationships = relationships.filter((relationship) => relationship.fromTable === parentTable.name);

  for (const relationship of parentOutgoingRelationships) {
    const childHasMatchingColumns = relationship.fromColumns.every((columnName) =>
      childTable.columns.some((column) => column.name === columnName)
    );

    if (!childHasMatchingColumns) {
      continue;
    }

    for (const columnName of relationship.fromColumns) {
      const childColumn = childTable.columns.find((column) => column.name === columnName);

      if (childColumn) {
        childColumn.isForeignKey = true;
      }
    }

    const duplicateRelationship = relationships.some(
      (candidate) =>
        candidate.fromTable === childTable.name &&
        candidate.toTable === relationship.toTable &&
        candidate.fromColumns.join("|") === relationship.fromColumns.join("|") &&
        candidate.toColumns.join("|") === relationship.toColumns.join("|")
    );

    if (!duplicateRelationship) {
      relationships.push({
        ...relationship,
        fromTable: childTable.name,
        inheritedFrom: parentTable.name,
      });
    }
  }
}

// Interpreta una definición de columna individual dentro de CREATE TABLE.
function parseColumnDefinition(definition) {
  const match = definition.match(/^([\w"]+)\s+(.+)$/);

  if (!match) {
    return null;
  }

  const name = normalizeIdentifier(match[1]);
  const remainder = match[2].trim();
  const tokens = tokenizeSql(remainder);
  const typeParts = [];
  let nullable = true;
  let isPrimaryKey = false;
  let isUnique = false;
  let references = null;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const upperToken = token.toUpperCase();
    const nextToken = tokens[index + 1]?.toUpperCase();

    if (upperToken === "NOT" && nextToken === "NULL") {
      nullable = false;
      index += 1;
      continue;
    }

    if (upperToken === "NULL") {
      nullable = true;
      continue;
    }

    if (upperToken === "PRIMARY" && nextToken === "KEY") {
      isPrimaryKey = true;
      nullable = false;
      index += 1;
      continue;
    }

    if (upperToken === "UNIQUE") {
      isUnique = true;
      continue;
    }

    if (upperToken === "REFERENCES") {
      references = {
        table: normalizeIdentifier(tokens[index + 1]),
        columns: extractColumnList(tokens.slice(index + 2).join(" ")),
      };
      break;
    }

    if (isColumnClauseStart(upperToken, nextToken)) {
      break;
    }

    typeParts.push(token);
  }

  return {
    name,
    type: typeParts.join(" ") || "TEXT",
    nullable,
    isPrimaryKey,
    isForeignKey: false,
    isUnique,
    references,
  };
}

// Interpreta restricciones FOREIGN KEY declaradas a nivel de tabla.
function parseForeignKeyDefinition(tableName, definition) {
  const match = definition.match(/FOREIGN\s+KEY\s*\(([^)]+)\)\s+REFERENCES\s+([\w".]+)\s*\(([^)]+)\)/i);

  if (!match) {
    return null;
  }

  return {
    fromTable: tableName,
    fromColumns: splitIdentifiers(match[1]),
    toTable: normalizeIdentifier(match[2]),
    toColumns: splitIdentifiers(match[3]),
    nullable: true,
    label: splitIdentifiers(match[1]).join(", "),
  };
}

// Copia columnas del padre al hijo cuando el script usa INHERITS o ATTACH PARTITION.
function inheritParentColumns(parentTable, childTable) {
  for (const parentColumn of parentTable.columns) {
    const existingChildColumn = childTable.columns.find((column) => column.name === parentColumn.name);

    if (existingChildColumn) {
      existingChildColumn.type = existingChildColumn.type || parentColumn.type;
      existingChildColumn.nullable = existingChildColumn.nullable && parentColumn.nullable;
      existingChildColumn.isPrimaryKey = existingChildColumn.isPrimaryKey || parentColumn.isPrimaryKey;
      existingChildColumn.isForeignKey = existingChildColumn.isForeignKey || parentColumn.isForeignKey;
      existingChildColumn.isUnique = existingChildColumn.isUnique || parentColumn.isUnique;
      existingChildColumn.references = existingChildColumn.references || parentColumn.references;
      continue;
    }

    childTable.columns.push({
      ...parentColumn,
      references: parentColumn.references ? { ...parentColumn.references, columns: [...parentColumn.references.columns] } : null,
    });
  }
}
