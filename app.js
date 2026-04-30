/**
 * TRAFFIC INTELLIGENCE PLATFORM
 * Application Logic: UI, Visualization, Simulation
 * =================================================
 */

// ─────────────────────────────────────────────────
//  State
// ─────────────────────────────────────────────────
let graph = null;
let svgScale = 1;
let svgPanX = 0;
let svgPanY = 0;
let isPanning = false;
let panStartX = 0;
let panStartY = 0;
let currentTrafficLevel = 'low';
let lastResult = null;
let travelRunId = 0;
let travelInProgress = false;

const SVG_W = 800;
const SVG_H = 550;

// ─────────────────────────────────────────────────
//  DOM References
// ─────────────────────────────────────────────────
const sourceSelect = document.getElementById('sourceSelect');
const destSelect = document.getElementById('destSelect');
const findRouteBtn = document.getElementById('findRouteBtn');
const travelModeBtn = document.getElementById('travelModeBtn');
const randomTrafficBtn = document.getElementById('randomTrafficBtn');
const resetBtn = document.getElementById('resetBtn');
const svg = document.getElementById('graphSvg');
const edgesGroup = document.getElementById('edgesGroup');
const pathGroup = document.getElementById('pathGroup');
const nodesGroup = document.getElementById('nodesGroup');
const labelsGroup = document.getElementById('labelsGroup');
const pathOverlayGroup = document.getElementById('pathOverlayGroup');
const canvasHint = document.getElementById('canvasHint');
const resultsEmpty = document.getElementById('resultsEmpty');
const resultsContent = document.getElementById('resultsContent');
const liveTravelCard = document.getElementById('liveTravelCard');
const travelCurrentNode = document.getElementById('travelCurrentNode');
const travelNextHop = document.getElementById('travelNextHop');
const travelRemainingRoute = document.getElementById('travelRemainingRoute');
const travelVisitedRoute = document.getElementById('travelVisitedRoute');

// ─────────────────────────────────────────────────
//  Init
// ─────────────────────────────────────────────────
function init() {
    spawnParticles();
    graph = buildCityGraph(SVG_W, SVG_H);
    populateSelects();
    renderGraph();
    setupEventListeners();
}

// ─────────────────────────────────────────────────
//  Populate selects
// ─────────────────────────────────────────────────
function populateSelects() {
    const nodes = Array.from(graph.nodes.values()).sort((a, b) => a.name.localeCompare(b.name));
    [sourceSelect, destSelect].forEach(sel => {
        const placeholder = sel.options[0];
        sel.innerHTML = '';
        sel.appendChild(placeholder);
        nodes.forEach(n => {
            const opt = document.createElement('option');
            opt.value = n.id;
            opt.textContent = `${n.id} — ${n.name}`;
            sel.appendChild(opt);
        });
    });
}

// ─────────────────────────────────────────────────
//  SVG Helpers
// ─────────────────────────────────────────────────
function svgEl(tag, attrs = {}) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    return el;
}

function trafficColor(level) {
    return { low: '#48bb78', medium: '#f6ad55', high: '#fc8181' }[level] || '#48bb78';
}

function trafficWidth(level) {
    return { low: 2.5, medium: 3.5, high: 4.5 }[level] || 2.5;
}

