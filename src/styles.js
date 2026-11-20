// Colors of the AL object types and of the kinds of relation, shared by every picture.
export const TYPE_STYLES = {
  table: ["#DCEBFF", "#2362A2"],
  tableextension: ["#DCEBFF", "#2362A2"],
  page: ["#E5F6E8", "#31783B"],
  pageextension: ["#E5F6E8", "#31783B"],
  pagecustomization: ["#E5F6E8", "#31783B"],
  codeunit: ["#FFF0D6", "#A96300"],
  report: ["#F5E5FF", "#77449A"],
  reportextension: ["#F5E5FF", "#77449A"],
  query: ["#E1F7F5", "#14766E"],
  xmlport: ["#FFE2E2", "#A23636"],
  enum: ["#EEEEEE", "#555555"],
  enumextension: ["#EEEEEE", "#555555"],
  interface: ["#FFF8C9", "#8B7400"],
  module: ["#E8ECF3", "#4E5D78"],
  procedure: ["#F3F6FA", "#55708F"],
  trigger: ["#FFF0D6", "#A96300"],
  event: ["#F5E5FF", "#77449A"],
  subscriber: ["#FCE8F3", "#A33A78"],
  action: ["#E5F6E8", "#31783B"]
};

export const RELATION_STYLES = {
  calls: { color: "#4C78A8" },
  reads: { color: "#0072B2" },
  writes: { color: "#D55E00" },
  relates: { color: "#009E73" },
  uses: { color: "#6B7280", dash: 3 },
  extends: { color: "#CC79A7" },
  implements: { color: "#E69F00" },
  selects: { color: "#EA580C" },
  publishes: { color: "#A21CAF" },
  subscribes: { color: "#A21CAF", dash: 3 },
  runs: { color: "#15803D" },
  part: { color: "#0891B2", dash: 3 },
  contains: { color: "#0891B2", dash: 3 },
  permits: { color: "#7C3AED" },
  includes: { color: "#8B5CF6" },
  starts: { color: "#15803D" },
  events: { color: "#A21CAF", dash: 3 }
};
