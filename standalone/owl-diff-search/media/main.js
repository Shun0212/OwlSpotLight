/* global acquireVsCodeApi */
'use strict';
(() => {
  const vscode = acquireVsCodeApi();
  const byId = id => document.getElementById(id);
  const fields = ['repo', 'query', 'comparison', 'base', 'head', 'target', 'mode', 'include', 'exclude', 'untracked', 'limit'];
  let busy = false;
  let response;
  const saved = vscode.getState() || {};
  for (const name of fields) {
    if (!(name in saved) || name === 'repo') continue;
    if (name === 'untracked') byId(name).checked = saved[name] !== false;
    else byId(name).value = String(saved[name]);
  }
  function values() {
    const state = {};
    for (const name of fields) {
      state[name] = name === 'untracked' ? byId(name).checked : byId(name).value;
    }
    return state;
  }
  function remember() { vscode.setState(values()); }
  function hints() {
    const working = byId('comparison').value === 'working';
    byId('head').disabled = working || busy;
    byId('pickHead').disabled = working || busy;
    byId('untracked').disabled = !working || busy;
    byId('base').placeholder = working ? '空欄 = HEAD' : 'main, origin/main, commit SHA';
    byId('scopeHint').textContent = {
      working: 'Base と保存済みの作業ツリーを比較します。Base の空欄は HEAD。ステージ済み・未ステージの両方が対象です。',
      range: 'Base → Head の最終的な差分を検索します。Head の空欄は HEAD。',
      history: 'Base..Head の各コミットを検索します。途中で取り消された変更も対象です。merge コミットは除外します。'
    }[byId('comparison').value];
    byId('modeHint').textContent = {
      hybrid: '変更の意味と用語の一致を組み合わせます。初回は検索エンジンの準備が必要です。',
      semantic: 'NightOwl で変更の意味を検索します。初回は検索エンジンの準備が必要です。',
      bm25: 'コード・パス・コミット件名の用語で順位付けします。モデルは不要です。',
      keyword: '入力した語がすべて含まれる変更を探します。大文字・小文字は区別しません。'
    }[byId('mode').value] + (byId('target').value === 'functions' ? ' 関数検索: Python / Java / JS / TS。' : '');
  }
  function setBusy(value) {
    busy = value;
    byId('controls').disabled = value;
    byId('search').disabled = value;
    byId('setup').disabled = value;
    byId('cancel').disabled = !value;
    byId('results').setAttribute('aria-busy', String(value));
    for (const button of document.querySelectorAll('[data-result]')) button.disabled = value;
    if (value) byId('error').hidden = true;
    hints();
  }
  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function resultButton(text, result, asDocument) {
    const button = element('button', asDocument ? 'secondary' : '', text);
    button.type = 'button';
    button.dataset.result = result.id;
    button.disabled = busy;
    button.addEventListener('click', () => vscode.postMessage({
      type: 'open', id: result.id, asDocument: Boolean(asDocument)
    }));
    return button;
  }
  function render(data) {
    response = data;
    const container = byId('results');
    container.replaceChildren();
    const seconds = (data.elapsed_ms / 1000).toFixed(1);
    byId('status').textContent = data.results.length + ' / ' + data.total + ' 件の結果 · ' +
      data.units + ' 件の変更 · ' + data.files + ' ファイル · ' + seconds + ' 秒';
    const warning = byId('warnings');
    warning.hidden = !data.warning_count;
    warning.textContent = data.warning_count
      ? '除外・注意 ' + data.warning_count + ' 件: ' + data.warnings.join(' / ') : '';
    if (!data.results.length) {
      container.appendChild(element('p', 'empty', data.units
        ? '一致する変更がありません。用語や検索方法を変えてみてください。'
        : 'この範囲には対象の変更がありません。参照やファイル条件を確認してください。'));
      return;
    }
    for (const [index, item] of data.results.entries()) {
      const card = element('article', 'result');
      const heading = element('div', 'result-heading');
      heading.append(element('span', 'rank', String(index + 1)), element('h2', '', item.path));
      card.appendChild(heading);
      if (item.commit) {
        card.appendChild(element('div', 'commit', item.commit.slice(0, 8) + '  ' + item.subject));
      }
      const details = element('div', 'result-meta');
      details.append(element('span', 'addition', '+' + item.added),
        element('span', 'deletion', '−' + item.removed),
        element('span', '', (item.side === 'old' ? '変更前 L' + item.old_line : '変更後 L' + item.new_line)));
      if (byId('query').value.trim() && data.mode !== 'keyword') {
        const score = element('span', 'score', '関連度 ' + item.score.toFixed(3));
        score.title = '検索結果を並べる相対的なスコアです。正解の確率ではありません。';
        details.appendChild(score);
      }
      card.appendChild(details);
      card.appendChild(element('div', 'symbol', item.title));
      const preview = element('details', 'preview');
      const summary = element('summary', '', 'コードを確認');
      preview.appendChild(summary);
      const pre = element('pre');
      for (const line of item.preview.split('\n')) {
        const kind = item.target === 'hunks'
          ? line.startsWith('+') ? 'line-add' : line.startsWith('-') ? 'line-remove'
            : line.startsWith('@@') ? 'line-hunk' : ''
          : '';
        pre.appendChild(element('span', kind, line + '\n'));
      }
      preview.appendChild(pre);
      if (item.preview_truncated) preview.appendChild(element('p', 'hint', 'プレビューを省略しています。diff で全文を確認できます。'));
      card.appendChild(preview);
      const actions = element('div', 'actions');
      actions.append(resultButton('diff を開く', item, false),
        resultButton(item.side === 'old' ? '変更前のコード' : 'コードを開く', item, true));
      card.appendChild(actions);
      container.appendChild(card);
    }
  }

  byId('searchForm').addEventListener('submit', event => {
    event.preventDefault();
    if (busy) return;
    remember();
    byId('error').hidden = true;
    byId('status').textContent = '差分を読み込み中…';
    vscode.postMessage({ type: 'search', values: values() });
  });
  byId('query').addEventListener('keydown', event => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      byId('searchForm').requestSubmit();
    }
  });
  for (const name of fields) byId(name).addEventListener('change', () => { remember(); hints(); });
  byId('query').addEventListener('input', remember);
  byId('setup').addEventListener('click', () => vscode.postMessage({ type: 'setup' }));
  byId('cancel').addEventListener('click', () => vscode.postMessage({ type: 'cancel' }));
  byId('logs').addEventListener('click', () => vscode.postMessage({ type: 'logs' }));
  for (const field of ['base', 'head']) {
    byId(field === 'base' ? 'pickBase' : 'pickHead').addEventListener('click', () =>
      vscode.postMessage({ type: 'pickRef', field, repo: byId('repo').value }));
  }
  window.addEventListener('message', event => {
    const message = event.data;
    if (message.type === 'workspaces') {
      const repo = byId('repo');
      const selected = repo.value || saved.repo;
      repo.replaceChildren(...message.folders.map(folder => {
        const option = element('option', '', folder.name);
        option.value = String(folder.index);
        option.title = folder.path;
        return option;
      }));
      if (Array.from(repo.options).some(option => option.value === selected)) repo.value = selected;
      byId('engineStatus').textContent = message.configured ? 'NightOwl 準備済み' : 'ローカル検索';
      if (!message.folders.length) byId('status').textContent = 'Git リポジトリのフォルダーを開いてください。';
    } else if (message.type === 'busy') {
      setBusy(message.value);
    } else if (message.type === 'progress') {
      byId('status').textContent = message.message;
    } else if (message.type === 'results') {
      byId('error').hidden = true;
      render(message.response);
    } else if (message.type === 'error') {
      byId('error').hidden = false;
      byId('error').textContent = message.message;
      byId('status').textContent = '処理を完了できませんでした。';
    } else if (message.type === 'ref' && ['base', 'head'].includes(message.field)) {
      byId(message.field).value = message.value;
      remember();
    } else if (message.type === 'seed') {
      byId('query').value = message.query;
      byId('query').focus();
      remember();
    } else if (message.type === 'configured') {
      byId('engineStatus').textContent = 'NightOwl 準備済み';
      byId('status').textContent = '準備ができました。自然言語で検索できます。';
    }
  });
  hints();
  vscode.postMessage({ type: 'ready' });
})();