// ─────────────────────────────────────────────────
//  Render Graph
// ─────────────────────────────────────────────────
function renderGraph(optPath = [], source = null, dest = null) {
    edgesGroup.innerHTML = '';
    pathGroup.innerHTML = '';
    nodesGroup.innerHTML = '';
    labelsGroup.innerHTML = '';
    if (pathOverlayGroup) pathOverlayGroup.innerHTML = '';

    const pathSet = new Set();
    for (let i = 0; i < optPath.length - 1; i++) {
        pathSet.add(`${optPath[i]}-${optPath[i + 1]}`);
        pathSet.add(`${optPath[i + 1]}-${optPath[i]}`);
    }

    // Draw edges
    const drawnEdges = new Set();
    for (const [fromId, edges] of graph.adjacency.entries()) {
        const fromNode = graph.nodes.get(fromId);
        for (const edge of edges) {
            const key = fromId < edge.to ? `${fromId}-${edge.to}` : `${edge.to}-${fromId}`;
            if (drawnEdges.has(key)) continue;
            drawnEdges.add(key);

            const toNode = graph.nodes.get(edge.to);
            const isOnPath = pathSet.has(`${fromId}-${edge.to}`) || pathSet.has(`${edge.to}-${fromId}`);
            const mx = (fromNode.x + toNode.x) / 2;
            const my = (fromNode.y + toNode.y) / 2;

            // Edge line — non-path edges are dim, showing traffic color subtly
            const line = svgEl('line', {
                x1: fromNode.x, y1: fromNode.y,
                x2: toNode.x, y2: toNode.y,
                stroke: trafficColor(edge.trafficLevel),
                'stroke-width': isOnPath ? 0 : 2,
                'stroke-opacity': isOnPath ? 0 : 0.25,
                class: 'edge',
                'data-from': fromId, 'data-to': edge.to,
            });
            edgesGroup.appendChild(line);

            // Weight label — show for all non-path edges
            if (!isOnPath) {
                const wLabel = svgEl('text', {
                    x: mx, y: my - 6,
                    class: 'edge-weight',
                    'text-anchor': 'middle',
                    opacity: '0.45',
                });
                wLabel.textContent = edge.currentWeight;
                edgesGroup.appendChild(wLabel);
            }
        }
    }

    // Path edges drawn AFTER nodes (see bottom of renderGraph) so they sit on top

    // Draw nodes
    for (const node of graph.nodes.values()) {
        const isSource = node.id === source;
        const isDest = node.id === dest;
        const isOnPath = optPath.includes(node.id);

        // Pulse ring for path nodes
        if (isOnPath && !isSource && !isDest) {
            const ring = svgEl('circle', {
                cx: node.x, cy: node.y, r: 22,
                fill: 'none',
                stroke: 'rgba(99,179,237,0.4)',
                'stroke-width': 2,
                class: 'path-node-ring',
            });
            nodesGroup.appendChild(ring);
        }

        // Outer glow for source/dest
        if (isSource || isDest) {
            const glow = svgEl('circle', {
                cx: node.x, cy: node.y, r: 28,
                fill: isSource ? 'rgba(246,173,85,0.15)' : 'rgba(252,129,129,0.15)',
                stroke: isSource ? 'rgba(246,173,85,0.4)' : 'rgba(252,129,129,0.4)',
                'stroke-width': 2,
            });
            nodesGroup.appendChild(glow);
        }

        // Node circle
        let fill = 'rgba(13, 21, 37, 0.9)';
        let stroke = isOnPath ? '#63b3ed' : 'rgba(255,255,255,0.15)';
        let strokeW = isOnPath ? 2.5 : 1.5;
        let r = 18;

        if (isSource) { fill = 'rgba(246,173,85,0.2)'; stroke = '#f6ad55'; strokeW = 3; r = 22; }
        if (isDest) { fill = 'rgba(252,129,129,0.2)'; stroke = '#fc8181'; strokeW = 3; r = 22; }

        const circle = svgEl('circle', {
            cx: node.x, cy: node.y, r,
            fill, stroke, 'stroke-width': strokeW,
            class: 'node-circle',
            filter: (isSource || isDest) ? 'url(#glowStrong)' : (isOnPath ? 'url(#glow)' : ''),
            'data-id': node.id,
        });

        circle.addEventListener('click', () => onNodeClick(node.id));
        nodesGroup.appendChild(circle);

        // Node ID label
        const label = svgEl('text', {
            x: node.x, y: node.y,
            class: 'node-label',
            fill: isSource ? '#f6ad55' : (isDest ? '#fc8181' : (isOnPath ? '#63b3ed' : 'white')),
        });
        label.textContent = node.id;
        labelsGroup.appendChild(label);

        // Node name below
        const shortName = node.name.split(' ')[0];
        const nameLabel = svgEl('text', {
            x: node.x, y: node.y + (r + 10),
            class: 'node-name',
        });
        nameLabel.textContent = shortName;
        labelsGroup.appendChild(nameLabel);
    }

    // ── Draw path edges ON TOP — trimmed to node circumference so always visible ──
    for (let i = 0; i < optPath.length - 1; i++) {
        const fn = graph.nodes.get(optPath[i]);
        const tn = graph.nodes.get(optPath[i + 1]);
        const edge = graph.getEdge(optPath[i], optPath[i + 1]);
        const tLevel = edge ? edge.trafficLevel : 'low';
        const tColor = trafficColor(tLevel);
        const tWidth = trafficWidth(tLevel) + 2;

        // ── Unit vector from fn → tn ──────────────────────────────
        const dx = tn.x - fn.x;
        const dy = tn.y - fn.y;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        const ux = dx / len, uy = dy / len;

        // Radius of each node (source/dest are bigger)
        const r1 = (optPath[i] === source || optPath[i] === dest) ? 25 : 21;
        const r2 = (optPath[i + 1] === source || optPath[i + 1] === dest) ? 25 : 21;

        // Trim start/end to circumference — but guard against nodes so close
        // that r1+r2 >= len (would invert the line and make it invisible)
        let x1, y1, x2, y2;
        if (r1 + r2 >= len) {
            // Nodes overlap visually — draw center-to-center so edge is always visible
            x1 = fn.x; y1 = fn.y;
            x2 = tn.x; y2 = tn.y;
        } else {
            x1 = fn.x + ux * r1; y1 = fn.y + uy * r1;
            x2 = tn.x - ux * r2; y2 = tn.y - uy * r2;
        }

        // Outer glow halo
        labelsGroup.appendChild(svgEl('line', {
            x1, y1, x2, y2,
            stroke: tColor,
            'stroke-width': tWidth + 10,
            'stroke-opacity': 0.3,
            'stroke-linecap': 'round',
        }));

        // Solid bright base line — always fully visible
        labelsGroup.appendChild(svgEl('line', {
            x1, y1, x2, y2,
            stroke: tColor,
            'stroke-width': tWidth + 1,
            'stroke-opacity': 0.7,
            'stroke-linecap': 'round',
        }));

        // Animated dashed overlay — rendered in top-most group so never covered
        const dashLine = svgEl('line', {
            x1, y1, x2, y2,
            stroke: '#ffffff',
            'stroke-width': tWidth,
            'stroke-opacity': '1',
            'stroke-linecap': 'round',
            class: 'path-edge',
            filter: 'url(#glow)',
            'stroke-dasharray': '8 4',
            'stroke-dashoffset': '0',
        });
        if (pathOverlayGroup) {
            pathOverlayGroup.appendChild(dashLine);
        } else {
            labelsGroup.appendChild(dashLine);
        }

        // Weight label (dark outline so readable on any background)
        const mx = (fn.x + tn.x) / 2;
        const my = (fn.y + tn.y) / 2;
        const wLabel = svgEl('text', {
            x: mx, y: my - 10,
            'text-anchor': 'middle',
            fill: tColor,
            'font-size': '12',
            'font-weight': '700',
            'font-family': 'Inter, sans-serif',
            'stroke': 'rgba(6,11,20,0.9)',
            'stroke-width': '3',
            'paint-order': 'stroke',
        });
        wLabel.textContent = edge ? edge.currentWeight : '';
        labelsGroup.appendChild(wLabel);
    }

    applyTransform();
}

