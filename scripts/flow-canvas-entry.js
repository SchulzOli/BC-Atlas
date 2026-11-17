// The canvas of the builder: React Flow (@xyflow/react) behind a small interface the view
// (src/app/ui/atlas.js) talks to without knowing React. The view says which nodes and wires
// there are and what can be done with each; everything on the canvas is a component of the
// library: the nodes with their ports (Handle), the buttons of a selected node (NodeToolbar),
// the choice on a selected wire (EdgeToolbar), the tools (Panel), Controls, MiniMap, Background.
//
//   const canvas = window.BCAFlowCanvas.mount(element, handlers);
//   canvas.set({
//     nodes: [{ key, kind, pos: [x, y], into, out, over, title, under, tip, actions: [{ id, label, tip, disabled }] }],
//     wires: [{ id, from, to, kind, label, fixed, choice: { value, options: [{ value, label }] } }],
//     tools: [{ id, label, tip, needsPicked }], hint
//   }, { picked });
//   canvas.point(clientX, clientY)   a point of the screen on the canvas
//   canvas.fit()
//
// handlers: connect(from, to), allowed(from, to), moved([{ key, pos }]), picked({ nodes, wires }),
//   opened(key), action(key, id), chosen(wire, value), tool(id)
import { createContext, createElement as h, memo, useContext, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { applyEdgeChanges, applyNodeChanges, Background, BaseEdge, Controls, EdgeToolbar, getBezierPath, Handle, MarkerType, MiniMap, NodeToolbar, Panel, Position, ReactFlow, ReactFlowProvider, useReactFlow } from "@xyflow/react";
import "@xyflow/react/dist/style.css";

// What the user did goes to the view.
const Handlers = createContext({});

// A node: a card with what it is, a port on each side it has, and its buttons when it is selected.
const Card = memo(({ id, data, selected }) => {
  const handlers = useContext(Handlers);
  return h("div", { className: `card ${data.kind}${selected ? " picked" : ""}`, title: data.tip },
    h(NodeToolbar, { isVisible: selected && data.actions.length > 0, position: Position.Top, className: "nodetools" },
      data.actions.map((action) => h("button", { key: action.id, className: "btn", title: action.tip, disabled: action.disabled, onClick: () => handlers.action(id, action.id) }, action.label))),
    data.into ? h(Handle, { type: "target", position: Position.Left, title: "Drop a wire here" }) : null,
    h("div", { className: "inside" }, data.over ? h("small", null, data.over) : null, h("b", null, data.title), data.under ? h("small", null, data.under) : null),
    data.out ? h(Handle, { type: "source", position: Position.Right, title: "Drag a wire from here" }) : null);
});
const nodeTypes = { card: Card };

// A wire: selected, it offers what can be chosen about it.
const Wire = memo(({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, label, data, selected }) => {
  const handlers = useContext(Handlers);
  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  return h("g", null,
    h(BaseEdge, { id, path, markerEnd, label, labelX, labelY, interactionWidth: 18 }),
    data.choice ? h(EdgeToolbar, { edgeId: id, x: labelX, y: labelY, isVisible: selected, className: "wiretools" },
      h("select", { value: data.choice.value, "aria-label": "When the step after this wire runs", onChange: (event) => handlers.chosen(id, event.target.value) },
        data.choice.options.map((option) => h("option", { key: option.value, value: option.value }, option.label)))) : null);
});
const edgeTypes = { wire: Wire };

const toNode = (node, picked) => ({
  id: node.key,
  type: "card",
  position: { x: node.pos[0], y: node.pos[1] },
  data: { kind: node.kind, over: node.over, title: node.title, under: node.under, tip: node.tip, into: node.into, out: node.out, actions: node.actions ?? [] },
  selected: picked.nodes.includes(node.key)
});
const toEdge = (wire, picked) => ({
  id: wire.id,
  type: "wire",
  source: wire.from,
  target: wire.to,
  className: wire.kind,
  label: wire.label,
  data: { choice: wire.choice },
  selectable: !wire.fixed,
  focusable: !wire.fixed,
  markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
  selected: picked.wires.includes(wire.id)
});

function Canvas({ api, handlers }) {
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const [extra, setExtra] = useState({ tools: [] });
  const flow = useReactFlow();
  useEffect(() => {
    api.set = (model, { picked = {} } = {}) => {
      const chosen = { nodes: picked.nodes ?? [], wires: picked.wires ?? [] };
      setNodes(model.nodes.map((node) => toNode(node, chosen)));
      setEdges(model.wires.map((wire) => toEdge(wire, chosen)));
      setExtra({ tools: model.tools ?? [], hint: model.hint });
    };
    api.point = (x, y) => {
      const point = flow.screenToFlowPosition({ x, y });
      return [point.x, point.y];
    };
    api.fit = () => flow.fitView({ padding: 0.15, maxZoom: 1.25, duration: 200 });
    api.ready?.();
  }, [api, flow]);
  const anything = nodes.some(({ selected }) => selected) || edges.some(({ selected }) => selected);
  return h(Handlers.Provider, { value: handlers }, h(ReactFlow, {
    nodes,
    edges,
    nodeTypes,
    edgeTypes,
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
  h(MiniMap, { pannable: true, zoomable: true, position: "bottom-left", nodeClassName: (node) => node.data.kind }),
  extra.tools.length ? h(Panel, { position: "top-right", className: "canvastools" },
    extra.tools.map((tool) => h("button", { key: tool.id, className: "btn", title: tool.tip, disabled: tool.needsPicked && !anything, onClick: () => handlers.tool(tool.id) }, tool.label))) : null,
  extra.hint ? h(Panel, { position: "top-left", className: "canvashint" }, extra.hint) : null));
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
