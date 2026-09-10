import { getHighlightColors, DEFAULT_HIGHLIGHT_COLORS } from './highlightColors';
import * as vscode from 'vscode';

export function graphSideBySide(resource?: vscode.Uri): boolean {
    return vscode.workspace.getConfiguration('owlspotlight', resource).get<boolean>('graph.sideBySide', true);
}

export function graphOnResultClick(resource?: vscode.Uri): boolean {
    return vscode.workspace.getConfiguration('owlspotlight', resource).get<boolean>('graph.openOnResultClick', true);
}

export function updateGraphOnResultClick(enabled: boolean, resource?: vscode.Uri): Promise<void> {
    return updateBoolean('graph.openOnResultClick', enabled, resource);
}

export function updateGraphSideBySide(enabled: boolean, resource?: vscode.Uri): Promise<void> {
    return updateBoolean('graph.sideBySide', enabled, resource);
}

async function updateBoolean(key: string, enabled: boolean, resource?: vscode.Uri): Promise<void> {
    const config = vscode.workspace.getConfiguration('owlspotlight', resource);
    const scope = config.inspect<boolean>(key);
    const target = scope?.workspaceFolderValue !== undefined ? vscode.ConfigurationTarget.WorkspaceFolder
        : scope?.workspaceValue !== undefined ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
    await config.update(key, enabled, target);
}

export function opaqueGraphColor(value: string | undefined, fallback: string): string {
    if (typeof value !== 'string') { return fallback; }
    if (/^#[\da-f]{6}$/i.test(value)) { return value; }
    const match = value.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\)$/i);
    if (!match || match.slice(1, 4).some(v => Number(v) > 255)) { return fallback; }
    return '#' + match.slice(1, 4).map(v => Number(v).toString(16).padStart(2, '0')).join('');
}

export function graphColor(value: string, fallback: string): { color: string; alpha: number } {
    const read = (input: string) => {
        const color = opaqueGraphColor(input, '');
        if (!color) { return undefined; }
        const match = input.match(/^rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\s*\)$/i);
        return { color, alpha: match ? Number(match[1]) : 1 };
    };
    return read(value) || read(fallback)!;
}

export function graphSettings(resource?: vscode.Uri) {
    const colors = getHighlightColors(resource);
    const fills = {
        function: graphColor(colors.standaloneFunction, DEFAULT_HIGHLIGHT_COLORS.standaloneFunction),
        method: graphColor(colors.classMethod, DEFAULT_HIGHLIGHT_COLORS.classMethod),
        class: graphColor(colors.classHeader, DEFAULT_HIGHLIGHT_COLORS.classHeader),
        classBody: graphColor(colors.classBody, DEFAULT_HIGHLIGHT_COLORS.classBody),
        selection: graphColor(colors.jumpLine, DEFAULT_HIGHLIGHT_COLORS.jumpLine)
    };
    return { sideBySide: graphSideBySide(resource), fills, functionColors: [
        fills.function.color, fills.method.color, fills.class.color, '#e86886', '#ac80e8',
        '#26b8bb', '#d6b63e', '#e581c2', '#8497e8', '#b0b958'
    ], palette: {
        low: fills.function.color, middle: fills.method.color,
        high: fills.class.color, selected: fills.selection.color
    } };
}