// ─────────────────────────────────────────────────
//  Transform (pan + zoom)
// ─────────────────────────────────────────────────
function applyTransform() {
    const g = svg.querySelector('g');
    const groups = [edgesGroup, pathGroup, nodesGroup, labelsGroup, pathOverlayGroup];
    for (const grp of groups) {
        grp.setAttribute('transform', `translate(${svgPanX},${svgPanY}) scale(${svgScale})`);
    }
}

function updateViewBox() {
    const rect = svg.getBoundingClientRect();
    svg.setAttribute('viewBox', `0 0 ${rect.width || SVG_W} ${rect.height || SVG_H}`);
}

// ─────────────────────────────────────────────────
//  Route Finding
// ─────────────────────────────────────────────────
function findRoute() {
    const src = sourceSelect.value;
    const dst = destSelect.value;

    if (!src || !dst) {
        showToast('⚠️ Please select source and destination!');
        return;
    }
    if (src === dst) {
        showToast('⚠️ Source and destination must be different!');
        return;
    }

    // Without traffic
    const base = graph.dijkstra(src, false);
    const basePath = graph.getPath(base.previous, src, dst);
    const baseCost = base.distances.get(dst);

    // Recompute from the current node at every hop so the route can reroute
    // if traffic changes while traveling.
    const trafficResult = graph.getAdaptiveRoute(src, dst, true);
    const trafficPath = trafficResult.path;
    const trafficCost = trafficResult.cost;

    if (basePath.length === 0 || baseCost === Infinity) {
        showToast('❌ No path found between these nodes!');
        return;
    }

    if (trafficPath.length === 0 || trafficCost === Infinity) {
        showToast('❌ No traffic-aware route found!');
        return;
    }

    lastResult = { src, dst, basePath, baseCost, trafficPath, trafficCost, reroutes: trafficResult.reroutes };
    canvasHint.classList.add('hidden');

    // Render the optimal (traffic-aware) path
    renderGraph(trafficPath, src, dst);
    showResults(lastResult);
    showToast(`✅ Optimal path found! ${trafficPath.join(' → ')}`);
}

