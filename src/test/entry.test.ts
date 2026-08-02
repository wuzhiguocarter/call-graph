// the vscode stub installs a module hook and must be loaded before any source
import { makeRange, resetStub, stubState, SymbolKind } from './vscodeStub'
import { describe, it, beforeEach } from 'node:test'
import * as assert from 'node:assert'
import type * as vscode from 'vscode'
import {
    findEnclosingSymbol,
    resolveCallEntry,
    resolveTypeEntry,
} from '../entry'

const URI = {
    fsPath: '/ws/a.ts',
    path: '/ws/a.ts',
    toString: () => 'file:///ws/a.ts',
}

const editorAt = (line: number, character = 0) =>
    ({
        document: { uri: URI },
        selection: { active: { line, character } },
    }) as unknown as vscode.TextEditor

const hierarchyItem = (name: string) => ({ name }) as vscode.CallHierarchyItem

const symbol = (
    name: string,
    kind: number,
    startLine: number,
    endLine: number,
    children: vscode.DocumentSymbol[] = [],
    selectionLine = startLine,
) =>
    ({
        name,
        kind,
        range: makeRange(startLine, endLine, 0, 999),
        selectionRange: makeRange(selectionLine, selectionLine, 4, 20),
        children,
    }) as unknown as vscode.DocumentSymbol

/** positions where prepare succeeds, keyed by line number */
const prepareSucceedsAt = (
    lines: number[],
    symbols: vscode.DocumentSymbol[] = [],
) => {
    stubState.executeCommand = async (command, ...args) => {
        if (command === 'vscode.executeDocumentSymbolProvider') return symbols
        const position = args[1] as vscode.Position
        return lines.includes(position.line) ? [hierarchyItem('resolved')] : []
    }
}

const prepareCalls = () =>
    stubState.commandCalls.filter(c => c.command.startsWith('vscode.prepare'))

describe('findEnclosingSymbol', () => {
    beforeEach(resetStub)

    const kinds = new Set([SymbolKind.Function, SymbolKind.Method])

    it('returns the innermost matching symbol', () => {
        const inner = symbol('inner', SymbolKind.Method, 5, 8)
        const outer = symbol('outer', SymbolKind.Function, 1, 20, [inner])

        const found = findEnclosingSymbol([outer], { line: 6 } as never, kinds)
        assert.strictEqual(found?.name, 'inner')
    })

    it('falls back to the outer symbol when the position misses the inner one', () => {
        const inner = symbol('inner', SymbolKind.Method, 5, 8)
        const outer = symbol('outer', SymbolKind.Function, 1, 20, [inner])

        const found = findEnclosingSymbol([outer], { line: 15 } as never, kinds)
        assert.strictEqual(found?.name, 'outer')
    })

    it('descends through containers whose kind does not match', () => {
        const method = symbol('method', SymbolKind.Method, 5, 8)
        const klass = symbol('Klass', SymbolKind.Class, 1, 20, [method])

        const found = findEnclosingSymbol([klass], { line: 6 } as never, kinds)
        assert.strictEqual(found?.name, 'method')
    })

    it('returns null when the position is outside every symbol', () => {
        const fn = symbol('fn', SymbolKind.Function, 1, 5)

        assert.strictEqual(
            findEnclosingSymbol([fn], { line: 50 } as never, kinds),
            null,
        )
    })

    it('returns null for an undefined symbol list', () => {
        assert.strictEqual(
            findEnclosingSymbol(undefined, { line: 1 } as never, kinds),
            null,
        )
    })

    it('skips legacy SymbolInformation entries that have no range', () => {
        const legacy = { name: 'legacy', kind: SymbolKind.Function } as never
        const fn = symbol('fn', SymbolKind.Function, 1, 5)

        const found = findEnclosingSymbol(
            [legacy, fn],
            { line: 2 } as never,
            kinds,
        )
        assert.strictEqual(found?.name, 'fn')
    })
})

