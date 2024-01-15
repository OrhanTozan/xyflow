/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  boxToRect,
  clampPosition,
  getBoundsOfBoxes,
  getOverlappingArea,
  isNumeric,
  rectToBox,
  nodeToRect,
  pointToRendererPoint,
  getViewportForBounds,
} from './general';
import {
  type Transform,
  type XYPosition,
  type Rect,
  type NodeOrigin,
  type NodeBase,
  type EdgeBase,
  type FitViewParamsBase,
  type FitViewOptionsBase,
  NodeDragItem,
  CoordinateExtent,
  OnError,
  OnBeforeDelete,
} from '../types';
import { errorMessages } from '../constants';

/**
 * Test whether an object is useable as an Edge
 * @public
 * @remarks In TypeScript this is a type guard that will narrow the type of whatever you pass in to Edge if it returns true
 * @param element - The element to test
 * @returns A boolean indicating whether the element is an Edge
 */
export const isEdgeBase = <EdgeType extends EdgeBase = EdgeBase>(element: any): element is EdgeType =>
  'id' in element && 'source' in element && 'target' in element;

/**
 * Test whether an object is useable as a Node
 * @public
 * @remarks In TypeScript this is a type guard that will narrow the type of whatever you pass in to Node if it returns true
 * @param element - The element to test
 * @returns A boolean indicating whether the element is an Node
 */
export const isNodeBase = <NodeType extends NodeBase = NodeBase>(element: any): element is NodeType =>
  'id' in element && !('source' in element) && !('target' in element);

/**
 * Pass in a node, and get connected nodes where edge.source === node.id
 * @public
 * @param node - The node to get the connected nodes from
 * @param nodes - The array of all nodes
 * @param edges - The array of all edges
 * @returns An array of nodes that are connected over eges where the source is the given node
 */
export const getOutgoersBase = <NodeType extends NodeBase = NodeBase, EdgeType extends EdgeBase = EdgeBase>(
  node: NodeType | { id: string },
  nodes: NodeType[],
  edges: EdgeType[]
): NodeType[] => {
  if (!node.id) {
    return [];
  }

  const outgoerIds = new Set();
  edges.forEach((edge) => {
    if (edge.source === node.id) {
      outgoerIds.add(edge.target);
    }
  });

  return nodes.filter((n) => outgoerIds.has(n.id));
};

/**
 * Pass in a node, and get connected nodes where edge.target === node.id
 * @public
 * @param node - The node to get the connected nodes from
 * @param nodes - The array of all nodes
 * @param edges - The array of all edges
 * @returns An array of nodes that are connected over eges where the target is the given node
 */
export const getIncomersBase = <NodeType extends NodeBase = NodeBase, EdgeType extends EdgeBase = EdgeBase>(
  node: NodeType | { id: string },
  nodes: NodeType[],
  edges: EdgeType[]
): NodeType[] => {
  if (!node.id) {
    return [];
  }
  const incomersIds = new Set();
  edges.forEach((edge) => {
    if (edge.target === node.id) {
      incomersIds.add(edge.source);
    }
  });

  return nodes.filter((n) => incomersIds.has(n.id));
};

export const getNodePositionWithOrigin = (
  node: NodeBase | undefined,
  nodeOrigin: NodeOrigin = [0, 0]
): XYPosition & { positionAbsolute: XYPosition } => {
  if (!node) {
    return {
      x: 0,
      y: 0,
      positionAbsolute: {
        x: 0,
        y: 0,
      },
    };
  }

  const offsetX = (node.computed?.width ?? node.initialWidth ?? 0) * nodeOrigin[0];
  const offsetY = (node.computed?.height ?? node.initialHeight ?? 0) * nodeOrigin[1];

  const position: XYPosition = {
    x: node.position.x - offsetX,
    y: node.position.y - offsetY,
  };

  return {
    ...position,
    positionAbsolute: node.computed?.positionAbsolute
      ? {
          x: node.computed.positionAbsolute.x - offsetX,
          y: node.computed.positionAbsolute.y - offsetY,
        }
      : position,
  };
};

/**
 * Determines a bounding box that contains all given nodes in an array
 * @public
 * @remarks Useful when combined with {@link getViewportForBounds} to calculate the correct transform to fit the given nodes in a viewport.
 * @param nodes - Nodes to calculate the bounds for
 * @param nodeOrigin - Origin of the nodes: [0, 0] - top left, [0.5, 0.5] - center
 * @returns Bounding box enclosing all nodes
 */
