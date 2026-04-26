import { materializeSchema } from "./schema-model.js";
import {
  cloneRelationship,
  cloneTable,
  normalizeTypeForSql,
  resolveAvailableTableName,
} from "./schema-utils.js";

// Heurísticas de calidad, propuestas de normalización y regeneración del SQL sugerido.

// Recorre el esquema y detecta patrones que suelen indicar problemas de normalización.
export function analyzeSchemaQuality(schema) {
  const issues = [];
  const recommendations = [];
  const repeatedGroups = [];
  const descriptorGroups = [];
  const nonAtomicColumns = [];
  const partialDependencies = [];
  const transitiveDependencies = [];
  const junctionTables = schema.tables.filter((table) => table.isJunctionTable);
  const structuralFindings = [];
  const repeatedBusinessColumns = detectRepeatedBusinessColumns(schema.tables);

  const firstNormalForm = {
    label: "1FN",
    passed: true,
    findings: [],
  };
  const secondNormalForm = {
    label: "2FN",
    passed: true,
    findings: [],
  };
  const thirdNormalForm = {
    label: "3FN",
    passed: true,
    findings: [],
  };

  for (const table of schema.tables) {
    const repeatedAttributeGroups = detectRepeatedAttributeGroups(table);
    const descriptorGroup = detectDescriptorGroups(table, schema.relationships);
    const atomicityWarnings = detectNonAtomicColumns(table);
    const tablePartialDependencies = detectPartialDependencies(table);
    const tableTransitiveDependencies = detectTransitiveDependencies(table, descriptorGroup);
    const missingPrimaryKey = detectLikelyMissingPrimaryKey(table);
    const missingRelationships = detectLikelyMissingRelationships(table, schema.tables);
    const redundantReferenceColumns = detectRedundantReferenceColumns(table, schema.tables);
    const orphanReferenceColumns = detectOrphanReferenceColumns(table, schema.tables);

    if (repeatedAttributeGroups.length) {
      repeatedGroups.push({ table, groups: repeatedAttributeGroups });
      const detail = `La tabla ${table.name} mezcla atributos repetidos: ${repeatedAttributeGroups.map((group) => group.columns.join(", ")).join("; ")}.`;
      issues.push(detail);
      firstNormalForm.findings.push(detail);
      recommendations.push(`Separar las columnas repetidas de ${table.name} en una tabla hija.`);
    }

    if (atomicityWarnings.length) {
      nonAtomicColumns.push({ table, columns: atomicityWarnings });

      for (const column of atomicityWarnings) {
        const detail = `La columna ${table.name}.${column.name} parece almacenar valores no atómicos.`;
        issues.push(detail);
        firstNormalForm.findings.push(detail);
      }

      recommendations.push(`Revisar columnas potencialmente multivalor en ${table.name} y extraerlas a tablas separadas si representan listas.`);
    }

    if (tablePartialDependencies.length) {
      partialDependencies.push(...tablePartialDependencies.map((entry) => ({ table, ...entry })));

      for (const dependency of tablePartialDependencies) {
        const detail = `La tabla ${table.name} muestra dependencia parcial: ${dependency.columns.join(", ")} dependen de ${dependency.determinant.join(", ")} y no de toda la clave compuesta.`;
        issues.push(detail);
        secondNormalForm.findings.push(detail);
      }

      recommendations.push(`Separar los atributos parcialmente dependientes de la clave compuesta en ${table.name}.`);
    }

    if (descriptorGroup) {
      descriptorGroups.push({ table, group: descriptorGroup });
    }

    if (tableTransitiveDependencies.length) {
      transitiveDependencies.push(...tableTransitiveDependencies.map((entry) => ({ table, ...entry })));

      for (const dependency of tableTransitiveDependencies) {
        const detail = `La tabla ${table.name} contiene una posible dependencia transitiva a través de ${dependency.foreignKeyColumn}: ${dependency.columns.join(", ")}.`;
        issues.push(detail);
        thirdNormalForm.findings.push(detail);
      }

      recommendations.push(`Mover atributos descriptivos de ${table.name} a una tabla de catálogo o dimensión separada.`);
    }

    if (table.isJunctionTable) {
      recommendations.push(`La tabla ${table.name} ya representa una relación N:M y conviene mantenerla como puente.`);
    }

    if (missingPrimaryKey) {
      structuralFindings.push(missingPrimaryKey);
      issues.push(missingPrimaryKey);
      recommendations.push(`Definir una clave primaria explicita para ${table.name}.`);
    }

    for (const finding of missingRelationships) {
      structuralFindings.push(finding.detail);
      issues.push(finding.detail);
      recommendations.push(`Relacionar ${table.name}.${finding.columnName} con ${finding.targetTable}.${finding.targetKey} mediante una clave foranea.`);
    }

    for (const finding of redundantReferenceColumns) {
      structuralFindings.push(finding.detail);
      issues.push(finding.detail);
      thirdNormalForm.findings.push(finding.detail);
      recommendations.push(`Eliminar o mover ${finding.columnName} de ${table.name} y referenciar ${finding.targetTable} por id.`);
    }

    for (const finding of orphanReferenceColumns) {
      structuralFindings.push(finding.detail);
      issues.push(finding.detail);
      recommendations.push(`Crear una tabla para ${finding.entityName} o reemplazar ${table.name}.${finding.columnName} por una referencia consistente.`);
    }
  }

  for (const finding of repeatedBusinessColumns) {
    structuralFindings.push(finding.detail);
    issues.push(finding.detail);
    thirdNormalForm.findings.push(finding.detail);
    recommendations.push(`Extraer ${finding.columnName} a una entidad independiente o centralizar su origen para evitar repeticion.`);
  }

  firstNormalForm.passed = firstNormalForm.findings.length === 0;
  secondNormalForm.passed = secondNormalForm.findings.length === 0;
  thirdNormalForm.passed = thirdNormalForm.findings.length === 0;

  const dedupedRecommendations = dedupeStrings(recommendations);

  return {
    summary: {
      tableCount: schema.tables.length,
      relationshipCount: schema.relationships.length,
      derivedRelationshipCount: schema.derivedRelationships.length,
      issueCount: issues.length,
      recommendationCount: dedupedRecommendations.length,
    },
    normalForms: [firstNormalForm, secondNormalForm, thirdNormalForm],
    issues,
    recommendations: dedupedRecommendations,
    repeatedGroups,
    descriptorGroups,
    nonAtomicColumns,
    partialDependencies,
    transitiveDependencies,
    junctionTables,
    structuralFindings,
  };
}