describe('resolveCallEntry', () => {
    beforeEach(resetStub)

    it('resolves at the cursor without retrying', async () => {
        prepareSucceedsAt([10])
        const entry = await resolveCallEntry(editorAt(10))

        assert.strictEqual(entry?.name, 'resolved')
        assert.strictEqual(prepareCalls().length, 1)
        assert.deepStrictEqual(stubState.errorMessages, [])
    })

    it('uses the call hierarchy command', async () => {
        prepareSucceedsAt([10])
        await resolveCallEntry(editorAt(10))

        assert.strictEqual(
            prepareCalls()[0].command,
            'vscode.prepareCallHierarchy',
        )
    })

    it('retries once when the language server is not ready yet', async () => {
        let attempts = 0
        stubState.executeCommand = async command => {
            if (command !== 'vscode.prepareCallHierarchy') return []
            attempts += 1
            return attempts > 1 ? [hierarchyItem('late')] : []
        }

        const entry = await resolveCallEntry(editorAt(10))
        assert.strictEqual(entry?.name, 'late')
        assert.strictEqual(attempts, 2)
        // the document symbol fallback is not needed
        assert.ok(
            !stubState.commandCalls.some(
                c => c.command === 'vscode.executeDocumentSymbolProvider',
            ),
        )
    })

    it('falls back to the enclosing function when the cursor is in its body', async () => {
        // prepare only succeeds on the declaration line 3, the cursor sits at 7
        const fn = symbol('doWork', SymbolKind.Function, 1, 20, [], 3)
        prepareSucceedsAt([3], [fn])

        const entry = await resolveCallEntry(editorAt(7))
        assert.strictEqual(entry?.name, 'resolved')

        // the fallback must use the selection range, i.e. the name position
        const last = prepareCalls().at(-1)
        assert.strictEqual((last?.args[1] as vscode.Position).line, 3)
        assert.deepStrictEqual(stubState.errorMessages, [])
    })

    it('reports an actionable error when nothing resolves', async () => {
        prepareSucceedsAt([], [])
        const entry = await resolveCallEntry(editorAt(7))

        assert.strictEqual(entry, null)
        assert.strictEqual(stubState.errorMessages.length, 1)
        assert.match(stubState.errorMessages[0], /function or method name/)
    })

    it('does not treat an interface as a call hierarchy entry', async () => {
        // the cursor is on an interface declaration, which has no call hierarchy
        const iface = symbol('AgentState', SymbolKind.Interface, 1, 20, [], 1)
        prepareSucceedsAt([1], [iface])

        const entry = await resolveCallEntry(editorAt(5))
        assert.strictEqual(entry, null)
        assert.strictEqual(stubState.errorMessages.length, 1)
    })

    it('logs the unresolved position for troubleshooting', async () => {
        prepareSucceedsAt([], [])
        await resolveCallEntry(editorAt(7, 2))

        assert.ok(
            stubState.outputLines.some(l =>
                l.includes("can't resolve entry at /ws/a.ts:8:3"),
            ),
            stubState.outputLines.join('\n'),
        )
    })
})

describe('resolveTypeEntry', () => {
    beforeEach(resetStub)

    it('uses the type hierarchy command', async () => {
        prepareSucceedsAt([10])
        const entry = await resolveTypeEntry(editorAt(10))

        assert.strictEqual(entry?.name, 'resolved')
        assert.strictEqual(
            prepareCalls()[0].command,
            'vscode.prepareTypeHierarchy',
        )
    })

    it('falls back to the enclosing interface', async () => {
        const iface = symbol('AgentState', SymbolKind.Interface, 1, 20, [], 3)
        prepareSucceedsAt([3], [iface])

        const entry = await resolveTypeEntry(editorAt(7))
        assert.strictEqual(entry?.name, 'resolved')
        assert.strictEqual(
            (prepareCalls().at(-1)?.args[1] as vscode.Position).line,
            3,
        )
    })

    it('falls back to the enclosing enum and struct', async () => {
        for (const kind of [SymbolKind.Enum, SymbolKind.Struct]) {
            resetStub()
            prepareSucceedsAt([3], [symbol('T', kind, 1, 20, [], 3)])
            assert.strictEqual(
                (await resolveTypeEntry(editorAt(7)))?.name,
                'resolved',
            )
        }
    })

    it('does not treat a plain function as a type entry', async () => {
        const fn = symbol('doWork', SymbolKind.Function, 1, 20, [], 3)
        prepareSucceedsAt([3], [fn])

        const entry = await resolveTypeEntry(editorAt(7))
        assert.strictEqual(entry, null)
        assert.match(stubState.errorMessages[0], /class, interface, struct/)
    })
})
