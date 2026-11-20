# BC Atlas marketing kit

Everything the Marketplace listing, the GitHub repository, and a launch need:
the brand, the images and their sources, the listing text, a launch
checklist, and ready-to-post copy.

## Files

| File | Use |
| --- | --- |
| `icon.svg` | Source of the extension icon. `render.cjs` writes `../media/icon.png` (256 × 256) from it. |
| `logo.svg` | The small mark (32 × 32) used in the panel, the favicon, and the website. |
| `../media/atlas.svg` | Monochrome mark for the activity bar and the panel tab (`currentColor`). |
| `social-preview.html` → `social-preview.jpg` | 1280 × 640 at 2×: the hero at the top of both READMEs and the GitHub social preview. |
| `screenshots/*.png` | Marketplace screenshots, 1440 × 900 at 1.5×, dark. `screenshots.mjs` takes them from the example apps. |
| `render.cjs` | Renders the icon and the social preview: `node vscode/marketing/render.cjs` (needs Playwright with Chromium). |

The listing itself lives in `../package.json` (`displayName`, `description`,
`categories`, `keywords`, `galleryBanner`, `pricing`) and `../README.md`.
`npm run package` points the README's relative images at
`https://github.com/SchulzOli/BC-Atlas/raw/HEAD/vscode/`, so they show on the
Marketplace once they are on `main`.

## Brand

**Name:** BC Atlas. In the Marketplace: *BC Atlas: AL Architecture &
Dependencies*.

**Mark:** an "A" drawn as a dependency graph (nodes at the apex, the feet,
and the crossbar), with an orbit around it: an atlas of your code. The teal
apex is the one accent; keep it teal on every background. Don't rotate,
recolor, or outline the mark, and keep a margin of at least a quarter of its
width around it.

| Color | Hex | Use |
| --- | --- | --- |
| Accent blue | `#2f6fe0` (dark UI: `#5b8def`) | Buttons, links, the small mark. The panel's `--accent`. |
| Navy | `#0b1432` → `#17306b` | Icon tile, Marketplace banner, hero background. |
| Teal | `#5eead4` | The apex node; highlights. |
| Sky | `#7dd3fc` → `#4b7cf7` | Gradient of the "A" in the icon. |

**Type:** Inter (Inter Display for big headlines).

**Taglines:**

- See your Business Central apps as one graph, read from the source, right
  in VS Code.

## Marketplace listing

| Field | Value |
| --- | --- |
| Display name | BC Atlas: AL Architecture & Dependencies |
| Short description | Business Central AL apps as one graph, read from the source: one view in 2D, as a diagram, or in 3D, health checks with fixes, stories that walk through the system, findings in the Problems panel, CodeLens, and an MCP server for AI agents. |
| Categories | Visualization, Linters, AI, Programming Languages |
| Banner | `#0b1432`, dark theme |
| Pricing | Free |

### Screenshots

All show the BC Atlas view on the example apps of this repository
(`examples/purchasing-app`: 16 objects;
`examples/multi-app`: three apps), in the
dark design of an exported file.

| Screenshot | Shows |
| --- | --- |
| `view.png` | The overview with a codeunit selected: its way from the screen to the tables is lit. |
| `diagram.png` | The Data lens as a diagram. |
| `space.png` | The System lens in 3D with the findings as rings. |
| `apps.png` | The Apps lens as a diagram: what each app uses of the others, declared or not. |
| `inside.png` | A codeunit from the inside: its procedures and events, and what each does. |

To retake them: `node vscode/marketing/screenshots.mjs` (needs Playwright
with Chromium). It also writes `docs/generated/images/view.png`, the picture
in the README of the repository, in the light design.

## Launch checklist

