// main.js
window.onload = function() {
    const vscode = acquireVsCodeApi();

    // グローバル変数で現在の検索クエリと統計データ・結果を保持
    let currentSearchQuery = '';
    let currentStatsData = null;
    let currentFolderPath = null;
    let currentResults = [];
    let owlIgnorePatterns = [];
    let owlIgnoreTree = null;
    let agentSearchEvents = [];
    let agentActivityHidden = false;

    // 状態保存/復元
    function collectState() {
        const activeTabBtn = document.querySelector('.tab-btn.active');
        const activeTab = activeTabBtn ? activeTabBtn.getAttribute('data-tab') : 'search';
        const searchInput = document.getElementById('searchInput')?.value || '';
        const language = document.getElementById('languageSelect')?.value || '.py';
        const scope = document.getElementById('scopeSelect')?.value || 'all';
        const searchMode = document.getElementById('searchModeSelect')?.value || 'semantic';
        const resultTypeFilter = document.getElementById('resultTypeFilter')?.value || 'function_level';
        const searchOptionsVisible = document.getElementById('searchOptions')?.style.display !== 'none';
        const statsFilter = document.getElementById('statsFilter')?.value || 'all';
        const statusText = document.getElementById('status')?.textContent || '';
        const statsStatusText = document.getElementById('stats-status')?.textContent || '';
        const translateToggle = document.getElementById('translateToggle');
        const translateEnabled = translateToggle ? !!translateToggle.checked : false;
        const geminiModelSelect = document.getElementById('geminiModelSelect');
        const geminiModel = geminiModelSelect ? geminiModelSelect.value : 'gemini-3.5-flash';

        return {
            activeTab,
            searchInput,
            language,
            scope,
            searchMode,
            resultTypeFilter,
            searchOptionsVisible,
            statsFilter,
            statusText,
            statsStatusText,
            translateEnabled,
            geminiModel,
            currentSearchQuery,
            currentStatsData,
            currentFolderPath,
            currentResults,
            agentSearchEvents,
            agentActivityHidden
        };
    }

    function saveState() {
        try {
            const state = collectState();
            vscode.setState(state);
            // 拡張側にも永続化
            vscode.postMessage({ command: 'persistState', state });
        } catch (e) {
            console.warn('Failed to save state', e);
        }
    }

    function restoreFromState() {
        try {
            const state = vscode.getState() || {};
            if (state.searchInput) {
                const si = document.getElementById('searchInput');
                if (si) si.value = state.searchInput;
                currentSearchQuery = state.currentSearchQuery || state.searchInput || '';
            }
            if (state.language && document.getElementById('languageSelect')) {
                const sel = document.getElementById('languageSelect');
                if (sel) sel.value = state.language;
            }
            if (state.scope && document.getElementById('scopeSelect')) {
                const sel = document.getElementById('scopeSelect');
                if (sel) sel.value = state.scope;
            }
            if (state.resultTypeFilter && document.getElementById('resultTypeFilter')) {
                const sel = document.getElementById('resultTypeFilter');
                if (sel) sel.value = state.resultTypeFilter;
            }
            if (state.searchMode && document.getElementById('searchModeSelect')) {
                const sel = document.getElementById('searchModeSelect');
                if (sel) sel.value = state.searchMode;
            }
            if (typeof state.searchOptionsVisible === 'boolean' && document.getElementById('searchOptions')) {
                document.getElementById('searchOptions').style.display = state.searchOptionsVisible ? 'grid' : 'none';
            }
            if (typeof state.translateEnabled === 'boolean') {
                const tToggle = document.getElementById('translateToggle');
                if (tToggle) tToggle.checked = !!state.translateEnabled;
            }
            if (state.geminiModel && document.getElementById('geminiModelSelect')) {
                const sel = document.getElementById('geminiModelSelect');
                if (sel) sel.value = state.geminiModel;
            }
            if (typeof state.agentActivityHidden === 'boolean') {
                agentActivityHidden = state.agentActivityHidden;
            }
            if (state.statsFilter && document.getElementById('statsFilter')) {
                const sf = document.getElementById('statsFilter');
                if (sf) sf.value = state.statsFilter;
            }
            if (state.statusText && document.getElementById('status')) {
                document.getElementById('status').textContent = state.statusText;
            }
            if (state.statsStatusText && document.getElementById('stats-status')) {
                document.getElementById('stats-status').textContent = state.statsStatusText;
            }

            // 復元: アクティブタブ
            const activeTab = state.activeTab || 'search';
            const btn = document.querySelector(`.tab-btn[data-tab="${activeTab}"]`);
            if (btn) btn.click();

            // データ復元
            currentFolderPath = state.currentFolderPath || currentFolderPath;
            if (Array.isArray(state.currentResults) && state.currentResults.length > 0) {
                currentResults = state.currentResults;
                renderResults(currentResults, currentFolderPath || '');
            }
            if (state.currentStatsData) {
                currentStatsData = state.currentStatsData;
                applyStatsFilter();
            }
            if (Array.isArray(state.agentSearchEvents) && state.agentSearchEvents.length > 0) {
                agentSearchEvents = state.agentSearchEvents;
                renderAgentSearchEvents();
            }
            syncSegmentedControls();
        } catch (e) {
            console.warn('Failed to restore state', e);
        }
    }

    function restoreFromExternalState(external) {
        if (!external) return;
        try {
            const hasLocal = vscode.getState() && (vscode.getState().searchInput || (Array.isArray(vscode.getState().currentResults) && vscode.getState().currentResults.length));
            if (hasLocal) return; // 既にローカル状態があれば上書きしない

            // 入力/トグル等
            if (external.searchInput) {
                const si = document.getElementById('searchInput');
                if (si) si.value = external.searchInput;
                currentSearchQuery = external.currentSearchQuery || external.searchInput || '';
            }
            if (external.language && document.getElementById('languageSelect')) {
                const sel = document.getElementById('languageSelect');
                if (sel) sel.value = external.language;
            }
            if (external.scope && document.getElementById('scopeSelect')) {
                const sel = document.getElementById('scopeSelect');
                if (sel) sel.value = external.scope;
            }
            if (external.resultTypeFilter && document.getElementById('resultTypeFilter')) {
                const sel = document.getElementById('resultTypeFilter');
                if (sel) sel.value = external.resultTypeFilter;
            }
            if (external.searchMode && document.getElementById('searchModeSelect')) {
                const sel = document.getElementById('searchModeSelect');
                if (sel) sel.value = external.searchMode;
            }
            if (typeof external.searchOptionsVisible === 'boolean' && document.getElementById('searchOptions')) {
                document.getElementById('searchOptions').style.display = external.searchOptionsVisible ? 'grid' : 'none';
            }
            if (typeof external.translateEnabled === 'boolean') {
                const tToggle = document.getElementById('translateToggle');
                if (tToggle) tToggle.checked = !!external.translateEnabled;
            }
            if (external.geminiModel && document.getElementById('geminiModelSelect')) {
                const sel = document.getElementById('geminiModelSelect');
                if (sel) sel.value = external.geminiModel;
            }
            if (typeof external.agentActivityHidden === 'boolean') {
                agentActivityHidden = external.agentActivityHidden;
            }
            if (external.statsFilter && document.getElementById('statsFilter')) {
                const sf = document.getElementById('statsFilter');
                if (sf) sf.value = external.statsFilter;
            }
            if (external.statusText && document.getElementById('status')) {
                document.getElementById('status').textContent = external.statusText;
            }
            if (external.statsStatusText && document.getElementById('stats-status')) {
                document.getElementById('stats-status').textContent = external.statsStatusText;
            }

            // タブ
            const activeTab = external.activeTab || 'search';
            const btn = document.querySelector(`.tab-btn[data-tab="${activeTab}"]`);
            if (btn) btn.click();

            currentFolderPath = external.currentFolderPath || currentFolderPath;
            if (Array.isArray(external.currentResults) && external.currentResults.length > 0) {
                currentResults = external.currentResults;
                renderResults(currentResults, currentFolderPath || '');
            }
            if (external.currentStatsData) {
                currentStatsData = external.currentStatsData;
                applyStatsFilter();
            }
            if (Array.isArray(external.agentSearchEvents) && external.agentSearchEvents.length > 0) {
                agentSearchEvents = external.agentSearchEvents;
                renderAgentSearchEvents();
            }
            // 外部復元後ローカルへも保存
            syncSegmentedControls();
            saveState();
        } catch (e) {
            console.warn('Failed to restore external state', e);
        }
    }
	
	// タブ切り替え機能
	const tabButtons = document.querySelectorAll('.tab-btn');
	const tabContents = document.querySelectorAll('.tab-content');
	
    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            const targetTab = button.getAttribute('data-tab');
            console.log('Tab clicked:', targetTab);
			
			// すべてのタブボタンとコンテンツの active クラスを削除
			tabButtons.forEach(btn => btn.classList.remove('active'));
			tabContents.forEach(content => {
				content.classList.remove('active');
				content.style.display = 'none';
			});
			
			// クリックされたタブをアクティブにする
			button.classList.add('active');
			const targetTabElement = document.getElementById(targetTab + '-tab');
            if (targetTabElement) {
                targetTabElement.classList.add('active');
                targetTabElement.style.display = 'block';
            }
            saveState();
        });
    });
	
	// 初期化時に最初のタブを表示
	const firstTab = document.getElementById('search-tab');
	if (firstTab) {
		firstTab.style.display = 'block';
	}
	
	// 既存のボタンイベント
        if (document.getElementById('setupAndStartBtn')) {
          document.getElementById('setupAndStartBtn').onclick = () => {
            console.log('setupAndStartBtn clicked');
            const statusEl = document.getElementById('status');
            if (statusEl) {
              statusEl.innerHTML = '<span class="loading-spinner"></span> Checking environment...';
            }
            vscode.postMessage({ command: 'setupAndStart' });
            saveState();
          };
        }
        if (document.getElementById('stopServerBtn')) {
          document.getElementById('stopServerBtn').onclick = () => {
            console.log('stopServerBtn clicked');
            vscode.postMessage({ command: 'stopServer' });
          };
        }
        if (document.getElementById('agentSetupBtn')) {
          document.getElementById('agentSetupBtn').onclick = () => {
            vscode.postMessage({ command: 'generateAgentSetup' });
          };
        }
        if (document.getElementById('agentActivityToggleBtn')) {
          document.getElementById('agentActivityToggleBtn').onclick = () => {
            agentActivityHidden = !agentActivityHidden;
            renderAgentSearchEvents();
            saveState();
          };
        }
        if (document.getElementById('searchOptionsBtn')) {
          document.getElementById('searchOptionsBtn').onclick = () => {
            const options = document.getElementById('searchOptions');
            if (!options) return;
            options.style.display = options.style.display === 'none' ? 'grid' : 'none';
            saveState();
          };
        }
        if (document.getElementById('resultTypeFilter')) {
          document.getElementById('resultTypeFilter').onchange = () => {
            renderResults(currentResults, currentFolderPath || '');
            saveState();
          };
        }
        function syncSegmentedControl(control) {
          const selectId = control.getAttribute('data-select');
          const select = selectId ? document.getElementById(selectId) : null;
          if (!select) return;
          const currentValue = select.value;
          control.querySelectorAll('.segment-btn').forEach(btn => {
            btn.classList.toggle('active', btn.getAttribute('data-value') === currentValue);
          });
        }
        function syncSegmentedControls() {
          document.querySelectorAll('.segmented-control').forEach(syncSegmentedControl);
          updateSearchBehaviorSummary();
          updateTranslationSummary();
        }
        function getGeminiModelLabel(model) {
          return {
            'gemini-3.5-flash': '3.5 Flash',
            'gemini-3.1-flash-lite': '3.1 Lite',
            'gemini-3.1-pro-preview': '3.1 Pro'
          }[model] || model;
        }
        function updateTranslationSummary() {
          const summary = document.getElementById('translationSummary');
          if (!summary) return;
          const enabled = !!document.getElementById('translateToggle')?.checked;
          const model = document.getElementById('geminiModelSelect')?.value || 'gemini-3.5-flash';
          summary.textContent = (enabled ? 'On' : 'Off') + ' · ' + getGeminiModelLabel(model);
          summary.title = summary.textContent;
        }
        function updateSearchBehaviorSummary() {
          const summary = document.querySelector('#searchBehaviorPanel .option-summary');
          if (!summary) return;
          const mode = document.getElementById('searchModeSelect')?.value || 'semantic';
          const type = document.getElementById('resultTypeFilter')?.value || 'function_level';
          const modeLabel = { semantic: 'Semantic', hybrid: 'Hybrid', bm25: 'BM25', keyword: 'Keyword' }[mode] || mode;
          const typeLabel = {
            function_level: 'Function-level',
            all: 'All',
            functions: 'Functions',
            methods: 'Methods',
            codeblocks: 'CodeBlocks'
          }[type] || type;
          summary.textContent = modeLabel + ' · ' + typeLabel;
          summary.title = summary.textContent;
        }
        function setupSegmentedControls() {
          document.querySelectorAll('.segmented-control').forEach(control => {
            const selectId = control.getAttribute('data-select');
            const select = selectId ? document.getElementById(selectId) : null;
            if (!select) return;
            control.querySelectorAll('.segment-btn').forEach(btn => {
              btn.onclick = () => {
                const value = btn.getAttribute('data-value');
                if (!value) return;
                select.value = value;
                syncSegmentedControl(control);
                select.dispatchEvent(new Event('change', { bubbles: true }));
                updateSearchBehaviorSummary();
                updateTranslationSummary();
                saveState();
              };
            });
            syncSegmentedControl(control);
          });
        }
        setupSegmentedControls();
        if (document.getElementById('refreshOwlIgnoreTreeBtn')) {
          document.getElementById('refreshOwlIgnoreTreeBtn').onclick = () => {
            vscode.postMessage({ command: 'requestOwlIgnoreSettings', maxDepth: 4 });
          };
        }
        if (document.getElementById('saveOwlIgnoreBtn')) {
          document.getElementById('saveOwlIgnoreBtn').onclick = () => {
            vscode.postMessage({ command: 'saveOwlIgnorePatterns', patterns: owlIgnorePatterns, maxDepth: 4 });
          };
        }
        if (document.getElementById('resetOwlIgnoreBtn')) {
          document.getElementById('resetOwlIgnoreBtn').onclick = () => {
            vscode.postMessage({ command: 'resetOwlIgnorePatterns' });
          };
        }

        // サーバーステータス確認（必要な操作時のみ Extension Host 経由で実行）
        function checkServerStatus() {
            vscode.postMessage({ command: 'checkServerStatus' });
        }
        function setServerStatus(online, port) {
            const el = document.getElementById('serverStatus');
            const txt = document.getElementById('serverStatusText');
            if (!el || !txt) return;
            if (online) {
                el.className = 'server-status online hidden';
                txt.textContent = port ? `Online (${port})` : 'Online';
            } else if (typeof port === 'string' && port.length > 0) {
                el.className = 'server-status pending';
                txt.textContent = port;
            } else {
                el.className = 'server-status offline';
                txt.textContent = 'Offline';
            }
        }
        function normalizeOwlIgnorePattern(pattern) {
            if (!pattern || typeof pattern !== 'string') return '';
            return pattern.trim().replace(/\\/g, '/').replace(/^\/+/, '');
        }
        function toDirPattern(relPath) {
            const normalized = normalizeOwlIgnorePattern(relPath);
            if (!normalized || normalized === '.') return '';
            return normalized.endsWith('/') ? normalized : normalized + '/';
        }
        function renderOwlIgnorePatternPreview() {
            const input = document.getElementById('owlIgnorePatternsInput');
            if (!input) return;
            input.value = owlIgnorePatterns.length ? owlIgnorePatterns.join('\n') : '(none)';
        }
        function setOwlIgnorePattern(relPath, checked) {
            const dirPattern = toDirPattern(relPath);
            if (!dirPattern) return;
            const filePattern = dirPattern.replace(/\/$/, '');
            const set = new Set(owlIgnorePatterns.map(normalizeOwlIgnorePattern).filter(Boolean));
            if (checked) {
                set.add(dirPattern);
            } else {
                set.delete(dirPattern);
                set.delete(filePattern);
            }
            owlIgnorePatterns = Array.from(set).sort((a, b) => a.localeCompare(b));
            renderOwlIgnorePatternPreview();
            updateOwlIgnoreMeta();
        }
        function flattenOwlIgnoreTree(node, depth = 0) {
            const list = [];
            if (!node || typeof node !== 'object') return list;
            if (node.rel_path && node.rel_path !== '.') {
                list.push({ ...node, depth });
            }
            if (Array.isArray(node.children)) {
                node.children.forEach(child => {
                    list.push(...flattenOwlIgnoreTree(child, depth + 1));
                });
            }
            return list;
        }
        function renderOwlIgnoreTree() {
            const tree = document.getElementById('owlIgnoreTree');
            if (!tree) {
                renderOwlIgnorePatternPreview();
                return;
            }
            tree.innerHTML = '';
            const nodes = [];
            if (owlIgnoreTree && Array.isArray(owlIgnoreTree.children)) {
                owlIgnoreTree.children.forEach(child => {
                    nodes.push(...flattenOwlIgnoreTree(child, 0));
                });
            }
            if (!nodes.length) {
                tree.textContent = 'No directories found.';
                renderOwlIgnorePatternPreview();
                return;
            }
            nodes.forEach(node => {
                const row = document.createElement('label');
                row.className = 'dir-tree-row';
                row.style.paddingLeft = Math.max(0, (node.depth || 0) * 14) + 'px';
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                const dirPattern = toDirPattern(node.rel_path);
                checkbox.checked = owlIgnorePatterns.some(pattern => {
                    const normalized = normalizeOwlIgnorePattern(pattern);
                    return normalized === normalizeOwlIgnorePattern(dirPattern) ||
                        normalized === normalizeOwlIgnorePattern(dirPattern.replace(/\/$/, ''));
                });
                checkbox.onchange = () => {
                    setOwlIgnorePattern(node.rel_path, checkbox.checked);
                    saveState();
                };
                const name = document.createElement('span');
                name.className = 'dir-tree-label';
                name.textContent = node.name;
                row.appendChild(checkbox);
                row.appendChild(name);
                tree.appendChild(row);
            });
            renderOwlIgnorePatternPreview();
        }
        function updateOwlIgnoreMeta(path) {
            const meta = document.getElementById('owlIgnoreMeta');
            if (!meta) return;
            meta.textContent = owlIgnorePatterns.length ? `${owlIgnorePatterns.length} rules` : 'No rules';
            if (path) meta.title = path;
        }
        function setOwlIgnoreSettings(info) {
            owlIgnorePatterns = Array.isArray(info?.patterns)
                ? info.patterns.map(normalizeOwlIgnorePattern).filter(Boolean)
                : [];
            owlIgnoreTree = info?.tree || null;
            renderOwlIgnoreTree();
            updateOwlIgnoreMeta(info?.path || '.owlignore');
        }
        // ローディング表示ヘルパー
        function showLoading(statusId) {
            const el = document.getElementById(statusId);
            if (el) {
                el.innerHTML = '<span class="loading-spinner"></span> Searching...';
            }
        }

        // 翻訳設定のトグル
        const translateToggle = document.getElementById('translateToggle');
        if (translateToggle) {
          translateToggle.onchange = () => {
            const enable = translateToggle.checked;
            vscode.postMessage({ command: 'updateTranslationSettings', enable });
            updateTranslationSummary();
            saveState();
          };
        }
        const geminiModelSelect = document.getElementById('geminiModelSelect');
        if (geminiModelSelect) {
          geminiModelSelect.onchange = () => {
            vscode.postMessage({
              command: 'updateTranslationSettings',
              model: geminiModelSelect.value
            });
            syncSegmentedControls();
            updateTranslationSummary();
            saveState();
          };
        }

        vscode.postMessage({ command: 'requestTranslationSettings' });
        vscode.postMessage({ command: 'requestOwlIgnoreSettings' });
	
    document.getElementById('searchBtn').onclick = () => {
                const text = (document.getElementById('searchInput')).value;
                if (text) {
                        currentSearchQuery = text;
                        const lang = document.getElementById('languageSelect')?.value || '.py';
                        const scope = document.getElementById('scopeSelect')?.value || 'all';
                        const searchMode = document.getElementById('searchModeSelect')?.value || 'semantic';
                        showLoading('status');
                        // 空状態を非表示
                        const empty = document.getElementById('emptyState');
                        if (empty) empty.style.display = 'none';
                        vscode.postMessage({ command: 'search', text, lang, scope, searchMode });
                        saveState();
                }
        };
	
	document.getElementById('searchInput').addEventListener('keydown', (e) => {
		if (e.key === 'Enter') {
			document.getElementById('searchBtn').click();
		}
	});
	
	// クラス統計関連のイベント
    document.getElementById('loadStatsBtn').onclick = () => {
                const query = currentSearchQuery || document.getElementById('searchInput').value || '';
                console.log('Loading class stats with query:', query);
                const lang = document.getElementById('languageSelect')?.value || '.py';
                const scope = document.getElementById('scopeSelect')?.value || 'all';
                const searchMode = document.getElementById('searchModeSelect')?.value || 'semantic';
                showLoading('stats-status');
                vscode.postMessage({ command: 'getClassStats', query: query, lang, scope, searchMode });
                saveState();
        };
	
	// フィルター変更時の処理
    document.getElementById('statsFilter').addEventListener('change', (e) => {
        const filterValue = e.target.value;
        console.log('Filter changed to:', filterValue);
		
		// ステータスメッセージを表示
		const statsStatus = document.getElementById('stats-status');
		if (statsStatus) {
			statsStatus.textContent = `Filter: ${filterValue === 'all' ? 'All' : filterValue === 'classes' ? 'Classes Only' : 'Standalone Functions Only'}`;
		}
        
        applyStatsFilter();
        saveState();
    });

    function applyStatsFilter() {
        if (!currentStatsData) {
            return;
        }
		
		const filter = document.getElementById('statsFilter').value;
		const resultsContainer = document.getElementById('stats-results');
		const statsStatus = document.getElementById('stats-status');
		
		resultsContainer.innerHTML = '';
		
		let classCount = 0;
		let functionCount = 0;
		
		if (filter === 'all' || filter === 'classes') {
			// クラス統計を表示
			currentStatsData.classes.forEach(classInfo => {
				classCount++;
				const classDiv = document.createElement('div');
				classDiv.className = 'stats-class-item';
				
				const headerDiv = document.createElement('div');
				headerDiv.className = 'stats-class-header';
				
				// 総合スコア（composite_score）と検索結果情報を表示
				const scoreInfo = classInfo.composite_score > 0 ? 
					`Score: ${classInfo.composite_score.toFixed(3)} (${classInfo.search_hits}/${classInfo.method_count} hits, best rank: ${classInfo.best_rank || 'N/A'})` :
					`Score: 0.000 (no search hits)`;
				
				headerDiv.innerHTML = `
					<span class="class-name">${classInfo.name}</span>
					<span class="method-count">${classInfo.method_count} methods</span>
					<span class="class-score">${scoreInfo}</span>
				`;
				classDiv.appendChild(headerDiv);
				
				// メソッド一覧
				const methodsDiv = document.createElement('div');
				methodsDiv.className = 'stats-methods';
                                classInfo.methods.forEach(method => {
                                        const methodDiv = document.createElement('div');
                                        methodDiv.className = 'stats-method-item';
                                        methodDiv.setAttribute('data-file', method.file_path);
                                        methodDiv.setAttribute('data-line', method.lineno);
					
					let relPath = method.file_path || '';
					if (relPath && relPath.startsWith(currentFolderPath)) {
						relPath = relPath.substring(currentFolderPath.length);
						if (relPath.startsWith('/') || relPath.startsWith('\\')) {
							relPath = relPath.slice(1);
						}
					}
					
                                        const rankInfo = method.search_rank ? ` (rank: ${method.search_rank})` : '';
                                        methodDiv.innerHTML = `
                                                <div class="method-name">${method.name}${rankInfo}</div>
                                                <div class="method-path">${relPath}:${method.lineno}</div>
                                        `;
					
					methodDiv.onclick = function() {
						vscode.postMessage({ 
							command: 'jump', 
							file: this.getAttribute('data-file'), 
							line: this.getAttribute('data-line'),
							functionName: method.name,
							className: classInfo.name,
							// サーバーから取得した正確な範囲情報を追加
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
			// トップレベル関数を表示
			if (currentStatsData.standalone_functions.length > 0) {
				functionCount = currentStatsData.standalone_functions.length;
				const functionsDiv = document.createElement('div');
				functionsDiv.className = 'stats-functions-section';
				
				const headerDiv = document.createElement('div');
				headerDiv.className = 'stats-section-header';
				headerDiv.innerHTML = `
					<span class="section-title">Standalone Functions</span>
					<span class="function-count">${currentStatsData.standalone_functions.length} functions</span>
				`;
				functionsDiv.appendChild(headerDiv);
				
				const functionsListDiv = document.createElement('div');
				functionsListDiv.className = 'stats-functions-list';
				
				currentStatsData.standalone_functions.forEach(func => {
					const funcDiv = document.createElement('div');
					funcDiv.className = 'stats-function-item';
					funcDiv.setAttribute('data-file', func.file_path);
					funcDiv.setAttribute('data-line', func.lineno);
					
					let relPath = func.file_path || '';
					if (relPath && relPath.startsWith(currentFolderPath)) {
						relPath = relPath.substring(currentFolderPath.length);
						if (relPath.startsWith('/') || relPath.startsWith('\\')) {
							relPath = relPath.slice(1);
						}
					}
					
					funcDiv.innerHTML = `
						<div class="function-name">${func.name}</div>
						<div class="function-path">${relPath}:${func.lineno}</div>
					`;
					
					funcDiv.onclick = function() {
						vscode.postMessage({ 
							command: 'jump', 
							file: this.getAttribute('data-file'), 
							line: this.getAttribute('data-line'),
							functionName: func.name,
							className: null, // standalone function
							// サーバーから取得した正確な範囲情報を追加
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
		
		// ステータス更新
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
        // 状態保存（フィルタ適用後）
        saveState();
    }

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function formatAgentEventTime(event) {
        const created = Number(event?.created_at || 0);
        if (!created) return '';
        try {
            return new Date(created * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } catch {
            return '';
        }
    }

    function applyAgentSearchEvent(event) {
        if (!event) return;
        if (event.kind === 'grep') {
            const statusEl = document.getElementById('status');
            if (statusEl) {
                statusEl.textContent = `Agent grep: ${event.result_count || 0} matches for "${event.query || ''}"`;
            }
            return;
        }
        const query = event.original_query || event.query || '';
        const searchInput = document.getElementById('searchInput');
        if (searchInput && query) {
            searchInput.value = query;
        }
        currentSearchQuery = query;
        if (event.file_ext && document.getElementById('languageSelect')) {
            document.getElementById('languageSelect').value = event.file_ext;
        }
        if (event.search_mode && document.getElementById('searchModeSelect')) {
            document.getElementById('searchModeSelect').value = event.search_mode;
        }
        if (event.scope && document.getElementById('scopeSelect')) {
            const normalizedScope = ['all', 'source', 'changed'].includes(event.scope) ? event.scope : 'all';
            document.getElementById('scopeSelect').value = normalizedScope;
        }
        currentFolderPath = event.directory || currentFolderPath;
        currentResults = Array.isArray(event.results) ? event.results : [];
        syncSegmentedControls();
        renderResults(currentResults, currentFolderPath || '');
        const statusEl = document.getElementById('status');
        if (statusEl) {
            statusEl.textContent = `Agent search: ${currentResults.length} results`;
        }
        saveState();
    }

    function renderAgentSearchEvents() {
        const panel = document.getElementById('agentReviewPanel');
        const list = document.getElementById('agentReviewList');
        const count = document.getElementById('agentReviewCount');
        const toggle = document.getElementById('agentActivityToggleBtn');
        if (!panel || !list) return;
        if (!agentSearchEvents.length) {
            panel.style.display = 'none';
            return;
        }
        panel.style.display = 'block';
        panel.classList.toggle('collapsed', agentActivityHidden);
        list.style.display = agentActivityHidden ? 'none' : 'flex';
        if (toggle) {
            toggle.textContent = agentActivityHidden ? 'Show' : 'Hide';
        }
        if (count) {
            count.textContent = agentSearchEvents.length + (agentSearchEvents.length === 1 ? ' event' : ' events');
        }
        list.innerHTML = '';
        agentSearchEvents.slice(0, 6).forEach(event => {
            const item = document.createElement('div');
            item.className = 'agent-review-item';
            item.setAttribute('data-event-id', event.id);
            const query = event.original_query || event.query || '';
            const resultCount = typeof event.result_count === 'number'
                ? event.result_count
                : Array.isArray(event.results) ? event.results.length : 0;
            const kind = event.kind === 'grep' ? 'grep' : 'search';
            const referencedRanks = Array.isArray(event.referenced_ranks) ? event.referenced_ranks : [];
            const referencedLocations = Array.isArray(event.referenced_locations) ? event.referenced_locations : [];
            const referencedText = referencedRanks.length
                ? 'Referenced #' + referencedRanks.join(', #')
                : referencedLocations.length
                    ? 'Referenced ' + referencedLocations.slice(0, 2).join(', ')
                    : '';
            item.innerHTML =
                '<div class="agent-review-meta">' +
                    '<span>' + escapeHtml(kind) + '</span>' +
                    '<span>' + escapeHtml(event.file_ext || '') + '</span>' +
                    '<span>' + escapeHtml(event.search_mode || '') + '</span>' +
                    '<span>' + resultCount + (kind === 'grep' ? ' matches' : ' results') + '</span>' +
                    '<span>' + escapeHtml(formatAgentEventTime(event)) + '</span>' +
                '</div>' +
                '<div class="agent-review-query">' + escapeHtml(query) + '</div>' +
                (referencedText ? '<div class="agent-reference-line">' + escapeHtml(referencedText) + '</div>' : '') +
                '<div class="agent-review-actions">' +
                    '<button type="button" class="secondary-action agent-use-query">Use</button>' +
                    (kind === 'search' ? '<button type="button" class="secondary-action agent-show-results">Show</button>' : '') +
                    '<span class="agent-feedback-status"></span>' +
                '</div>';
            item.querySelector('.agent-use-query').onclick = () => {
                const input = document.getElementById('searchInput');
                if (input) input.value = query;
                currentSearchQuery = query;
                saveState();
            };
            const showButton = item.querySelector('.agent-show-results');
            if (showButton) {
                showButton.onclick = () => {
                    applyAgentSearchEvent(event);
                };
            }
            list.appendChild(item);
        });
    }

    function addAgentSearchEvents(events) {
        if (!Array.isArray(events) || !events.length) return;
        const byId = new Map(agentSearchEvents.map(event => [event.id, event]));
        events.forEach(event => {
            if (event && typeof event.id !== 'undefined') {
                byId.set(event.id, event);
            }
        });
        agentSearchEvents = Array.from(byId.values())
            .sort((a, b) => Number(b.id || 0) - Number(a.id || 0))
            .slice(0, 20);
        renderAgentSearchEvents();
    }

    // 結果描画を関数化（復元時にも利用）
    function renderResults(results, folderPath) {
        const resultsContainer = document.getElementById('results');
        const statusEl = document.getElementById('status');
        const emptyEl = document.getElementById('emptyState');
        const resultTypeFilter = document.getElementById('resultTypeFilter')?.value || 'function_level';
        const formatScore = (value) => {
            if (typeof value !== 'number' || !Number.isFinite(value)) return null;
            return String(Math.round(Math.max(0, Math.min(1, value)) * 100));
        };
        const symbolLabel = (result) => {
            if (result.symbol_kind === 'code_block') return 'CodeBlock';
            if (result.class_name || result.symbol_kind === 'method') return 'Method';
            return 'Function';
        };
        const visibleResults = results.filter((r) => {
            if (resultTypeFilter === 'functions') return !r.class_name && r.symbol_kind !== 'code_block';
            if (resultTypeFilter === 'methods') return !!r.class_name || r.symbol_kind === 'method';
            if (resultTypeFilter === 'function_level') return r.symbol_kind !== 'code_block';
            if (resultTypeFilter === 'codeblocks') return r.symbol_kind === 'code_block';
            return true;
        });

        if (visibleResults.length) {
            if (statusEl) {
                const suffix = visibleResults.length === results.length ? '' : ' shown / ' + results.length + ' total';
                statusEl.innerHTML = '<span class="result-count-badge">' + visibleResults.length + ' results' + suffix + '</span>';
            }
            if (emptyEl) emptyEl.style.display = 'none';
        } else {
            if (statusEl) statusEl.textContent = results.length ? 'No results match the selected type filter' : 'No matching functions found';
            if (emptyEl) emptyEl.style.display = 'flex';
        }
        if (!resultsContainer) return;

        // 空状態以外をクリア
        const children = Array.from(resultsContainer.children);
        children.forEach(c => {
            if (c.id !== 'emptyState') resultsContainer.removeChild(c);
        });

        // 類似度の最大値を取得（バー表示の正規化用）
        const maxScore = visibleResults.reduce((max, r) => Math.max(max, r.hybrid_score || r.score || r.similarity || 0), 0);

        visibleResults.forEach(function(r, index) {
            let relPath = r.file_path || r.file || '';
            if (relPath && folderPath && relPath.startsWith(folderPath)) {
                relPath = relPath.substring(folderPath.length);
                if (relPath.startsWith('/') || relPath.startsWith('\\')) {
                    relPath = relPath.slice(1);
                }
            }

            const resultDiv = document.createElement('div');
            resultDiv.setAttribute('data-file', r.file_path || r.file);
            resultDiv.setAttribute('data-line', r.lineno || r.line_number || 1);

            const functionName = r.function_name || r.name || 'unknown';
            const className = r.class_name;
            let displayTitle = '';
            let titleClass = 'result-title';
            let itemClass = 'result-item';

            if (r.symbol_kind === 'code_block') {
                const staticInfo = r.python_static || {};
                const calls = Array.isArray(staticInfo.calls) && staticInfo.calls.length
                    ? ' <span class="codeblock-calls">calls: ' + escapeHtml(staticInfo.calls.slice(0, 3).join(', ')) + '</span>'
                    : '';
                displayTitle = '<span class="function-name">CodeBlock</span>' + calls;
                titleClass += ' codeblock-title';
                itemClass += ' codeblock-item';
            } else if (className) {
                displayTitle = '<span class="class-name">' + escapeHtml(className) + '</span>.<span class="method-name">' + escapeHtml(functionName) + '</span>';
                titleClass += ' method-title';
                itemClass += ' method-item';
            } else {
                displayTitle = '<span class="function-name">' + escapeHtml(functionName) + '</span>';
                titleClass += ' function-title';
                itemClass += ' function-item';
            }

            resultDiv.className = itemClass;

            // スコアバッジ。hybrid は順位用、semantic/BM25 は内訳として表示する。
            const hasScore = typeof r.score === 'number' || typeof r.similarity === 'number';
            const rankScore = typeof r.hybrid_score === 'number' ? r.hybrid_score : (typeof r.score === 'number' ? r.score : r.similarity || 0);
            const semanticScore = formatScore(r.semantic_similarity);
            const bm25Score = formatScore(r.bm25_score);
            const rankScoreText = formatScore(rankScore);
            let scoreClass = 'score-low';
            let barClass = 'bar-low';
            if (rankScore >= 0.7) { scoreClass = 'score-high'; barClass = 'bar-high'; }
            else if (rankScore >= 0.4) { scoreClass = 'score-mid'; barClass = 'bar-mid'; }
            const scoreBadge = hasScore
                ? '<span class="score-badge ' + scoreClass + '" title="Relative score used for ordering within this result set">' + rankScoreText + '</span>'
                : '';
            const staticInfo = r.python_static || {};
            const metaBadges = [];
            metaBadges.push('<span class="meta-badge type-badge">' + symbolLabel(r) + '</span>');
            if (Array.isArray(staticInfo.framework_tags)) {
                staticInfo.framework_tags.slice(0, 2).forEach(tag => metaBadges.push('<span class="meta-badge">' + escapeHtml(tag) + '</span>'));
            }
            if (Array.isArray(staticInfo.routes) && staticInfo.routes.length) {
                const route = staticInfo.routes[0];
                metaBadges.push('<span class="meta-badge">' + escapeHtml(route.method + ' ' + (route.path || '')) + '</span>');
            }
            if (r.search_mode === 'keyword') {
                const keywords = Array.isArray(r.matched_keywords) && r.matched_keywords.length
                    ? ': ' + escapeHtml(r.matched_keywords.join(', '))
                    : '';
                metaBadges.push('<span class="meta-badge score-meta" title="Literal keyword match">Keyword match' + keywords + '</span>');
            }
            if (semanticScore && r.search_mode !== 'bm25' && r.search_mode !== 'keyword') {
                metaBadges.push('<span class="meta-badge score-meta" title="Relative semantic score within this search">Semantic ' + semanticScore + '</span>');
            }
            if (bm25Score && r.bm25_score > 0) {
                metaBadges.push('<span class="meta-badge score-meta" title="Relative BM25 score within this search">BM25 ' + bm25Score + '</span>');
            }
            const metaLine = metaBadges.length ? '<div class="result-meta">' + metaBadges.join('') + '</div>' : '';

            // ランクバッジ
            const rankClass = index < 3 ? 'result-rank rank-top' : 'result-rank';
            const rankBadge = '<span class="' + rankClass + '">' + (index + 1) + '</span>';

            // 類似度バー
            const barWidth = maxScore > 0 ? ((rankScore / maxScore) * 100).toFixed(1) : '0';
            const scoreBar = hasScore
                ? '<div class="score-bar-wrapper"><div class="score-bar ' + barClass + '" style="width:' + barWidth + '%;"></div></div>'
                : '';
            const snippetSource = r.raw_code || r.code || '';
            const snippet = snippetSource
                ? escapeHtml(String(snippetSource).trim().split('\n').slice(0, 3).join('\n'))
                : '';

            resultDiv.innerHTML = 
                '<div class="result-header">' +
                  rankBadge +
                  '<div class="' + titleClass + '">' + displayTitle + '</div>' +
                  scoreBadge +
                '</div>' +
                '<div class="result-path">' + escapeHtml(relPath) + ':' + (r.lineno || r.line_number || 1) + '</div>' +
                metaLine +
                '<div class="result-snippet">' + snippet + '</div>' +
                scoreBar;

            resultDiv.onclick = function() {
                const jumpData = {
                    command: 'jump', 
                    file: this.getAttribute('data-file'), 
                    line: this.getAttribute('data-line'),
                    functionName: functionName,
                    className: className || null,
                    startLine: r.lineno || r.line_number || 1,
                    endLine: r.end_lineno || null
                };
                console.log('Jump with range info:', jumpData);
                vscode.postMessage(jumpData);
            };

            resultsContainer.appendChild(resultDiv);
        });

        // 状態保存（描画後）
        saveState();
    }

	// メッセージハンドラー
        window.addEventListener('message', event => {
                const msg = event.data;
                if (msg.type === 'initState') {
                        restoreFromExternalState(msg.state);
                        return;
                }
                if (msg.type === 'translationSettings') {
                        const tToggle = document.getElementById('translateToggle');
                        if (tToggle) { tToggle.checked = !!msg.enable; }
                        const modelSelect = document.getElementById('geminiModelSelect');
                        if (modelSelect) {
                                if (Array.isArray(msg.models) && msg.models.length) {
                                        const currentValue = msg.model || modelSelect.value;
                                        modelSelect.innerHTML = msg.models.map(model => {
                                                const label = getGeminiModelLabel(model);
                                                return '<option value="' + escapeHtml(model) + '">' + escapeHtml(label) + '</option>';
                                        }).join('');
                                        modelSelect.value = currentValue;
                                } else if (msg.model) {
                                        modelSelect.value = msg.model;
                                }
                        }
                        syncSegmentedControls();
                        updateTranslationSummary();
                }
                if (msg.type === 'translatedQuery') {
                        const el = document.getElementById('translatedQuery');
                        if (el && msg.original !== msg.translated) {
                                el.innerHTML = 'Translated: <strong>' + msg.translated + '</strong>';
                                el.style.display = 'block';
                        } else if (el) {
                                el.style.display = 'none';
                        }
                }
                if (msg.type === 'serverStatus') {
                        setServerStatus(msg.online, msg.message || msg.port);
                }
                if (msg.type === 'agentSearchEvents') {
                        addAgentSearchEvents(msg.events);
                }
                if (msg.type === 'agentFeedbackStatus') {
                        const item = document.querySelector('.agent-review-item[data-event-id="' + msg.eventId + '"]');
                        const status = item ? item.querySelector('.agent-feedback-status') : null;
                        if (status) status.textContent = msg.message || '';
                }
                if (msg.type === 'owlIgnoreSettings') {
                        setOwlIgnoreSettings(msg);
                }
                if (msg.type === 'owlIgnoreStatus' || msg.type === 'owlIgnoreError') {
                        const meta = document.getElementById('owlIgnoreMeta');
                        if (meta) meta.textContent = msg.message;
                }
                if (msg.type === 'status') {
                        const statusEl = document.getElementById('status');
                        if (statusEl) {
                                if (msg.message && msg.message.toLowerCase().includes('search')) {
                                        statusEl.innerHTML = '<span class="loading-spinner"></span> ' + msg.message;
                                } else {
                                        statusEl.textContent = msg.message;
                                }
                        }
                        saveState();
                }
        if (msg.type === 'error') {
            const statusEl = document.getElementById('status');
            if (statusEl) statusEl.textContent = msg.message;
            const emptyEl = document.getElementById('emptyState');
            if (emptyEl) emptyEl.style.display = 'flex';
            saveState();
        }
        if (msg.type === 'classStats') {
            currentStatsData = msg.data;
            currentFolderPath = msg.folderPath;
            console.log('Class stats received:', currentStatsData);
            const statsEmpty = document.getElementById('statsEmptyState');
            if (statsEmpty) statsEmpty.style.display = 'none';
			
			// ステータス表示
			const statsStatus = document.getElementById('stats-status');
			if (statsStatus) {
				const queryInfo = currentStatsData.search_query ? 
					` (query: "${currentStatsData.search_query}")` : 
					' (no search query)';
				statsStatus.textContent = `Statistics loaded${queryInfo}`;
			}
            
            applyStatsFilter();
            saveState();
        }
        if (msg.type === 'results') {
            currentResults = Array.isArray(msg.results) ? msg.results : [];
            currentFolderPath = msg.folderPath || currentFolderPath;
            renderResults(currentResults, currentFolderPath || '');
        }
    });
	
	// ヘルプボタンの処理
	const helpBtn = document.getElementById('helpBtn');
	const helpModal = document.getElementById('helpModal');
	const helpContent = document.getElementById('helpContent');
	const closeHelpModal = document.getElementById('closeHelpModal');
	const repoBtn = document.getElementById('repoBtn');
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
	    if (e.target === helpModal) { helpModal.style.display = 'none'; }
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

    // 初期復元（retainContextWhenHiddenが効くが、ウィンドウ再読み込み等にも対応）
    restoreFromState();
    // 拡張側の永続ストレージからの復元要求
    vscode.postMessage({ command: 'requestInitState' });
};
