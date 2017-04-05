import { workspace } from 'vscode';

export interface GitConfig {
    "user.name": string,
    "user.email": string
}

export const CUSTOM_GIT_CONFIG = {
    "user.name": "custom",
    "user.email": ""
}

const CONFIG_LIST_KEY = 'configList';

export function getConfig() {
    return workspace.getConfiguration('git-autoconfig');
}

export function getConfigQueryInterval() {
    return getConfig().get<number>('queryInterval');
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