// Convierte el resultado del análisis en un informe legible para la UI.
export function formatQualityReport(analysis, schema) {
  const lines = [];

  lines.push("Resumen general:");
  lines.push(`- Tablas analizadas: ${analysis.summary.tableCount}`);
  lines.push(`- Relaciones detectadas: ${analysis.summary.relationshipCount}`);
  lines.push(`- Relaciones N:M inferidas: ${analysis.summary.derivedRelationshipCount}`);
  lines.push(`- Problemas detectados: ${analysis.summary.issueCount}`);
  lines.push(`- Recomendaciones generadas: ${analysis.summary.recommendationCount}`);
  lines.push("");

  lines.push("Evaluacion por forma normal:");
  for (const normalForm of analysis.normalForms) {
    lines.push(`- ${normalForm.label}: ${normalForm.passed ? "cumple con las heuristicas actuales" : "requiere revision"}`);
  }
  lines.push("");

  if (!analysis.issues.length) {
    lines.push("No se detectaron problemas claros de normalizacion con las heuristicas actuales.");
  } else {
    lines.push("Hallazgos de normalizacion:");

    for (const normalForm of analysis.normalForms) {
      if (!normalForm.findings.length) {
        continue;
      }

      lines.push(`- ${normalForm.label}:`);
      for (const finding of normalForm.findings) {
        lines.push(`  * ${finding}`);
      }
    }
  }

  if (analysis.structuralFindings.length) {
    lines.push("");
    lines.push("Hallazgos estructurales:");
    for (const finding of analysis.structuralFindings) {
      lines.push(`- ${finding}`);
    }
  }

  if (analysis.recommendations.length) {
    lines.push("");
    lines.push("Recomendaciones:");
    for (const recommendation of analysis.recommendations) {
      lines.push(`- ${recommendation}`);
    }
  }

  if (schema.derivedRelationships.length) {
    lines.push("");
    lines.push("Relaciones N:M inferidas:");
    for (const relationship of schema.derivedRelationships) {
      lines.push(`- ${relationship.fromTable} <-> ${relationship.toTable} por ${relationship.bridgeTable}`);
    }
  }

  return lines.join("\n");
}

