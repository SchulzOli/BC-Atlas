import { renderGraph, writeGraphQuery } from "../graph/platform.js";
import { displayPath } from "../output.js";

export async function graphQueryCommand(input, values) {
  const { graph, file } = await writeGraphQuery(input, values);
  if (file) console.error(`Wrote ${displayPath(file)} (${graph.nodes.length} nodes, ${graph.edges.length} edges)`);
  else process.stdout.write(`${JSON.stringify(graph, null, 2)}\n`);
}

export async function graphRenderCommand(input, values) {
  const result = await renderGraph(input, values);
  console.log(`Wrote ${displayPath(result.output)} (${result.nodes} nodes, ${result.edges} edges)`);
}
