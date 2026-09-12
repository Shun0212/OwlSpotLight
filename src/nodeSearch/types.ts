import type { DiffSearchMode } from '../searchTypes';

export interface EngineOptions {
    cacheDir: string;
    modelName: string;
    revision: string;
    dtype: 'q8' | 'fp32';
    batchSize: number;
    localFilesOnly?: boolean;
}
export interface SearchProgress { active: boolean; phase: string; current: number; total: number }
export type ReportProgress = (progress: SearchProgress) => void;
export const DEFAULT_MODEL = 'Shuu12121/NightOwl-CodeEmbedding';
export const DEFAULT_REVISION = 'cfc3c6d172a93c79826db380ce82b6fee377ae1c';

export interface SearchRequest {
    file?: string;
    line?: number;
    similar?: boolean;
    scope?: 'all' | 'source' | 'changed';
    search_target?: string;
    diff_range_mode?: 'branch' | 'custom' | 'working_tree';
    diff_base_ref?: string;
    diff_head_ref?: string;
    branch_ref?: string;
    first_parent?: boolean;
    include_globs?: string[];
    exclude_globs?: string[];
    directory: string;
    query: string;
    file_ext?: string;
    include_files?: string[];
    search_mode?: DiffSearchMode;
    top_k?: number;
}
export interface CodeSymbol {
    file_path: string;
    name: string;
    function_name: string;
    class_name?: string;
    symbol_kind: 'function' | 'method' | 'diff_hunk';
    snapshot_ref?: string;
    commit_hash?: string;
    search_text?: string;
    [key: string]: unknown;
    lineno: number;
    start_lineno: number;
    end_lineno: number;
    code: string;
    calls?: Array<{ name: string; receiver?: string; line: number; column: number; endLine: number; endColumn: number }>;
}
export interface SearchResult extends CodeSymbol {
    score: number;
    similarity?: number;
    bm25_score: number;
    search_mode: DiffSearchMode;
}

export interface DiffUnit extends CodeSymbol {
    path: string;
    diff_old_path: string | null;
    diff_new_path: string | null;
    commit_hash: string;
    commit_subject: string;
    commit_message: string;
    search_text: string;
    additions: number;
    deletions: number;
    added_ranges: number[][];
    removed_ranges: number[][];
}
