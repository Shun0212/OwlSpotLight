// main.js
window.onload = function() {
    const vscode = acquireVsCodeApi();

    // グローバル変数で現在の検索クエリと統計データ・結果を保持
    let currentSearchQuery = '';
    let currentStatsData = null;
    let currentFolderPath = null;
    let currentResults = [];
    let currentMode = 'semantic';
    // 履歴: [{text, pinned}] — 最新順 / ピン留め優先表示
    let queryHistory = [];
    const HISTORY_MAX = 20;

    // 状態保存/復元
    function collectState() {
        const activeTabBtn = document.querySelector('.tab-btn.active');
        const activeTab = activeTabBtn ? activeTabBtn.getAttribute('data-tab') : 'search';
        const searchInput = document.getElementById('searchInput')?.value || '';
        const language = document.getElementById('languageSelect')?.value || '.py';
        const statsFilter = document.getElementById('statsFilter')?.value || 'all';
        const statusText = document.getElementById('status')?.textContent || '';
        const statsStatusText = document.getElementById('stats-status')?.textContent || '';
        const translateToggle = document.getElementById('translateToggle');
        const translateEnabled = translateToggle ? !!translateToggle.checked : false;

        return {
            activeTab,
            searchInput,
            language,
            statsFilter,
            statusText,
            statsStatusText,
            translateEnabled,
            currentSearchQuery,
            currentStatsData,
            currentFolderPath,
            currentResults,
            currentMode,
            queryHistory
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
            if (typeof state.translateEnabled === 'boolean') {
                const tToggle = document.getElementById('translateToggle');
                if (tToggle) tToggle.checked = !!state.translateEnabled;
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
            if (typeof state.currentMode === 'string') {
                currentMode = state.currentMode;
                applyMode(currentMode);
            }
            if (Array.isArray(state.queryHistory)) {
                queryHistory = state.queryHistory.slice(0, HISTORY_MAX);
                renderHistory();
            }
            if (Array.isArray(state.currentResults) && state.currentResults.length > 0) {
                currentResults = state.currentResults;
                renderResults(currentResults, currentFolderPath || '');
            }
            if (state.currentStatsData) {
                currentStatsData = state.currentStatsData;
                applyStatsFilter();
            }
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
            if (typeof external.translateEnabled === 'boolean') {
                const tToggle = document.getElementById('translateToggle');
                if (tToggle) tToggle.checked = !!external.translateEnabled;
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
            if (typeof external.currentMode === 'string') {
                currentMode = external.currentMode;
                applyMode(currentMode);
            }
            if (Array.isArray(external.queryHistory)) {
                queryHistory = external.queryHistory.slice(0, HISTORY_MAX);
                renderHistory();
            }
            if (Array.isArray(external.currentResults) && external.currentResults.length > 0) {
                currentResults = external.currentResults;
                renderResults(currentResults, currentFolderPath || '');
            }
            if (external.currentStatsData) {
                currentStatsData = external.currentStatsData;
                applyStatsFilter();
            }
            // 外部復元後ローカルへも保存
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
    if (document.getElementById('startServerBtn')) {
      document.getElementById('startServerBtn').onclick = () => {
        console.log('startServerBtn clicked');
        vscode.postMessage({ command: 'startServer' });
      };
    }
        if (document.getElementById('clearCacheBtn')) {
          document.getElementById('clearCacheBtn').onclick = () => {
            console.log('clearCacheBtn clicked');
            const lang = document.getElementById('languageSelect')?.value || '.py';
            vscode.postMessage({ command: 'clearCache', lang });
          };
        }

        // サーバーステータスのポーリング（Extension Host経由）
        function checkServerStatus() {
            vscode.postMessage({ command: 'checkServerStatus' });
        }
        function setServerStatus(online) {
            const el = document.getElementById('serverStatus');
            const txt = document.getElementById('serverStatusText');
            if (!el || !txt) return;
            if (online) {
                el.className = 'server-status online';
                txt.textContent = 'Online';
            } else {
                el.className = 'server-status offline';
                txt.textContent = 'Offline';
            }
        }
        checkServerStatus();
        setInterval(checkServerStatus, 5000);

        // ローディング表示ヘルパー
        function showLoading(statusId) {
            const el = document.getElementById(statusId);
            if (el) {
                el.innerHTML = '<span class="loading-spinner"></span> Searching...';
            }
        }

        // ===== Mode selector =====
        function applyMode(mode) {
            currentMode = mode;
            document.querySelectorAll('.mode-btn').forEach(btn => {
                btn.classList.toggle('active', btn.getAttribute('data-mode') === mode);
            });
        }
        document.querySelectorAll('.mode-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const newMode = btn.getAttribute('data-mode');
                if (newMode === currentMode) return;
                applyMode(newMode);
                saveState();
                // 現在の検索クエリがあれば自動再検索
                const input = document.getElementById('searchInput');
                if (input && input.value.trim()) {
                    document.getElementById('searchBtn').click();
                }
            });
        });

        // ===== Query history =====
        function addToHistory(text) {
            if (!text) return;
            const idx = queryHistory.findIndex(h => h.text === text);
            const wasPinned = idx >= 0 ? !!queryHistory[idx].pinned : false;
            if (idx >= 0) queryHistory.splice(idx, 1);
            queryHistory.unshift({ text, pinned: wasPinned });
            // トリム: ピン留めは常に残す
            const pinned = queryHistory.filter(h => h.pinned);
            const recent = queryHistory.filter(h => !h.pinned).slice(0, HISTORY_MAX - pinned.length);
            queryHistory = [...pinned, ...recent.filter(r => !pinned.some(p => p.text === r.text))];
            renderHistory();
        }
        function togglePin(text) {
            const item = queryHistory.find(h => h.text === text);
            if (item) { item.pinned = !item.pinned; renderHistory(); saveState(); }
        }
        function renderHistory() {
            const bar = document.getElementById('historyBar');
            if (!bar) return;
            bar.innerHTML = '';
            // ピン留めを先頭に並べる
            const sorted = [...queryHistory].sort((a, b) => (b.pinned?1:0) - (a.pinned?1:0));
            sorted.slice(0, 10).forEach(item => {
                const chip = document.createElement('span');
                chip.className = 'history-chip' + (item.pinned ? ' pinned' : '');
                chip.title = item.text;
                const textEl = document.createElement('span');
                textEl.className = 'chip-text';
                textEl.textContent = item.text;
                textEl.onclick = () => {
                    const input = document.getElementById('searchInput');
                    if (input) { input.value = item.text; }
                    document.getElementById('searchBtn')?.click();
                };
                const pinEl = document.createElement('span');
                pinEl.className = 'chip-pin';
                pinEl.title = item.pinned ? 'Unpin query' : 'Pin query';
                pinEl.setAttribute('role', 'button');
                pinEl.onclick = (e) => { e.stopPropagation(); togglePin(item.text); };
                chip.appendChild(textEl);
                chip.appendChild(pinEl);
                bar.appendChild(chip);
            });
        }


        if (translateToggle) {
          translateToggle.onchange = () => {
            const enable = translateToggle.checked;
            vscode.postMessage({ command: 'updateTranslationSettings', enable });
            saveState();
          };
        }

        vscode.postMessage({ command: 'requestTranslationSettings' });
	
    document.getElementById('searchBtn').onclick = () => {
                const text = (document.getElementById('searchInput')).value;
                if (text) {
                        currentSearchQuery = text;
                        const lang = document.getElementById('languageSelect')?.value || '.py';
                        showLoading('status');
                        // 空状態を非表示
                        const empty = document.getElementById('emptyState');
                        if (empty) empty.style.display = 'none';
                        vscode.postMessage({ command: 'search', text, lang, mode: currentMode });
                        addToHistory(text);
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
                showLoading('stats-status');
                vscode.postMessage({ command: 'getClassStats', query: query, lang });
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

    // 結果描画を関数化（復元時にも利用）
    function renderResults(results, folderPath) {
        const resultsContainer = document.getElementById('results');
        const statusEl = document.getElementById('status');
        const emptyEl = document.getElementById('emptyState');

        if (results.length) {
            if (statusEl) statusEl.innerHTML = '<span class="result-count-badge">' + results.length + ' results</span>';
            if (emptyEl) emptyEl.style.display = 'none';
        } else {
            if (statusEl) statusEl.textContent = 'No matching functions found';
            if (emptyEl) emptyEl.style.display = 'flex';
        }
        if (!resultsContainer) return;

        // 空状態以外をクリア
        const children = Array.from(resultsContainer.children);
        children.forEach(c => {
            if (c.id !== 'emptyState') resultsContainer.removeChild(c);
        });

        // スコアの最大値を取得（バー表示の正規化用）
        const maxScore = results.reduce((max, r) => Math.max(max, r.score || r.similarity || 0), 0);

        results.forEach(function(r, index) {
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

            if (className) {
                displayTitle = '<span class="class-name">' + className + '</span>.<span class="method-name">' + functionName + '</span>';
                titleClass += ' method-title';
                itemClass += ' method-item';
            } else {
                displayTitle = '<span class="function-name">' + functionName + '</span>';
                titleClass += ' function-title';
                itemClass += ' function-item';
            }

            resultDiv.className = itemClass;

            // スコアバッジ
            const score = r.score || r.similarity || 0;
            let scoreClass = 'score-low';
            let barClass = 'bar-low';
            if (score >= 0.7) { scoreClass = 'score-high'; barClass = 'bar-high'; }
            else if (score >= 0.4) { scoreClass = 'score-mid'; barClass = 'bar-mid'; }
            const scoreBadge = score > 0
                ? '<span class="score-badge ' + scoreClass + '">' + (score * 100).toFixed(0) + '%</span>'
                : '';

            // ランクバッジ
            const rankClass = index < 3 ? 'result-rank rank-top' : 'result-rank';
            const rankBadge = '<span class="' + rankClass + '">' + (index + 1) + '</span>';

            // スコアバー
            const barWidth = maxScore > 0 ? ((score / maxScore) * 100).toFixed(1) : '0';
            const scoreBar = score > 0
                ? '<div class="score-bar-wrapper"><div class="score-bar ' + barClass + '" style="width:' + barWidth + '%;"></div></div>'
                : '';

            const funcKey = (r.file_path || r.file || '') + ':' + (r.lineno || r.line_number || 1) + ':' + functionName;
            resultDiv.setAttribute('data-func-key', funcKey);

            resultDiv.innerHTML = 
                '<div class="result-header">' +
                  rankBadge +
                  '<div class="' + titleClass + '">' + displayTitle + '</div>' +
                  scoreBadge +
                '</div>' +
                '<div class="result-path">' + relPath + ':' + (r.lineno || r.line_number || 1) + '</div>' +
                '<div class="result-snippet">' + (r.code ? r.code.split('\n').slice(0,2).join(' ') : '') + '</div>' +
                scoreBar +
                '<div class="result-meta"></div>' +
                '<div class="result-actions">' +
                  '<button type="button" class="result-action-btn" data-action="graph">Callers / Callees</button>' +
                  '<button type="button" class="result-action-btn" data-action="similar">Find similar</button>' +
                '</div>' +
                '<div class="result-graph-panel" style="display:none;"></div>';

            // アクションボタン: イベントは個別バインド
            const graphBtn = resultDiv.querySelector('[data-action="graph"]');
            const similarBtn = resultDiv.querySelector('[data-action="similar"]');
            const panelEl = resultDiv.querySelector('.result-graph-panel');
            if (graphBtn) {
                graphBtn.onclick = (e) => {
                    e.stopPropagation();
                    if (panelEl.style.display === 'block') {
                        panelEl.style.display = 'none';
                        graphBtn.classList.remove('active');
                        return;
                    }
                    panelEl.style.display = 'block';
                    graphBtn.classList.add('active');
                    panelEl.innerHTML = '<span class="loading-spinner"></span> Loading neighbors…';
                    const lang = document.getElementById('languageSelect')?.value || '.py';
                    // 一意のpanel IDを付けて応答を紐付け
                    const panelId = 'graph-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
                    panelEl.setAttribute('data-panel-id', panelId);
                    vscode.postMessage({
                        command: 'getGraphNeighbors',
                        panelId,
                        file: r.file_path || r.file,
                        lineno: r.lineno || r.line_number || 1,
                        name: functionName,
                        className: className || null,
                        lang
                    });
                };
            }
            if (similarBtn) {
                similarBtn.onclick = (e) => {
                    e.stopPropagation();
                    const text = r.code || '';
                    if (!text) { return; }
                    const lang = document.getElementById('languageSelect')?.value || '.py';
                    const input = document.getElementById('searchInput');
                    if (input) { input.value = (r.name || r.function_name || '') + ' similar'; }
                    vscode.postMessage({ command: 'search', text, lang, mode: currentMode });
                    addToHistory('~ ' + (r.name || r.function_name || 'selected'));
                    showLoading('status');
                };
            }

            resultDiv.onclick = function(ev) {
                // アクションパネル/ボタン上のクリックはジャンプしない
                if (ev.target.closest('.result-action-btn') || ev.target.closest('.result-graph-panel')) { return; }
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
                if (msg.type === 'runSearch') {
                        const input = document.getElementById('searchInput');
                        const langSel = document.getElementById('languageSelect');
                        if (msg.lang && langSel) {
                                for (const opt of langSel.options) {
                                        if (opt.value === msg.lang) { langSel.value = msg.lang; break; }
                                }
                        }
                        if (input && typeof msg.query === 'string') {
                                input.value = msg.query;
                                // 検索タブに切替
                                const searchTab = document.querySelector('[data-tab="search"]');
                                if (searchTab) { searchTab.click(); }
                                document.getElementById('searchBtn')?.click();
                        }
                        return;
                }
                if (msg.type === 'translationSettings') {
                        const tToggle = document.getElementById('translateToggle');
                        if (tToggle) { tToggle.checked = !!msg.enable; }
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
                        setServerStatus(msg.online);
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
            // 別ファイルからの使用数をまとめて取得（Python のみ対応）
            const lang = document.getElementById('languageSelect')?.value || '.py';
            if (lang === '.py' && currentResults.length) {
                const refs = currentResults.map(r => ({
                    file: r.file_path || r.file,
                    lineno: r.lineno || r.line_number || 1,
                    name: r.name || r.function_name || '',
                    class_name: r.class_name || null,
                }));
                vscode.postMessage({ command: 'getUsageCounts', lang, refs });
            }
        }
        if (msg.type === 'usageCounts') {
            const counts = Array.isArray(msg.counts) ? msg.counts : [];
            counts.forEach((c) => {
                const key = (c.file || '') + ':' + (c.lineno || 1) + ':' + (c.name || '');
                const item = document.querySelector('.result-item[data-func-key="' + CSS.escape(key) + '"]');
                if (!item) return;
                const meta = item.querySelector('.result-meta');
                if (!meta) return;
                const ext = c.external_callers || 0;
                const total = c.total_callers || 0;
                let badge;
                if (ext > 0) {
                    badge = '<span class="usage-badge used-external" title="Called from ' + ext + ' other file(s)">'
                        + '<span class="usage-dot"></span>used in ' + ext + ' file' + (ext === 1 ? '' : 's') + '</span>';
                } else if (total > 0) {
                    badge = '<span class="usage-badge" title="' + total + ' in-file caller(s)">'
                        + '<span class="usage-dot"></span>local only · ' + total + '</span>';
                } else {
                    badge = '<span class="usage-badge unused" title="No known callers in this workspace">'
                        + '<span class="usage-dot"></span>no callers</span>';
                }
                meta.innerHTML = badge;
            });
        }
        if (msg.type === 'graphNeighbors') {
            const panel = document.querySelector('.result-graph-panel[data-panel-id="' + msg.panelId + '"]');
            if (!panel) return;
            const buildList = (title, items) => {
                const header = '<div class="graph-section-title">' + title
                    + '<span class="count-pill">' + items.length + '</span></div>';
                if (!items.length) return header + '<div class="graph-empty">none</div>';
                const lines = items.map(it => {
                    const nm = it.name || it.function_name || '?';
                    const cls = it.class_name ? (it.class_name + '.') : '';
                    const f = (it.file || it.file_path || '');
                    let rel = f;
                    if (rel && currentFolderPath && rel.startsWith(currentFolderPath)) {
                        rel = rel.substring(currentFolderPath.length).replace(/^[\\/]/, '');
                    }
                    const extTag = it.is_external ? '<span class="graph-ext-tag">ext</span>' : '';
                    return '<div class="graph-item" data-file="' + (f || '') + '" data-line="' + (it.lineno || 1) + '">'
                        + '<span class="graph-name">' + cls + nm + '</span>'
                        + '<span class="graph-path">' + rel + ':' + (it.lineno || 1) + '</span>'
                        + extTag
                        + '</div>';
                }).join('');
                return header + lines;
            };
            if (msg.error) {
                panel.innerHTML = '<span style="color:var(--vscode-errorForeground,#f48771);">' + msg.error + '</span>';
                return;
            }
            panel.innerHTML = buildList('Callers', msg.callers || []) + buildList('Callees', msg.callees || []);
            panel.querySelectorAll('.graph-item').forEach(el => {
                el.onclick = () => {
                    vscode.postMessage({
                        command: 'jump',
                        file: el.getAttribute('data-file'),
                        line: el.getAttribute('data-line'),
                        functionName: el.querySelector('.graph-name')?.textContent || '',
                        className: null,
                        startLine: parseInt(el.getAttribute('data-line') || '1', 10),
                        endLine: null
                    });
                };
            });
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