function setTravelStatus({ currentNode, nextHop = '—', remainingRoute = [], visitedRoute = [] }) {
    liveTravelCard.classList.remove('hidden');
    travelCurrentNode.textContent = currentNode || '—';
    travelNextHop.textContent = nextHop || '—';
    travelRemainingRoute.textContent = remainingRoute.length ? remainingRoute.join(' → ') : '—';
    travelVisitedRoute.textContent = visitedRoute.length ? visitedRoute.join(' → ') : '—';
}

function clearTravelStatus() {
    liveTravelCard.classList.add('hidden');
    travelCurrentNode.textContent = '—';
    travelNextHop.textContent = '—';
    travelRemainingRoute.textContent = '—';
    travelVisitedRoute.textContent = '—';
}

async function startTravelMode() {
    if (travelInProgress) return;

    const src = sourceSelect.value;
    const dst = destSelect.value;

    if (!src || !dst) {
        showToast('⚠️ Please select source and destination!');
        return;
    }
    if (src === dst) {
        showToast('⚠️ Source and destination must be different!');
        return;
    }

    const base = graph.dijkstra(src, false);
    const basePath = graph.getPath(base.previous, src, dst);
    const baseCost = base.distances.get(dst);
    if (basePath.length === 0 || baseCost === Infinity) {
        showToast('❌ No path found between these nodes!');
        return;
    }

    travelInProgress = true;
    const runId = ++travelRunId;
    travelModeBtn.disabled = true;
    findRouteBtn.disabled = true;
    randomTrafficBtn.disabled = true;
    resetBtn.disabled = true;

    canvasHint.classList.add('hidden');
    resultsEmpty.classList.add('hidden');
    resultsContent.classList.remove('hidden');

    const traveled = [src];
    let current = src;
    let totalCost = 0;

    try {
        lastResult = { src, dst, basePath, baseCost, trafficPath: basePath, trafficCost: baseCost };
        renderGraph([src], src, dst);
        showResults(lastResult);
        setTravelStatus({ currentNode: src, nextHop: '—', remainingRoute: [src, dst], visitedRoute: [src] });
        showToast('🚗 Travel mode started');

        while (runId === travelRunId && current !== dst) {
            const adaptive = graph.getAdaptiveRoute(current, dst, true);
            const remaining = adaptive.path;
            if (remaining.length < 2) {
                showToast('❌ Route became unavailable while traveling!');
                break;
            }

            const nextHop = remaining[1];
            const edge = graph.getEdge(current, nextHop);
            if (!edge) {
                showToast('❌ Missing road segment on the live route!');
                break;
            }

            const livePlan = [...traveled, ...remaining.slice(1)];
            setTravelStatus({
                currentNode: current,
                nextHop,
                remainingRoute: livePlan,
                visitedRoute: traveled,
            });
            renderGraph(traveled, src, dst);
            await new Promise(resolve => setTimeout(resolve, 650));
            if (runId !== travelRunId) break;

            totalCost += edge.currentWeight;
            traveled.push(nextHop);
            current = nextHop;

            const updatedRemaining = current === dst ? [dst] : graph.getAdaptiveRoute(current, dst, true).path;
            const currentPlan = [...traveled, ...updatedRemaining.slice(1)];
            lastResult.trafficPath = currentPlan;
            lastResult.trafficCost = current === dst ? totalCost : totalCost + graph.getAdaptiveRoute(current, dst, true).cost;
            renderGraph(traveled, src, dst);
            showResults({ ...lastResult, trafficPath: currentPlan, trafficCost: lastResult.trafficCost });
            setTravelStatus({
                currentNode: current,
                nextHop: current === dst ? 'Arrived' : 'Re-routing...',
                remainingRoute: currentPlan,
                visitedRoute: traveled,
            });
        }

        if (runId === travelRunId && current === dst) {
            showToast(`🏁 Arrived at ${dst} via ${traveled.join(' → ')}`);
        }
    } finally {
        if (runId === travelRunId) {
            travelInProgress = false;
            travelModeBtn.disabled = false;
            findRouteBtn.disabled = false;
            randomTrafficBtn.disabled = false;
            resetBtn.disabled = false;
        }
    }
}

