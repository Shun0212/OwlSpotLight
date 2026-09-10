"""Provider-independent cards backed by the same TypeScript validator as Gemini."""
import json
import os
from pathlib import Path
import subprocess
from threading import RLock


class AgentCards:
    def __init__(self):
        self._lock = RLock()
        self._snapshots = {}

    def bridge(self, request):
        script = Path(__file__).resolve().parents[1] / 'out' / 'agentCodeBridge.js'
        env = {**os.environ, 'ELECTRON_RUN_AS_NODE': '1'}
        result = subprocess.run([os.environ.get('OWLSPOTLIGHT_NODE', 'node'), str(script)],
                                input=json.dumps(request), text=True, capture_output=True,
                                timeout=15, env=env)
        if result.returncode:
            raise ValueError(result.stderr.strip()[:500] or 'Unable to read code')
        return json.loads(result.stdout)

    def read(self, event, result_id, start_line=1):
        with self._lock:
            result = self.result(event, result_id)
            key = (event['id'], result_id)
            existing = self._snapshots.get(key)
            if existing and len(existing['pages']) >= 6:
                for page in existing['pages']:
                    if page['startLine'] == start_line:
                        return page
                raise ValueError('Read limit reached for this result (6 pages).')
            if existing:
                page = self.bridge({'action': 'page', 'document': existing['document'], 'startLine': start_line})['page']
            else:
                response = self.bridge({'action': 'read', 'root': event['directory'], 'result': result, 'startLine': start_line})
                page = response['page']
                if len(self._snapshots) >= 30:
                    del self._snapshots[next(iter(self._snapshots))]
                existing = {'document': response['document'], 'pages': []}
                self._snapshots[key] = existing
            if page not in existing['pages']:
                existing['pages'].append(page)
            return page

    def annotate(self, event, result_id, title, reason, highlights):
        with self._lock:
            result = self.result(event, result_id)
            snapshot = self._snapshots.get((event['id'], result_id))
            if not snapshot:
                raise ValueError('Call read_code for this result before publishing a card.')
            pages = snapshot['pages']
            verified = self.bridge({'action': 'highlights', 'highlights': highlights, 'pages': pages})['highlights']
            if len(verified) != len(highlights):
                raise ValueError('Highlights must use inspected lines (20 lines each, 4 highlights, blue/green/amber/purple).')
            result.update(agent_card_title=title.strip()[:160], agent_relevance_reason=reason.strip()[:1000],
                          agent_highlights=verified, agent_code_pages=list(pages))
            return result

    @staticmethod
    def result(event, result_id):
        # IDs are ranks in this exact event, not arbitrary filesystem paths.
        for index, result in enumerate(event.get('results', []), 1):
            if str(index) == str(result_id):
                return result
        raise ValueError('Unknown result_id for this search event.')