1. **Publisher.** Create the publisher `SchulzOli` at
   [marketplace.visualstudio.com/manage](https://marketplace.visualstudio.com/manage)
   (or change `publisher` in `../package.json`).
2. **Sign-in without a token.** Azure DevOps retires global personal access
   tokens, the only kind the Marketplace accepted, on December 1, 2026. The
   workflow therefore signs in with Microsoft Entra ID through GitHub's OIDC
   token, and nothing secret is stored:
   1. In the [Entra admin center](https://entra.microsoft.com), register an
      app (*App registrations → New registration*, for example
      `bc-atlas-marketplace`). It needs no Azure subscription. An existing
      app registration for another extension works too; just add the
      credential from the next step. If the app signs in but the
      Marketplace never accepts it, use a user-assigned managed identity
      instead (it needs an Azure subscription, but costs nothing); the
      steps are the same.
   2. On the app, add a federated credential (*Certificates & secrets →
      Federated credentials → Other issuer*): issuer
      `https://token.actions.githubusercontent.com`, audience
      `api://AzureADTokenExchange`, and the subject GitHub presents for this
      repository, which carries the owner and repository IDs:
      `repo:SchulzOli@153920877/BC-Atlas@1316205066:environment:marketplace`.
      The *GitHub Actions* template builds a subject from the names only,
      which fails with `AADSTS700213`.
   3. In the repository, add the secrets `AZURE_CLIENT_ID` (the app's
      application ID) and `AZURE_TENANT_ID` (the directory ID), as repository
      secrets or secrets of the `marketplace` environment.
   4. Run the *Release* workflow once. The step *Show the
      identity the Marketplace sees* prints the identity's Azure DevOps
      profile ID; the Marketplace knows identities by this ID, not by their
      Entra IDs. Add that ID to the publisher `SchulzOli` as a member with
      the *Contributor* role (*Manage publishers → Members*).

   Until the last step is done, the step *Check access to the publisher*
   (`vsce verify-pat --azure-credential SchulzOli`) fails with
   `InvalidAccessException` before anything is published. For Open VSX
   (VSCodium, Cursor, Windsurf, Gitpod), also add the token `OVSX_PAT`; Open
   VSX is not affected by the Azure DevOps change.
3. **Publish.** Run the *Release* workflow with the version in
   `../package.json`; it publishes the npm package and the extension together.
4. **GitHub.** Under *Settings → General → Social preview*, upload
   `social-preview.jpg`. Set the repository description to the short
   description above, the website to the documentation, and the topics
   `business-central`, `al`, `dynamics-365`, `vscode-extension`,
   `dependency-graph`, `mcp`.
5. **Release.** Tag the release and paste the changelog into the GitHub
   release, with `social-preview.jpg` on top.
6. **Announce** with the posts below, each with `social-preview.jpg` or a
   screenshot. A short screen recording of the view in 3D (rotate, click a
   node, open the object) works best on LinkedIn.

## Launch copy

### One line (140 characters)

> BC Atlas for VS Code: see your Business Central apps as one graph, what is
> wrong with them, and how to fix it. Free, MIT.

### X / Bluesky / Mastodon

> BC Atlas is now a VS Code extension 🚀
>
> Open an AL app and see it as one graph: in 2D, as a diagram, or in 3D,
> findings with the fix in the Problems panel, CodeLens above every object,
> and an MCP server for Copilot.
>
> Free and MIT. #BusinessCentral #MSDyn365BC #ALLang

### LinkedIn (English)

> **How does your Business Central app work, and what depends on what?**
>
> BC Atlas answers that in VS Code. Open an AL project and it reads the
> source into one graph: every object, what it does with the others, and
> what is wrong with it.
>
> What you get:
> 🧭 how it works, from the screens over the logic to the data
> 🌐 the same graph in 2D, as a diagram, or in 3D
> 🩺 health findings in the Problems panel, CodeLens above every object
> 🤖 an MCP server, so Copilot can read the graph, fix a finding, and check again
> ✅ the same rules as `bca check` in your pipeline
>
> It runs locally, sends no telemetry, and is free and MIT-licensed.
>
> 👉 Search for "BC Atlas" in the VS Code extensions, or see
> https://schulzoli.github.io/BC-Atlas/
>
> #BusinessCentral #MSDyn365BC #ALLang #VSCode

### LinkedIn (Deutsch)

> **Wie funktioniert eure Business-Central-App, und was hängt wovon ab?**
>
> BC Atlas beantwortet das direkt in VS Code. AL-Projekt öffnen, und BC Atlas
> liest den Quellcode in einen Graphen: jedes Objekt, was es mit den anderen
> macht, und was daran nicht stimmt.
>
> Was drin ist:
> 🧭 wie es funktioniert, von den Seiten über die Logik bis zu den Daten
> 🌐 derselbe Graph in 2D, als Diagramm oder in 3D
> 🩺 Befunde im Problems-Panel, CodeLens über jedem Objekt
> 🤖 ein MCP-Server, damit Copilot den Graphen liest, einen Befund behebt und erneut prüft
> ✅ dieselben Regeln wie `bca check` in der Pipeline
>
> Läuft lokal, ohne Telemetrie, kostenlos und MIT-lizenziert.
>
> 👉 In VS Code nach "BC Atlas" suchen, oder https://schulzoli.github.io/BC-Atlas/
>
> #BusinessCentral #MSDyn365BC #ALLang #VSCode

### Community post (Reddit, BC forums, Discord)

> **BC Atlas: a free VS Code extension to see the architecture of AL apps**
>
> I built BC Atlas to answer "how does this app work?" without drawing
> boxes by hand. It parses AL with tree-sitter-al, resolves objects, calls,
> events, data access, and permissions, and then:
>
> - shows them as one graph (objects, apps, namespaces) in 2D, as a diagram,
>   or in 3D;
> - puts findings in the Problems panel and CodeLens above objects;
> - gates CI on them with `bca check`;
> - writes documentation that stays in sync with the source (`bca layers`);
> - exposes it all to AI agents through MCP.
>
> It runs locally and is MIT-licensed. Feedback and issues welcome:
> https://github.com/SchulzOli/BC-Atlas
