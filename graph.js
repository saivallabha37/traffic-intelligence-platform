/**
 * TRAFFIC INTELLIGENCE PLATFORM
 * Core Data Structures: Graph + Dijkstra's Algorithm
 * ===================================================
 */

// ─────────────────────────────────────────────────
//  Min-Heap Priority Queue
// ─────────────────────────────────────────────────
class PriorityQueue {
  constructor() {
    this.heap = [];
  }

  enqueue(node, priority) {
    this.heap.push({ node, priority });
    this._bubbleUp(this.heap.length - 1);
  }

  dequeue() {
    if (this.isEmpty()) return null;
    const min = this.heap[0];
    const last = this.heap.pop();
    if (this.heap.length > 0) {
      this.heap[0] = last;
      this._sinkDown(0);
    }
    return min;
  }

  isEmpty() { return this.heap.length === 0; }
  size() { return this.heap.length; }

  _bubbleUp(idx) {
    while (idx > 0) {
      const parent = Math.floor((idx - 1) / 2);
      if (this.heap[parent].priority <= this.heap[idx].priority) break;
      [this.heap[parent], this.heap[idx]] = [this.heap[idx], this.heap[parent]];
      idx = parent;
    }
  }

  _sinkDown(idx) {
    const n = this.heap.length;
    while (true) {
      let smallest = idx;
      const left = 2 * idx + 1;
      const right = 2 * idx + 2;
      if (left < n && this.heap[left].priority < this.heap[smallest].priority) smallest = left;
      if (right < n && this.heap[right].priority < this.heap[smallest].priority) smallest = right;
      if (smallest === idx) break;
      [this.heap[smallest], this.heap[idx]] = [this.heap[idx], this.heap[smallest]];
      idx = smallest;
    }
  }
}

// ─────────────────────────────────────────────────
//  Graph (Adjacency List – Undirected Weighted)
// ─────────────────────────────────────────────────
class TrafficGraph {
  constructor() {
    this.nodes = new Map();       // id -> { id, name, x, y }
    this.adjacency = new Map();   // id -> [{ to, baseWeight, trafficLevel, currentWeight }]
    this.edgeMap = new Map();     // `${from}-${to}` or `${to}-${from}` -> edge obj
  }

  addNode(id, name, x, y) {
    this.nodes.set(id, { id, name, x, y });
    if (!this.adjacency.has(id)) this.adjacency.set(id, []);
  }

  addEdge(from, to, baseWeight) {
    const trafficLevel = 'low';
    const edgeA = { to, baseWeight, trafficLevel, currentWeight: baseWeight };
    const edgeB = { to: from, baseWeight, trafficLevel, currentWeight: baseWeight };

    this.adjacency.get(from).push(edgeA);
    this.adjacency.get(to).push(edgeB);

    const key = this._edgeKey(from, to);
    this.edgeMap.set(key, edgeA); // canonical edge
  }

  _edgeKey(a, b) {
    return a < b ? `${a}-${b}` : `${b}-${a}`;
  }

  /**
   * Set traffic level on an edge.
   * multiplier: low=1, medium=1.6, high=2.5
   */
  setTraffic(from, to, level) {
    const multiplier = { low: 1.0, medium: 2.2, high: 4.0 };
    const m = multiplier[level] || 1.0;

    const updateEdge = (src, dst) => {
      const edges = this.adjacency.get(src) || [];
      const e = edges.find(e => e.to === dst);
      if (e) {
        e.trafficLevel = level;
        e.currentWeight = Math.round(e.baseWeight * m);
      }
    };

    updateEdge(from, to);
    updateEdge(to, from);

    const key = this._edgeKey(from, to);
    if (this.edgeMap.has(key)) {
      this.edgeMap.get(key).trafficLevel = level;
      this.edgeMap.get(key).currentWeight = Math.round(
        this.edgeMap.get(key).baseWeight * m
      );
    }
  }

  getEdge(from, to) {
    const edges = this.adjacency.get(from) || [];
    return edges.find(e => e.to === to) || null;
  }

  getEdgeByKey(a, b) {
    return this.edgeMap.get(this._edgeKey(a, b));
  }

  /**
   * A* Algorithm (Dijkstra + Euclidean heuristic)
   * useTraffic: if true, uses currentWeight; else uses baseWeight
   * blockedNodes: optional Set of node ids to avoid while routing
   * destination: if provided, use A* with Euclidean heuristic; else fall back to Dijkstra
   * @returns { distances, previous, visited }
   */
  dijkstra(source, useTraffic = false, blockedNodes = new Set(), destination = null) {
    const distances = new Map();
    const previous = new Map();
    const visited = new Set();
    const pq = new PriorityQueue();

    // Initialize
    for (const id of this.nodes.keys()) {
      distances.set(id, Infinity);
      previous.set(id, null);
    }
    distances.set(source, 0);

    // Use A* if destination is provided, else standard Dijkstra
    const useAStar = destination !== null && this.nodes.has(destination);
    const heuristic = (nodeId) => {
      if (!useAStar) return 0;
      const from = this.nodes.get(nodeId);
      const to = this.nodes.get(destination);
      if (!from || !to) return 0;
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      return Math.sqrt(dx * dx + dy * dy);
    };

    pq.enqueue(source, 0 + heuristic(source));

    while (!pq.isEmpty()) {
      const { node: current } = pq.dequeue();
      if (visited.has(current)) continue;
      visited.add(current);

      // Early termination for A*
      if (useAStar && current === destination) break;

      const neighbors = this.adjacency.get(current) || [];
      for (const edge of neighbors) {
        if (blockedNodes.has(edge.to) && edge.to !== source) continue;
        if (visited.has(edge.to)) continue;
        const weight = useTraffic ? edge.currentWeight : edge.baseWeight;
        const newDist = distances.get(current) + weight;
        if (newDist < distances.get(edge.to)) {
          distances.set(edge.to, newDist);
          previous.set(edge.to, current);
          pq.enqueue(edge.to, newDist + heuristic(edge.to));
        }
      }
    }

    return { distances, previous, visited };
  }