// ─────────────────────────────────────────────────
//  Show Results Panel
// ─────────────────────────────────────────────────
function showResults({ src, dst, basePath, baseCost, trafficPath, trafficCost }) {
    resultsEmpty.classList.add('hidden');
    resultsContent.classList.remove('hidden');

    // Before
    document.getElementById('beforePath').textContent = basePath.join(' → ');
    document.getElementById('beforeCost').textContent = baseCost;
    document.getElementById('beforeHops').textContent = basePath.length - 1;

    // After
    document.getElementById('afterPath').textContent = trafficPath.join(' → ');
    document.getElementById('afterCost').textContent = trafficCost;
    document.getElementById('afterHops').textContent = trafficPath.length - 1;

    // Savings / Extra cost
    const savingsCard = document.getElementById('savingsCard');
    const savingsDiff = trafficCost - baseCost;
    const savingsPct = baseCost > 0 ? Math.round((Math.abs(savingsDiff) / baseCost) * 100) : 0;

    if (savingsDiff === 0) {
        savingsCard.className = 'savings-card';
        document.getElementById('savingsIcon').textContent = '✅';
        document.getElementById('savingsLabel').textContent = 'No Extra Cost';
        document.getElementById('savingsValue').textContent = 'Same path';
        document.getElementById('savingsPct').textContent = '0%';
    } else if (savingsDiff > 0) {
        savingsCard.className = 'savings-card extra';
        document.getElementById('savingsIcon').textContent = '🚨';
        document.getElementById('savingsLabel').textContent = 'Extra Traffic Cost';
        document.getElementById('savingsValue').textContent = `+${savingsDiff} units`;
        document.getElementById('savingsPct').textContent = `+${savingsPct}%`;
    } else {
        savingsCard.className = 'savings-card';
        document.getElementById('savingsIcon').textContent = '💰';
        document.getElementById('savingsLabel').textContent = 'Cost Saved by Rerouting';
        document.getElementById('savingsValue').textContent = `${Math.abs(savingsDiff)} units`;
        document.getElementById('savingsPct').textContent = `${savingsPct}%`;
    }

    // Path Steps
    const stepsList = document.getElementById('stepsList');
    stepsList.innerHTML = '';
    trafficPath.forEach((nodeId, i) => {
        const node = graph.nodes.get(nodeId);
        const stepDiv = document.createElement('div');
        stepDiv.className = 'step-item';
        stepDiv.style.animationDelay = `${i * 60}ms`;

        let cost = '';
        if (i < trafficPath.length - 1) {
            const edge = graph.getEdge(nodeId, trafficPath[i + 1]);
            if (edge) cost = ` (+${edge.currentWeight})`;
        }

        stepDiv.innerHTML = `
      <span class="step-num">${i + 1}</span>
      <span><strong>${nodeId}</strong> – ${node.name}${cost}</span>
    `;
        stepsList.appendChild(stepDiv);
    });

    // Edge Traffic Status for path edges
    const edgeStatusList = document.getElementById('edgeStatusList');
    edgeStatusList.innerHTML = '';
    for (let i = 0; i < trafficPath.length - 1; i++) {
        const a = trafficPath[i], b = trafficPath[i + 1];
        const edge = graph.getEdge(a, b);
        if (!edge) continue;
        const div = document.createElement('div');
        div.className = 'edge-status-item';
        const tClass = `traffic-${edge.trafficLevel === 'medium' ? 'med' : edge.trafficLevel}`;
        div.innerHTML = `
      <span class="edge-name">${a} → ${b}</span>
      <span class="edge-traffic-badge ${tClass}">${edge.trafficLevel.toUpperCase()} · ${edge.currentWeight}</span>
    `;
        edgeStatusList.appendChild(div);
    }
}

