# BC Atlas AI (built-in plugin `ai`)

BC Atlas reads the AL source and says what is there: objects, relations,
process tests, who is blocked, what a recording of Business Central shows.
It calls no model, and the same source always gives the same result.

This plugin adds the one thing a model is good at: **telling it**. It writes
narrative documentation from those facts, one page per process and one for
the system, and keeps the facts next to each page so every sentence can be
checked. It is optional. Without an `ai` section it writes nothing and only
prepares the facts.

```
 BC Atlas (deterministic)                       plugin ai                              you choose
 ─────────────────────────                      ─────────                              ──────────
 source ─► graph: steps, people, findings ─►    grounding (Markdown, no source code)
 recordings of Business Central ──────────►        │
                                                   ▼
                                           one OpenAI-compatible endpoint  ─────────►  a gateway (LiteLLM, OpenRouter, ...)
                                           POST <endpoint>/chat/completions            or a provider, or a local server
                                                   │
                                                   ▼
                                           docs/narrative/<subject>.md
                                           docs/narrative/grounding/<subject>.md
```

| Contributes (plugin.json) | |
|---|---|
| Commands | `bca ai status`, `context`, `write` |
| Task | `ai` for `bca run`, after `layers`; output: the folder of the pages |
| MCP tools | `bc_atlas_ai_context` (the grounding; calls no model), `bc_atlas_ai_write` |

## Set it up

```json
{
  "ai": {
    "endpoint": "https://gateway.example/v1",
    "model": "<a model id your endpoint serves>",
    "outputDir": "docs/narrative",
    "language": "en"
  }
}
```

```sh
export BCA_AI_API_KEY=...   # the key of the endpoint; never in .bca.json
bca ai status               # endpoint, model, key set or not, and what there is to write about
```

| Setting | Default | Meaning |
|---|---|---|
| `endpoint` | none | Base URL of an OpenAI-compatible API, the part before `/chat/completions`. `BCA_AI_ENDPOINT` overrides it. |
| `model` | none | The model id to ask for. `BCA_AI_MODEL` overrides it. |
| `apiKeyEnv` | `BCA_AI_API_KEY` | Name of the environment variable that holds the key. An endpoint that needs no key works without. |
| `outputDir` | `docs/narrative` | Folder of the pages. |
| `language` | `en` | Language tag the model is asked to write in. |
| `temperature` | `0.2` | 0 to 2. |
| `timeout` | `120` | Seconds to wait for an answer. |

**Any model, any provider.** The plugin speaks one protocol and knows no
provider. Point `endpoint` at a gateway that routes to the models you use,
at a provider that offers an OpenAI-compatible API, or at a server on your
own machine. Changing the model or the provider is a change of two settings.

## Use

```sh
bca ai context --subject process:use-case-purchase-requests   # the facts, as a model gets them
bca ai write --dry-run                                        # which pages would be written; calls no model
bca ai write                                                  # write them
bca ai write --subject system --force                         # one page, again
bca run --tasks ai                                            # the same as a task
```

- **Subjects** are the system and every process of the
  [battle test](../../docs/battle-test.md); `bca ai status` lists them.
- **A page is written again only when its facts changed** (or the model, or
  the language). Each page starts with a mark of what it was written from. A
  run without changes calls no model and costs nothing, so the `ai` task can
  stand in a pipeline.
- **`context` needs no model.** An agent that writes documentation itself
  uses `bc_atlas_ai_context` and writes from the same facts.

## What is sent, and what is not

What goes to the endpoint is the grounding of a subject and a fixed
instruction to write only from it. The grounding holds names and facts:
objects with type and ID, procedures that are called, permission sets, the
steps of the process tests, the people and roles of the simulation,
requirements, recordings, and findings with their fixes. **Source code is
not sent.** Look at exactly what would be sent with `bca ai context`.

Where a process test stands on a recording of Business Central (see
[Grounding](../../docs/battle-test.md#grounding-process-tests-on-recordings)),
the facts say what really ran; where it does not, they say that the test is
all there is.

## What it is not

- The text is written by a model. It can be wrong or leave things out, and
  two runs do not give the same words. The facts next to it are what holds.
- Nothing else in BC Atlas depends on it: findings, checks, the view, and
  the layered documentation stay deterministic.

Switch it off for a project with `"plugins": { "ai": false }`.
