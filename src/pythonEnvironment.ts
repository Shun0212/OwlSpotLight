export function withUtf8PythonEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
	return {
		...env,
		PYTHONUTF8: '1',
		PYTHONIOENCODING: 'utf-8',
		PYTHONUNBUFFERED: '1'
	};
}
