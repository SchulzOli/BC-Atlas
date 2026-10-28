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
| `screenshots/*.png` | Marketplace screenshots, 1440 × 900 at 1.5×, VS Code dark theme. |
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
| Teal | `#5eead4` | The apex node; highlights such as "Clean architecture". |
| Sky | `#7dd3fc` → `#4b7cf7` | Gradient of the "A" in the icon. |
| Allowed / against the architecture | green / `#ef4444` red | Only for dependencies, as in the explorer. |

**Type:** Inter (Inter Display for big headlines).

**Taglines:**

- See your architecture, find what stands in its way, and keep it clean,
  right in VS Code.
- Clean architecture for Business Central, in your editor.
- Split the big app: see which parts could be apps today, and what is in the
  way for the rest.

## Marketplace listing

| Field | Value |
| --- | --- |
| Display name | BC Atlas: AL Architecture & Dependencies |
| Short description | See and enforce the architecture of Business Central AL apps: dependencies in 3D, clean-architecture checks with fixes, health in the Problems panel, CodeLens, diagrams, and an MCP server for AI agents. |
| Categories | Visualization, Linters, AI, Programming Languages |
| Banner | `#0b1432`, dark theme |
| Pricing | Free |

### Screenshots

All show Microsoft's open-source
[Shopify Connector](https://github.com/microsoft/BCApps/tree/main/src/Apps/W1/Shopify)
(514 objects), with the architecture proposed by folder:

```sh
bca architecture ./Shopify/App --propose --group-by folder --depth 2 --write
```

That gives 28 components in 12 layers, 658 wrong-way dependencies, and 232
work items.

| Screenshot | Shows |
| --- | --- |
| `architecture.png` | The Architecture page: components, layers, work items, baseline. |
| `components-3d.png` | The 3D explorer on the Components level: allowed links green, wrong-way red. |
| `dependencies-3d.png` | All objects in 3D with the Architecture panel and the build-order timeline. |
| `editor.png` | An AL table with the CodeLens, the object page beside it, and the Problems panel. |
| `object.png` | The page of one object with its violations and how to resolve them. |
| `overview.png` | The overview with the side bar and the status bar. |
| `health.png` | The Health page (not in the README; for posts and slides). |

To retake them: open the folder in VS Code (or code-server) with the dark
theme, the secondary side bar closed, the window at 1440 × 900, run
**BC Atlas: Open**, and capture each page.

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
   4. Run the *Publish VS Code extension* workflow once. The step *Show the
      identity the Marketplace sees* prints the identity's Azure DevOps
      profile ID; the Marketplace knows identities by this ID, not by their
      Entra IDs. Add that ID to the publisher `SchulzOli` as a member with
      the *Contributor* role (*Manage publishers → Members*).

   Until the last step is done, the step *Check access to the publisher*
   (`vsce verify-pat --azure-credential SchulzOli`) fails with
   `InvalidAccessException` before anything is published. For Open VSX
   (VSCodium, Cursor, Windsurf, Gitpod), also add the token `OVSX_PAT`; Open
   VSX is not affected by the Azure DevOps change.
3. **Publish.** Run the *Publish VS Code extension* workflow with the version
   in `../package.json`.
4. **GitHub.** Under *Settings → General → Social preview*, upload
   `social-preview.jpg`. Set the repository description to the short
   description above, the website to the documentation, and the topics
   `business-central`, `al`, `dynamics-365`, `vscode-extension`,
   `clean-architecture`, `dependency-graph`, `mcp`.
5. **Release.** Tag the release and paste the changelog into the GitHub
   release, with `social-preview.jpg` on top.
6. **Announce** with the posts below, each with `social-preview.jpg` or a
   screenshot. A short screen recording of the 3D explorer (rotate, click a
   red link, open the object) works best on LinkedIn.

## Launch copy

### One line (140 characters)

> BC Atlas for VS Code: see the architecture of your Business Central apps,
> every wrong-way dependency, and how to fix it. Free, MIT.

### X / Bluesky / Mastodon

> BC Atlas is now a VS Code extension 🚀
>
> Open an AL app and see its architecture: dependencies in 3D, every
> wrong-way dependency as a work item with the fix, findings in the Problems
> panel, CodeLens above every object, and an MCP server for Copilot.
>
> Free and MIT. #BusinessCentral #MSDyn365BC #ALLang

### LinkedIn (English)

> **Which part of your Business Central app could become an app of its own
> today, and what is in the way for the rest?**
>
> BC Atlas answers that in VS Code. Open an AL project and it proposes a
> layered architecture from today's dependencies, or checks the one you
> define. Every dependency that points the wrong way becomes a work item that
> says what to do in AL terms: move a subscriber, move a field into a table
> extension, extract an interface.
>
> On Microsoft's Shopify Connector (514 objects): 28 components in 12 layers,
> 658 wrong-way dependencies, 232 work items, and 2 components that could
> become apps right away.
>
> What you get:
> 🧭 the architecture with layers, work items, and a baseline that only shrinks
> 🌐 dependencies in 3D, replayed commit by commit, per pull request, or per release
> 🩺 health findings in the Problems panel, CodeLens above every object
> 🤖 an MCP server, so Copilot can pick a work item, apply it, and check again
> ✅ the same rules as `bca check` in your pipeline
>
> It runs locally, sends no telemetry, and is free and MIT-licensed.
>
> 👉 Search for "BC Atlas" in the VS Code extensions, or see
> https://schulzoli.github.io/BC-Atlas/
>
> #BusinessCentral #MSDyn365BC #ALLang #CleanArchitecture #VSCode

### LinkedIn (Deutsch)

> **Welcher Teil eurer Business-Central-App könnte heute schon eine eigene App
> sein, und was steht beim Rest im Weg?**
>
> BC Atlas beantwortet das direkt in VS Code. AL-Projekt öffnen, und BC Atlas
> schlägt aus den heutigen Abhängigkeiten eine Schichtenarchitektur vor oder
> prüft die, die ihr festlegt. Jede Abhängigkeit in die falsche Richtung wird
> zu einem Arbeitspaket mit dem konkreten Schritt in AL: Subscriber
> verschieben, Feld in eine Table Extension auslagern, Interface extrahieren.
>
> Am Shopify Connector von Microsoft (514 Objekte): 28 Komponenten in 12
> Schichten, 658 Abhängigkeiten in die falsche Richtung, 232 Arbeitspakete,
> und 2 Komponenten, die sofort eigene Apps sein könnten.
>
> Was drin ist:
> 🧭 Architektur mit Schichten, Arbeitspaketen und einer Baseline, die nur schrumpft
> 🌐 Abhängigkeiten in 3D, abspielbar pro Commit, Pull Request oder Release
> 🩺 Befunde im Problems-Panel, CodeLens über jedem Objekt
> 🤖 ein MCP-Server, damit Copilot ein Arbeitspaket umsetzt und erneut prüft
> ✅ dieselben Regeln wie `bca check` in der Pipeline
>
> Läuft lokal, ohne Telemetrie, kostenlos und MIT-lizenziert.
>
> 👉 In VS Code nach "BC Atlas" suchen, oder https://schulzoli.github.io/BC-Atlas/
>
> #BusinessCentral #MSDyn365BC #ALLang #CleanArchitecture #VSCode

### Community post (Reddit, BC forums, Discord)

> **BC Atlas: a free VS Code extension to see and enforce the architecture of
> AL apps**
>
> I built BC Atlas to answer "how do we split this app?" without drawing
> boxes by hand. It parses AL with tree-sitter-al, resolves objects, calls,
> events, data access, and permissions, and then:
>
> - proposes a layered architecture (by module, namespace, or folder) and
>   lists every wrong-way dependency with a concrete fix;
> - shows dependencies in 3D (objects, apps, components) with a timeline per
>   commit, pull request, or release;
> - puts findings in the Problems panel and CodeLens above objects;
> - enforces it in CI with `bca check` and a baseline;
> - exposes it all to AI agents through MCP.
>
> It runs locally and is MIT-licensed. Feedback and issues welcome:
> https://github.com/SchulzOli/BC-Atlas
