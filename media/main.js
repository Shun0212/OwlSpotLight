// main.js
window.onload = function() {
	const vscode = acquireVsCodeApi();
	
	// グローバル変数で現在の検索クエリと統計データを保持
	let currentSearchQuery = '';
	let currentStatsData = null;
	let currentFolderPath = null;
	
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
	    vscode.postMessage({ command: 'clearCache' });
	  };
	}
	
	document.getElementById('searchBtn').onclick = () => {
		const text = (document.getElementById('searchInput')).value;
		if (text) {
			currentSearchQuery = text; // 現在の検索クエリを保存
			vscode.postMessage({ command: 'search', text });
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
		vscode.postMessage({ command: 'getClassStats', query: query });
	};
	
	// フィルター変更時の処理
	document.getElementById('statsFilter').addEventListener('change', (e) => {
		const filterValue = e.target.value;
		console.log('Filter changed to:', filterValue);
		
		// ステータスメッセージを表示
		const statsStatus = document.getElementById('stats-status');
		if (statsStatus) {
			statsStatus.textContent = `フィルター: ${filterValue === 'all' ? 'すべて' : filterValue === 'classes' ? 'クラスのみ' : '関数のみ'}`;
		}
		
		applyStatsFilter();
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
					
					methodDiv.innerHTML = `
						<div class="method-name">${method.name}</div>
						<div class="method-path">${relPath}:${method.lineno}</div>
					`;
					
					methodDiv.onclick = function() {
						vscode.postMessage({ 
							command: 'jump', 
							file: this.getAttribute('data-file'), 
							line: this.getAttribute('data-line') 
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
							line: this.getAttribute('data-line') 
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
			const filterText = filter === 'all' ? 'すべて' : filter === 'classes' ? 'クラスのみ' : '関数のみ';
			let statusText = `フィルター: ${filterText}`;
			if (filter === 'all') {
				statusText += ` - ${classCount}クラス, ${functionCount}関数`;
			} else if (filter === 'classes') {
				statusText += ` - ${classCount}クラス`;
			} else if (filter === 'functions') {
				statusText += ` - ${functionCount}関数`;
			}
			statsStatus.textContent = statusText;
		}
	}

	// メッセージハンドラー
	window.addEventListener('message', event => {
		const msg = event.data;
		if (msg.type === 'status') {
			document.getElementById('status').textContent = msg.message;
		}
		if (msg.type === 'error') {
			document.getElementById('status').textContent = msg.message;
			document.getElementById('results').innerHTML = '';
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
				statsStatus.textContent = `クラス統計を読み込みました${queryInfo}`;
			}
			
			applyStatsFilter();
		}
		if (msg.type === 'results') {
			document.getElementById('status').textContent = msg.results.length ? '検索結果:' : '該当する関数が見つかりませんでした';
			const folderPath = msg.folderPath;
			// 結果コンテナをクリアしてから新しい結果を追加
			const resultsContainer = document.getElementById('results');
			resultsContainer.innerHTML = '';
			
			msg.results.forEach(function(r) {
				let relPath = r.file_path || r.file || '';
				if (relPath && relPath.startsWith(folderPath)) {
					relPath = relPath.substring(folderPath.length);
					if (relPath.startsWith('/') || relPath.startsWith('\\')) {
						relPath = relPath.slice(1);
					}
				}
				
				const resultDiv = document.createElement('div');
				resultDiv.setAttribute('data-file', r.file_path || r.file);
				resultDiv.setAttribute('data-line', r.lineno || r.line_number || 1);
				
				// クラス内の関数かどうかを判定
				const functionName = r.function_name || r.name || 'unknown';
				const className = r.class_name;
				let displayTitle = '';
				let titleClass = 'result-title';
				let itemClass = 'result-item';
				
				if (className) {
					// クラス内の関数の場合
					displayTitle = '<span class="class-name">' + className + '</span>.<span class="method-name">' + functionName + '</span>';
					titleClass += ' method-title';
					itemClass += ' method-item';
				} else {
					// トップレベル関数の場合
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
					vscode.postMessage({ command: 'jump', file: this.getAttribute('data-file'), line: this.getAttribute('data-line') });
				};
				
				resultsContainer.appendChild(resultDiv);
			});
		}
	});
	
	// ヘルプボタンの処理
	const helpBtn = document.getElementById('helpBtn');
	const helpModal = document.getElementById('helpModal');
	const helpContent = document.getElementById('helpContent');
	const closeHelpModal = document.getElementById('closeHelpModal');
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
};
