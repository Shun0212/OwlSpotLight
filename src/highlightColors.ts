import * as vscode from 'vscode';

export const DEFAULT_HIGHLIGHT_COLORS = {
    jumpLine: 'rgba(255,200,0,0.35)',
    standaloneFunction: 'rgba(255,140,0,0.18)',
    classMethod: 'rgba(0,140,255,0.18)',
    classBody: 'rgba(0,200,100,0.08)',
    classHeader: 'rgba(0,200,100,0.20)',
};

export function getHighlightColors(resource?: vscode.Uri) {
    const configured = vscode.workspace.getConfiguration('owlspotlight', resource).get<Record<string, string>>('highlightColors', {});
    return {
        jumpLine: configured.jumpLine ?? DEFAULT_HIGHLIGHT_COLORS.jumpLine,
        standaloneFunction: configured.standaloneFunction ?? DEFAULT_HIGHLIGHT_COLORS.standaloneFunction,
        classMethod: configured.classMethod ?? DEFAULT_HIGHLIGHT_COLORS.classMethod,
        classBody: configured.classBody ?? DEFAULT_HIGHLIGHT_COLORS.classBody,
        classHeader: configured.classHeader ?? DEFAULT_HIGHLIGHT_COLORS.classHeader,
    };
}

// rgba文字列のアルファ値を変倍してボーダー色を自動導出する
export function deriveBorderColor(rgba: string): string {
	const m = rgba.match(/rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)/);
	if (!m) { return rgba; }
	const newAlpha = Math.min(1.0, parseFloat(m[4]) * 2.5).toFixed(2);
	return `rgba(${m[1]},${m[2]},${m[3]},${newAlpha})`;
}