// ─────────────────────────────────────────────────
//  Traffic Controls
// ─────────────────────────────────────────────────

/** Re-run Dijkstra with current traffic weights and refresh UI */
function recomputeAndRender() {
    if (lastResult) {
        const src = lastResult.src, dst = lastResult.dst;
        const trafficResult = graph.getAdaptiveRoute(src, dst, true);
        const trafficPath = trafficResult.path;
        const trafficCost = trafficResult.cost;
        lastResult.trafficPath = trafficPath;
        lastResult.trafficCost = trafficCost;
        lastResult.reroutes = trafficResult.reroutes;
        renderGraph(trafficPath, src, dst);
        showResults(lastResult);
    } else {
        renderGraph();
    }
}

/**
 * Sample a traffic level with higher variance toward extremes.
 * This creates more dramatic route changes based on traffic conditions.
 *
 *  Low    →  60% low,  15% medium,  25% high
 *  Medium →  10% low,  40% medium,  50% high
 *  High   →   5% low,  15% medium,  80% high
 */
function sampleTrafficLevel(target) {
    const rand = Math.random();
    if (target === 'low') {
        if (rand < 0.60) return 'low';
        if (rand < 0.75) return 'medium';
        return 'high';
    } else if (target === 'medium') {
        if (rand < 0.10) return 'low';
        if (rand < 0.50) return 'medium';
        return 'high';
    } else { // high
        if (rand < 0.05) return 'low';
        if (rand < 0.20) return 'medium';
        return 'high';
    }
}

function applyBiasedTraffic(targetLevel) {
    const drawnEdges = new Set();
    for (const [fromId, edges] of graph.adjacency.entries()) {
        for (const edge of edges) {
            const key = fromId < edge.to ? `${fromId}-${edge.to}` : `${edge.to}-${fromId}`;
            if (!drawnEdges.has(key)) {
                drawnEdges.add(key);
                // Apply the exact selected traffic level to all edges uniformly
                graph.setTraffic(fromId, edge.to, targetLevel);
            }
        }
    }
}

function setTrafficLevel(level) {
    currentTrafficLevel = level;
    document.querySelectorAll('.traffic-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.level === level);
    });

    // Apply per-edge probabilistic traffic biased toward selected level
    applyBiasedTraffic(level);
    recomputeAndRender();
}

function randomizeTraffic() {
    const levels = ['low', 'medium', 'high'];
    const drawnEdges = new Set();
    for (const [fromId, edges] of graph.adjacency.entries()) {
        for (const edge of edges) {
            const key = fromId < edge.to ? `${fromId}-${edge.to}` : `${edge.to}-${fromId}`;
            if (!drawnEdges.has(key)) {
                drawnEdges.add(key);
                graph.setTraffic(fromId, edge.to, levels[Math.floor(Math.random() * levels.length)]);
            }
        }
    }
    recomputeAndRender();
    showToast('🎲 Traffic randomized across all roads!');
}

function resetAll() {
    travelRunId++;
    travelInProgress = false;
    lastResult = null;
    sourceSelect.value = '';
    destSelect.value = '';
    svgScale = 1;
    svgPanX = 0;
    svgPanY = 0;
    // Reset all traffic to low
    const drawnEdges = new Set();
    for (const [fromId, edges] of graph.adjacency.entries()) {
        for (const edge of edges) {
            const key = fromId < edge.to ? `${fromId}-${edge.to}` : `${edge.to}-${fromId}`;
            if (!drawnEdges.has(key)) {
                drawnEdges.add(key);
                graph.setTraffic(fromId, edge.to, 'low');
            }
        }
    }
    setTrafficLevel('low');
    renderGraph();
    canvasHint.classList.remove('hidden');
    resultsEmpty.classList.remove('hidden');
    resultsContent.classList.add('hidden');
    clearTravelStatus();
    travelModeBtn.disabled = false;
    findRouteBtn.disabled = false;
    randomTrafficBtn.disabled = false;
    resetBtn.disabled = false;
    showToast('↺ Everything reset!');
}

