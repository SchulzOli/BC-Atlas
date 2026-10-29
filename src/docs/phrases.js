// User-facing wording for generated documentation. Instructions follow the
// Microsoft Writing Style Guide conventions used by Business Central help:
// one action per step, UI labels emphasized, "choose", "enter", "select".
//
// Templates contain {placeholders}. A placeholder becomes a token so each
// renderer can format UI labels and example input in its own syntax.

const EN = {
  "open.view": "Choose the 🔍 icon, enter {page}, and then choose the related link.",
  "open.new": "Choose the 🔍 icon, enter {page}, and then choose the related link. Choose {new} to create a record.",
  "open.edit": "Choose the 🔍 icon, enter {page}, and then choose the related link.",
  "go-to-record": "Select the record you want to work with.",
  close: "Close the {page} page. Business Central saves your changes.",
  "new-line": "Add a new line.",
  invoke: "Choose the {action} action.",
  "set.text": "In the {field} field, enter a value, for example {value}.",
  "set.choice": "In the {field} field, select {value}.",
  "set.on": "Turn on the {field} toggle.",
  "set.off": "Turn off the {field} toggle.",
  "set.variable": "In the {field} field, enter the required value.",
  section: "In the {section} section, {instruction}",
  repeat: "For each {record} record, do the following:",
  "repeat.inline": "For each {record} record, {instructions}.",
  conditional: "If applicable, {instruction}",
  then: "then {instruction}",
  "ui.new": "New",
  button: "Choose {button}.",
  filter: "Filter the list: in the {field} column, enter {value}.",
  "filter.variable": "Filter the list by the {field} column.",
  "navigate.first": "Select the first line.",
  "navigate.last": "Select the last line.",
  "navigate.next": "Go to the next line.",
  "navigate.previous": "Go to the previous line.",
  lookup: "In the {field} field, choose the lookup button and select a value.",
  drilldown: "Choose the value in the {field} field to see the underlying entries.",
  "assist-edit": "In the {field} field, choose the ... button.",
  attempt: "{instruction} Business Central shows an error message.",
  "set.clear": "Clear the {field} field.",
  dialog: "If the {page} page opens, do the following:",
  "dialog.inline": "If the {page} page opens, {instructions}.",
  "confirm.yes": "If Business Central asks you to confirm, choose {button}.",
  "confirm.no": "If Business Central asks you to confirm, choose {button}.",
  "confirm.any": "If Business Central asks you to confirm, choose the answer that fits your case.",
  "ui.ok": "OK",
  "ui.cancel": "Cancel",
  "ui.yes": "Yes",
  "ui.no": "No",

  "short.open": "Open {page}",
  "short.open.new": "Create {record}",
  "short.close": "Close {page}",
  "short.go-to-record": "Select the record",
  "short.new-line": "Add a line",
  "short.invoke": "Choose {action}",
  "short.set": "Enter {field}",
  "short.set.choice": "Select {field}",
  "short.set.on": "Turn on {field}",
  "short.set.off": "Turn off {field}",
  "short.repeat": "For each {record}",
  "short.section": "{section}: {instruction}",
  "short.button": "Choose {button}",
  "short.filter": "Filter by {field}",
  "short.navigate": "Select a line",
  "short.lookup": "Look up {field}",
  "short.drilldown": "Drill down on {field}",
  "short.assist-edit": "Edit {field}",
  "short.attempt": "Try: {instruction}",
  "short.dialog": "In {page}",
  "short.confirm": "Confirm",
  "process.user": "User",
  "process.steps": "{count} steps",
  "process.step": "1 step",
  "journey.related": "related",
  "journey.alternative": "alternative",
  "heading.flow": "At a glance",
  "heading.process": "Process",
  "label.bpmn": "Open {file} in a BPMN modeler such as Camunda Modeler or bpmn.io to edit the process; double-click a scenario to see its steps.",

  "heading.prereq": "Before you start",
  "heading.steps": "Steps",
  "heading.result": "What should happen",
  "heading.next": "Next steps",
  "heading.related": "Related guides",
  "heading.alternative": "Alternative paths",
  "heading.source": "Source and verification",
  "heading.use-cases": "Use cases",
  "heading.scenarios": "Scenarios",
  "heading.by-page": "Scenarios by page",
  "heading.by-permission": "Scenarios by permission set",
  "heading.journey": "Journey",
  "heading.coverage": "Coverage",
  "heading.untouched-pages": "Pages without a documented scenario",
  "heading.unused-actions": "Actions not used in any scenario",
  "heading.main-scenario": "Main scenario",
  "heading.alternatives": "Alternative scenarios",
  "heading.documentation": "Documentation",

  "label.goal": "Use this guide to {goal}.",
  "label.permission": "Required permission: {permission}",
  "label.requires": "Complete {guide} first.",
  "label.examples": "The values below are examples from the automated UI test. Use values appropriate for your environment.",
  "label.file": "File",
  "label.function": "Function",
  "label.hash": "Source SHA-256",
  "label.use-case": "Use case",
  "label.unassigned": "Other scenarios",
  "label.coverage": "{covered} of {total} pages are covered by at least one scenario.",
  "label.generated": "Generated by BC Atlas from AL UI tests. Do not edit; regenerate instead.",
  "label.contents": "Contents",
  "label.search": "Filter scenarios",
  "label.step-result": "Result: {result}",
  "column.page": "Page",
  "column.permission-set": "Permission set",
  "column.scenarios": "Scenarios",

  "prereq.setup": "Setup",
  "prereq.master-data": "Master data",
  "prereq.environment": "Environment",
  "prereq.feature-flag": "Feature flag",
  "prereq.state": "Required state",

  "testcase.title": "Test case {id}",
  "testcase.id": "Test case ID",
  "testcase.objective": "Objective",
  "testcase.preconditions": "Preconditions",
  "testcase.steps": "Test steps",
  "testcase.step": "#",
  "testcase.action": "Action",
  "testcase.expected": "Expected result",
  "testcase.pass": "Pass/Fail",
  "testcase.actual": "Actual result",
  "testcase.final": "Final expected result",
  "testcase.signoff": "Sign-off",
  "testcase.tester": "Tester",
  "testcase.date": "Date",
  "testcase.outcome": "Overall result",
  "testcase.permissions": "Permissions",
  "testcase.source": "Source",
  "testcase.check-preconditions": "Verify that the preconditions are met.",
  "testcase.preconditions-met": "All preconditions are met.",

  "expect.open": "The {page} page opens.",
  "expect.new": "A new record opens on the {page} page.",
  "expect.close": "The page closes and the changes are saved.",
  "expect.set": "The value is accepted without an error.",
  "expect.invoke": "The action completes without an error.",
  "expect.select": "The record is selected.",
  "expect.new-line": "A new line is added.",
  "expect.repeat": "Every record is processed.",
  "expect.button": "The page closes.",
  "expect.filter": "The list shows only the matching records.",
  "expect.lookup": "The selected value appears in the field.",
  "expect.drilldown": "A page with the underlying entries opens.",
  "expect.opens": "The {page} page opens.",
  "expect.error": "Business Central shows an error message and does not accept the change.",
  "expect.dialog": "The dialog is completed.",
  "expect.confirm": "Business Central continues with your answer."
};

