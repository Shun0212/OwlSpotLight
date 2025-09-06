// main.js
window.onload = function() {
    const vscode = acquireVsCodeApi();

    // グローバル変数で現在の検索クエリと統計データ・結果を保持
    let currentSearchQuery = '';
    let currentStatsData = null;
    let currentFolderPath = null;
    let currentResults = [];

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
            currentResults
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

        // 翻訳設定のトグル
        const translateToggle = document.getElementById('translateToggle');
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
                        currentSearchQuery = text; // 現在の検索クエリを保存
                        const lang = document.getElementById('languageSelect')?.value || '.py';
                        vscode.postMessage({ command: 'search', text, lang });
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
        if (statusEl) statusEl.textContent = results.length ? 'Search Results:' : 'No matching functions found';
        if (!resultsContainer) return;
        resultsContainer.innerHTML = '';

        results.forEach(function(r) {
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

            resultDiv.innerHTML = 
                '<div class="' + titleClass + '">' + displayTitle + '</div>' +
                '<div class="result-path">' + relPath + ':' + (r.lineno || r.line_number || 1) + '</div>' +
                '<div class="result-snippet">' + (r.code ? r.code.split('\n').slice(0,2).join(' ') : '') + '</div>';

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
                }
                if (msg.type === 'status') {
                        document.getElementById('status').textContent = msg.message;
                        saveState();
                }
        if (msg.type === 'error') {
            document.getElementById('status').textContent = msg.message;
            document.getElementById('results').innerHTML = '';
            saveState();
        }
        if (msg.type === 'classStats') {
            currentStatsData = msg.data;
            currentFolderPath = msg.folderPath;
            console.log('Class stats received:', currentStatsData);
			
			// ステータス表示
			const statsStatus = document.getElementById('stats-status');
			if (statsStatus) {
				const queryInfo = currentStatsData.search_query ? 
					` (based on search: "${currentStatsData.search_query}")` : 
					' (no search query)';
				statsStatus.textContent = `Class statistics loaded${queryInfo}`;
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