export const getNodesBounds = (nodes: NodeBase[], nodeOrigin: NodeOrigin = [0, 0]): Rect => {
  if (nodes.length === 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  const box = nodes.reduce(
    (currBox, node) => {
      const { x, y } = getNodePositionWithOrigin(node, node.origin || nodeOrigin);
      return getBoundsOfBoxes(
        currBox,
        rectToBox({
          x,
          y,
          width: node.computed?.width ?? node.initialWidth ?? 0,
          height: node.computed?.height ?? node.initialHeight ?? 0,
        })
      );
    },
    { x: Infinity, y: Infinity, x2: -Infinity, y2: -Infinity }
  );

  return boxToRect(box);
};

export const getNodesInside = <NodeType extends NodeBase>(
  nodes: NodeType[],
  rect: Rect,
  [tx, ty, tScale]: Transform = [0, 0, 1],
  partially = false,
  // set excludeNonSelectableNodes if you want to pay attention to the nodes "selectable" attribute
  excludeNonSelectableNodes = false,
  nodeOrigin: NodeOrigin = [0, 0]
): NodeType[] => {
  const paneRect = {
    ...pointToRendererPoint(rect, [tx, ty, tScale]),
    width: rect.width / tScale,
    height: rect.height / tScale,
  };

  const visibleNodes = nodes.reduce<NodeType[]>((res, node) => {
    const { computed, selectable = true, hidden = false } = node;
    const width = computed?.width ?? node.initialWidth ?? null;
    const height = computed?.height ?? node.initialHeight ?? null;

    if ((excludeNonSelectableNodes && !selectable) || hidden) {
      return res;
    }

    const overlappingArea = getOverlappingArea(paneRect, nodeToRect(node, nodeOrigin));
    const notInitialized = width === null || height === null;

    const partiallyVisible = partially && overlappingArea > 0;
    const area = (width ?? 0) * (height ?? 0);
    const isVisible = notInitialized || partiallyVisible || overlappingArea >= area;

    if (isVisible || node.dragging) {
      res.push(node);
    }

    return res;
  }, []);

  return visibleNodes;
};

/**
 * Get all connecting edges for a given set of nodes
 * @param nodes - Nodes you want to get the connected edges for
 * @param edges - All edges
 * @returns Array of edges that connect any of the given nodes with each other
 */
export const getConnectedEdgesBase = <NodeType extends NodeBase = NodeBase, EdgeType extends EdgeBase = EdgeBase>(
  nodes: NodeType[],
  edges: EdgeType[]
): EdgeType[] => {
  const nodeIds = new Set();
  nodes.forEach((node) => {
    nodeIds.add(node.id);
  });

  return edges.filter((edge) => nodeIds.has(edge.source) || nodeIds.has(edge.target));
};

export function fitView<Params extends FitViewParamsBase<NodeBase>, Options extends FitViewOptionsBase<NodeBase>>(
  { nodes, width, height, panZoom, minZoom, maxZoom, nodeOrigin = [0, 0] }: Params,
  options?: Options
) {
  const filteredNodes = nodes.filter((n) => {
    const isVisible = n.computed?.width && n.computed?.height && (options?.includeHiddenNodes || !n.hidden);

    if (options?.nodes?.length) {
      return isVisible && options?.nodes.some((optionNode) => optionNode.id === n.id);
    }

    return isVisible;
  });

  if (filteredNodes.length > 0) {
    const bounds = getNodesBounds(filteredNodes, nodeOrigin);

    const viewport = getViewportForBounds(
      bounds,
      width,
      height,
      options?.minZoom ?? minZoom,
      options?.maxZoom ?? maxZoom,
      options?.padding ?? 0.1
    );

    panZoom.setViewport(viewport, { duration: options?.duration });

    return true;
  }

  return false;
}

function clampNodeExtent(node: NodeDragItem | NodeBase, extent?: CoordinateExtent | 'parent') {
  if (!extent || extent === 'parent') {
    return extent;
  }
  return [extent[0], [extent[1][0] - (node.computed?.width ?? 0), extent[1][1] - (node.computed?.height ?? 0)]];
}

export function calcNextPosition<NodeType extends NodeBase>(
  node: NodeDragItem | NodeType,
  nextPosition: XYPosition,
  nodes: NodeType[],
  nodeExtent?: CoordinateExtent,
  nodeOrigin: NodeOrigin = [0, 0],
  onError?: OnError
): { position: XYPosition; positionAbsolute: XYPosition } {
  const clampedNodeExtent = clampNodeExtent(node, node.extent || nodeExtent);
  let currentExtent = clampedNodeExtent;
  let parentNode: NodeType | null = null;
  let parentPos = { x: 0, y: 0 };

  if (node.parentNode) {
    parentNode = nodes.find((n) => n.id === node.parentNode) || null;
    parentPos = parentNode
      ? getNodePositionWithOrigin(parentNode, parentNode.origin || nodeOrigin).positionAbsolute
      : parentPos;
  }

  if (node.extent === 'parent' && !node.expandParent) {
    const nodeWidth = node.computed?.width;
    const nodeHeight = node.computed?.height;
    if (node.parentNode && nodeWidth && nodeHeight) {
      const currNodeOrigin = node.origin || nodeOrigin;

      currentExtent =
        parentNode && isNumeric(parentNode.computed?.width) && isNumeric(parentNode.computed?.height)
          ? [
              [parentPos.x + nodeWidth * currNodeOrigin[0], parentPos.y + nodeHeight * currNodeOrigin[1]],
              [
                parentPos.x + (parentNode.computed?.width ?? 0) - nodeWidth + nodeWidth * currNodeOrigin[0],
                parentPos.y + (parentNode.computed?.height ?? 0) - nodeHeight + nodeHeight * currNodeOrigin[1],
              ],
            ]
          : currentExtent;
    } else {
      onError?.('005', errorMessages['error005']());
      currentExtent = clampedNodeExtent;
    }
  } else if (node.extent && node.parentNode && node.extent !== 'parent') {
    currentExtent = [
      [node.extent[0][0] + parentPos.x, node.extent[0][1] + parentPos.y],
      [node.extent[1][0] + parentPos.x, node.extent[1][1] + parentPos.y],
    ];
  }

  const positionAbsolute =
    currentExtent && currentExtent !== 'parent'
      ? clampPosition(nextPosition, currentExtent as CoordinateExtent)
      : nextPosition;

  return {
    position: {
      x: positionAbsolute.x - parentPos.x,
      y: positionAbsolute.y - parentPos.y,
    },
    positionAbsolute,
  };
}

/**
 * Pass in nodes & edges to delete, get arrays of nodes and edges that actually can be deleted
 * @internal
 * @param param.nodesToRemove - The nodes to remove
 * @param param.edgesToRemove - The edges to remove
 * @param param.nodes - All nodes
 * @param param.edges - All edges
 * @param param.onBeforeDelete - Callback to check which nodes and edges can be deleted
 * @returns nodes: nodes that can be deleted, edges: edges that can be deleted
 */
export async function getElementsToRemove<NodeType extends NodeBase = NodeBase, EdgeType extends EdgeBase = EdgeBase>({
  nodesToRemove = [],
  edgesToRemove = [],
  nodes,
  edges,
  onBeforeDelete,
}: {
  nodesToRemove: Partial<NodeType>[];
  edgesToRemove: Partial<EdgeType>[];
  nodes: NodeType[];
  edges: EdgeType[];
  onBeforeDelete?: OnBeforeDelete;
}): Promise<{
  nodes: NodeType[];
  edges: EdgeType[];
}> {
  const nodeIds = nodesToRemove.map((node) => node.id);
  const matchingNodes: NodeType[] = [];

  for (const node of nodes) {
    if (node.deletable === false) {
      continue;
    }

    const isIncluded = nodeIds.includes(node.id);
    const parentHit = !isIncluded && node.parentNode && matchingNodes.find((n) => n.id === node.parentNode);

    if (isIncluded || parentHit) {
      matchingNodes.push(node);
    }
  }

  const edgeIds = edgesToRemove.map((edge) => edge.id);
  const deletableEdges = edges.filter((edge) => edge.deletable !== false);
  const connectedEdges = getConnectedEdgesBase(matchingNodes, deletableEdges);
  const matchingEdges: EdgeType[] = connectedEdges;

  for (const edge of deletableEdges) {
    const isIncluded = edgeIds.includes(edge.id);

    if (isIncluded && !matchingEdges.find((e) => e.id === edge.id)) {
      matchingEdges.push(edge);
    }
  }

  if (!onBeforeDelete) {
    return {
      edges: matchingEdges,
      nodes: matchingNodes,
    };
  }

  const onBeforeDeleteResult = await onBeforeDelete({
    nodes: matchingNodes,
    edges: matchingEdges,
  });

  if (typeof onBeforeDeleteResult === 'boolean') {
    return onBeforeDeleteResult ? { edges: matchingEdges, nodes: matchingNodes } : { edges: [], nodes: [] };
  }

  return onBeforeDeleteResult;
}