// Agrupa análisis, esquema transformado y SQL final en una sola operación.
export function buildNormalizationSuggestion(schema) {
  const analysis = analyzeSchemaQuality(schema);
  const normalizedSchema = buildNormalizedSchema(schema, analysis);

  return {
    analysis,
    normalizedSchema,
    normalizedSql: buildNormalizedSqlProposal(normalizedSchema),
  };
}

// Construye una versión transformada del esquema aplicando las heurísticas encontradas.
export function buildNormalizedSchema(schema, analysis) {
  const tableMap = new Map(schema.tables.map((table) => [table.name, cloneTable(table)]));
  const relationships = schema.relationships.map((relationship) => cloneRelationship(relationship));
  const descriptorEntries = mergeDescriptorEntries(analysis);

  for (const entry of analysis.repeatedGroups) {
    const sourceTable = tableMap.get(entry.table.name);

    if (!sourceTable) {
      continue;
    }

    for (const group of entry.groups) {
      const childTableName = resolveAvailableTableName(tableMap, `${sourceTable.name}_${group.baseName}`);
      const childColumns = [];

      for (const primaryKeyColumn of sourceTable.columns.filter((column) => column.isPrimaryKey)) {
        childColumns.push({
          ...primaryKeyColumn,
          isForeignKey: true,
          references: {
            table: sourceTable.name,
            columns: [primaryKeyColumn.name],
          },
        });
      }

      for (const column of group.columns.map((columnName) => sourceTable.columns.find((column) => column.name === columnName)).filter(Boolean)) {
        childColumns.push({
          ...column,
          isPrimaryKey: false,
          isForeignKey: false,
          isUnique: false,
          references: column.references ? { ...column.references, columns: [...column.references.columns] } : null,
        });
      }

      childTableName &&
        tableMap.set(childTableName, {
          name: childTableName,
          columns: childColumns,
          uniqueConstraints: [],
          semanticType: "standard",
          isJunctionTable: false,
          partitionParent: null,
          isPartitionedParent: false,
        });

      sourceTable.columns = sourceTable.columns.filter((column) => !group.columns.includes(column.name));
      relationships.push({
        fromTable: childTableName,
        fromColumns: childColumns.filter((column) => column.isForeignKey).map((column) => column.name),
        toTable: sourceTable.name,
        toColumns: sourceTable.columns.filter((column) => column.isPrimaryKey).map((column) => column.name),
        nullable: false,
        label: `${sourceTable.name} ref`,
      });
    }
  }

  for (const entry of descriptorEntries) {
    const sourceTable = tableMap.get(entry.table.name);

    if (!sourceTable) {
      continue;
    }

    const descriptorTableName = resolveAvailableTableName(tableMap, `${sourceTable.name}_${entry.group.baseName}`);
    const foreignKeyColumn = sourceTable.columns.find((column) => column.name === entry.group.foreignKeyColumn);

    if (!foreignKeyColumn) {
      continue;
    }

    const descriptorColumns = [
      {
        name: `${entry.group.baseName}_id`,
        type: foreignKeyColumn.type,
        nullable: false,
        isPrimaryKey: true,
        isForeignKey: false,
        isUnique: true,
        references: null,
      },
      ...entry.group.columns.map((columnName) => {
        const sourceColumn = sourceTable.columns.find((column) => column.name === columnName);
        return {
          ...sourceColumn,
          isPrimaryKey: false,
          isForeignKey: false,
          isUnique: false,
          references: null,
        };
      }),
    ];

    tableMap.set(descriptorTableName, {
      name: descriptorTableName,
      columns: descriptorColumns,
      uniqueConstraints: [[`${entry.group.baseName}_id`]],
      semanticType: "dimension",
      isJunctionTable: false,
      partitionParent: null,
      isPartitionedParent: false,
    });

    sourceTable.columns = sourceTable.columns.filter((column) => !entry.group.columns.includes(column.name));
    foreignKeyColumn.references = { table: descriptorTableName, columns: [`${entry.group.baseName}_id`] };
    foreignKeyColumn.isForeignKey = true;

    relationships.push({
      fromTable: sourceTable.name,
      fromColumns: [foreignKeyColumn.name],
      toTable: descriptorTableName,
      toColumns: [`${entry.group.baseName}_id`],
      nullable: foreignKeyColumn.nullable,
      label: foreignKeyColumn.name,
    });
  }

  return materializeSchema([...tableMap.values()], relationships);
}

