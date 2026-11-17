# Current and target architecture

Refactoring needs two pictures: how the code is organised **today** (the
current state, "Ist") and how it **should** be organised (the target state,
"Soll"). BC Atlas builds both from the same dependencies, scores both against
the same goals, and lists what has to change to get from one to the other.

What "should" means differs from team to team. One team trusts its
namespaces and wants few moves; another wants components that can become apps
and accepts a large reorganisation. So the goals are yours: a set of criteria
with weights, bundled with the proposal settings in a **template**. BC Atlas
ships presets, and you can save your own.

```sh
bca architecture compare ./app                              # today against the target
bca architecture compare ./app --template layered           # the same, with other goals
bca architecture compare ./app --weight fewMoves=6          # one weight changed
bca architecture templates ./app                            # presets and your own
bca architecture compare ./app --weight fewMoves=6 --save-template our-way
```

Everything on this page is also available to an AI agent through the MCP
server ([Agent integration and MCP](./agent-integration.md)): it can read
the comparison, follow the steps, and define templates.

## The two states

A comparison has two sides, `--from` (default: `structure`) and `--to`
(default: `configured` when `.bca.json` has components, otherwise `best`).
Each side is one of:

| Side | What it is |
| --- | --- |
| `structure` | The grouping the source has today: its namespaces (one segment below the prefix all of them share), or else the folders that say what objects do (type folders such as `Tables/` do not count), or else its apps. Objects without a namespace join the others by their folder. |
| `configured` | `architecture.components` of `.bca.json`: the architecture you adopted. |
| `proposal` | What `bca architecture --propose` proposes under the template in use. |
| `best` | Several proposals, each scored with your goals; the best one wins. |

The `structure` side is taken directly from the objects; nothing is
clustered. Like any proposal, it gets layers and allowed dependencies from
the order in which as little coupling as possible points the wrong way, so
its wrong-way dependencies and cycles can be counted like those of a target.
A configured architecture keeps the layers and `dependsOn` you wrote.

Both sides are checked with the same rules (coupling weights,
`allowSameLayer`, `strictLayers`, `internalAccess`) and scored with the same
goals. Otherwise the numbers could not be compared.

## Criteria

Every criterion scores a grouping from 0 to 1; 1 is best.

| Criterion | Meaning | How it is measured |
| --- | --- | --- |
| `cohesion` | What works together sits together. | The share of the weighted coupling between objects that stays inside components. |
| `modularity` | The components are real groups, not one large one and not a random cut. | The weighted modularity Q of the grouping (0 when one component holds everything); 0.5 and more counts as 1. |
| `layering` | Dependencies between components go the allowed way. | The share of the object dependencies between components that the layers and declared dependencies allow. |
| `acyclic` | Components do not depend on each other in a circle. | 1 minus the share of components that are part of a dependency cycle. |
| `ownership` | Every table is written by its own component only. | 1 minus the share of tables that another component writes. |
| `extractable` | Components could become apps of their own today. | The share of objects in components without a forbidden outgoing dependency and outside every cycle. |
| `stability` | Components depend on components more stable than themselves. | 1 minus the share of dependencies between components that point at a less stable component (instability more than 0.1 higher). |
| `size` | Components are neither tiny nor huge. | The share of objects in components whose object count lies inside the size band (default 3 to 200). |
| `followNamespaces` | Components agree with the namespaces the code has. | Harmonic mean of purity (objects whose component is mostly their namespace) and coverage (objects whose namespace is mostly their component), at the namespace depth that fits best. |
| `followFolders` | Components agree with the folders that say what objects do. | The same agreement with the functional folders. |
| `followApps` | Components agree with the apps the code is split into. | The same agreement with the apps of the workspace. |
| `fewMoves` | The architecture is close to the structure of today. | 1 minus the share of objects that would have to move away from the `structure` side. |

A criterion that has nothing to measure scores 1 on both sides: `followApps`
in a single app, `ownership` without tables, `followNamespaces` in code
without namespaces. The reason is part of the result.

Cohesion, cycles, ownership, and extractability all get better when
components are merged; one component that holds everything scores 1 on each.
Modularity, size, the three `follow` criteria, and `fewMoves` are what speaks
against that. Keep at least one of them weighted.

## Weights

The total is the weighted mean of the scores, from 0 to 100. Only the
proportions of the weights count: `cohesion: 2, layering: 4` is the same as
`cohesion: 1, layering: 2`. Weight 0 leaves a criterion out of the total; it
is still measured and shown.

The defaults (the `balanced` preset):

| `cohesion` | `modularity` | `layering` | `acyclic` | `ownership` | `extractable` | `stability` | `size` | `followNamespaces` | `followFolders` | `followApps` | `fewMoves` |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 2 | 4 | 3 | 2 | 2 | 1 | 1 | 1 | 1 | 1 | 1 | 2 |

