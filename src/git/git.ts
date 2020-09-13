/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import * as fs from 'fs';
import * as path from 'path';
import * as cp from 'child_process';
import { EventEmitter, Event } from 'vscode';

export function denodeify<R>(fn: Function): (...args:any[]) => Promise<R> {
    return (...args) => new Promise((c, e) => fn(...args, (err:any, r: R) => err ? e(err) : c(r)));
}
export interface IDisposable {
    dispose(): void;
}

export function dispose<T extends IDisposable>(disposables: T[]): T[] {
    disposables.forEach(d => d.dispose());
    return [];
}

export function toDisposable(dispose: () => void): IDisposable {
    return { dispose };
}

const readdir = denodeify<string[]>(fs.readdir);
const readfile = denodeify<string>(fs.readFile);

export interface IGit {
    path: string;
    version: string;
}

export interface PushOptions {
    setUpstream?: boolean;
}

export interface IFileStatus {
    x: string;
    y: string;
    path: string;
    rename?: string;
}

export interface Remote {
    name: string;
    url: string;
}

export enum RefType {
    Head,
    RemoteHead,
    Tag
}

export interface Ref {
    type: RefType;
    name?: string;
    commit?: string;
    remote?: string;
}

export interface Branch extends Ref {
    upstream?: string;
    ahead?: number;
    behind?: number;
}

function parseVersion(raw: string): string {
    return raw.replace(/^git version /, '');
}

function findSpecificGit(path: string): Promise<IGit> {
    return new Promise<IGit>((c, e) => {
        const buffers: Buffer[] = [];
        const child = cp.spawn(path, ['--version']);
        child.stdout.on('data', (b: Buffer) => buffers.push(b));
        child.on('error', e);
        child.on('exit', code => code ? e(new Error('Not found')) : c({ path, version: parseVersion(Buffer.concat(buffers).toString('utf8').trim()) }));
    });
}

function findGitDarwin(): Promise<IGit> {
    return new Promise<IGit>((c, e) => {
        cp.exec('which git', (err, gitPathBuffer) => {
            if (err) {
                return e('git not found');
            }

            const path = gitPathBuffer.toString().replace(/^\s+|\s+$/g, '');

            function getVersion(path: string) {
                // make sure git executes
                cp.exec('git --version', (err, stdout: Buffer | string) => {
                    if (err) {
                        return e('git not found');
                    }

                    return c({ path, version: parseVersion(stdout.toString('utf8').trim()) });
                });
            }

            if (path !== '/usr/bin/git') {
                return getVersion(path);
            }

            // must check if XCode is installed
            cp.exec('xcode-select -p', (err: any) => {
                if (err && err.code === 2) {
                    // git is not installed, and launching /usr/bin/git
                    // will prompt the user to install it

                    return e('git not found');
                }

                getVersion(path);
            });
        });
    });
}

function findSystemGitWin32(base: string): Promise<IGit> {
    if (!base) {
        return Promise.reject<IGit>('Not found');
    }

    return findSpecificGit(path.join(base, 'Git', 'cmd', 'git.exe'));
}

function findGitHubGitWin32(): Promise<IGit> {
    const github = path.join(process.env['LOCALAPPDATA'], 'GitHub');

    return readdir(github).then(children => {
        const git = children.filter(child => /^PortableGit/.test(child))[0];

        if (!git) {
            return Promise.reject<IGit>('Not found');
        }

        return findSpecificGit(path.join(github, git, 'cmd', 'git.exe'));
    });
}

function findGitWin32(): Promise<IGit> {
    return findSystemGitWin32(process.env['ProgramW6432'])
        .then(void 0, () => findSystemGitWin32(process.env['ProgramFiles(x86)']))
        .then(void 0, () => findSystemGitWin32(process.env['ProgramFiles']))
        .then(void 0, () => findSpecificGit('git'))
        .then(void 0, () => findGitHubGitWin32());
}

export function findGit(hint: string | undefined): Promise<IGit> {
    var first = hint ? findSpecificGit(hint) : Promise.reject<IGit>(null);

    return first.then(void 0, () => {
        switch (process.platform) {
            case 'darwin': return findGitDarwin();
            case 'win32': return findGitWin32();
            default: return findSpecificGit('git');
        }
    });
}


export interface IExecutionResult {
    exitCode: number;
    stdout: string;
    stderr: string;
}