// Regenera sentencias CREATE TABLE a partir del esquema normalizado propuesto.
export function buildNormalizedSqlProposal(schema) {
  return schema.tables
    .map((table) => {
      const primaryKeyColumns = table.columns.filter((column) => column.isPrimaryKey).map((column) => column.name);
      const columnLines = table.columns.map((column) => {
        const constraints = [];

        if (!column.nullable) {
          constraints.push("NOT NULL");
        }

        if (column.isPrimaryKey && primaryKeyColumns.length === 1) {
          constraints.push("PRIMARY KEY");
        } else if (column.isUnique) {
          constraints.push("UNIQUE");
        }

        return `  ${column.name} ${normalizeTypeForSql(column.type)}${constraints.length ? ` ${constraints.join(" ")}` : ""}`;
      });

      const tableConstraints = [];

      if (primaryKeyColumns.length > 1) {
        tableConstraints.push(`  PRIMARY KEY (${primaryKeyColumns.join(", ")})`);
      }

      const uniqueConstraints = table.uniqueConstraints.filter((group) => {
        const sortedGroup = [...group].sort().join("|");
        const sortedPrimaryKey = [...primaryKeyColumns].sort().join("|");
        return sortedGroup !== sortedPrimaryKey;
      });

      for (const group of uniqueConstraints) {
        if (group.length === 1) {
          const uniqueColumn = table.columns.find((column) => column.name === group[0]);

          if (uniqueColumn?.isUnique) {
            continue;
          }
        }

        tableConstraints.push(`  UNIQUE (${group.join(", ")})`);
      }

      const definitionLines = [...columnLines, ...tableConstraints];

      return [`CREATE TABLE ${table.name} (`, definitionLines.join(",\n"), ");"].join("\n");
    })
    .join("\n\n");
}

// Busca columnas repetidas por sufijos numéricos como telefono1, telefono2, etc.
function detectRepeatedAttributeGroups(table) {
  const groupedColumns = new Map();

  for (const column of table.columns) {
    const match = column.name.match(/^(.*?)(\d+)$/);

    if (!match) {
      continue;
    }

    const baseName = match[1];
    const group = groupedColumns.get(baseName) ?? [];
    group.push(column.name);
    groupedColumns.set(baseName, group);
  }

  return [...groupedColumns.entries()]
    .filter(([, columns]) => columns.length > 1)
    .map(([baseName, columns]) => ({ baseName, columns }));
}

// Busca atributos descriptivos que podrían vivir en una tabla catálogo separada.
function detectDescriptorGroups(table, relationships) {
  const foreignKeys = table.columns.filter((column) => column.isForeignKey);

  for (const foreignKey of foreignKeys) {
    const siblingDescriptors = table.columns.filter(
      (column) =>
        column.name !== foreignKey.name &&
        !column.isPrimaryKey &&
        !column.isForeignKey &&
        /(name|title|description|status|type|category|code)$/i.test(column.name)
    );

    const hasExistingCatalog = relationships.some(
      (relationship) => relationship.fromTable === table.name && relationship.fromColumns.includes(foreignKey.name)
    );

    if (siblingDescriptors.length >= 2 && !hasExistingCatalog) {
      return {
        baseName: foreignKey.name.replace(/_id$/i, "") || "catalog",
        foreignKeyColumn: foreignKey.name,
        columns: siblingDescriptors.map((column) => column.name),
      };
    }
  }

  return null;
}

// Busca columnas que suelen almacenar colecciones o estructuras compuestas en una sola celda.
function detectNonAtomicColumns(table) {
  return table.columns.filter(
    (column) =>
      /\[\]|JSON|JSONB|ARRAY|XML/i.test(column.type) ||
      /(list|items|values|tags|phones|emails|codes)$/i.test(column.name)
  );
}

