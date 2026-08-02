import * as Module from 'module'

/**
 * The `vscode` module only exists inside the extension host, so it is replaced
 * by this stub before any source module is loaded. Mocha loads this file first
 * through `--require`, which installs the hook below.
 *
 * Tests drive the stub through `stubState`, which is reset by `resetStub()`.
 */

export interface StubPosition {
    line: number
    character: number
}

export interface StubRange {
    start: StubPosition
    end: StubPosition
    contains(position: StubPosition): boolean
}

export const makeRange = (
    startLine: number,
    endLine: number,
    startCharacter = 0,
    endCharacter = 0,
): StubRange => ({
    start: { line: startLine, character: startCharacter },
    end: { line: endLine, character: endCharacter },
    contains(position: StubPosition) {
        if (position.line < this.start.line || position.line > this.end.line) {
            return false
        }
        if (
            position.line === this.start.line &&
            position.character < this.start.character
        ) {
            return false
        }
        if (
            position.line === this.end.line &&
            position.character > this.end.character
        ) {
            return false
        }
        return true
    },
})

export const stubState = {
    /** answers `vscode.commands.executeCommand` */
    executeCommand: (async () => undefined) as (
        command: string,
        ...args: unknown[]
    ) => Promise<unknown>,
    /** backs `vscode.workspace.getConfiguration().get(key)` */
    config: {} as Record<string, unknown>,
    /** every command dispatched through the stub, in order */
    commandCalls: [] as { command: string; args: unknown[] }[],
    /** messages passed to `vscode.window.showErrorMessage` */
    errorMessages: [] as string[],
    /** lines written to the output channel */
    outputLines: [] as string[],
}

export const resetStub = () => {
    stubState.executeCommand = async () => undefined
    stubState.config = {}
    stubState.commandCalls = []
    stubState.errorMessages = []
    stubState.outputLines = []
}

export const SymbolKind = {
    File: 0,
    Module: 1,
    Namespace: 2,
    Package: 3,
    Class: 4,
    Method: 5,
    Property: 6,
    Field: 7,
    Constructor: 8,
    Enum: 9,
    Interface: 10,
    Function: 11,
    Variable: 12,
    Constant: 13,
    String: 14,
    Number: 15,
    Boolean: 16,
    Array: 17,
    Object: 18,
    Key: 19,
    Null: 20,
    EnumMember: 21,
    Struct: 22,
    Event: 23,
    Operator: 24,
    TypeParameter: 25,
} as const

const vscodeStub = {
    SymbolKind,
    ProgressLocation: { Notification: 15 },
    ViewColumn: { Beside: -2 },
    commands: {
        executeCommand: (command: string, ...args: unknown[]) => {
            stubState.commandCalls.push({ command, args })
            return stubState.executeCommand(command, ...args)
        },
    },
    window: {
        createOutputChannel: () => ({
            appendLine: (line: string) => stubState.outputLines.push(line),
        }),
        showErrorMessage: (message: string) => {
            stubState.errorMessages.push(message)
        },
        showInformationMessage: () => undefined,
    },
    workspace: {
        workspaceFolders: [{ uri: { fsPath: '/ws', path: '/ws' } }],
        getConfiguration: () => ({
            get: (key: string) => stubState.config[key],
        }),
    },
    Uri: {
        file: (fsPath: string) => ({
            fsPath,
            path: fsPath,
            toString: () => `file://${fsPath}`,
        }),
    },
    // call.ts narrows call directions with `instanceof`
    CallHierarchyOutgoingCall: class {},
    CallHierarchyIncomingCall: class {},
}

interface LoaderModule {
    _load(request: string, parent: unknown, isMain: boolean): unknown
}

const loader = Module as unknown as LoaderModule
const originalLoad = loader._load
loader._load = function (request: string, parent: unknown, isMain: boolean) {
    if (request === 'vscode') return vscodeStub
    return originalLoad.call(this, request, parent, isMain)
}
