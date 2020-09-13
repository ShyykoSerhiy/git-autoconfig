'use strict';
import * as vscode from 'vscode';
import { Git, findGit, Repository, GitError } from './git/git';
import {
    getConfigList,
    updateConfigList,
    CUSTOM_GIT_CONFIG,
    IGNORE_CURRENT_ROOT_GIT_CONFIG,
    GitConfig,
    generateGitConfigKey,
    getConfigQueryInterval,
    removeRootFromIgnoreList,
    addRootToIgnoreList,
    isRootInIgnoreList
} from './config/config';
import {
    COMMAND_GET_CONFIG,
    COMMAND_SET_CONFIG,
    COMMAND_IGNORE_ROOT,
    COMMAND_UNIGNORE_ROOT
} from './consts';
const MESSAGE_PREFIX = "git-autoconfig: ";

let timeoutId: NodeJS.Timer;

// this method is called when your extension is activated
// extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext) {
    const gitConf = await findGit(undefined);
    const git = new Git({ gitPath: gitConf.path, version: gitConf.version });

    /**
     * Check for local config.
     */
    const checkForLocalConfig = async () => {
        const repositoryRoot = await findRepositoryRoot(false);
        const repository = new Repository(git, repositoryRoot);
        try {
            // return early if the root is in ignore list 
            if (isRootInIgnoreList(repositoryRoot)) {
                return;
            }

            if (repositoryRoot) {
                const gitConfig = await getGitConfig(repository, false);
                if (!gitConfig) {
                    console.log(`${MESSAGE_PREFIX}Config doesn exists.`);
                    await setGitConfig();
                } else {
                    console.log(`${MESSAGE_PREFIX}Config already exists. : ${JSON.stringify(gitConfig, null, 2)}`);
                }
            } else {
                //console.log(`${MESSAGE_PREFIX}Failed to get repository root.`);
            }
        } catch (_ignorred) {
            console.log(`${MESSAGE_PREFIX}Error while trying to checkForLocalConfig. ${JSON.stringify(_ignorred)}`);
        } finally {
            timeoutId = setTimeout(checkForLocalConfig, getConfigQueryInterval());
        }
    }
    timeoutId = setTimeout(checkForLocalConfig, 0);

    /**
     * Finds repositoryRoot by vscode.workspace.rootPath
     * @param showError if to show  error messages 
     */
    const findRepositoryRoot = async (showError = true) => {
        let repositoryRoot: string;
        try {
            repositoryRoot = await git.getRepositoryRoot(vscode.workspace.rootPath);
        } catch (e) {
            if (showError) {
                let errorMessage = `${MESSAGE_PREFIX}Failed to get git repository root.`;
                if (e instanceof GitError) {
                    errorMessage += e.gitErrorCode;
                }
                vscode.window.showWarningMessage(errorMessage);
            }
            return null;
        }
        return repositoryRoot;
    };
    /**
     * Gets config git config from git repository(local)
     * @param repository git repository
     * @param showMessages if to show info and error messages 
     */
    const getGitConfig = async (repository: Repository, showMessages = true) => {
        try {
            const userEmail = (await repository.configGet('local', 'user.email', {})).trim();
            const userName = (await repository.configGet('local', 'user.name', {})).trim();
            showMessages && vscode.window.showInformationMessage(`${MESSAGE_PREFIX}user.email=${userEmail} user.name=${userName}`);
            const result: GitConfig = { "user.email": userEmail, "user.name": userName };
            return result;
        } catch (e) {
            showMessages && vscode.window.showWarningMessage(`${MESSAGE_PREFIX}user.email or user.name is not set locally. You can set it using command '' `);
        }
        return null;
    }

    const ignoreCurrentRoot = async () => {
        const repositoryRoot = await findRepositoryRoot();
        if (!repositoryRoot) {
            return;
        }
        await addRootToIgnoreList(repositoryRoot);
    }

    const unignoreCurrentRoot = async () => {
        const repositoryRoot = await findRepositoryRoot();
        if (!repositoryRoot) {
            return;
        }
        await removeRootFromIgnoreList(repositoryRoot);
    }

    const setGitConfig = async () => {
        const repositoryRoot = await findRepositoryRoot();
        if (!repositoryRoot) {
            return;
        }
        const repository = new Repository(git, repositoryRoot);
        const configList = getConfigList();
        const setGitConfig = async (newConfig: GitConfig) => {
            try {
                const newConfigKey = generateGitConfigKey(newConfig);
                if (!configList.find((c) => generateGitConfigKey(c) === newConfigKey)) {
                    configList.push(newConfig);
                    await updateConfigList(configList);
                };

                await repository.config('local', 'user.email', newConfig['user.email']);
                await repository.config('local', 'user.name', newConfig['user.name']);
            } catch (e) {
                vscode.window.showErrorMessage('Failed to set local git config.', e);
                return false;
            }
            vscode.window.showInformationMessage('Local git config successfully set.')
            return true;
        };

        const customSetGitConfig = async () => {
            const userEmail = await vscode.window.showInputBox({ ignoreFocusOut: true, placeHolder: 'user.email like : "Marvolo@Riddle.Tom"', prompt: 'Enter email that you use for your git account.' });
            if (!userEmail) {
                vscode.window.showInformationMessage('user.email should not be empty');
            }
            const userName = await vscode.window.showInputBox({ ignoreFocusOut: true, placeHolder: 'user.name like : "Tom Marvolo Riddle"', prompt: 'Enter name that you use for your git account.' });
            const newConfig: GitConfig = {
                "user.email": userEmail,
                "user.name": userName
            };
            await setGitConfig(newConfig);
        }
        if (configList.length) {
            const map: Map<string, GitConfig> = configList.concat(CUSTOM_GIT_CONFIG, IGNORE_CURRENT_ROOT_GIT_CONFIG).reduce((map, c) => {
                map.set(generateGitConfigKey(c), c);
                return map;
            }, new Map<string, GitConfig>());
            const pick = await vscode.window.showQuickPick(Array.from(map.keys()), { ignoreFocusOut: true, placeHolder: 'Select one of previous configs or new custom one or ignore current root.' });
            if (pick === generateGitConfigKey(CUSTOM_GIT_CONFIG)) {
                await customSetGitConfig();
            } else if (pick === generateGitConfigKey(IGNORE_CURRENT_ROOT_GIT_CONFIG)) {
                await vscode.commands.executeCommand(COMMAND_IGNORE_ROOT);
            } else {
                await setGitConfig(map.get(pick));
            }
        } else {
            await customSetGitConfig();
        }
    };

    //commands

    const getConfigCommand = vscode.commands.registerCommand(COMMAND_GET_CONFIG, async () => {
        const repositoryRoot = await findRepositoryRoot();
        if (!repositoryRoot) {
            return;
        }
        const repository = new Repository(git, repositoryRoot);
        getGitConfig(repository);
    });

    const setConfigCommand = vscode.commands.registerCommand(COMMAND_SET_CONFIG, async () => {
        await setGitConfig();
    });

    const ignoreRootCommand = vscode.commands.registerCommand(COMMAND_IGNORE_ROOT, async () => {
        await ignoreCurrentRoot();
    });

    const unignoreRootCommand = vscode.commands.registerCommand(COMMAND_UNIGNORE_ROOT, async () => {
        await unignoreCurrentRoot();
    });

    context.subscriptions.push(
        getConfigCommand,
        setConfigCommand,
        ignoreRootCommand,
        unignoreRootCommand
    );
}

// this method is called when your extension is deactivated
export function deactivate() {
    clearTimeout(timeoutId);
}