const DE = {
  "open.view": "Wählen Sie das Symbol 🔍, geben Sie {page} ein, und wählen Sie dann den entsprechenden Link aus.",
  "open.new": "Wählen Sie das Symbol 🔍, geben Sie {page} ein, und wählen Sie dann den entsprechenden Link aus. Wählen Sie {new}, um einen Datensatz anzulegen.",
  "open.edit": "Wählen Sie das Symbol 🔍, geben Sie {page} ein, und wählen Sie dann den entsprechenden Link aus.",
  "go-to-record": "Wählen Sie den Datensatz aus, den Sie bearbeiten möchten.",
  close: "Schließen Sie die Seite {page}. Business Central speichert Ihre Änderungen.",
  "new-line": "Fügen Sie eine neue Zeile hinzu.",
  invoke: "Wählen Sie die Aktion {action}.",
  "set.text": "Geben Sie im Feld {field} einen Wert ein, zum Beispiel {value}.",
  "set.choice": "Wählen Sie im Feld {field} den Wert {value} aus.",
  "set.on": "Aktivieren Sie den Umschalter {field}.",
  "set.off": "Deaktivieren Sie den Umschalter {field}.",
  "set.variable": "Geben Sie im Feld {field} den erforderlichen Wert ein.",
  section: "Im Abschnitt {section}: {instruction}",
  repeat: "Führen Sie für jeden Datensatz {record} die folgenden Schritte aus:",
  "repeat.inline": "Für jeden Datensatz {record}: {instructions}.",
  conditional: "Falls zutreffend: {instruction}",
  then: "anschließend: {instruction}",
  "ui.new": "Neu",
  button: "Wählen Sie {button}.",
  filter: "Filtern Sie die Liste: Geben Sie in der Spalte {field} den Wert {value} ein.",
  "filter.variable": "Filtern Sie die Liste nach der Spalte {field}.",
  "navigate.first": "Wählen Sie die erste Zeile aus.",
  "navigate.last": "Wählen Sie die letzte Zeile aus.",
  "navigate.next": "Wechseln Sie zur nächsten Zeile.",
  "navigate.previous": "Wechseln Sie zur vorherigen Zeile.",
  lookup: "Wählen Sie im Feld {field} die Nachschlageschaltfläche, und wählen Sie einen Wert aus.",
  drilldown: "Wählen Sie den Wert im Feld {field}, um die zugrunde liegenden Posten anzuzeigen.",
  "assist-edit": "Wählen Sie im Feld {field} die Schaltfläche ...",
  attempt: "{instruction} Business Central zeigt eine Fehlermeldung an.",
  "set.clear": "Leeren Sie das Feld {field}.",
  dialog: "Falls die Seite {page} geöffnet wird, führen Sie die folgenden Schritte aus:",
  "dialog.inline": "Falls die Seite {page} geöffnet wird: {instructions}.",
  "confirm.yes": "Falls Business Central eine Bestätigung verlangt, wählen Sie {button}.",
  "confirm.no": "Falls Business Central eine Bestätigung verlangt, wählen Sie {button}.",
  "confirm.any": "Falls Business Central eine Bestätigung verlangt, wählen Sie die passende Antwort.",
  "ui.ok": "OK",
  "ui.cancel": "Abbrechen",
  "ui.yes": "Ja",
  "ui.no": "Nein",

  "short.open": "{page} öffnen",
  "short.open.new": "{record} anlegen",
  "short.close": "{page} schließen",
  "short.go-to-record": "Datensatz auswählen",
  "short.new-line": "Zeile hinzufügen",
  "short.invoke": "{action} wählen",
  "short.set": "{field} ausfüllen",
  "short.set.choice": "{field} auswählen",
  "short.set.on": "{field} aktivieren",
  "short.set.off": "{field} deaktivieren",
  "short.repeat": "Für jeden Datensatz {record}",
  "short.section": "{section}: {instruction}",
  "short.button": "{button} wählen",
  "short.filter": "Nach {field} filtern",
  "short.navigate": "Zeile auswählen",
  "short.lookup": "{field} nachschlagen",
  "short.drilldown": "Drilldown auf {field}",
  "short.assist-edit": "{field} bearbeiten",
  "short.attempt": "Versuch: {instruction}",
  "short.dialog": "In {page}",
  "short.confirm": "Bestätigen",
  "process.user": "Benutzer",
  "process.steps": "{count} Schritte",
  "process.step": "1 Schritt",
  "journey.related": "verwandt",
  "journey.alternative": "Alternative",
  "heading.flow": "Auf einen Blick",
  "heading.process": "Prozess",
  "label.bpmn": "Öffnen Sie {file} in einem BPMN-Modellierer wie Camunda Modeler oder bpmn.io, um den Prozess zu bearbeiten; ein Doppelklick auf ein Szenario zeigt seine Schritte.",

  "heading.prereq": "Voraussetzungen",
  "heading.steps": "Schritte",
  "heading.result": "Ergebnis",
  "heading.next": "Nächste Schritte",
  "heading.related": "Verwandte Anleitungen",
  "heading.alternative": "Alternative Wege",
  "heading.source": "Quelle und Verifizierung",
  "heading.use-cases": "Anwendungsfälle",
  "heading.scenarios": "Szenarien",
  "heading.by-page": "Szenarien nach Seite",
  "heading.by-permission": "Szenarien nach Berechtigungssatz",
  "heading.journey": "Ablauf",
  "heading.coverage": "Abdeckung",
  "heading.untouched-pages": "Seiten ohne dokumentiertes Szenario",
  "heading.unused-actions": "Aktionen ohne Szenario",
  "heading.main-scenario": "Hauptszenario",
  "heading.alternatives": "Alternative Szenarien",
  "heading.documentation": "Dokumentation",

  "label.goal": "Ziel: {goal}.",
  "label.permission": "Erforderliche Berechtigung: {permission}",
  "label.requires": "Schließen Sie zuerst {guide} ab.",
  "label.examples": "Die folgenden Werte sind Beispiele aus dem automatisierten UI-Test. Verwenden Sie Werte, die zu Ihrer Umgebung passen.",
  "label.file": "Datei",
  "label.function": "Funktion",
  "label.hash": "Quell-SHA-256",
  "label.use-case": "Anwendungsfall",
  "label.unassigned": "Weitere Szenarien",
  "label.coverage": "{covered} von {total} Seiten sind durch mindestens ein Szenario abgedeckt.",
  "label.generated": "Von BC Atlas aus AL-UI-Tests generiert. Nicht bearbeiten, sondern neu generieren.",
  "label.contents": "Inhalt",
  "label.search": "Szenarien filtern",
  "label.step-result": "Ergebnis: {result}",
  "column.page": "Seite",
  "column.permission-set": "Berechtigungssatz",
  "column.scenarios": "Szenarien",

  "prereq.setup": "Einrichtung",
  "prereq.master-data": "Stammdaten",
  "prereq.environment": "Umgebung",
  "prereq.feature-flag": "Featureschalter",
  "prereq.state": "Erforderlicher Zustand",

  "testcase.title": "Testfall {id}",
  "testcase.id": "Testfall-ID",
  "testcase.objective": "Ziel",
  "testcase.preconditions": "Vorbedingungen",
  "testcase.steps": "Testschritte",
  "testcase.step": "Nr.",
  "testcase.action": "Aktion",
  "testcase.expected": "Erwartetes Ergebnis",
  "testcase.pass": "OK/Fehler",
  "testcase.actual": "Tatsächliches Ergebnis",
  "testcase.final": "Erwartetes Endergebnis",
  "testcase.signoff": "Abnahme",
  "testcase.tester": "Tester",
  "testcase.date": "Datum",
  "testcase.outcome": "Gesamtergebnis",
  "testcase.permissions": "Berechtigungen",
  "testcase.source": "Quelle",
  "testcase.check-preconditions": "Prüfen Sie, ob die Vorbedingungen erfüllt sind.",
  "testcase.preconditions-met": "Alle Vorbedingungen sind erfüllt.",

  "expect.open": "Die Seite {page} wird geöffnet.",
  "expect.new": "Auf der Seite {page} wird ein neuer Datensatz geöffnet.",
  "expect.close": "Die Seite wird geschlossen und die Änderungen sind gespeichert.",
  "expect.set": "Der Wert wird ohne Fehler übernommen.",
  "expect.invoke": "Die Aktion wird ohne Fehler ausgeführt.",
  "expect.select": "Der Datensatz ist ausgewählt.",
  "expect.new-line": "Eine neue Zeile wurde hinzugefügt.",
  "expect.repeat": "Alle Datensätze sind verarbeitet.",
  "expect.button": "Die Seite wird geschlossen.",
  "expect.filter": "Die Liste zeigt nur die passenden Datensätze.",
  "expect.lookup": "Der ausgewählte Wert steht im Feld.",
  "expect.drilldown": "Eine Seite mit den zugrunde liegenden Posten wird geöffnet.",
  "expect.opens": "Die Seite {page} wird geöffnet.",
  "expect.error": "Business Central zeigt eine Fehlermeldung an und übernimmt die Änderung nicht.",
  "expect.dialog": "Der Dialog ist abgeschlossen.",
  "expect.confirm": "Business Central fährt mit Ihrer Antwort fort."
};