export async function exec(child: cp.ChildProcess): Promise<IExecutionResult> {
    const disposables: IDisposable[] = [];

    const once = (ee: NodeJS.EventEmitter, name: string, fn: Function) => {
        ee.once(name, fn);
        disposables.push(toDisposable(() => ee.removeListener(name, fn)));
    };

    const on = (ee: NodeJS.EventEmitter, name: string, fn: Function) => {
        ee.on(name, fn);
        disposables.push(toDisposable(() => ee.removeListener(name, fn)));
    };

    const [exitCode, stdout, stderr] = await Promise.all<any>([
        new Promise<number>((c, e) => {
            once(child, 'error', e);
            once(child, 'exit', c);
        }),
        new Promise<string>(c => {
            const buffers: string[] = [];
            on(child.stdout, 'data', (b:string) => buffers.push(b));
            once(child.stdout, 'close', () => c(buffers.join('')));
        }),
        new Promise<string>(c => {
            const buffers: string[] = [];
            on(child.stderr, 'data', (b:string) => buffers.push(b));
            once(child.stderr, 'close', () => c(buffers.join('')));
        })
    ]);

    dispose(disposables);

    return { exitCode, stdout, stderr };
}

export interface IGitErrorData {
    error?: Error;
    message?: string;
    stdout?: string;
    stderr?: string;
    exitCode?: number;
    gitErrorCode?: string;
    gitCommand?: string;
}

export class GitError {

    error?: Error;
    message: string;
    stdout?: string;
    stderr?: string;
    exitCode?: number;
    gitErrorCode?: string;
    gitCommand?: string;

    constructor(data: IGitErrorData) {
        if (data.error) {
            this.error = data.error;
            this.message = data.error.message;
        } else {
            this.error = void 0;
        }

        this.message = this.message || data.message || 'Git error';
        this.stdout = data.stdout;
        this.stderr = data.stderr;
        this.exitCode = data.exitCode;
        this.gitErrorCode = data.gitErrorCode;
        this.gitCommand = data.gitCommand;
    }

    toString(): string {
        let result = this.message + ' ' + JSON.stringify({
            exitCode: this.exitCode,
            gitErrorCode: this.gitErrorCode,
            gitCommand: this.gitCommand,
            stdout: this.stdout,
            stderr: this.stderr
        }, [], 2);

        if (this.error) {
            result += (<any>this.error).stack;
        }

        return result;
    }
}

export interface IGitOptions {
    gitPath: string;
    version: string;
}

export const GitErrorCodes = {
    BadConfigFile: 'BadConfigFile',
    AuthenticationFailed: 'AuthenticationFailed',
    NoUserNameConfigured: 'NoUserNameConfigured',
    NoUserEmailConfigured: 'NoUserEmailConfigured',
    NoRemoteRepositorySpecified: 'NoRemoteRepositorySpecified',
    NotAGitRepository: 'NotAGitRepository',
    NotAtRepositoryRoot: 'NotAtRepositoryRoot',
    Conflict: 'Conflict',
    UnmergedChanges: 'UnmergedChanges',
    PushRejected: 'PushRejected',
    RemoteConnectionError: 'RemoteConnectionError',
    DirtyWorkTree: 'DirtyWorkTree',
    CantOpenResource: 'CantOpenResource',
    GitNotFound: 'GitNotFound',
    CantCreatePipe: 'CantCreatePipe',
    CantAccessRemote: 'CantAccessRemote',
    RepositoryNotFound: 'RepositoryNotFound'
};

export class Git {
    private gitPath: string;
    private version: string;

    private _onOutput = new EventEmitter<string>();
    get onOutput(): Event<string> { return this._onOutput.event; }

    constructor(options: IGitOptions) {
        this.gitPath = options.gitPath;
        this.version = options.version;
    }

    open(repository: string, env: any = {}): Repository {
        return new Repository(this, repository, env);
    }

    async getRepositoryRoot(path: string): Promise<string> {
        const result = await this.exec(path, ['rev-parse', '--show-toplevel']);
        return result.stdout.trim();
    }

    async exec(cwd: string, args: string[], options: any = {}): Promise<IExecutionResult> {
        options = Object.assign({ cwd }, options || {});
        return await this._exec(args, options);
    }