// ─────────────────────────────────────────────────
//  Node Click (quick select)
// ─────────────────────────────────────────────────
function onNodeClick(id) {
    if (!sourceSelect.value) {
        sourceSelect.value = id;
        showToast(`📍 Source set to ${id}`);
    } else if (!destSelect.value && id !== sourceSelect.value) {
        destSelect.value = id;
        showToast(`🏁 Destination set to ${id}`);
    } else {
        sourceSelect.value = id;
        destSelect.value = '';
        showToast(`📍 Source reset to ${id}`);
    }
}

// ─────────────────────────────────────────────────
//  Zoom & Pan
// ─────────────────────────────────────────────────
document.getElementById('zoomInBtn').addEventListener('click', () => {
    svgScale = Math.min(svgScale * 1.25, 4);
    applyTransform();
});

document.getElementById('zoomOutBtn').addEventListener('click', () => {
    svgScale = Math.max(svgScale / 1.25, 0.4);
    applyTransform();
});

document.getElementById('fitBtn').addEventListener('click', () => {
    svgScale = 1; svgPanX = 0; svgPanY = 0;
    applyTransform();
});

svg.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    isPanning = true;
    panStartX = e.clientX - svgPanX;
    panStartY = e.clientY - svgPanY;
    svg.style.cursor = 'grabbing';
});

svg.addEventListener('mousemove', e => {
    if (!isPanning) return;
    svgPanX = e.clientX - panStartX;
    svgPanY = e.clientY - panStartY;
    applyTransform();
});

svg.addEventListener('mouseup', () => { isPanning = false; svg.style.cursor = 'grab'; });
svg.addEventListener('mouseleave', () => { isPanning = false; svg.style.cursor = 'grab'; });

svg.addEventListener('wheel', e => {
    e.preventDefault();
    const delta = e.deltaY < 0 ? 1.1 : 0.9;
    svgScale = Math.max(0.4, Math.min(4, svgScale * delta));
    applyTransform();
}, { passive: false });

// ─────────────────────────────────────────────────
//  Toast Notification
// ─────────────────────────────────────────────────
let toastTimer = null;
function showToast(msg) {
    const toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 3000);
}

// ─────────────────────────────────────────────────
//  Floating Particles
// ─────────────────────────────────────────────────
function spawnParticles() {
    const container = document.getElementById('particles');
    for (let i = 0; i < 20; i++) {
        const p = document.createElement('div');
        p.className = 'particle';
        p.style.left = `${Math.random() * 100}%`;
        p.style.animationDuration = `${8 + Math.random() * 14}s`;
        p.style.animationDelay = `${Math.random() * 12}s`;
        p.style.width = p.style.height = `${1 + Math.random() * 2}px`;
        const colors = ['#63b3ed', '#b794f4', '#76e4f7', '#f6ad55'];
        p.style.background = colors[Math.floor(Math.random() * colors.length)];
        container.appendChild(p);
    }
}

// ─────────────────────────────────────────────────
//  Event Listeners
// ─────────────────────────────────────────────────
function setupEventListeners() {
    findRouteBtn.addEventListener('click', findRoute);
    travelModeBtn.addEventListener('click', startTravelMode);
    randomTrafficBtn.addEventListener('click', randomizeTraffic);
    resetBtn.addEventListener('click', resetAll);

    document.querySelectorAll('.traffic-btn').forEach(btn => {
        btn.addEventListener('click', () => setTrafficLevel(btn.dataset.level));
    });

    // Keyboard shortcut: Enter = find route
    document.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.target.closest('select')) findRoute();
        if (e.key === 'Escape') resetAll();
    });

    window.addEventListener('resize', () => renderGraph(
        lastResult ? lastResult.trafficPath : [],
        lastResult ? lastResult.src : null,
        lastResult ? lastResult.dst : null
    ));
}

// ─────────────────────────────────────────────────
//  Boot
// ─────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        updateViewBox();
        init();
        showToast('🚦 Traffic Intelligence Platform loaded!');
    }, 100);
});
