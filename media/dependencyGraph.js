/* global acquireVsCodeApi */
(() => {
    const vscode = acquireVsCodeApi();
    const byId = id => document.getElementById(id);
    const svg = byId('graph');
    const canvas = byId('canvas');
    const ns = 'http://www.w3.org/2000/svg';
    const positions = new Map();
    let state = { nodes: [], edges: [], selected: '', initial: '', root: '' };
    let scoredFor = '';
    let busy = false;
    let palette = { low: '#ff8c00', middle: '#008cff', high: '#00c864', selected: '#ffc800' };
    let fills = {
        function: {color:'#ff8c00',alpha:0.18}, method: {color:'#008cff',alpha:0.18},
        class: {color:'#00c864',alpha:0.20}, classBody: {color:'#00c864',alpha:0.08}, selection: {color:'#ffc800',alpha:0.35}
    };
    let functionColors = ['#ff8c00','#008cff','#00c864','#e86886','#ac80e8','#26b8bb','#d6b63e','#e581c2','#8497e8','#b0b958'];
    let camera = { x: 0, y: 0, scale: 1 };
    let scene;
    let pointer;
    let fitAfterResize = false;
    let userSelected = false;
    const NODE_WIDTH = 260, NODE_HEIGHT = 94;
    const element = (tag, attributes = {}, text) => {
        const node = document.createElementNS(ns, tag);
        for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
        if (text !== undefined) node.textContent = text;
        return node;
    };
    const widths = new Map();
    function measureLabels() {
        const probe = element('text', { 'font-size': 14, 'font-weight': 600, visibility: 'hidden' });
        svg.append(probe);
        const measure = (label, isClass = false) => {
            probe.setAttribute('font-size', isClass ? 12 : 14);
            probe.setAttribute('font-family', isClass ? 'var(--vscode-editor-font-family, monospace)' : 'inherit');
            probe.textContent = label;
            return Math.max(NODE_WIDTH, Math.ceil(probe.getComputedTextLength()) + 40);
        };
        for (const node of state.nodes) {
            widths.set(node.id, measure(node.symbolKind === 'class' ? 'class ' + node.name : node.name, node.symbolKind === 'class'));
            if (node.className) {
                widths.set(classKey(node), measure('class ' + node.className, true));
            }
        }
        probe.remove();
    }
    const nodeWidth = node => widths.get(node?.id) || NODE_WIDTH;
    const post = type => vscode.postMessage({ type, id: state.selected, similar: byId('similar').checked });
    const score = node => {
        const mode = byId('color').value;
        if (mode === 'none' || (mode === 'similarity' && scoredFor !== state.selected)) return null;
        return node[mode];
    };
    const nodeKind = node => node.symbolKind === 'class' ? 'class' : node.className || node.symbolKind === 'method' ? 'method' : 'function';
    const rgba = (style, multiplier = 1) => {
        const channels = [1,3,5].map(i => parseInt(style.color.slice(i,i+2),16));
        return `rgba(${channels.join(',')},${Math.max(0,Math.min(1,style.alpha * multiplier))})`;
    };
    const nodeFill = node => {
        const value = score(node);
        // Keep configured opacity as the upper bound; an unknown score uses the base style.
        return rgba({...fills[nodeKind(node)],color:nodeColor(node)}, typeof value === 'number' ? 0.25 + 0.75 * Math.max(0,Math.min(1,value)) : 1);
    };
    const classKey = node => node.symbolKind === 'class' ? JSON.stringify([node.file, node.name])
        : node.className ? JSON.stringify([node.file, node.className]) : undefined;
    function classGroups() {
        const groups = new Map();
        for (const node of state.nodes) {
            const id = classKey(node);
            if (!id) continue;
            if (!groups.has(id)) groups.set(id, {id, name: node.symbolKind === 'class' ? node.name : node.className, file: node.file, members: []});
            const group = groups.get(id);
            if (node.symbolKind === 'class') group.classNode = node;
            else group.members.push(node);
        }
        return [...groups.values()];
    }
    function classBounds(group) {
        const members = group.members.filter(n => positions.has(n.id)).map(n => ({...positions.get(n.id), width: nodeWidth(n)}));
        if (!members.length) {
            const p = positions.get(group.classNode?.id) || {x:0,y:0};
            return {x:p.x - 20,y:p.y - 10,width:nodeWidth(group.classNode) + 44,height:NODE_HEIGHT + 40};
        }
        const x = Math.min(...members.map(p=>p.x)) - 22, y = Math.min(...members.map(p=>p.y)) - 48;
        return {x,y,width:Math.max(Math.max(...members.map(p=>p.x+p.width)) + 22 - x, Math.max(nodeWidth(group.classNode), widths.get(group.id) || 0) + 44),
            height:Math.max(...members.map(p=>p.y)) + NODE_HEIGHT + 22 - y};
    }
    function focusNode(id) {
        const node = state.nodes.find(n=>n.id===id), position = positions.get(id);
        if (!position) return;
        let x = position.x + nodeWidth(node)/2, y = position.y + NODE_HEIGHT/2;
        if (node?.symbolKind === 'class') {
            const group = classGroups().find(g=>g.classNode?.id===id);
            if (group) {const bounds=classBounds(group); x=bounds.x+bounds.width/2; y=bounds.y+25;}
        }
        camera.scale = 0.83;
        camera.x = canvas.clientWidth/2 - x*camera.scale;
        camera.y = canvas.clientHeight/2 - y*camera.scale;
        fitAfterResize = false;
        viewport();
    }
    const nodeColor = node => functionColors[node.colorIndex ?? state.nodes.indexOf(node) % 10];
    function viewport() {
        scene?.setAttribute('transform', `translate(${camera.x},${camera.y}) scale(${camera.scale})`);
        byId('fit').textContent = `Fit · ${Math.round(camera.scale * 100)}%`;
    }
    function zoom(factor, x = canvas.clientWidth / 2, y = canvas.clientHeight / 2) {
        const next = Math.max(0.15, Math.min(3, camera.scale * factor));
        const ratio = next / camera.scale;
        camera = { x: x - (x - camera.x) * ratio, y: y - (y - camera.y) * ratio, scale: next };
        fitAfterResize = false;
        viewport();
    }
    function fit() {
        if (!positions.size || !canvas.clientWidth || !canvas.clientHeight) return;
        const points = state.nodes.filter(n => positions.has(n.id)).map(n => ({...positions.get(n.id), width: nodeWidth(n)}));
        points.push(...classGroups().map(classBounds));
        const left = Math.min(...points.map(p => p.x)) - 35;
        const top = Math.min(...points.map(p => p.y)) - 55;
        const width = Math.max(...points.map(p => p.x + p.width)) + 35 - left;
        const height = Math.max(...points.map(p => p.y)) + NODE_HEIGHT + 55 - top;
        const scale = Math.max(0.15, Math.min(1.2, canvas.clientWidth / width, canvas.clientHeight / height));
        camera = { scale, x: (canvas.clientWidth - width * scale) / 2 - left * scale,
            y: (canvas.clientHeight - height * scale) / 2 - top * scale };
        viewport();
    }
    function placeNewNodes() {
        measureLabels();
        const pending = state.nodes.filter(n => !positions.has(n.id));
        if (!positions.size && pending.length) positions.set(state.initial || pending[0].id, {x:0,y:0});
        for (let pass=0;pass<=pending.length;pass++) {
            for (const node of pending) {
                if (positions.has(node.id)) continue;
                const key = classKey(node);
                const classmates = key ? state.nodes.filter(n=>n.id!==node.id && classKey(n)===key && positions.has(n.id)) : [];
                if (classmates.length) {
                    const methods = classmates.filter(n=>n.symbolKind!=='class');
                    const anchor = positions.get((methods[0] || classmates[0]).id);
                    const y = node.symbolKind === 'class'
                        ? Math.min(...classmates.map(n=>positions.get(n.id).y))-38
                        : Math.max(...classmates.map(n=>positions.get(n.id).y+(n.symbolKind==='class'?62:NODE_HEIGHT+36)));
                    positions.set(node.id,{x:anchor.x,y});
                    continue;
                }
                const edge = state.edges.find(e=>e.kind==='call' &&
                    ((e.target===node.id && positions.has(e.source)) || (e.source===node.id && positions.has(e.target))))
                    || state.edges.find(e=>e.target===node.id && positions.has(e.source));
                if(!edge && pass<pending.length) continue;
                const neighborId = edge ? edge.source===node.id ? edge.target : edge.source : state.initial;
                const neighbor = positions.get(neighborId) || {x:0,y:0};
                const direction = edge?.source===node.id ? -1 : 1;
                const neighborNode = state.nodes.find(n=>n.id===neighborId);
                let x=direction > 0 ? neighbor.x+nodeWidth(neighborNode)+100 : neighbor.x-nodeWidth(node)-100, y=neighbor.y;
                // Reserve a separate column for each class so its frame never
                // encloses unrelated functions when additional methods arrive.
                while(state.nodes.some(other=>positions.has(other.id) &&
                    x < positions.get(other.id).x+nodeWidth(other)+60 && x+nodeWidth(node)+60 > positions.get(other.id).x &&
                    (key || classKey(other)) && classKey(other)!==key)) x+=direction*(nodeWidth(node)+100);
                let offset=0;
                while(state.nodes.some(other=>{const p=positions.get(other.id);return p && x<p.x+nodeWidth(other)+30 && x+nodeWidth(node)+30>p.x && Math.abs(p.y-y)<NODE_HEIGHT+35;})) {
                    offset++; y=neighbor.y+Math.ceil(offset/2)*146*(offset%2?1:-1);
                }
                positions.set(node.id,{x,y});
            }
        }
    }
    function settleGroups() {
        const groups = classGroups();
        // Membership can arrive after a method was first shown on its own.
        for (const group of groups) {
            const members = group.members.filter(n=>positions.has(n.id));
            if (!members.length) continue;
            members.sort((a,b)=>positions.get(a.id).y-positions.get(b.id).y);
            const anchor = positions.get(members[0].id);
            const x = anchor.x, y = anchor.y;
            members.forEach((node,index)=>positions.set(node.id,{x,y:y+index*(NODE_HEIGHT+36)}));
        }
        const blocks = groups.map(group=>({
            nodes: [...group.members,...(group.classNode?[group.classNode]:[])],
            bounds: ()=>classBounds(group)
        }));
        for (const node of state.nodes.filter(n=>!classKey(n))) {
            blocks.push({nodes:[node],bounds:()=>({...positions.get(node.id),width:nodeWidth(node),height:NODE_HEIGHT})});
        }
        const placed = [];
        for (const block of blocks) {
            let bounds = block.bounds();
            let collision;
            while ((collision = placed.find(other=>bounds.x<other.x+other.width+60 && bounds.x+bounds.width+60>other.x &&
                bounds.y<other.y+other.height+36 && bounds.y+bounds.height+36>other.y))) {
                const dx = collision.x+collision.width+60-bounds.x;
                for (const node of block.nodes) { const p=positions.get(node.id); if(p) p.x+=dx; }
                bounds=block.bounds();
            }
            placed.push(bounds);
        }
    }
    function select(id) {
        state.selected = id;
        userSelected = true;
        render();
        focusNode(id);
        post('select');
    }
    function render() {
        svg.replaceChildren();
        const defs = element('defs');
        const marker = element('marker', { id: 'arrow', viewBox: '0 0 10 10', refX: 9, refY: 5,
            markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' });
        marker.append(element('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: 'context-stroke' }));
        defs.append(marker); svg.append(defs);
        scene = element('g', { id: 'scene' }); svg.append(scene);
        const groups = classGroups();
        for (const group of groups) {
            const bounds = classBounds(group);
            if (group.classNode && group.members.length) positions.set(group.classNode.id,{x:bounds.x+22,y:bounds.y+10});
            const frame = element('g', {class:'class-frame','data-group':group.id});
            frame.append(element('rect', {...bounds,rx:12,fill:rgba(fills.classBody),stroke:rgba(fills.class,2.5),'stroke-width':1.5}));
            const header = element('g', group.classNode ? {class:'node class-title','data-id':group.classNode.id,'data-kind':'class',tabindex:0,role:'button','aria-label':group.name,'aria-pressed':group.classNode.id===state.selected} : {class:'class-title'});
            header.append(element('rect',{x:bounds.x,y:bounds.y,width:bounds.width,height:34,rx:10,fill:group.classNode ? nodeFill(group.classNode) : rgba(fills.class),stroke:group.classNode?.id===state.selected?palette.selected:'none','stroke-width':3}));
            header.append(element('text',{x:bounds.x+14,y:bounds.y+22,fill:'var(--graph-text)','font-size':12,'font-weight':600},'class '+group.name));
            header.append(element('title',{},group.file+' · '+group.name));
            if(group.classNode) header.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();select(group.classNode.id);}});
            frame.append(header); scene.append(frame);
        }
        const connected = new Set([state.selected]);
        for (const edge of state.edges) {
            if (edge.kind === 'similar' && !byId('similar').checked) continue;
            if (edge.source === state.selected) connected.add(edge.target);
            if (edge.target === state.selected) connected.add(edge.source);
            const port = id => {
                const group = groups.find(g=>g.classNode?.id===id);
                return group ? {...classBounds(group), height:34} : {...positions.get(id),width:nodeWidth(state.nodes.find(n=>n.id===id)),height:NODE_HEIGHT};
            };
            if (!positions.has(edge.source) || !positions.has(edge.target)) continue;
            const source = port(edge.source), target = port(edge.target);
            const sourceWidth = source.width;
            const targetWidth = target.width;
            if (!source || !target) continue;
            const right = target.x >= source.x;
            const x1 = source.x + (right ? sourceWidth : 0), y1 = source.y + source.height / 2;
            const x2 = target.x + (right ? 0 : targetWidth), y2 = target.y + target.height / 2;
            const offset = edge.kind === 'similar' ? -70 : 0;
            let d = `M ${x1} ${y1} C ${(x1 + x2) / 2} ${y1 + offset}, ${(x1 + x2) / 2} ${y2 + offset}, ${x2} ${y2}`;
            if (source.x === target.x) d = `M ${source.x + sourceWidth} ${y1} C ${source.x + sourceWidth + 70} ${y1 - 65}, ${target.x + targetWidth + 70} ${y2 + 65}, ${target.x + targetWidth} ${y2}`;
            const active = state.selected === edge.source || state.selected === edge.target;
            const line = element('path', { d, fill: 'none', class: 'edge',
                stroke: edge.kind === 'similar' ? 'var(--vscode-charts-purple, #a879df)' : 'var(--graph-edge)',
                opacity: active ? 0.9 : 0.25, 'stroke-width': active ? 2.2 : 1.5,
                'stroke-dasharray': edge.kind === 'similar' ? '2 6' : edge.evidence === 'static' ? '7 4' : 'none' });
            if (edge.kind === 'call') line.setAttribute('marker-end', 'url(#arrow)');
            line.append(element('title', {}, edge.kind === 'similar' ? `Code cosine similarity: ${edge.score?.toFixed(3)}` : `Calls (${edge.evidence === 'static' ? 'static estimate' : 'language provider'})`));
            scene.append(line);
            if (edge.kind === 'call') {
                const hit = element('path', {d, fill:'none', stroke:'transparent', 'stroke-width':16,
                    class:'call-hit', 'data-source':edge.source, 'data-target':edge.target,
                    tabindex:0, role:'button', 'aria-label':'Open call location'});
                hit.append(element('title', {}, 'Go to call location'));
                hit.addEventListener('keydown', event => {
                    if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault(); vscode.postMessage({type:'openCall',source:edge.source,target:edge.target});
                    }
                });
                scene.append(hit);
            }
        }
        for (const node of state.nodes) {
            if (node.symbolKind === 'class') continue;
            const position = positions.get(node.id);
            if (!position) continue;
            const width = nodeWidth(node);
            const value = score(node);
            const color = nodeColor(node);
            const label = node.name;
            const selected = node.id === state.selected;
            const group = element('g', { class: 'node', 'data-id': node.id, 'data-kind': nodeKind(node), tabindex: 0,
                role: 'button', 'aria-label': label, 'aria-pressed': selected,
                transform: `translate(${position.x},${position.y})` });
            group.append(element('rect', { width: width, height: NODE_HEIGHT, rx: 9, fill: 'var(--vscode-editor-background, #1e1e1e)' }));
            group.append(element('rect', { class: 'node-body', width: width, height: NODE_HEIGHT, rx: 9,
                fill: nodeFill(node),
                stroke: selected ? rgba(fills.selection,2.5) : rgba({...fills[nodeKind(node)],color},2.5), 'stroke-width': selected ? 3 : 1.5 }));
            group.append(element('rect', { x: 8, y: 12, width: 3, height: 43, rx: 1.5, fill: color }));
            group.append(element('text', { x: 20, y: 28, fill: 'var(--graph-text)', 'font-size': 14, 'font-weight': 600 },
                label));
            const filename = node.file.split(/[\\/]/).pop();
            group.append(element('text', { x: 20, y: 49, fill: 'var(--graph-description)', 'font-size': 11 }, `${filename.slice(0, 25)}:${node.line}`));
            group.append(element('text', { x: 20, y: 73, fill: 'var(--graph-description)', 'font-size': 11 }, nodeKind(node)));
            if (byId('color').value !== 'none') {
                group.append(element('text', { x: width - 14, y: 73, 'text-anchor': 'end', fill: 'var(--graph-text)', 'font-size': 11 },
                    typeof value === 'number' ? `cos ${value.toFixed(3)}` : 'unscored'));
                group.append(element('rect', { x: 14, y: 84, width: width - 28, height: 3, rx: 1.5, fill: 'var(--graph-track)' }));
                if (typeof value === 'number') group.append(element('rect', { class: 'similarity-meter', x: 14, y: 84,
                    width: (width - 28) * Math.max(0, Math.min(1, value)), height: 3, rx: 1.5, fill: 'var(--graph-meter)' }));
            }
            group.append(element('title', {}, `${label}\n${node.file}:${node.line}\n${nodeKind(node)} · ${typeof value === 'number' ? 'cosine ' + value.toFixed(3) : 'unscored'}`));
            group.addEventListener('keydown', event => {
                if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); select(node.id); svg.querySelector(`[data-id="${CSS.escape(node.id)}"]`)?.focus(); }
            });
            scene.append(group);
        }
        viewport();
        const selected = state.nodes.find(n => n.id === state.selected);
        byId('expand').disabled = busy || !selected;
        byId('source').disabled = !selected;
    }
    canvas.addEventListener('pointerdown', event => {
        if (event.button !== 0 && event.button !== 1) return;
        const node = event.target.closest('.node');
        const group = event.target.closest('.class-frame');
        pointer = { id: event.pointerId, node: event.button === 0 ? node?.dataset.id : undefined,
            edge: event.button === 0 ? event.target.closest('.call-hit')?.dataset : undefined,
            group: group?.dataset.group || classKey(state.nodes.find(n=>n.id===node?.dataset.id) || {}), x: event.clientX, y: event.clientY, moved: false };
        canvas.setPointerCapture(event.pointerId);
        canvas.classList.add('dragging');
        event.preventDefault();
    });
    canvas.addEventListener('pointermove', event => {
        if (!pointer || event.pointerId !== pointer.id) return;
        const dx = event.clientX - pointer.x, dy = event.clientY - pointer.y;
        if (!pointer.moved && Math.hypot(dx, dy) < 4) return;
        pointer.moved = true; fitAfterResize = false;
        pointer.x = event.clientX; pointer.y = event.clientY;
        if (pointer.group) {
            const group = classGroups().find(g=>g.id===pointer.group);
            if (group) for (const node of [...group.members,...(group.classNode?[group.classNode]:[])]) {
                const position=positions.get(node.id);
                if(position){position.x+=dx/camera.scale;position.y+=dy/camera.scale;}
            }
            render();
        } else if (pointer.node) {
            const position = positions.get(pointer.node);
            position.x += dx / camera.scale; position.y += dy / camera.scale;
            render();
        } else { camera.x += dx; camera.y += dy; viewport(); }
    });
    function release(event) {
        if (!pointer || event.pointerId !== pointer.id) return;
        const previous = pointer; pointer = undefined;
        canvas.classList.remove('dragging');
        if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
        if (previous.moved && (previous.node || previous.group)) { settleGroups(); render(); }
        if (event.type === 'pointerup' && !previous.moved && previous.node) select(previous.node);
        else if (event.type === 'pointerup' && !previous.moved && previous.edge) vscode.postMessage({type:'openCall',source:previous.edge.source,target:previous.edge.target});
    }
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);
    canvas.addEventListener('lostpointercapture', release);
    canvas.addEventListener('wheel', event => {
        event.preventDefault();
        const rect = canvas.getBoundingClientRect();
        if (event.shiftKey) { camera.x -= event.deltaX || event.deltaY; viewport(); fitAfterResize = false; }
        else zoom(Math.exp(-Math.max(-150, Math.min(150, event.deltaY)) * 0.005), event.clientX - rect.left, event.clientY - rect.top);
    }, { passive: false });
    canvas.addEventListener('keydown', event => {
        if (event.key === '+' || event.key === '=') zoom(1.2);
        else if (event.key === '-') zoom(1 / 1.2);
        else if (event.key === '0') { fitAfterResize = true; fit(); }
        else return;
        event.preventDefault();
    });
    byId('sideBySide').onchange = () => vscode.postMessage({ type: 'setSideBySide', enabled: byId('sideBySide').checked, id: state.selected });
    byId('zoomIn').onclick = () => zoom(1.2);
    byId('zoomOut').onclick = () => zoom(1 / 1.2);
    byId('fit').onclick = () => { fitAfterResize = true; fit(); };
    new ResizeObserver(() => { if (fitAfterResize) fit(); }).observe(canvas);
    byId('expand').onclick = () => post('expand');
    byId('source').onclick = () => post('open');
    byId('reset').onclick = () => post('reset');
    byId('similar').onchange = () => { if (byId('similar').checked) post('expand'); else render(); };
    byId('color').onchange = render;
    window.addEventListener('message', ({ data }) => {
        if (data.type === 'settings') {
            byId('sideBySide').checked = data.sideBySide;
            palette = data.palette;
            if (data.fills) fills = data.fills;
            if (data.functionColors) functionColors = data.functionColors;
            for (const [key, value] of Object.entries(palette)) document.documentElement.style.setProperty('--palette-' + key, value);
            render();
        } else if (data.type === 'graph') {
            const reset = data.reset || !positions.size || state.root !== data.root;
            const previousSelection = state.selected;
            if (reset) { positions.clear(); userSelected = false; }
            byId('graphError').hidden = true;
            state = data; scoredFor = data.selected;
            if (!reset && userSelected && data.nodes.some(n => n.id === previousSelection)) state.selected = previousSelection;
            placeNewNodes();
            settleGroups();
            byId('query').textContent = data.query ? `Query: ${data.query}` : 'Choose a function to explore its calls';
            byId('status').textContent = data.status;
            render();
            if (reset) focusNode(state.selected || state.initial);
        } else if (data.type === 'upsertNode') {
            const existing = state.nodes.find(node => node.id === data.node.id);
            if (existing) Object.assign(existing, data.node);
            else state.nodes.push(data.node);
            placeNewNodes();
            settleGroups();
            render();
        } else if (data.type === 'selection') {
            state.selected = data.id;
            userSelected = true;
            render();
            if (data.reveal && data.id) focusNode(data.id);
        } else if (data.type === 'busy') {
            busy = data.busy;
            byId('expand').disabled = busy || !state.selected;
            byId('reset').disabled = busy;
            byId('similar').disabled = busy;
            if (busy) byId('status').textContent = 'Loading calls and similarity… You can still pan, zoom and preview code.';
        } else if (data.type === 'error') {
            byId('status').textContent = data.message;
            byId('graphError').textContent = data.message;
            byId('graphError').hidden = false;
        }
    });
    vscode.postMessage({ type: 'ready' });
})();
