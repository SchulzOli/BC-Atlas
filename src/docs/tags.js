const DOCUMENT_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export const DOCUMENTATION_TAGS = Object.freeze({
  "DOC-ID": {
    cardinality: "one",
    value: "document-id",
    description: "Provides the stable identity used for links and the generated Markdown filename."
  },
  FEATURE: {
    cardinality: "many",
    value: "text",
    description: "Classifies the scenario by business feature or domain for navigation and coverage."
  },
  SCENARIO: {
    cardinality: "one",
    value: "sentence",
    description: "Defines the user-facing objective and expected business outcome of the scenario."
  },
  PERMISSIONS: {
    cardinality: "many",
    value: "text",
    description: "Names a Business Central permission set required to complete the documented workflow.",
    aliases: ["PERMISSION"]
  },
  GIVEN: {
    cardinality: "many",
    value: "sentence",
    description: "Records a prerequisite that must be true before the user starts the workflow.",
    qualifiers: ["SETUP", "MASTER-DATA", "ENVIRONMENT", "FEATURE-FLAG", "STATE"]
  },
  WHEN: {
    cardinality: "many",
    value: "sentence",
    description: "Describes a user action or phase and anchors the UI steps derived from the test."
  },
  THEN: {
    cardinality: "many",
    value: "sentence",
    description: "States the observable result that confirms the workflow completed successfully."
  },
  TEARDOWN: {
    cardinality: "many",
    value: "sentence",
    description: "Describes test cleanup that is excluded from the generated user workflow."
  },
  REQUIRES: {
    cardinality: "many",
    value: "document-id",
    description: "Links to a guide that the user must complete before starting this scenario.",
    relation: "requires"
  },
  NEXT: {
    cardinality: "many",
    value: "document-id",
    description: "Links to the recommended guide to follow after completing this scenario.",
    relation: "next"
  },
  RELATED: {
    cardinality: "many",
    value: "document-id",
    description: "Links to another guide that provides useful context for this scenario.",
    relation: "related"
  },
  ALTERNATIVE: {
    cardinality: "many",
    value: "document-id",
    description: "Links to a different workflow that achieves a comparable business outcome.",
    relation: "alternative"
  }
});

export const PREREQUISITE_TYPES = Object.freeze({
  SETUP: "setup",
  "MASTER-DATA": "master-data",
  ENVIRONMENT: "environment",
  "FEATURE-FLAG": "feature-flag",
  STATE: "state"
});

export const RELATION_TAGS = Object.freeze(
  Object.fromEntries(
    Object.entries(DOCUMENTATION_TAGS)
      .filter(([, definition]) => definition.relation)
      .map(([tag, definition]) => [tag, definition.relation])
  )
);

const aliases = new Map();
for (const [tag, definition] of Object.entries(DOCUMENTATION_TAGS)) {
  aliases.set(tag, tag);
  for (const alias of definition.aliases ?? []) aliases.set(alias, tag);
}

export function canonicalTag(tag) {
  return aliases.get(String(tag).toUpperCase());
}

export function isDocumentId(value) {
  return DOCUMENT_ID_PATTERN.test(String(value));
}

export function documentationGlossary() {
  return Object.entries(DOCUMENTATION_TAGS).map(([tag, definition]) => ({
    tag,
    ...definition
  }));
}
