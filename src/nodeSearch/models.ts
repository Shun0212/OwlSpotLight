import { DEFAULT_MODEL, DEFAULT_REVISION } from './types';

export const MODEL_PROFILES = [
    {
        id: DEFAULT_MODEL, label: 'NightOwl-CodeEmbedding', revision: DEFAULT_REVISION,
        dimensions: 768, maxLength: 1024, sizeMB: { q8: 152, fp32: 604 },
        checksums: {
            q8: '46297e0726f35ae86bddfb07dcf6a8d7f27d57a8c270d05215876930ef91c279',
            fp32: '0340fea4371770257b351ed35ff38d9e6b6155019d466ece3fc5abdd9032ad39',
        },
    },
    {
        id: 'Shuu12121/NightOwl-CodeEmbedding-35M', label: 'NightOwl-CodeEmbedding-35M',
        revision: 'ca36960f1d5ca8ef69a133464202e432635fc595',
        dimensions: 384, maxLength: 1024, sizeMB: { q8: 35, fp32: 137 },
        checksums: {
            q8: 'f6c8a324bac66d621df2da87a7f80c9dfa74eca4c4e9758a720b1213bdba7c11',
            fp32: 'd9918524ead0faa7ac04202dc9ee3c7de3551c5c2b528eab0041feaae4edfb04',
        },
    },
] as const;

export function modelProfile(name: string) {
    return MODEL_PROFILES.find(model => model.id === name);
}

export function modelRevision(name: string, override = ''): string {
    return override.trim() || modelProfile(name)?.revision || '';
}