Set your own in `.bca.json`, or for one call with `--weight`:

```json
{
  "architecture": {
    "goals": {
      "weights": { "fewMoves": 6, "extractable": 0 },
      "size": { "min": 5, "max": 150 }
    }
  }
}
```

```sh
bca architecture compare ./app --weight fewMoves=6 --weight extractable=0
```

Every setting comes from the first place that sets it: the option of the
call, then `architecture.goals` and `architecture.proposal` in `.bca.json`,
then the template in use, then the default. The result says for every weight
where it came from.

## Presets

A template bundles the goals with the settings of the proposal
([Decide what the proposal considers](./clean-architecture.md#decide-what-the-proposal-considers)),
the coupling weights, and how strictly layers are checked.

| Preset | Use it when | What it sets |
| --- | --- | --- |
| `balanced` | You have no stronger opinion yet. The default; with it BC Atlas behaves as it does without templates. | The default weights and proposal settings. |
| `follow-structure` | The namespaces and folders are deliberate and you want to find what breaks them. | Components are the namespaces (`groupBy: namespace`, no shared core); `followNamespaces` 5, `followFolders` 4, `fewMoves` 4. |
| `by-coupling` | Folders sort by object type or grew by accident, or you want to see what the code itself says. | Only the relations shape components (`groupBy: coupling`, `startFrom: []`); `modularity` 6, `cohesion` 4, the `follow` criteria and `fewMoves` 0. |
| `layered` | The components are roughly right and the dependencies between them are the problem. | `layering` 6, `acyclic` 5, `stability` 3; `strictLayers: true`, `allowSameLayer: false`. |
| `modular-monolith` | You prepare splitting an app, or keep one large app in clear modules. | Coarse components (`granularity: 0.6`, `minObjects: 5`, shared core); `extractable` 5, `ownership` 4, `acyclic` 4; size band 10 to 400; `internalAccess: component`. |
| `small-steps` | The code is in production and every move costs. | `fewMoves` 8, the `follow` criteria 2 to 3; only objects that clearly belong elsewhere are proposed to move (`moves.minGain: 4`). |

`bca architecture templates` lists them with every weight. Use one for a
single call with `--template <name>`, or make it the one in use:

```json
{ "architecture": { "template": "layered" } }
```

`strictLayers` and `allowSameLayer` only matter for components that have
layers but no `dependsOn`; a proposal declares `dependsOn` for every
component, and declared dependencies decide.

## Your own templates

`architecture.templates` in `.bca.json` maps a name to a template. A template
starts from the defaults, or from the preset or template it `extends`, and
overrides parts of it: single weights, single proposal settings.

```json
{
  "architecture": {
    "template": "our-way",
    "templates": {
      "our-way": {
        "extends": "layered",
        "title": "Our way",
        "summary": "Layered, but close to the namespaces we have.",
        "goals": { "weights": { "followNamespaces": 4, "fewMoves": 3 } },
        "proposal": { "granularity": 0.8, "exclude": ["type:permissionset"] }
      },
      "company": "../shared/bc-atlas-template.json"
    }
  }
}
```

A template has these parts, all optional:

| Part | Content |
| --- | --- |
| `title`, `summary` | What it is called and when to use it. |
| `extends` | A preset or another template to start from. |
| `goals` | `weights` per criterion and the `size` band. |
| `proposal` | Proposal settings, as in `architecture.proposal`. |
| `couplingWeights` | Weights of the relation kinds, as in `architecture.couplingWeights`. |
| `allowSameLayer`, `strictLayers`, `internalAccess` | How the layers and Access = Internal are checked. |

**A template in a file.** Instead of a template, give the path of a JSON
file that holds one, relative to the project. Several repositories can point
at the same file and share one idea of a good architecture.

**Save what you have.** When the weights and settings you tried give the
result you want, save them under a name:

```sh
bca architecture compare ./app --template layered --granularity 0.8 --weight fewMoves=4 --save-template our-way
```

This writes the effective settings (the template, `.bca.json`, and the
options of the call together) to `architecture.templates` as one template
that stands on its own. The rest of `.bca.json` keeps its content. A preset
name cannot be used; a template that does not resolve or has a wrong setting
is not written.

## Compare

```text
$ bca architecture compare examples/monolith --to proposal
Current and target architecture

Template  balanced (Balanced)
Current   The namespaces of the source: Core (4), Permissions (1), Sales (4), Warehouse (2)
Target    The proposal (template balanced): Core (5), Sales (6)
Distance  3 of 11 objects would move (27%)

Criterion            Weight  Current  Target  Change
Cohesion             2       0.67     0.85    +0.18
Modularity           4       0.63     0.61    -0.03
Layering             3       0.33     0.29    -0.05
No cycles            2       0.25     0.00    -0.25
Data ownership       2       0.75     1.00    +0.25
...
Few moves            2       1.00     0.73    -0.27
Total (0 to 100)             64.3     62.7    -1.6

Components of the target
  Core (5): merges Core (4), Permissions (1)
  Sales (6): merges Sales (4), Warehouse (2)
  Permissions (1) goes into Core (1)
  Warehouse (2) goes into Sales (2)

Steps
  1. Adopt the target architecture
       bca architecture --propose --write
  2. Move 1 object to Core
     1 from Permissions. Removes 3 dependencies that today's structure does not allow.
       bca refactor move --object permissionset:50000 --to "Core"
  3. Move 2 objects to Sales
       bca refactor move --object codeunit:50200 --to "Sales"
       bca refactor move --object table:50200 --to "Sales"
  ...
```

Here the proposal scores lower than the namespaces the code has: it brings
more coupling inside components, but two components in one cycle are worse
than three of four. With these goals the structure of today is the better
target, and the comparison says so.

`--format markdown` gives the same as a report with the two states side by
side; `--format json` gives everything (schema
`bc-atlas.architecture-compare/1`).

### The best of several proposals

`--to best` proposes up to eight architectures and scores each with your
goals. The candidates vary what the settings leave open:

- how to group: the settings as they are, namespaces decide, folders decide,
  relations only;
- the granularity: half, double;
- the shared core: on, off (and off or on together with half the granularity).

A setting you give as an option of the call is not varied. The best total
wins; among equal totals the candidate listed first. The result lists every
candidate with its settings, its score per criterion, and whether it is the
same grouping as another one, so you see why the winner won.

## Read the result

- **Criteria.** Each row has the weight, the score of both states, the
  change, and a sentence with the numbers behind both scores.
- **Mapping.** For each component of the target: the components of today its
  objects come from. `same`: at least 90% of each is the other, and the name
  is the same; `renamed`: the same with another name; `merged`: two or more
  components of today put most of their objects into it; `split`: it is the
  smaller part of a component of today; `reshaped`: mostly one component of
  today, with more than 10% gained or lost; `new`: no component of today
  makes up most of it. Components of today that no target component is mainly
  made of are listed as gone, with where their objects go.
- **Moves.** A component of the target takes the place of the component of
  today most of its objects come from; a component of today is the home of
  one target component only. Every other object is a move, with the command
  that performs it, the dependencies of today it removes that are not
  allowed (`resolves`), and the coupling it brings inside its new component
  (`gain`). The list holds the 50 most valuable moves (`--limit`, 0 for all);
  `movesTotal` counts all.
- **Distance.** The share of objects that move. It is what `fewMoves` scores.

## Follow the steps

The steps come in the order to take them:

1. **Adopt the target** (when it is a proposal): the command that writes the
   target components to `.bca.json`. From then on `bca architecture` and
   `bca check` measure the source against the target.
2. **Move objects**, one step per target component. First the components
   whose moves remove the most dependencies that are not allowed today, then
   the ones that bring the most coupling inside, then the larger ones. Inside
   a step the moves are ordered the same way. `bca refactor move` shows a
   diff and writes with `--apply`
   ([Clean architecture](./clean-architecture.md)).
3. **Resolve what the target still does not allow.** Moving objects does not
   remove a dependency that points the wrong way between two components;
   that needs a change in the code. The step names the strategies;
   `bca architecture` lists every work item.
4. **Check the result**: compile, then `bca architecture` and `bca check`.

Run the comparison again at any point. The current state is always read from
the source, so the distance shrinks as you go.

## In the view

The **Architecture** menu of the [BC Atlas view](./vscode.md) shows the same:
the score of the architecture for every goal of the template in use, the
templates, and **Current and target…**, where you choose the two states, set
the weight of every goal, and compare. Each step lists its commands to copy;
**Make the target the architecture…** writes the target to `.bca.json`, and
**Save as a template** keeps your weights under a name. See
[Why a component is what it is](./vscode.md#why-a-component-is-what-it-is).

## Limits

- The score is a weighted mean of heuristics, not a proof. It ranks
  architectures of the same project under your goals; scores of different
  projects cannot be compared.
- In small projects (a few dozen objects) one or two objects change a score
  a lot, and one component for everything can win. Look at the criteria, not
  only at the total.
- The steps do not predict the score after each step; only the two states
  are scored.
- `bca refactor move` moves a file to the folder and namespace the other
  objects of the target component have. For a component that is new, give
  the folder yourself (`--folder`).