const PHRASEBOOKS = { en: EN, de: DE };

export const SUPPORTED_PHRASE_LANGUAGES = Object.freeze(Object.keys(PHRASEBOOKS));

function phrasebook(language = "en-US") {
  const base = String(language).toLowerCase().split(/[-_]/u)[0];
  return PHRASEBOOKS[base] ?? EN;
}

export function lowerFirst(text) {
  return text.replace(/^\p{Lu}(?!\p{Lu})/u, (letter) => letter.toLowerCase());
}

/**
 * Builds a phrase as an array of tokens. Strings stay text; placeholder values
 * may be plain strings or token objects such as { ui } and { input }.
 */
export function phrase(language, key, values = {}) {
  const template = phrasebook(language)[key] ?? EN[key];
  if (template === undefined) throw new Error(`missing documentation phrase: ${key}`);
  const tokens = [];
  let last = 0;
  for (const match of template.matchAll(/\{([a-z-]+)\}/gu)) {
    if (match.index > last) tokens.push(template.slice(last, match.index));
    const value = values[match[1]];
    if (Array.isArray(value)) tokens.push(...value);
    else if (value !== undefined) tokens.push(value);
    last = match.index + match[0].length;
  }
  if (last < template.length) tokens.push(template.slice(last));
  return mergeText(tokens);
}

/** Plain-text label for headings and table captions. */
export function label(language, key, values = {}) {
  return plainText(phrase(language, key, values));
}

export function mergeText(tokens) {
  const merged = [];
  for (const token of tokens) {
    if (typeof token === "string" && typeof merged.at(-1) === "string") merged[merged.length - 1] += token;
    else if (token !== "") merged.push(token);
  }
  return merged;
}

export function plainText(tokens) {
  return tokens.map((token) => (typeof token === "string" ? token : token.ui ?? token.input ?? token.text ?? "")).join("");
}

/** Lowercases the first letter of a token sequence for use mid-sentence. */
export function lowerTokens(tokens) {
  if (typeof tokens[0] !== "string") return tokens;
  return [lowerFirst(tokens[0]), ...tokens.slice(1)];
}
