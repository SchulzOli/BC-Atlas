// Formats instruction tokens ({ ui }, { input }, strings) for each output.
import { plainText } from "../phrases.js";

export function escapeXml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;");
}

export function escapeMarkdown(value) {
  return String(value ?? "").replace(/([\\`*_[\]<>|])/gu, "\\$1");
}

function tokens(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [String(value)];
}

export function markdown(value, { escape = false } = {}) {
  return tokens(value).map((token) => {
    if (typeof token === "string") return escape ? escapeMarkdown(token) : token;
    return `**${escapeMarkdown(token.ui ?? token.input ?? token.text)}**`;
  }).join("");
}

export function html(value) {
  return tokens(value).map((token) => {
    if (typeof token === "string") return escapeXml(token);
    if (token.ui !== undefined) return `<b class="ui">${escapeXml(token.ui)}</b>`;
    return `<kbd>${escapeXml(token.input ?? token.text)}</kbd>`;
  }).join("");
}

export function dita(value) {
  return tokens(value).map((token) => {
    if (typeof token === "string") return escapeXml(token);
    if (token.ui !== undefined) return `<uicontrol>${escapeXml(token.ui)}</uicontrol>`;
    return `<userinput>${escapeXml(token.input ?? token.text)}</userinput>`;
  }).join("");
}

export function plain(value) {
  return plainText(tokens(value));
}
