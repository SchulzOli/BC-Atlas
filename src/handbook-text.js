// The texts of the system handbook (handbook.js) in English and German. A
// language tag such as de-DE picks German; anything else is English. Words
// follow the Business Central client in each language (Tabelle, Seite,
// Bericht, Berechtigungssatz).

const number = (language) => (value) => Number(value).toLocaleString(language === "de" ? "de-DE" : "en-US");

const EN = {
  types: {
    table: "Table", tableextension: "Table extension", page: "Page", pageextension: "Page extension", pagecustomization: "Page customization",
    codeunit: "Codeunit", report: "Report", reportextension: "Report extension", query: "Query", xmlport: "XMLport", enum: "Enum",
    enumextension: "Enum extension", interface: "Interface", controladdin: "Control add-in", profile: "Profile", profileextension: "Profile extension",
    permissionset: "Permission set", permissionsetextension: "Permission set extension", entitlement: "Entitlement"
  },
  plural: (count, one, many = `${one}s`) => `${number("en")(count)} ${count === 1 ? one : many}`,
  defaultTitle: (name) => `${name}: system handbook`,
  pages: {
    "README.md": { title: "System handbook" },
    "events.md": { title: "Events", summary: "who raises which event and who reacts to it" },
    "data.md": { title: "Data", summary: "tables, who reads and writes them, and how" },
    "permissions.md": { title: "Permissions", summary: "what each permission set grants, and what nothing covers" },
    "interfaces.md": { title: "Interfaces", summary: "contracts, implementations, and the enum values that choose them" },
    "ui.md": { title: "User interface", summary: "pages and reports by usage category, APIs, and their source tables" },
    "code-health.md": { title: "Code health", summary: "complexity, size, obsolete code, and documentation coverage" }
  },
  overview: {
    intro: "What this system consists of and how it hangs together, generated from its AL source. Each page below answers one question across all objects.",
    contents: "Contents", apps: "Apps", app: "App", publisher: "Publisher", version: "Version", objects: "Objects",
    objectTypes: "Object types", type: "Type",
    components: "Components",
    configured: "The components of the architecture in `.bca.json`; layer 0 is the core, and dependencies may only point to lower layers.",
    proposed: "No architecture is configured yet; these components are what `bca architecture --propose` derives from today's dependencies.",
    layer: "Layer", component: "Component", dependsOn: "Depends on", purpose: "Purpose",
    central: "Objects everything relies on", centralIntro: "Used by the most other objects; a change to them reaches furthest.",
    object: "Object", usedBy: "Used by"
  },
  events: {
    intro: "Events are how objects react to each other without depending on each other directly. For every event: who raises it and who reacts to it.",
    counts: (events, subscriptions) => `${EN.plural(events, "event")} published here, ${EN.plural(subscriptions, "subscription")}.`,
    published: "Events published in this system",
    unused: (count) => `${EN.plural(count, "event")} without a subscriber here: extension points for other apps, or events no longer needed.`,
    allUsed: "Every event has a subscriber here.",
    publisher: "Publisher", event: "Event", kind: "Kind", description: "Description", subscribers: "Subscribers", subscriber: "Subscriber", none: "none",
    kinds: { business: "business", internal: "internal", integration: "integration" },
    external: "Events of other apps this system reacts to",
    externalIntro: "Subscriptions to events of dependencies such as the Base Application: where this system hooks into standard processes."
  },
  data: {
    intro: "Which tables this system has, who reads and writes them, and how. I = insert, M = modify, D = delete, R = read.",
    tables: "Tables", table: "Table", caption: "Caption", classification: "Classification", fields: "Fields",
    writtenBy: "Written by", readBy: "Read by", shownOn: "Shown on", nobody: "nobody",
    foreign: "Tables of other apps this system writes", foreignIntro: "Data owned by a dependency that this system changes directly.",
    extensions: "Table extensions", extends: "Extends", extension: "Extension", fieldsAdded: "Fields added",
    unwritten: "Tables no code here writes", unwrittenIntro: "Filled through pages, configuration packages, APIs, or other apps; or no longer used.",
    editedOnPage: " (edited on a page)"
  },
  permissions: {
    intro: "What each permission set grants, and the tables and objects no permission set covers.",
    none: "This system defines no permission sets.",
    caption: (text) => `Caption: ${text}.`, notAssignable: "Not assignable (only included in others).", assignable: "Assignable to users.",
    includes: (list) => `Includes ${list}.`,
    object: "Object", kind: "Kind", rights: "Rights",
    uncovered: "Tables without table data permissions",
    uncoveredIntro: "No permission set of this system grants access to their data; users need permissions from elsewhere."
  },
  interfaces: {
    intro: "Contracts that let one object call another without knowing which implementation runs, and the enum values that choose an implementation.",
    none: "This system defines or implements no interfaces.",
    foreign: " (from another app)", methods: "Methods: ", implementation: "Implementation", selectedBy: "Selected by",
    noImplementation: "No implementation in this system."
  },
  ui: {
    intro: "What users can open, grouped the way Business Central offers it (usage category), with the data behind each page.",
    counts: (pages, searchable, reports, api) => `${EN.plural(pages, "page")} (${EN.plural(searchable, "page")} found by search), ${EN.plural(reports, "report")}, ${EN.plural(api, "API page")}.`,
    object: "Object", caption: "Caption", type: "Type", sourceTable: "Source table", applicationArea: "Application area", report: "Report",
    others: "Opened from other pages", othersIntro: "Cards, subpages, and dialogs that search does not list.", page: "Page",
    apis: "APIs", endpoint: "Endpoint"
  },
  health: {
    intro: "Where the code is hard to change: complex procedures, large objects, obsolete code, and what is not documented.",
    summary: (procedures, total) => `${EN.plural(procedures, "procedure")} and triggers with code; cyclomatic complexity ${number("en")(total)} in all. Complexity counts the paths through a procedure: 1, plus 1 for each \`if\`, loop, \`case\` branch, and \`and\` or \`or\`. Above 10, a procedure is hard to test; above 20, hard to change safely.`,
    complex: "Most complex procedures", procedure: "Procedure", object: "Object", complexity: "Complexity", lines: "Lines", procedures: "Procedures",
    largest: "Largest objects",
    obsolete: "Obsolete", obsoleteIntro: "Marked for removal; plan the work before the tag's version.",
    what: "What", state: "State", tag: "Tag", reason: "Reason",
    procedureIn: (name, object) => `\`${name}\` in ${object}`, fieldIn: (name, object) => `Field ${name} in ${object}`,
    coverage: "Documentation coverage",
    coverageText: (documented, total, percent) => `${number("en")(documented)} of ${EN.plural(total, "public procedure")} of public objects (the API other apps can call) have a \`///\` summary${percent === undefined ? "" : ` (${percent}%)`}. Objects with \`Access = Internal\` do not count.`,
    undocumented: "Public codeunits and interfaces without a `///` summary:",
    more: (count) => `- and ${count} more`
  }
};

