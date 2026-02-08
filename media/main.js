// main.js
window.onload = function() {
    const vscode = acquireVsCodeApi();

    let currentSearchQuery = '';
    let currentStatsData = null;
    let currentFolderPath = null;
    let currentResults = [];
    let currentBatchResult = null;
    let batchSearchHistory = [];
    let experimentalMode = 'run';
    let owlIgnorePatterns = [];
    let owlIgnoreTree = null;

    function byId(id) {
        return document.getElementById(id);
    }

    function parsePatternText(raw) {
        if (!raw || typeof raw !== 'string') {
            return [];
        }
        return raw
            .split(/[\n,]/)
            .map((item) => item.trim())
            .filter((item) => item.length > 0);
    }

    function getScopeFilters() {
        return {
            searchMode: byId('searchModeSelect')?.value || 'semantic',
            includePaths: parsePatternText(byId('includePathsInput')?.value || ''),
            excludePaths: parsePatternText(byId('excludePathsInput')?.value || ''),
            stripCommentsFromEmbeddings: !!byId('stripCommentsToggle')?.checked
        };
    }

    function getRelativePath(absPath, folderPath) {
        let relPath = absPath || '';
        if (relPath && folderPath && relPath.startsWith(folderPath)) {
            relPath = relPath.substring(folderPath.length);
            if (relPath.startsWith('/') || relPath.startsWith('\\')) {
                relPath = relPath.slice(1);
            }
        }
        return relPath;
    }

    function normalizePattern(pattern) {
        if (!pattern || typeof pattern !== 'string') {
            return '';
        }
        const normalized = pattern.trim().replace(/\\/g, '/').replace(/^\/+/, '');
        return normalized;
    }

    function toDirPattern(relPath) {
        const normalized = normalizePattern(relPath);
        if (!normalized || normalized === '.') {
            return '';
        }
        return normalized.endsWith('/') ? normalized : `${normalized}/`;
    }

    function setOwlIgnorePattern(relPath, checked) {
        const dirPattern = toDirPattern(relPath);
        if (!dirPattern) {
            return;
        }
        const filePattern = dirPattern.replace(/\/$/, '');
        const set = new Set((owlIgnorePatterns || []).map((p) => normalizePattern(p)).filter(Boolean));
        if (checked) {
            set.add(dirPattern);
        } else {
            set.delete(dirPattern);
            set.delete(filePattern);
        }
        owlIgnorePatterns = Array.from(set);
        renderOwlIgnorePatternPreview();
    }

    function renderOwlIgnorePatternPreview() {
        const preview = byId('owlignoreCurrentPatterns');
        if (!preview) {
            return;
        }
        preview.value = owlIgnorePatterns.length > 0
            ? owlIgnorePatterns.join('\n')
            : '(none)';
    }

    function renderTreeNode(node, container) {
        const item = document.createElement('div');
        item.className = 'dir-tree-item';

        const row = document.createElement('div');
        row.className = 'dir-tree-row';
        row.style.paddingLeft = `${Math.max(0, (node.depth || 0) * 14)}px`;

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = !!node.checked;
        checkbox.onchange = () => {
            setOwlIgnorePattern(node.rel_path, checkbox.checked);
            saveState();
        };
        row.appendChild(checkbox);

        const label = document.createElement('span');
        label.textContent = node.name;
        label.className = 'dir-tree-label';
        row.appendChild(label);
        item.appendChild(row);

        container.appendChild(item);
    }

    function flattenTree(node, depth = 0) {
        const list = [];
        if (!node || typeof node !== 'object') {
            return list;
        }
        if (node.rel_path && node.rel_path !== '.') {
            list.push({
                name: node.name,
                rel_path: node.rel_path,
                checked: !!node.checked,
                depth
            });
        }
        if (Array.isArray(node.children)) {
            node.children.forEach((child) => {
                list.push(...flattenTree(child, depth + 1));
            });
        }
        return list;
    }

    function renderOwlIgnoreTree() {
        const treeContainer = byId('owlignore-tree');
        if (!treeContainer) {
            renderOwlIgnorePatternPreview();
            return;
        }
        treeContainer.innerHTML = '';
        if (!owlIgnoreTree || !Array.isArray(owlIgnoreTree.children) || owlIgnoreTree.children.length === 0) {
            treeContainer.textContent = 'No directories found.';
            renderOwlIgnorePatternPreview();
            return;
        }

        const flattened = [];
        owlIgnoreTree.children.forEach((child) => {
            flattened.push(...flattenTree(child, 0));
        });
        flattened.forEach((node) => {
            node.checked = owlIgnorePatterns.some((pattern) => {
                const dirPattern = toDirPattern(node.rel_path);
                return normalizePattern(pattern) === normalizePattern(dirPattern) ||
                    normalizePattern(pattern) === normalizePattern(dirPattern.replace(/\/$/, ''));
            });
            renderTreeNode(node, treeContainer);
        });
        renderOwlIgnorePatternPreview();
    }

    function setExperimentalMode(mode) {
        experimentalMode = mode === 'history' ? 'history' : 'run';
        const runBtn = byId('expRunModeBtn');
        const historyBtn = byId('expHistoryModeBtn');
        const runPanel = byId('exp-run-panel');
        const historyPanel = byId('exp-history-panel');

        if (runBtn) {
            runBtn.classList.toggle('active', experimentalMode === 'run');
        }
        if (historyBtn) {
            historyBtn.classList.toggle('active', experimentalMode === 'history');
        }
        if (runPanel) {
            runPanel.classList.toggle('active', experimentalMode === 'run');
        }
        if (historyPanel) {
            historyPanel.classList.toggle('active', experimentalMode === 'history');
        }
    }

    function collectState() {
        const activeTabBtn = document.querySelector('.tab-btn.active');
        const activeTab = activeTabBtn ? activeTabBtn.getAttribute('data-tab') : 'search';
        const searchInput = byId('searchInput')?.value || '';
        const language = byId('languageSelect')?.value || '.py';
        const statsFilter = byId('statsFilter')?.value || 'all';
        const statusText = byId('status')?.textContent || '';
        const statsStatusText = byId('stats-status')?.textContent || '';
        const expStatusText = byId('exp-status')?.textContent || '';
        const translateToggle = byId('translateToggle');
        const translateEnabled = translateToggle ? !!translateToggle.checked : false;
        const searchMode = byId('searchModeSelect')?.value || 'semantic';
        const stripCommentsToggle = byId('stripCommentsToggle');
        const stripCommentsFromEmbeddings = stripCommentsToggle ? !!stripCommentsToggle.checked : false;

        return {
            activeTab,
            searchInput,
            language,
            statsFilter,
            statusText,
            statsStatusText,
            expStatusText,
            translateEnabled,
            searchMode,
            stripCommentsFromEmbeddings,
            includePathsInput: byId('includePathsInput')?.value || '',
            excludePathsInput: byId('excludePathsInput')?.value || '',
            batchQueriesInput: byId('batchQueriesInput')?.value || '',
            scopeDetailsOpen: !!byId('scopeDetails')?.open,
            owlIgnorePatterns,
            experimentalMode,
            currentSearchQuery,
            currentStatsData,
            currentFolderPath,
            currentResults,
            currentBatchResult,
            batchSearchHistory
        };
    }

    function saveState() {
        try {
            const state = collectState();
            vscode.setState(state);
            vscode.postMessage({ command: 'persistState', state });
        } catch (e) {
            console.warn('Failed to save state', e);
        }
    }

    function createSearchResultElement(r, folderPath) {
        const resultDiv = document.createElement('div');
        resultDiv.className = 'result-item';
        resultDiv.setAttribute('data-file', r.file_path || r.file || '');
        resultDiv.setAttribute('data-line', r.lineno || r.line_number || 1);

        const functionName = r.function_name || r.name || 'unknown';
        const className = r.class_name;
        const relPath = getRelativePath(r.file_path || r.file || '', folderPath);

        let displayTitle = '';
        let titleClass = 'result-title';
        if (className) {
            displayTitle = '<span class="class-name">' + className + '</span>.<span class="method-name">' + functionName + '</span>';
            titleClass += ' method-title';
            resultDiv.classList.add('method-item');
        } else {
            displayTitle = '<span class="function-name">' + functionName + '</span>';
            titleClass += ' function-title';
            resultDiv.classList.add('function-item');
        }

        resultDiv.innerHTML =
            '<div class="' + titleClass + '">' + displayTitle + '</div>' +
            '<div class="result-path">' + relPath + ':' + (r.lineno || r.line_number || 1) + '</div>' +
            '<div class="result-snippet">' + (r.code ? r.code.split('\n').slice(0, 2).join(' ') : '') + '</div>';

        if (r.code) {
            const details = document.createElement('details');
            details.className = 'result-code-details';
            details.addEventListener('click', (event) => {
                event.stopPropagation();
            });
            const summary = document.createElement('summary');
            summary.textContent = 'Show function code';
            const pre = document.createElement('pre');
            pre.className = 'result-code-block';
            pre.textContent = r.code;
            details.appendChild(summary);
            details.appendChild(pre);
            resultDiv.appendChild(details);
        }

        resultDiv.onclick = function() {
            vscode.postMessage({
                command: 'jump',
                file: this.getAttribute('data-file'),
                line: this.getAttribute('data-line'),
                functionName: functionName,
                className: className || null,
                startLine: r.lineno || r.line_number || 1,
                endLine: r.end_lineno || null
            });
        };

        return resultDiv;
    }

    function renderResults(results, folderPath) {
        const resultsContainer = byId('results');
        const statusEl = byId('status');
        if (statusEl) {
            statusEl.textContent = results.length ? 'Search Results:' : 'No matching functions found';
        }
        if (!resultsContainer) {
            return;
        }

        resultsContainer.innerHTML = '';
        results.forEach((r) => {
            resultsContainer.appendChild(createSearchResultElement(r, folderPath));
        });
        saveState();
    }

    function renderBatchRunInto(container, run, folderPath) {
        if (!container) {
            return;
        }
        const items = Array.isArray(run?.items) ? run.items : [];
        container.innerHTML = '';

        if (!items.length) {
            container.textContent = 'No batch results yet.';
            return;
        }

        items.forEach((item, idx) => {
            const card = document.createElement('div');
            card.className = 'exp-query-card';

            const title = document.createElement('div');
            title.className = 'exp-query-title';
            const original = item.original_query || item.query || '';
            title.textContent = `${idx + 1}. ${original}`;
            card.appendChild(title);

            const translated = item.translated_query || item.query || '';
            if (translated && translated !== original) {
                const translatedLine = document.createElement('div');
                translatedLine.className = 'exp-query-subtitle';
                translatedLine.textContent = `Translated: ${translated}`;
                card.appendChild(translatedLine);
            }

            const resultCount = Array.isArray(item.results) ? item.results.length : 0;
            const meta = document.createElement('div');
            meta.className = 'exp-query-meta';
            meta.textContent = `${resultCount} hits`;
            card.appendChild(meta);

            const list = document.createElement('div');
            list.className = 'exp-query-results';
            if (resultCount === 0) {
                const empty = document.createElement('div');
                empty.className = 'exp-empty';
                empty.textContent = 'No matching functions found.';
                list.appendChild(empty);
            } else {
                item.results.forEach((r) => {
                    list.appendChild(createSearchResultElement(r, folderPath));
                });
            }
            card.appendChild(list);
            container.appendChild(card);
        });
    }

    function renderBatchHistory() {
        const historyContainer = byId('history-results');
        const historyStatus = byId('history-status');
        if (!historyContainer) {
            return;
        }

        historyContainer.innerHTML = '';
        if (!Array.isArray(batchSearchHistory) || batchSearchHistory.length === 0) {
            if (historyStatus) {
                historyStatus.textContent = 'No saved runs';
            }
            historyContainer.textContent = 'History is empty.';
            return;
        }

        if (historyStatus) {
            historyStatus.textContent = `${batchSearchHistory.length} saved runs`;
        }

        batchSearchHistory.forEach((run) => {
            const item = document.createElement('div');
            item.className = 'history-item';

            const header = document.createElement('div');
            header.className = 'history-header';
            const when = run.timestamp ? new Date(run.timestamp).toLocaleString() : 'Unknown time';
            const queryCount = Array.isArray(run.items) ? run.items.length : 0;
            header.textContent = `${when} (${queryCount} queries)`;
            item.appendChild(header);

            const scope = document.createElement('div');
            scope.className = 'history-scope';
            const modeText = run.searchMode || 'semantic';
            const includeText = Array.isArray(run.includePaths) && run.includePaths.length ? run.includePaths.join(', ') : '-';
            const excludeText = Array.isArray(run.excludePaths) && run.excludePaths.length ? run.excludePaths.join(', ') : '-';
            const stripText = run.stripCommentsFromEmbeddings ? 'ON' : 'OFF';
            scope.textContent = `Mode: ${modeText} / Include: ${includeText} / Exclude: ${excludeText} / No-comment embed: ${stripText}`;
            item.appendChild(scope);

            const openBtn = document.createElement('button');
            openBtn.textContent = 'Open';
            openBtn.onclick = () => {
                currentBatchResult = run;
                currentFolderPath = run.folderPath || currentFolderPath;
                renderBatchRunInto(byId('exp-results'), run, currentFolderPath || '');
                const expStatus = byId('exp-status');
                if (expStatus) {
                    expStatus.textContent = `Loaded run: ${when}`;
                }
                setExperimentalMode('run');
                saveState();
            };
            item.appendChild(openBtn);

            historyContainer.appendChild(item);
        });
    }

    function restoreCoreState(state) {
        if (state.searchInput && byId('searchInput')) {
            byId('searchInput').value = state.searchInput;
            currentSearchQuery = state.currentSearchQuery || state.searchInput || '';
        }
        if (state.language && byId('languageSelect')) {
            byId('languageSelect').value = state.language;
        }
        if (typeof state.translateEnabled === 'boolean' && byId('translateToggle')) {
            byId('translateToggle').checked = !!state.translateEnabled;
        }
        if (typeof state.searchMode === 'string' && byId('searchModeSelect')) {
            byId('searchModeSelect').value = state.searchMode === 'bm25' ? 'bm25' : 'semantic';
        }
        if (typeof state.stripCommentsFromEmbeddings === 'boolean' && byId('stripCommentsToggle')) {
            byId('stripCommentsToggle').checked = !!state.stripCommentsFromEmbeddings;
        }
        if (state.statsFilter && byId('statsFilter')) {
            byId('statsFilter').value = state.statsFilter;
        }
        if (state.statusText && byId('status')) {
            byId('status').textContent = state.statusText;
        }
        if (state.statsStatusText && byId('stats-status')) {
            byId('stats-status').textContent = state.statsStatusText;
        }
        if (state.expStatusText && byId('exp-status')) {
            byId('exp-status').textContent = state.expStatusText;
        }
        if (typeof state.includePathsInput === 'string' && byId('includePathsInput')) {
            byId('includePathsInput').value = state.includePathsInput;
        }
        if (typeof state.excludePathsInput === 'string' && byId('excludePathsInput')) {
            byId('excludePathsInput').value = state.excludePathsInput;
        }
        if (typeof state.batchQueriesInput === 'string' && byId('batchQueriesInput')) {
            byId('batchQueriesInput').value = state.batchQueriesInput;
        }
        if (Array.isArray(state.owlIgnorePatterns)) {
            owlIgnorePatterns = state.owlIgnorePatterns.map((p) => normalizePattern(p)).filter(Boolean);
        }

        currentFolderPath = state.currentFolderPath || currentFolderPath;
        currentResults = Array.isArray(state.currentResults) ? state.currentResults : currentResults;
        currentStatsData = state.currentStatsData || currentStatsData;
        currentBatchResult = state.currentBatchResult || currentBatchResult;
        batchSearchHistory = Array.isArray(state.batchSearchHistory) ? state.batchSearchHistory : batchSearchHistory;

        if (Array.isArray(currentResults) && currentResults.length > 0) {
            renderResults(currentResults, currentFolderPath || '');
        }
        if (currentStatsData) {
            applyStatsFilter();
        }
        if (currentBatchResult) {
            renderBatchRunInto(byId('exp-results'), currentBatchResult, currentFolderPath || '');
        }
        const scopeDetails = byId('scopeDetails');
        if (scopeDetails && typeof state.scopeDetailsOpen === 'boolean') {
            scopeDetails.open = !!state.scopeDetailsOpen;
        }
        renderOwlIgnoreTree();
        renderBatchHistory();

        const activeTab = state.activeTab || 'search';
        const tabBtn = document.querySelector(`.tab-btn[data-tab="${activeTab}"]`);
        if (tabBtn) {
            tabBtn.click();
        }

        setExperimentalMode(state.experimentalMode || 'run');
    }

    function restoreFromState() {
        try {
            const state = vscode.getState() || {};
            restoreCoreState(state);
        } catch (e) {
            console.warn('Failed to restore state', e);
        }
    }

    function restoreFromExternalState(external) {
        if (!external) {
            return;
        }
        try {
            const local = vscode.getState() || {};
            const hasLocal = local.searchInput || (Array.isArray(local.currentResults) && local.currentResults.length > 0);
            if (hasLocal) {
                return;
            }
            restoreCoreState(external);
            saveState();
        } catch (e) {
            console.warn('Failed to restore external state', e);
        }
    }

    const tabButtons = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');

    tabButtons.forEach((button) => {
        button.addEventListener('click', () => {
            const targetTab = button.getAttribute('data-tab');
            tabButtons.forEach((btn) => btn.classList.remove('active'));
            tabContents.forEach((content) => {
                content.classList.remove('active');
                content.style.display = 'none';
            });

            button.classList.add('active');
            const targetTabElement = byId(targetTab + '-tab');
            if (targetTabElement) {
                targetTabElement.classList.add('active');
                targetTabElement.style.display = 'block';
            }
            saveState();
        });
    });

    const firstTab = byId('search-tab');
    if (firstTab) {
        firstTab.style.display = 'block';
    }

    const runModeBtn = byId('expRunModeBtn');
    const historyModeBtn = byId('expHistoryModeBtn');
    if (runModeBtn) {
        runModeBtn.onclick = () => {
            setExperimentalMode('run');
            saveState();
        };
    }
    if (historyModeBtn) {
        historyModeBtn.onclick = () => {
            setExperimentalMode('history');
            saveState();
        };
    }

    const clearHistoryBtn = byId('clearHistoryBtn');
    const exportHistoryBtn = byId('exportHistoryBtn');
    if (exportHistoryBtn) {
        exportHistoryBtn.onclick = () => {
            const expStatus = byId('exp-status');
            if (!Array.isArray(batchSearchHistory) || batchSearchHistory.length === 0) {
                if (expStatus) {
                    expStatus.textContent = 'No history to export.';
                }
                return;
            }
            vscode.postMessage({ command: 'exportHistory', history: batchSearchHistory });
            if (expStatus) {
                expStatus.textContent = 'Preparing export...';
            }
        };
    }
    if (clearHistoryBtn) {
        clearHistoryBtn.onclick = () => {
            batchSearchHistory = [];
            renderBatchHistory();
            const expStatus = byId('exp-status');
            if (expStatus) {
                expStatus.textContent = 'Search history cleared.';
            }
            saveState();
        };
    }

    const includeInput = byId('includePathsInput');
    const excludeInput = byId('excludePathsInput');
    if (includeInput) {
        includeInput.addEventListener('change', saveState);
        includeInput.addEventListener('blur', saveState);
    }
    if (excludeInput) {
        excludeInput.addEventListener('change', saveState);
        excludeInput.addEventListener('blur', saveState);
    }

    const scopeManagerBtn = byId('scopeManagerBtn');
    const scopeDetails = byId('scopeDetails');
    const refreshScopeTreeBtn = byId('refreshScopeTreeBtn');
    const saveOwlIgnoreBtn = byId('saveOwlIgnoreBtn');

    if (scopeManagerBtn && scopeDetails) {
        scopeManagerBtn.onclick = () => {
            scopeDetails.open = !scopeDetails.open;
            if (scopeDetails.open) {
                vscode.postMessage({ command: 'requestScopeManagerData', maxDepth: 4 });
            }
            saveState();
        };
    }
    if (scopeDetails) {
        scopeDetails.addEventListener('toggle', () => {
            if (scopeDetails.open) {
                vscode.postMessage({ command: 'requestScopeManagerData', maxDepth: 4 });
            }
            saveState();
        });
    }
    if (refreshScopeTreeBtn) {
        refreshScopeTreeBtn.onclick = () => {
            const status = byId('owlignore-status');
            if (status) {
                status.textContent = 'Loading directory tree...';
            }
            vscode.postMessage({ command: 'requestScopeManagerData', maxDepth: 4 });
        };
    }
    if (saveOwlIgnoreBtn) {
        saveOwlIgnoreBtn.onclick = () => {
            const status = byId('owlignore-status');
            if (status) {
                status.textContent = 'Saving .owlignore...';
            }
            vscode.postMessage({
                command: 'saveOwlIgnorePatterns',
                patterns: owlIgnorePatterns,
                maxDepth: 4
            });
        };
    }

    if (byId('startServerBtn')) {
        byId('startServerBtn').onclick = () => {
            vscode.postMessage({ command: 'startServer' });
        };
    }

    if (byId('clearCacheBtn')) {
        byId('clearCacheBtn').onclick = () => {
            const lang = byId('languageSelect')?.value || '.py';
            const scope = getScopeFilters();
            vscode.postMessage({ command: 'clearCache', lang, ...scope });
        };
    }

    const translateToggle = byId('translateToggle');
    if (translateToggle) {
        translateToggle.onchange = () => {
            const enable = translateToggle.checked;
            vscode.postMessage({ command: 'updateTranslationSettings', enable });
            saveState();
        };
    }
    const searchModeSelect = byId('searchModeSelect');
    if (searchModeSelect) {
        searchModeSelect.onchange = () => {
            saveState();
        };
    }
    const stripCommentsToggle = byId('stripCommentsToggle');
    if (stripCommentsToggle) {
        stripCommentsToggle.onchange = () => {
            saveState();
        };
    }
    vscode.postMessage({ command: 'requestTranslationSettings' });

    const searchBtn = byId('searchBtn');
    if (searchBtn) {
        searchBtn.onclick = () => {
            const text = byId('searchInput')?.value || '';
            if (!text) {
                return;
            }
            currentSearchQuery = text;
            const lang = byId('languageSelect')?.value || '.py';
            const scope = getScopeFilters();
            vscode.postMessage({ command: 'search', text, lang, ...scope });
            saveState();
        };
    }

    const searchInput = byId('searchInput');
    if (searchInput) {
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                byId('searchBtn')?.click();
            }
        });
    }

    const loadStatsBtn = byId('loadStatsBtn');
    if (loadStatsBtn) {
        loadStatsBtn.onclick = () => {
            const query = currentSearchQuery || byId('searchInput')?.value || '';
            const lang = byId('languageSelect')?.value || '.py';
            const scope = getScopeFilters();
            vscode.postMessage({ command: 'getClassStats', query, lang, ...scope });
            saveState();
        };
    }

    const runBatchBtn = byId('runBatchBtn');
    if (runBatchBtn) {
        runBatchBtn.onclick = () => {
            const rawQueries = byId('batchQueriesInput')?.value || '';
            const queries = rawQueries
                .split('\n')
                .map((q) => q.trim())
                .filter((q) => q.length > 0);

            const expStatus = byId('exp-status');
            if (!queries.length) {
                if (expStatus) {
                    expStatus.textContent = 'Please enter at least one query.';
                }
                return;
            }

            const lang = byId('languageSelect')?.value || '.py';
            const scope = getScopeFilters();
            if (expStatus) {
                expStatus.textContent = `Running ${queries.length} queries...`;
            }
            vscode.postMessage({ command: 'runBatchSearch', queries, lang, ...scope });
            saveState();
        };
    }

    const statsFilter = byId('statsFilter');
    if (statsFilter) {
        statsFilter.addEventListener('change', (e) => {
            const filterValue = e.target.value;
            const statsStatus = byId('stats-status');
            if (statsStatus) {
                statsStatus.textContent = `Filter: ${filterValue === 'all' ? 'All' : filterValue === 'classes' ? 'Classes Only' : 'Standalone Functions Only'}`;
            }
            applyStatsFilter();
            saveState();
        });
    }

    function applyStatsFilter() {
        if (!currentStatsData) {
            return;
        }

        const filter = byId('statsFilter')?.value || 'all';
        const resultsContainer = byId('stats-results');
        const statsStatus = byId('stats-status');
        if (!resultsContainer) {
            return;
        }

        resultsContainer.innerHTML = '';

        let classCount = 0;
        let functionCount = 0;

        if (filter === 'all' || filter === 'classes') {
            currentStatsData.classes.forEach((classInfo) => {
                classCount++;
                const classDiv = document.createElement('div');
                classDiv.className = 'stats-class-item';

                const headerDiv = document.createElement('div');
                headerDiv.className = 'stats-class-header';
                const scoreInfo = classInfo.composite_score > 0
                    ? `Score: ${classInfo.composite_score.toFixed(3)} (${classInfo.search_hits}/${classInfo.method_count} hits, best rank: ${classInfo.best_rank || 'N/A'})`
                    : 'Score: 0.000 (no search hits)';

                headerDiv.innerHTML =
                    `<span class="class-name">${classInfo.name}</span>` +
                    `<span class="method-count">${classInfo.method_count} methods</span>` +
                    `<span class="class-score">${scoreInfo}</span>`;
                classDiv.appendChild(headerDiv);

                const methodsDiv = document.createElement('div');
                methodsDiv.className = 'stats-methods';
                classInfo.methods.forEach((method) => {
                    const methodDiv = document.createElement('div');
                    methodDiv.className = 'stats-method-item';
                    methodDiv.setAttribute('data-file', method.file_path);
                    methodDiv.setAttribute('data-line', method.lineno);

                    const relPath = getRelativePath(method.file_path || '', currentFolderPath || '');
                    const rankInfo = method.search_rank ? ` (rank: ${method.search_rank})` : '';
                    methodDiv.innerHTML =
                        `<div class="method-name">${method.name}${rankInfo}</div>` +
                        `<div class="method-path">${relPath}:${method.lineno}</div>`;

                    methodDiv.onclick = function() {
                        vscode.postMessage({
                            command: 'jump',
                            file: this.getAttribute('data-file'),
                            line: this.getAttribute('data-line'),
                            functionName: method.name,
                            className: classInfo.name,
                            startLine: method.lineno,
                            endLine: method.end_lineno || null
                        });
                    };
                    methodsDiv.appendChild(methodDiv);
                });
                classDiv.appendChild(methodsDiv);
                resultsContainer.appendChild(classDiv);
            });
        }

        if (filter === 'all' || filter === 'functions') {
            if (currentStatsData.standalone_functions.length > 0) {
                functionCount = currentStatsData.standalone_functions.length;
                const functionsDiv = document.createElement('div');
                functionsDiv.className = 'stats-functions-section';

                const headerDiv = document.createElement('div');
                headerDiv.className = 'stats-section-header';
                headerDiv.innerHTML =
                    '<span class="section-title">Standalone Functions</span>' +
                    `<span class="function-count">${currentStatsData.standalone_functions.length} functions</span>`;
                functionsDiv.appendChild(headerDiv);

                const functionsListDiv = document.createElement('div');
                functionsListDiv.className = 'stats-functions-list';

                currentStatsData.standalone_functions.forEach((func) => {
                    const funcDiv = document.createElement('div');
                    funcDiv.className = 'stats-function-item';
                    funcDiv.setAttribute('data-file', func.file_path);
                    funcDiv.setAttribute('data-line', func.lineno);

                    const relPath = getRelativePath(func.file_path || '', currentFolderPath || '');
                    funcDiv.innerHTML =
                        `<div class="function-name">${func.name}</div>` +
                        `<div class="function-path">${relPath}:${func.lineno}</div>`;

                    funcDiv.onclick = function() {
                        vscode.postMessage({
                            command: 'jump',
                            file: this.getAttribute('data-file'),
                            line: this.getAttribute('data-line'),
                            functionName: func.name,
                            className: null,
                            startLine: func.lineno,
                            endLine: func.end_lineno || null
                        });
                    };
                    functionsListDiv.appendChild(funcDiv);
                });
                functionsDiv.appendChild(functionsListDiv);
                resultsContainer.appendChild(functionsDiv);
            }
        }

        if (statsStatus) {
            const filterText = filter === 'all' ? 'All' : filter === 'classes' ? 'Classes Only' : 'Standalone Functions Only';
            let statusText = `Filter: ${filterText}`;
            if (filter === 'all') {
                statusText += ` - ${classCount} classes, ${functionCount} functions`;
            } else if (filter === 'classes') {
                statusText += ` - ${classCount} classes`;
            } else if (filter === 'functions') {
                statusText += ` - ${functionCount} functions`;
            }
            statsStatus.textContent = statusText;
        }
        saveState();
    }

    window.addEventListener('message', (event) => {
        const msg = event.data;
        if (msg.type === 'initState') {
            restoreFromExternalState(msg.state);
            return;
        }
        if (msg.type === 'translationSettings') {
            const tToggle = byId('translateToggle');
            if (tToggle) {
                tToggle.checked = !!msg.enable;
            }
            return;
        }
        if (msg.type === 'status') {
            if (byId('status')) {
                byId('status').textContent = msg.message;
            }
            saveState();
            return;
        }
        if (msg.type === 'error') {
            if (byId('status')) {
                byId('status').textContent = msg.message;
            }
            if (byId('results')) {
                byId('results').innerHTML = '';
            }
            saveState();
            return;
        }
        if (msg.type === 'scopeManagerData') {
            const data = msg.data || {};
            owlIgnorePatterns = Array.isArray(data.patterns)
                ? data.patterns.map((p) => normalizePattern(p)).filter(Boolean)
                : [];
            owlIgnoreTree = data.tree || null;
            renderOwlIgnoreTree();
            renderOwlIgnorePatternPreview();
            const status = byId('owlignore-status');
            if (status) {
                const patternCount = owlIgnorePatterns.length;
                status.textContent = `.owlignore loaded (${patternCount} patterns)`;
            }
            saveState();
            return;
        }
        if (msg.type === 'scopeManagerSaved') {
            const status = byId('owlignore-status');
            if (status) {
                status.textContent = msg.message || '.owlignore updated.';
            }
            saveState();
            return;
        }
        if (msg.type === 'scopeManagerError') {
            const status = byId('owlignore-status');
            if (status) {
                status.textContent = msg.message || 'Failed to manage .owlignore.';
            }
            saveState();
            return;
        }
        if (msg.type === 'classStats') {
            currentStatsData = msg.data;
            currentFolderPath = msg.folderPath;
            const statsStatus = byId('stats-status');
            if (statsStatus) {
                const queryInfo = currentStatsData.search_query
                    ? ` (based on search: "${currentStatsData.search_query}")`
                    : ' (no search query)';
                statsStatus.textContent = `Class statistics loaded${queryInfo}`;
            }
            applyStatsFilter();
            saveState();
            return;
        }
        if (msg.type === 'results') {
            currentResults = Array.isArray(msg.results) ? msg.results : [];
            currentFolderPath = msg.folderPath || currentFolderPath;
            renderResults(currentResults, currentFolderPath || '');
            return;
        }
        if (msg.type === 'batchResults') {
            currentFolderPath = msg.folderPath || currentFolderPath;
            currentBatchResult = msg.data || { items: [] };

            const scope = getScopeFilters();
            const runRecord = {
                id: Date.now(),
                timestamp: new Date().toISOString(),
                language: byId('languageSelect')?.value || '.py',
                searchMode: scope.searchMode || 'semantic',
                includePaths: scope.includePaths,
                excludePaths: scope.excludePaths,
                stripCommentsFromEmbeddings: !!scope.stripCommentsFromEmbeddings,
                folderPath: currentFolderPath || '',
                items: Array.isArray(currentBatchResult.items) ? currentBatchResult.items : []
            };
            batchSearchHistory = [runRecord, ...batchSearchHistory].slice(0, 50);

            renderBatchRunInto(byId('exp-results'), currentBatchResult, currentFolderPath || '');
            renderBatchHistory();
            const expStatus = byId('exp-status');
            if (expStatus) {
                const count = Array.isArray(runRecord.items) ? runRecord.items.length : 0;
                expStatus.textContent = `Batch finished: ${count} queries`;
            }
            setExperimentalMode('run');
            saveState();
            return;
        }
        if (msg.type === 'batchError') {
            const expStatus = byId('exp-status');
            if (expStatus) {
                expStatus.textContent = msg.message || 'Batch search failed.';
            }
            saveState();
            return;
        }
        if (msg.type === 'historyExported') {
            const expStatus = byId('exp-status');
            if (expStatus) {
                expStatus.textContent = `History exported: ${msg.path || ''}`;
            }
            saveState();
            return;
        }
        if (msg.type === 'historyExportError') {
            const expStatus = byId('exp-status');
            if (expStatus) {
                expStatus.textContent = msg.message || 'Failed to export history.';
            }
            saveState();
        }
    });

    const helpBtn = byId('helpBtn');
    const helpModal = byId('helpModal');
    const helpContent = byId('helpContent');
    const closeHelpModal = byId('closeHelpModal');
    const repoBtn = byId('repoBtn');

    if (helpBtn && helpModal && helpContent && closeHelpModal) {
        helpBtn.onclick = async () => {
            helpModal.style.display = 'flex';
            helpContent.innerHTML = 'Loading...';
            try {
                const res = await fetch(window.HELP_HTML_URI);
                const html = await res.text();
                helpContent.innerHTML = html;
            } catch (e) {
                helpContent.innerHTML = 'Failed to load help.';
            }
        };
        closeHelpModal.onclick = () => {
            helpModal.style.display = 'none';
        };
        helpModal.onclick = (e) => {
            if (e.target === helpModal) {
                helpModal.style.display = 'none';
            }
        };
        document.addEventListener('keydown', (e) => {
            if (helpModal.style.display === 'flex' && (e.key === 'Escape' || e.key === 'Esc')) {
                helpModal.style.display = 'none';
            }
        });
    }

    if (repoBtn) {
        repoBtn.onclick = () => {
            if (window.OWL_REPO_URL) {
                vscode.postMessage({ command: 'openExternal', url: window.OWL_REPO_URL });
            }
        };
    }

    restoreFromState();
    vscode.postMessage({ command: 'requestInitState' });
    vscode.postMessage({ command: 'requestScopeManagerData', maxDepth: 4 });
};