  /**
   * Recompute the remaining route after every hop.
   * This models live rerouting after reaching each intersection.
   */
  getAdaptiveRoute(source, destination, useTraffic = false) {
    const route = [source];
    let totalCost = 0;
    let current = source;
    const safetyLimit = this.nodes.size + 1;
    const blocked = new Set();

    for (let i = 0; i < safetyLimit && current !== destination; i++) {
      const { distances, previous } = this.dijkstra(current, useTraffic, blocked, destination);
      if (!Number.isFinite(distances.get(destination))) {
        return { path: [], cost: Infinity, reroutes: route.length - 1 };
      }

      const segment = this.getPath(previous, current, destination);
      if (segment.length < 2) {
        return { path: [], cost: Infinity, reroutes: route.length - 1 };
      }

      const nextHop = segment[1];
      const edge = this.getEdge(current, nextHop);
      if (!edge) {
        return { path: [], cost: Infinity, reroutes: route.length - 1 };
      }

      totalCost += useTraffic ? edge.currentWeight : edge.baseWeight;
      route.push(nextHop);

      if (nextHop !== destination) {
        blocked.add(current);
      }
      current = nextHop;
    }

    if (current !== destination) {
      return { path: [], cost: Infinity, reroutes: route.length - 1 };
    }

    return { path: route, cost: totalCost, reroutes: route.length - 1 };
  }

  /**
   * Reconstruct path from dijkstra's previous map
   */
  getPath(previous, source, destination) {
    const path = [];
    let current = destination;
    while (current !== null) {
      path.unshift(current);
      current = previous.get(current);
      if (path.length > this.nodes.size + 1) return []; // cycle guard
    }
    if (path[0] !== source) return []; // no path
    return path;
  }
}

// ─────────────────────────────────────────────────
//  City Graph Factory
//  A realistic 14-node city intersection map
// ─────────────────────────────────────────────────
function buildCityGraph(W, H) {
  const g = new TrafficGraph();

  const pw = W;
  const ph = H;

  // Nodes: [id, name, x%, y%]
  const nodesDef = [
    ['A', 'Airport',       0.12, 0.15],
    ['B', 'Bank Sq',       0.35, 0.10],
    ['C', 'City Hall',     0.60, 0.12],
    ['D', 'Downtown',      0.82, 0.18],
    ['E', 'East End',      0.90, 0.42],
    ['F', 'Fairview',      0.75, 0.65],
    ['G', 'Garden City',   0.50, 0.80],
    ['H', 'Harbor',        0.25, 0.78],
    ['I', 'Industrial',    0.10, 0.55],
    ['J', 'Junction',      0.30, 0.42],
    ['K', 'Kings Rd',      0.55, 0.45],
    ['L', 'Lake Bridge',   0.70, 0.30],
    ['M', 'Metro Park',    0.42, 0.28],
    ['N', 'North Gate',    0.20, 0.28],
  ];

  for (const [id, name, xp, yp] of nodesDef) {
    g.addNode(id, name, Math.round(pw * xp), Math.round(ph * yp));
  }

  // Edges: [from, to, baseWeight]
  const edgesDef = [
    ['A', 'N', 12], ['A', 'I', 18],
    ['B', 'N', 10], ['B', 'M', 8],  ['B', 'C', 15],
    ['C', 'L', 11], ['C', 'D', 9],
    ['D', 'E', 14], ['D', 'L', 8],
    ['E', 'F', 12], ['E', 'L', 16],
    ['F', 'G', 9],  ['F', 'K', 10], ['F', 'L', 14],
    ['G', 'H', 11], ['G', 'K', 13],
    ['H', 'I', 15], ['H', 'J', 10],
    ['I', 'J', 9],  ['I', 'N', 16],
    ['J', 'K', 12], ['J', 'M', 14], ['J', 'N', 11],
    ['K', 'L', 7],  ['K', 'M', 9],
    ['M', 'N', 6],
  ];

  for (const [from, to, w] of edgesDef) {
    g.addEdge(from, to, w);
  }

  return g;
}

// Export for app.js
window.TrafficGraph = TrafficGraph;
window.PriorityQueue = PriorityQueue;
window.buildCityGraph = buildCityGraph;