const DE = {
  types: {
    table: "Tabelle", tableextension: "Tabellenerweiterung", page: "Seite", pageextension: "Seitenerweiterung", pagecustomization: "Seitenanpassung",
    codeunit: "Codeunit", report: "Bericht", reportextension: "Berichtserweiterung", query: "Abfrage", xmlport: "XMLport", enum: "Enum",
    enumextension: "Enum-Erweiterung", interface: "Interface", controladdin: "Steuerelement-Add-In", profile: "Profil", profileextension: "Profilerweiterung",
    permissionset: "Berechtigungssatz", permissionsetextension: "Berechtigungssatzerweiterung", entitlement: "Berechtigung (Entitlement)"
  },
  plural: (count, one, many) => `${number("de")(count)} ${count === 1 ? one : many}`,
  defaultTitle: (name) => `${name}: Systemhandbuch`,
  pages: {
    "README.md": { title: "Systemhandbuch" },
    "events.md": { title: "Ereignisse", summary: "wer welches Ereignis auslöst und wer darauf reagiert" },
    "data.md": { title: "Daten", summary: "Tabellen, wer sie liest und schreibt, und wie" },
    "permissions.md": { title: "Berechtigungen", summary: "was jeder Berechtigungssatz gewährt und was keiner abdeckt" },
    "interfaces.md": { title: "Interfaces", summary: "Verträge, Implementierungen und die Enum-Werte, die sie auswählen" },
    "ui.md": { title: "Benutzeroberfläche", summary: "Seiten und Berichte nach Verwendungskategorie, APIs und ihre Quelltabellen" },
    "code-health.md": { title: "Codequalität", summary: "Komplexität, Größe, veralteter Code und Dokumentationsabdeckung" }
  },
  overview: {
    intro: "Woraus dieses System besteht und wie es zusammenhängt, erzeugt aus seinem AL-Quellcode. Jede Seite unten beantwortet eine Frage über alle Objekte hinweg.",
    contents: "Inhalt", apps: "Apps", app: "App", publisher: "Herausgeber", version: "Version", objects: "Objekte",
    objectTypes: "Objekttypen", type: "Typ",
    components: "Komponenten",
    configured: "Die Komponenten der Architektur in `.bca.json`; Schicht 0 ist der Kern, und Abhängigkeiten dürfen nur auf tiefere Schichten zeigen.",
    proposed: "Noch ist keine Architektur festgelegt; diese Komponenten leitet `bca architecture --propose` aus den heutigen Abhängigkeiten ab.",
    layer: "Schicht", component: "Komponente", dependsOn: "Hängt ab von", purpose: "Zweck",
    central: "Objekte, auf die sich alles stützt", centralIntro: "Von den meisten anderen Objekten verwendet; eine Änderung an ihnen wirkt am weitesten.",
    object: "Objekt", usedBy: "Verwendet von"
  },
  events: {
    intro: "Über Ereignisse reagieren Objekte aufeinander, ohne direkt voneinander abzuhängen. Für jedes Ereignis: wer es auslöst und wer darauf reagiert.",
    counts: (events, subscriptions) => `${DE.plural(events, "Ereignis", "Ereignisse")} veröffentlicht, ${DE.plural(subscriptions, "Abonnement", "Abonnements")}.`,
    published: "In diesem System veröffentlichte Ereignisse",
    unused: (count) => `${DE.plural(count, "Ereignis", "Ereignisse")} ohne Abonnenten hier: Erweiterungspunkte für andere Apps oder nicht mehr benötigte Ereignisse.`,
    allUsed: "Jedes Ereignis hat hier einen Abonnenten.",
    publisher: "Herausgeber", event: "Ereignis", kind: "Art", description: "Beschreibung", subscribers: "Abonnenten", subscriber: "Abonnent", none: "keine",
    kinds: { business: "Business", internal: "intern", integration: "Integration" },
    external: "Ereignisse anderer Apps, auf die dieses System reagiert",
    externalIntro: "Abonnements von Ereignissen der Abhängigkeiten, etwa der Base Application: hier greift dieses System in Standardprozesse ein."
  },
  data: {
    intro: "Welche Tabellen dieses System hat, wer sie liest und schreibt, und wie. I = Einfügen, M = Ändern, D = Löschen, R = Lesen.",
    tables: "Tabellen", table: "Tabelle", caption: "Bezeichnung", classification: "Klassifizierung", fields: "Felder",
    writtenBy: "Geschrieben von", readBy: "Gelesen von", shownOn: "Angezeigt auf", nobody: "niemand",
    foreign: "Tabellen anderer Apps, die dieses System schreibt", foreignIntro: "Daten einer Abhängigkeit, die dieses System direkt ändert.",
    extensions: "Tabellenerweiterungen", extends: "Erweitert", extension: "Erweiterung", fieldsAdded: "Neue Felder",
    unwritten: "Tabellen, die kein Code hier schreibt", unwrittenIntro: "Befüllt über Seiten, Konfigurationspakete, APIs oder andere Apps, oder nicht mehr verwendet.",
    editedOnPage: " (auf einer Seite bearbeitet)"
  },
  permissions: {
    intro: "Was jeder Berechtigungssatz gewährt, und welche Tabellen und Objekte kein Berechtigungssatz abdeckt.",
    none: "Dieses System definiert keine Berechtigungssätze.",
    caption: (text) => `Bezeichnung: ${text}.`, notAssignable: "Nicht zuweisbar (nur in anderen enthalten).", assignable: "Benutzern zuweisbar.",
    includes: (list) => `Enthält ${list}.`,
    object: "Objekt", kind: "Art", rights: "Rechte",
    uncovered: "Tabellen ohne Tabellendatenberechtigungen",
    uncoveredIntro: "Kein Berechtigungssatz dieses Systems gewährt Zugriff auf ihre Daten; Benutzer brauchen Berechtigungen von anderswo."
  },
  interfaces: {
    intro: "Verträge, über die ein Objekt ein anderes aufruft, ohne zu wissen, welche Implementierung läuft, und die Enum-Werte, die eine Implementierung auswählen.",
    none: "Dieses System definiert oder implementiert keine Interfaces.",
    foreign: " (aus einer anderen App)", methods: "Methoden: ", implementation: "Implementierung", selectedBy: "Ausgewählt durch",
    noImplementation: "Keine Implementierung in diesem System."
  },
  ui: {
    intro: "Was Benutzer öffnen können, gruppiert wie Business Central es anbietet (Verwendungskategorie), mit den Daten hinter jeder Seite.",
    counts: (pages, searchable, reports, api) => `${DE.plural(pages, "Seite", "Seiten")} (${DE.plural(searchable, "Seite", "Seiten")} über die Suche), ${DE.plural(reports, "Bericht", "Berichte")}, ${DE.plural(api, "API-Seite", "API-Seiten")}.`,
    object: "Objekt", caption: "Bezeichnung", type: "Typ", sourceTable: "Quelltabelle", applicationArea: "Anwendungsbereich", report: "Bericht",
    others: "Von anderen Seiten geöffnet", othersIntro: "Karten, Unterseiten und Dialoge, die die Suche nicht anzeigt.", page: "Seite",
    apis: "APIs", endpoint: "Endpunkt"
  },
  health: {
    intro: "Wo der Code schwer zu ändern ist: komplexe Prozeduren, große Objekte, veralteter Code und was nicht dokumentiert ist.",
    summary: (procedures, total) => `${DE.plural(procedures, "Prozedur", "Prozeduren")} und Trigger mit Code; zyklomatische Komplexität insgesamt ${number("de")(total)}. Die Komplexität zählt die Pfade durch eine Prozedur: 1, plus 1 für jedes \`if\`, jede Schleife, jeden \`case\`-Zweig und jedes \`and\` oder \`or\`. Über 10 ist eine Prozedur schwer zu testen, über 20 schwer sicher zu ändern.`,
    complex: "Komplexeste Prozeduren", procedure: "Prozedur", object: "Objekt", complexity: "Komplexität", lines: "Zeilen", procedures: "Prozeduren",
    largest: "Größte Objekte",
    obsolete: "Veraltet", obsoleteIntro: "Zum Entfernen markiert; die Arbeit vor der Version des Tags einplanen.",
    what: "Was", state: "Status", tag: "Tag", reason: "Grund",
    procedureIn: (name, object) => `\`${name}\` in ${object}`, fieldIn: (name, object) => `Feld ${name} in ${object}`,
    coverage: "Dokumentationsabdeckung",
    coverageText: (documented, total, percent) => `${number("de")(documented)} von ${DE.plural(total, "öffentlichen Prozedur", "öffentlichen Prozeduren")} öffentlicher Objekte (die API, die andere Apps aufrufen können) haben eine \`///\`-Zusammenfassung${percent === undefined ? "" : ` (${percent} %)`}. Objekte mit \`Access = Internal\` zählen nicht.`,
    undocumented: "Öffentliche Codeunits und Interfaces ohne `///`-Zusammenfassung:",
    more: (count) => `- und ${count} weitere`
  }
};

export const HANDBOOK_LANGUAGES = Object.freeze(["en", "de"]);

/** The texts for a language tag (de, de-DE, de-AT → German; anything else English). */
export function handbookText(language) {
  return /^de\b/iu.test(String(language ?? "")) ? DE : EN;
}
