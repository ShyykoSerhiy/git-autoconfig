import { workspace } from 'vscode';

export interface GitConfig {
    "user.name": string,
    "user.email": string
}

export const CUSTOM_GIT_CONFIG: GitConfig = {
    "user.name": "custom",
    "user.email": ""
}

export const IGNORE_CURRENT_ROOT_GIT_CONFIG: GitConfig = {
    "user.name": "Ignore current root",
    "user.email": ""
}

const CONFIG_LIST_KEY = 'configList';
const IGNORE_LIST_KEY = 'ignoreRootList';

export function getConfig() {
    return workspace.getConfiguration('git-autoconfig');
}

export function getConfigQueryInterval() {
    return getConfig().get<number>('queryInterval');
}

export function getIgnoreRootList() {
    return getConfig().get<string[]>(IGNORE_LIST_KEY, []);
}

export function setIgnoreRootList(ignoreRootList: string[]): Thenable<void> {
    return getConfig().update(IGNORE_LIST_KEY, ignoreRootList, true);
}

export function addRootToIgnoreList(root: string): Thenable<void> {
    return setIgnoreRootList(Array.from(new Set([...getIgnoreRootList(), root])));
}

export function removeRootFromIgnoreList(root: string): Thenable<void> {
    return setIgnoreRootList(Array.from(new Set([...getIgnoreRootList().filter((r) => {
        return r !== root;
    })])));
}

export function isRootInIgnoreList(root: string): boolean {
    return getIgnoreRootList().indexOf(root) >= 0;
}

export function generateGitConfigKey(c: GitConfig) {
    return `${c["user.email"]} ${c["user.name"]}`;
}

export function getConfigList(): GitConfig[] {
    return getConfig().get<GitConfig[]>(CONFIG_LIST_KEY);
}

export function updateConfigList(configList: GitConfig[]): Thenable<void> {
    return getConfig().update(CONFIG_LIST_KEY, configList, true);
}