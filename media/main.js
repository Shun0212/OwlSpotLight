// main.js
window.onload = function() {
	const vscode = acquireVsCodeApi();
	document.getElementById('startServerBtn').onclick = () => {
		console.log('startServerBtn clicked');
		vscode.postMessage({ command: 'startServer' });
	};
	document.getElementById('searchBtn').onclick = () => {
		const text = (document.getElementById('searchInput')).value;
		if (text) {
			vscode.postMessage({ command: 'search', text });
		}
	};
	document.getElementById('searchInput').addEventListener('keydown', (e) => {
		if (e.key === 'Enter') document.getElementById('searchBtn').click();
	});
	window.addEventListener('message', event => {
		const msg = event.data;
		if (msg.type === 'status') {
			document.getElementById('status').textContent = msg.message;
		}
		if (msg.type === 'error') {
			document.getElementById('status').textContent = msg.message;
			document.getElementById('results').innerHTML = '';
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
					if (relPath.startsWith('/') || relPath.startsWith('\\')) relPath = relPath.slice(1);
				}
				
				const resultDiv = document.createElement('div');
				resultDiv.className = 'result-item';
				resultDiv.setAttribute('data-file', r.file_path || r.file);
				resultDiv.setAttribute('data-line', r.lineno || r.line_number || 1);
				
				resultDiv.innerHTML = 
					'<div class="result-title">' + (r.function_name || r.name || 'unknown') + '</div>' +
					'<div class="result-path">' + relPath + ':' + (r.lineno || r.line_number || 1) + '</div>' +
					'<div class="result-snippet">' + (r.code ? r.code.split('\n').slice(0,2).join(' ') : '') + '</div>';
				
				resultDiv.onclick = function() {
					vscode.postMessage({ command: 'jump', file: this.getAttribute('data-file'), line: this.getAttribute('data-line') });
				};
				
				resultsContainer.appendChild(resultDiv);
			});
		}
	});
};