// Intenta localizar dependencias parciales sobre claves compuestas.
function detectPartialDependencies(table) {
  const primaryKeyColumns = table.columns.filter((column) => column.isPrimaryKey).map((column) => column.name);

  if (primaryKeyColumns.length < 2) {
    return [];
  }

  const foreignKeyColumns = table.columns.filter((column) => column.isForeignKey && column.isPrimaryKey);
  const nonKeyColumns = table.columns.filter((column) => !column.isPrimaryKey && !column.isForeignKey);
  const dependencies = [];

  for (const foreignKey of foreignKeyColumns) {
    const baseName = foreignKey.name.replace(/_id$/i, "");
    const relatedColumns = nonKeyColumns.filter(
      (column) =>
        column.name.toLowerCase().startsWith(`${baseName}_`) ||
        column.name.toLowerCase() === `${baseName}name` ||
        column.name.toLowerCase() === `${baseName}_name` ||
        column.name.toLowerCase() === `${baseName}_title` ||
        column.name.toLowerCase() === `${baseName}_code` ||
        column.name.toLowerCase() === `${baseName}_type` ||
        column.name.toLowerCase() === `${baseName}_status`
    );

    if (!relatedColumns.length) {
      continue;
    }

    dependencies.push({
      determinant: [foreignKey.name],
      columns: relatedColumns.map((column) => column.name),
    });
  }

  return dependencies;
}

// Detecta atributos descriptivos que probablemente dependen de otra entidad y no de la clave de la tabla.
function detectTransitiveDependencies(table, descriptorGroup) {
  if (!descriptorGroup) {
    return [];
  }

  return [
    {
      foreignKeyColumn: descriptorGroup.foreignKeyColumn,
      columns: descriptorGroup.columns,
      baseName: descriptorGroup.baseName,
    },
  ];
}

// Unifica dependencias transitivas y grupos descriptor para no descomponer dos veces lo mismo.
function mergeDescriptorEntries(analysis) {
  const merged = new Map();

  for (const entry of analysis.descriptorGroups) {
    merged.set(`${entry.table.name}|${entry.group.foreignKeyColumn}`, entry);
  }

  for (const entry of analysis.transitiveDependencies) {
    const key = `${entry.table.name}|${entry.foreignKeyColumn}`;

    if (!merged.has(key)) {
      merged.set(key, {
        table: entry.table,
        group: {
          baseName: entry.baseName,
          foreignKeyColumn: entry.foreignKeyColumn,
          columns: entry.columns,
        },
      });
    }
  }

  return [...merged.values()];
}

// Elimina recomendaciones duplicadas para que el informe siga siendo legible.
function dedupeStrings(values) {
  return [...new Set(values)];
}

// Detecta tablas que parecen tener un identificador pero no lo marcaron como clave primaria.
function detectLikelyMissingPrimaryKey(table) {
  if (table.columns.some((column) => column.isPrimaryKey)) {
    return null;
  }

  const candidate = table.columns.find((column) => /^(id|id_[a-z0-9_]+)$/i.test(column.name));

  if (!candidate) {
    return null;
  }

  return `La tabla ${table.name} parece tener un identificador (${candidate.name}) pero no declara clave primaria.`;
}

// Detecta columnas id_* que probablemente deberian ser FKs hacia otra tabla del esquema.
function detectLikelyMissingRelationships(table, tables) {
  return table.columns
    .filter((column) => /^id_[a-z0-9_]+$/i.test(column.name) && !column.isForeignKey)
    .map((column) => {
      const entityToken = column.name.replace(/^id_/i, "");
      const targetTable = findTableByEntityToken(tables, entityToken, table.name);
      const targetKey = targetTable ? getBestIdentifierColumn(targetTable) : null;

      if (!targetTable || !targetKey) {
        return null;
      }

      return {
        columnName: column.name,
        targetTable: targetTable.name,
        targetKey,
        detail: `La tabla ${table.name} contiene ${column.name}, que parece una referencia a ${targetTable.name}, pero no hay relacion declarada.` ,
      };
    })
    .filter(Boolean);
}

