import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
	files: 'out/test/**/*.test.js',
	version: 'stable',
	launchArgs: [
		'--headless',
		'--disable-gpu',
		'--disable-dev-shm-usage',
		'--no-sandbox'
	],
	env: {
		DISPLAY: ':99'
	}
});
