// The canvas of the builder: React Flow (@xyflow/react) behind a small interface the view
// (src/app/ui/atlas.js) talks to without knowing React. The view says which nodes and wires
// there are; the library draws them, lets them be dragged, wired, selected, zoomed, and shown
// on a minimap, and says what the user did.
//
//   const canvas = window.BCAFlowCanvas.mount(element, handlers);
//   canvas.set({ nodes: [{ key, kind, html, title, pos: [x, y], into, out }], wires: [{ id, from, to, kind, label, fixed }] }, { picked });
//   canvas.point(clientX, clientY)   a point of the screen on the canvas
//   canvas.fit()
//
// handlers: connect(from, to), allowed(from, to), moved([{ key, pos }]), picked({ nodes, wires }), opened(key)
import { createElement as h, memo, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { applyEdgeChanges, applyNodeChanges, Background, Controls, Handle, MarkerType, MiniMap, Position, ReactFlow, ReactFlowProvider, useReactFlow } from "@xyflow/react";
import "@xyflow/react/dist/style.css";

// One kind of node: a card whose inside the view writes, with a port on each side it has.
const Card = memo(({ data, selected }) => h("div", { className: `card ${data.kind}${selected ? " picked" : ""}`, title: data.title },
  data.into ? h(Handle, { type: "target", position: Position.Left, title: "Drop a wire here" }) : null,
  h("div", { className: "inside", dangerouslySetInnerHTML: { __html: data.html } }),
  data.out ? h(Handle, { type: "source", position: Position.Right, title: "Drag a wire from here" }) : null));
const nodeTypes = { card: Card };

const toNode = (node, picked) => ({
  id: node.key,
  type: "card",
  position: { x: node.pos[0], y: node.pos[1] },
  data: { kind: node.kind, html: node.html, title: node.title, into: node.into, out: node.out },
  selected: picked.nodes.includes(node.key)
});
const toEdge = (wire, picked) => ({
  id: wire.id,
  source: wire.from,
  target: wire.to,
  className: wire.kind,
  label: wire.label,
  selectable: !wire.fixed,
  focusable: !wire.fixed,
  interactionWidth: 18,
  markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
  selected: picked.wires.includes(wire.id)
});

function Canvas({ api, handlers }) {
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const flow = useReactFlow();
  useEffect(() => {
    api.set = (model, { picked = {} } = {}) => {
      const chosen = { nodes: picked.nodes ?? [], wires: picked.wires ?? [] };
      setNodes(model.nodes.map((node) => toNode(node, chosen)));
      setEdges(model.wires.map((wire) => toEdge(wire, chosen)));
    };
    api.point = (x, y) => {
      const point = flow.screenToFlowPosition({ x, y });
      return [point.x, point.y];
    };
    api.fit = () => flow.fitView({ padding: 0.15, maxZoom: 1.25, duration: 200 });
    api.ready?.();
  }, [api, flow]);
  return h(ReactFlow, {
    nodes,
    edges,
    nodeTypes,
    // What is removed, the view decides: a change of the flows, not of the picture.
    onNodesChange: (changes) => setNodes((now) => applyNodeChanges(changes.filter(({ type }) => type !== "remove"), now)),
    onEdgesChange: (changes) => setEdges((now) => applyEdgeChanges(changes.filter(({ type }) => type !== "remove"), now)),
    onConnect: ({ source, target }) => handlers.connect(source, target),
    isValidConnection: ({ source, target }) => source !== target && handlers.allowed?.(source, target) !== false,
    onNodeDragStop: (_event, _node, dragged) => handlers.moved(dragged.map((node) => ({ key: node.id, pos: [Math.round(node.position.x), Math.round(node.position.y)] }))),
    onNodeDoubleClick: (_event, node) => handlers.opened(node.id),
    onSelectionChange: (selection) => handlers.picked({ nodes: selection.nodes.map(({ id }) => id), wires: selection.edges.map(({ id }) => id) }),
    deleteKeyCode: null,
    zoomOnDoubleClick: false,
    minZoom: 0.2,
    maxZoom: 2,
    connectionRadius: 28,
    colorMode: handlers.dark?.() ? "dark" : "light"
  },
  h(Background, { gap: 20, size: 1 }),
  h(Controls, { showInteractive: false, position: "bottom-right" }),
  h(MiniMap, { pannable: true, zoomable: true, position: "bottom-left", nodeClassName: (node) => node.data.kind }));
}

window.BCAFlowCanvas = {
  /** Draws a canvas into an element. */
  mount(element, handlers) {
    const api = { set() {}, point: () => [0, 0], fit() {} };
    // What is set before the library is ready is drawn when it is.
    let waiting;
    const first = (...args) => { waiting = args; };
    api.set = first;
    api.ready = () => {
      if (waiting) api.set(...waiting);
      waiting = undefined;
    };
    const root = createRoot(element);
    root.render(h(ReactFlowProvider, null, h(Canvas, { api, handlers })));
    api.unmount = () => root.unmount();
    return api;
  }
};