// Detecta atributos que repiten datos de otra entidad cuando ya existe o deberia existir una referencia por id.
function detectRedundantReferenceColumns(table, tables) {
  const findings = [];
  const inferredTargets = [];

  for (const column of table.columns) {
    if (!/^id_[a-z0-9_]+$/i.test(column.name)) {
      continue;
    }

    const entityToken = column.name.replace(/^id_/i, "");
    const targetTable = findTableByEntityToken(tables, entityToken, table.name);

    if (targetTable) {
      inferredTargets.push(targetTable);
    }
  }

  for (const column of table.columns) {
    const match = column.name.match(/^([a-z0-9_]+)_(nombre|name|precio|price|ciudad|city|telefono|phone|tienda|store)$/i);

    if (!match) {
      continue;
    }

    const entityToken = match[1];
    const idColumnName = `id_${entityToken}`;
    const hasIdentifier = table.columns.some((entry) => entry.name.toLowerCase() === idColumnName.toLowerCase());
    const targetTable = findTableByEntityToken(tables, entityToken, table.name);

    if (!hasIdentifier || !targetTable) {
      continue;
    }

    findings.push({
      columnName: column.name,
      targetTable: targetTable.name,
      detail: `La tabla ${table.name} repite el atributo ${column.name} aunque ya contiene ${idColumnName}; eso sugiere redundancia con ${targetTable.name}.`,
    });

    inferredTargets.push(targetTable);
  }

  for (const column of table.columns) {
    if (/^(id|id_[a-z0-9_]+)$/i.test(column.name)) {
      continue;
    }

    const entityToken = normalizeEntityToken(column.name);
    const targetTable = findTableByEntityToken(tables, entityToken, table.name);

    if (!targetTable) {
      continue;
    }

    const hasMatchingId = table.columns.some(
      (entry) => entry.name.toLowerCase() === `id_${entityToken}` || entry.name.toLowerCase() === `id_${normalizeEntityToken(targetTable.name)}`
    );

    if (hasMatchingId) {
      continue;
    }

    if (!isLikelyEntityReference(column.name, targetTable)) {
      continue;
    }

    findings.push({
      columnName: column.name,
      targetTable: targetTable.name,
      detail: `La tabla ${table.name} usa ${column.name} como texto cuando probablemente deberia referenciar ${targetTable.name} mediante un id.`,
    });

    inferredTargets.push(targetTable);
  }

  for (const targetTable of dedupeTables(inferredTargets)) {
    const targetDescriptors = new Set(
      targetTable.columns
        .filter((column) => !column.isPrimaryKey && !column.isForeignKey)
        .map((column) => column.name.toLowerCase())
    );
    const normalizedTargetDescriptors = new Set(
      targetTable.columns
        .filter((column) => !column.isPrimaryKey && !column.isForeignKey)
        .map((column) => normalizeDescriptorToken(column.name))
        .filter(Boolean)
    );
    const normalizedTargetName = normalizeEntityToken(targetTable.name);

    for (const column of table.columns) {
      if (/^(id|id_[a-z0-9_]+)$/i.test(column.name)) {
        continue;
      }

      const normalizedColumnName = column.name.toLowerCase();
      const normalizedDescriptor = normalizeDescriptorToken(column.name);
      const prefixedDescriptor = normalizedDescriptor.startsWith(`${normalizedTargetName}_`)
        ? normalizedDescriptor.slice(normalizedTargetName.length + 1)
        : normalizedDescriptor;

      const matchesDescriptor =
        targetDescriptors.has(normalizedColumnName) ||
        normalizedTargetDescriptors.has(normalizedDescriptor) ||
        normalizedTargetDescriptors.has(prefixedDescriptor);

      if (!matchesDescriptor) {
        continue;
      }

      findings.push({
        columnName: column.name,
        targetTable: targetTable.name,
        detail: `La tabla ${table.name} contiene ${column.name}, un atributo que probablemente deberia obtenerse desde ${targetTable.name} en lugar de duplicarse.`,
      });
    }
  }

  return dedupeByDetail(findings);
}

