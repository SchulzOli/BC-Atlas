# Dependency explorer example

[`dependencies.json`](./dependencies.json) is the graph document of the
[multi-app workspace](../multi-app) with three apps:

- **Contoso Core**: items, price groups, and pricing;
- **Contoso Sales**: quotes, declares a dependency on Contoso Core;
- **Contoso Integration**: exports quotes, declares only Contoso Sales but
  reads Contoso Core's items directly (an undeclared app dependency) and uses
  the Base Application's `Customer` table (unresolved, no symbols).

`npm run examples` commits the workspace step by step into a temporary Git
repository and runs the explorer export with `--history` on it, so the timeline has five
frames: Core, a legacy pricing codeunit, Sales on top of Core, the quote
export, and finally the item sync that introduces the undeclared dependency
while the legacy codeunit is removed.

**[Open the interactive explorer](https://schulzoli.github.io/BC-Atlas/examples/explorer/html/dependencies.html)**
(published with the documentation website), or build it locally:

```sh
node src/cli.js export examples/multi-app --view explorer -o dependencies.html
```

![Dependency explorer showing three apps, cross-app dependencies, and the commit timeline](../../docs/generated/images/explorer-view.png)

The workspace's `.bca.json` defines a target architecture: Core, Sales on top
of Core, and Integration on top of Sales only. The item sync breaks it by
reading Core directly, so the explorer's Components level shows one red
dependency, the timeline shows the violation appearing in the last commit, and
the details suggest the fix (declare Core as a dependency of Integration, or go
through Sales). Run `node src/cli.js architecture examples/multi-app` for the
same as a report.

See [Dependency explorer](../../docs/dependency-explorer.md) for every control
and [Clean architecture](../../docs/clean-architecture.md) for the rules.
