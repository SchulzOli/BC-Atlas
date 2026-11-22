// The page and what it runs in: the host that answers its requests (the
// VS Code extension, or the MCP server as an MCP App), or none for an exported
// file; the theme; short messages; and saving a file. Registers BCA_HOST.
(() => {
  "use strict";

  /** Connects the view to where it runs; boot is window.BCA_APP. */
  function connect(boot) {
    const $ = (selector) => document.querySelector(selector);
    // Live: something answers the requests of the view. In VS Code the extension, as an MCP App
    // the MCP server (vendor/mcp-app.js); both take { type: "request", id, method, params }.
    const MCP = boot.mode === "mcp";
    const LIVE = boot.mode === "vscode" || MCP;
    const vscode = MCP ? window.BCA_MCP_HOST : LIVE ? acquireVsCodeApi() : undefined;

    async function inflate(base64) {
      const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
      return new Response(stream).text();
    }

    // Requests to the extension: { type: "request", id, method, params } is
    // answered with { type: "response", id, result } or { id, error }.
    let nextRequest = 0;
    const pending = new Map();
    addEventListener("message", (event) => {
      const message = event.data;
      if (message?.type !== "response" || !pending.has(message.id)) return;
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error));
      else resolve(message.result);
    });
    function call(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = ++nextRequest;
        pending.set(id, { resolve, reject });
        vscode.postMessage({ type: "request", id, method, params });
      });
    }

    // The theme: the editor's in VS Code, else the one chosen or the system's.
    const THEME_KEY = "bca-theme";
    const storedTheme = (() => { try { return localStorage.getItem(THEME_KEY); } catch { return undefined; } })();
    // In VS Code the view follows the editor's color theme.
    const editorTheme = () => (document.body.classList.contains("vscode-light") || document.body.classList.contains("vscode-high-contrast-light") ? "light" : "dark");
    let theme = LIVE ? editorTheme() : storedTheme ?? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const applyTheme = () => { document.documentElement.dataset.theme = theme; };
    applyTheme();
    if (LIVE) {
      $("#theme-toggle").hidden = true;
      new MutationObserver(() => {
        if (editorTheme() === theme) return;
        theme = editorTheme();
        applyTheme();
      }).observe(document.body, { attributes: true, attributeFilter: ["class"] });
    }
    $("#theme-toggle").addEventListener("click", () => {
      theme = theme === "dark" ? "light" : "dark";
      try { localStorage.setItem(THEME_KEY, theme); } catch { /* optional */ }
      applyTheme();
    });

    let toastTimer;
    function toast(message) {
      const element = $("#toast");
      element.textContent = message;
      element.classList.add("show");
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => element.classList.remove("show"), 2600);
    }
    const message = (html = "") => { $("#message").innerHTML = html; };

    function download(name, content, type = "text/plain") {
      if (LIVE) {
        const binary = content instanceof Uint8Array;
        const text = binary ? btoa(Array.from(content, (byte) => String.fromCharCode(byte)).join("")) : content;
        // The extension asks where to save; the MCP server saves into the project and says where.
        return call("saveFile", { name, content: text, encoding: binary ? "base64" : undefined }).then((saved) => (saved?.path ? toast(`Saved ${saved.path}`) : undefined), (error) => toast(error.message));
      }
      const link = document.createElement("a");
      link.href = URL.createObjectURL(new Blob([content], { type }));
      link.download = name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);
      return undefined;
    }
    const fileName = (text) => String(text).toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "") || "bc-atlas";

    return { MCP, LIVE, vscode, inflate, call, toast, message, download, fileName };
  }

  globalThis.BCA_HOST = { connect };
})();