// Detecta referencias textuales a entidades que ni siquiera tienen tabla propia.
function detectOrphanReferenceColumns(table, tables) {
  const commonDescriptors = new Set(["nombre", "name", "descripcion", "description", "title", "precio", "price", "cantidad", "total"]);

  return table.columns
    .filter((column) => !/^(id|id_[a-z0-9_]+)$/i.test(column.name))
    .map((column) => {
      const entityName = normalizeEntityToken(column.name);

      if (!entityName || commonDescriptors.has(entityName)) {
        return null;
      }

      const targetTable = findTableByEntityToken(tables, entityName, table.name);

      if (targetTable || !isReferenceLikeName(column.name)) {
        return null;
      }

      return {
        columnName: column.name,
        entityName,
        detail: `La tabla ${table.name} contiene ${column.name} como dato repetible, pero no existe una tabla relacionada para ${entityName}.`,
      };
    })
    .filter(Boolean);
}

// Detecta atributos de negocio repetidos en varias tablas sin una entidad central clara.
function detectRepeatedBusinessColumns(tables) {
  const occurrences = new Map();

  for (const table of tables) {
    for (const column of table.columns) {
      if (!isCandidateSharedBusinessColumn(column.name)) {
        continue;
      }

      const list = occurrences.get(column.name.toLowerCase()) ?? [];
      list.push(table.name);
      occurrences.set(column.name.toLowerCase(), list);
    }
  }

  return [...occurrences.entries()]
    .filter(([, tableNames]) => new Set(tableNames).size > 1)
    .map(([columnName, tableNames]) => ({
      columnName,
      detail: `El atributo ${columnName} aparece repetido en ${[...new Set(tableNames)].join(", ")} y podria necesitar una entidad propia o una sola fuente de verdad.`,
    }));
}

// Resuelve una posible tabla objetivo a partir de un nombre singular/plural aproximado.
function findTableByEntityToken(tables, entityToken, currentTableName) {
  const normalizedToken = normalizeEntityToken(entityToken);

  return tables.find((table) => {
    if (table.name === currentTableName) {
      return false;
    }

    const normalizedTable = normalizeEntityToken(table.name);
    return normalizedTable === normalizedToken;
  }) ?? null;
}

// Normaliza plurales simples y prefijos comunes para comparar entidades por nombre.
function normalizeEntityToken(value) {
  return value
    .toLowerCase()
    .replace(/^id_/i, "")
    .replace(/_id$/i, "")
    .replace(/_(nombre|name|precio|price|ciudad|city|telefono|phone|tienda|store)$/i, "")
    .replace(/s$/i, "");
}

function normalizeDescriptorToken(value) {
  return value
    .toLowerCase()
    .replace(/^(id|id_[a-z0-9_]+)$/i, "")
    .replace(/^(fk_|cod_|codigo_)/i, "");
}

// Escoge la mejor columna identificadora conocida para una tabla objetivo.
function getBestIdentifierColumn(table) {
  return (
    table.columns.find((column) => column.isPrimaryKey)?.name ??
    table.columns.find((column) => /^(id|id_[a-z0-9_]+)$/i.test(column.name))?.name ??
    null
  );
}

// Decide si un nombre de columna parece referirse a una entidad y no a un simple atributo comun.
function isLikelyEntityReference(columnName, targetTable) {
  const normalizedColumn = normalizeEntityToken(columnName);
  const normalizedTarget = normalizeEntityToken(targetTable.name);

  return normalizedColumn === normalizedTarget && !/(nombre|name|descripcion|description|title|precio|price|cantidad|total)$/i.test(columnName);
}

// Columnas que suelen repetirse de forma sospechosa entre varias tablas de negocio.
function isCandidateSharedBusinessColumn(columnName) {
  return /^(tienda|store|ciudad|city|empleado|employee|proveedor|supplier|sucursal|branch)$/i.test(columnName);
}

// Nombres que suelen representar entidades textuales cargadas directamente en la tabla.
function isReferenceLikeName(columnName) {
  return /^(empleado|employee|tienda|store|cliente|customer|producto|product|proveedor|supplier)$/i.test(columnName);
}

// Elimina resultados duplicados producidos por heuristicas superpuestas.
function dedupeByDetail(entries) {
  const unique = new Map();

  for (const entry of entries) {
    if (!unique.has(entry.detail)) {
      unique.set(entry.detail, entry);
    }
  }

  return [...unique.values()];
}

function dedupeTables(tables) {
  const unique = new Map();

  for (const table of tables) {
    if (!unique.has(table.name)) {
      unique.set(table.name, table);
    }
  }

  return [...unique.values()];
}