    stream(cwd: string, args: string[], options: any = {}): cp.ChildProcess {
        options = Object.assign({ cwd }, options || {});
        return this.spawn(args, options);
    }

    private async _exec(args: string[], options: any = {}): Promise<IExecutionResult> {
        const child = this.spawn(args, options);

        if (options.input) {
            child.stdin.end(options.input, 'utf8');
        }

        const result = await exec(child);

        if (result.exitCode) {
            let gitErrorCode: string | undefined = void 0;

            if (/Authentication failed/.test(result.stderr)) {
                gitErrorCode = GitErrorCodes.AuthenticationFailed;
            } else if (/Not a git repository/.test(result.stderr)) {
                gitErrorCode = GitErrorCodes.NotAGitRepository;
            } else if (/bad config file/.test(result.stderr)) {
                gitErrorCode = GitErrorCodes.BadConfigFile;
            } else if (/cannot make pipe for command substitution|cannot create standard input pipe/.test(result.stderr)) {
                gitErrorCode = GitErrorCodes.CantCreatePipe;
            } else if (/Repository not found/.test(result.stderr)) {
                gitErrorCode = GitErrorCodes.RepositoryNotFound;
            } else if (/unable to access/.test(result.stderr)) {
                gitErrorCode = GitErrorCodes.CantAccessRemote;
            }

            if (options.log !== false) {
                this.log(`${result.stderr}\n`);
            }

            return Promise.reject<IExecutionResult>(new GitError({
                message: 'Failed to execute git',
                stdout: result.stdout,
                stderr: result.stderr,
                exitCode: result.exitCode,
                gitErrorCode,
                gitCommand: args[0]
            }));
        }

        return result;
    }

    spawn(args: string[], options: any = {}): cp.ChildProcess {
        if (!this.gitPath) {
            throw new Error('git could not be found in the system.');
        }

        if (!options) {
            options = {};
        }

        if (!options.stdio && !options.input) {
            options.stdio = ['ignore', null, null]; // Unless provided, ignore stdin and leave default streams for stdout and stderr
        }

        options.env = Object.assign({}, process.env, options.env || {}, {
            VSCODE_GIT_COMMAND: args[0],
            LANG: 'en_US.UTF-8'
        });

        if (options.log !== false) {
            this.log(`git ${args.join(' ')}\n`);
        }

        return cp.spawn(this.gitPath, args, options);
    }

    private log(output: string): void {
        this._onOutput.fire(output);
    }
}

export class Repository {
    constructor(
        private _git: Git,
        private repositoryRoot: string,
        private env: any = {}
    ) { }

    get git(): Git {
        return this._git;
    }

    get root(): string {
        return this.repositoryRoot;
    }

    async exec(args: string[], options: any = {}): Promise<IExecutionResult> {
        options.env = Object.assign({}, options.env || {});
        options.env = Object.assign(options.env, this.env);

        return await this.git.exec(this.repositoryRoot, args, options);
    }

    async configGet(scope: string, key: string,  options: any = {}): Promise<string> {
        const args = ['config'];

        if (scope) {
            args.push(`--${scope}`);
        }

        args.push('--get')

        args.push(key);

        const result = await this.exec(args, options);
        return result.stdout;
    }

    async config(scope: string, key: string, value: any, options: any = {}): Promise<string> {
        const args = ['config'];

        if (scope) {
            args.push(`--${scope}`);
        }

        args.push(key);

        if (value) {
            args.push(value);
        }

        const result = await this.exec(args, options);
        return result.stdout;
    }

    async getStatus(): Promise<IFileStatus[]> {
        const executionResult = await this.exec(['status', '-z', '-u']);
        const status = executionResult.stdout;
        const result: IFileStatus[] = [];
        let current: IFileStatus;
        let i = 0;

        function readName(): string {
            const start = i;
            let c: string;
            while ((c = status.charAt(i)) !== '\u0000') { i++; }
            return status.substring(start, i++);
        }

        while (i < status.length) {
            current = {
                x: status.charAt(i++),
                y: status.charAt(i++),
                path: ''
            };

            i++;

            if (current.x === 'R') {
                current.rename = readName();
            }

            current.path = readName();

            // If path ends with slash, it must be a nested git repo
            if (current.path[current.path.length - 1] === '/') {
                continue;
            }

            result.push(current);
        }

        return result;
    }
}