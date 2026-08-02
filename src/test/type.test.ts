// the vscode stub installs a module hook and must be loaded before any source
import { makeRange, resetStub, stubState, SymbolKind } from './vscodeStub'
import { describe, it, beforeEach } from 'node:test'
import * as assert from 'node:assert'
import type * as vscode from 'vscode'
import { getSubtypeNode, getSupertypeNode, TypeHierarchyNode } from '../type'

const item = (name: string, line = 0) =>
    ({
        name,
        kind: SymbolKind.Class,
        uri: {
            fsPath: `/ws/${name}.ts`,
            path: `/ws/${name}.ts`,
            toString: () => `file:///ws/${name}.ts`,
        },
        range: makeRange(line, line),
        selectionRange: makeRange(line, line),
    }) as unknown as vscode.TypeHierarchyItem

const never = () => false

/**
 * Answer hierarchy queries from a static adjacency map keyed by type name
 */
const respondWith = (edges: Record<string, vscode.TypeHierarchyItem[]>) => {
    stubState.executeCommand = async (_command, ...args) => {
        const from = args[0] as vscode.TypeHierarchyItem
        return edges[from.name] ?? []
    }
}

const names = (nodes: TypeHierarchyNode[]) => nodes.map(n => n.item.name)

describe('getSupertypeNode / getSubtypeNode', () => {
    beforeEach(resetStub)

    it('queries supertypes for the Super direction', async () => {
        respondWith({})
        await getSupertypeNode(item('A'), never)

        assert.deepStrictEqual(
            stubState.commandCalls.map(c => c.command),
            ['vscode.provideSupertypes'],
        )
    })

    it('queries subtypes for the Sub direction', async () => {
        respondWith({})
        await getSubtypeNode(item('A'), never)

        assert.deepStrictEqual(
            stubState.commandCalls.map(c => c.command),
            ['vscode.provideSubtypes'],
        )
    })

    it('builds the hierarchy recursively', async () => {
        respondWith({ A: [item('B')], B: [item('C')] })
        const graph = await getSupertypeNode(item('A'), never)

        assert.deepStrictEqual(names(graph.children), ['B'])
        assert.deepStrictEqual(names(graph.children[0].children), ['C'])
    })

    it('tolerates a provider that returns undefined', async () => {
        stubState.executeCommand = async () => undefined
        const graph = await getSupertypeNode(item('A'), never)

        assert.deepStrictEqual(graph.children, [])
    })

    it('expands a shared type once and reuses the same node', async () => {
        // both B and C derive from D
        respondWith({
            A: [item('B'), item('C')],
            B: [item('D')],
            C: [item('D')],
            D: [],
        })
        const graph = await getSupertypeNode(item('A'), never)

        const fromB = graph.children[0].children[0]
        const fromC = graph.children[1].children[0]
        assert.strictEqual(fromB.item.name, 'D')
        assert.strictEqual(fromB, fromC, 'D should be a shared node')

        const dQueries = stubState.commandCalls.filter(
            c => (c.args[0] as vscode.TypeHierarchyItem).name === 'D',
        )
        assert.strictEqual(dQueries.length, 1, 'D should be expanded once')
    })

    it('terminates on a cyclic hierarchy', async () => {
        respondWith({ A: [item('B')], B: [item('A')] })
        const graph = await getSupertypeNode(item('A'), never)

        const b = graph.children[0]
        assert.strictEqual(b.item.name, 'B')
        // the cycle points back at the entry node itself
        assert.strictEqual(b.children[0], graph)
    })

    it('stops at maxDepth', async () => {
        stubState.config['call-graph.maxDepth'] = 2
        respondWith({ A: [item('B')], B: [item('C')], C: [item('D')] })
        const graph = await getSupertypeNode(item('A'), never)

        assert.deepStrictEqual(names(graph.children), ['B'])
        assert.deepStrictEqual(names(graph.children[0].children), ['C'])
        // depth 2 is reached, C is not expanded any further
        assert.deepStrictEqual(graph.children[0].children[0].children, [])
    })

    it('treats maxDepth 0 as unlimited', async () => {
        stubState.config['call-graph.maxDepth'] = 0
        respondWith({ A: [item('B')], B: [item('C')], C: [] })
        const graph = await getSupertypeNode(item('A'), never)

        assert.deepStrictEqual(names(graph.children[0].children), ['C'])
    })

    it('drops types rejected by the ignore predicate', async () => {
        respondWith({ A: [item('Keep'), item('Drop')] })
        const graph = await getSupertypeNode(item('A'), candidate =>
            candidate.uri.fsPath.includes('Drop'),
        )

        assert.deepStrictEqual(names(graph.children), ['Keep'])
    })

    it('does not expand ignored types', async () => {
        respondWith({ A: [item('Drop')], Drop: [item('Deep')] })
        await getSupertypeNode(item('A'), candidate =>
            candidate.uri.fsPath.includes('Drop'),
        )

        const expanded = stubState.commandCalls.map(
            c => (c.args[0] as vscode.TypeHierarchyItem).name,
        )
        assert.deepStrictEqual(expanded, ['A'])
    })

    it('distinguishes same-named types from different files', async () => {
        const first = item('Dup')
        const second = item('Dup', 40)
        respondWith({ A: [first, second], Dup: [] })
        const graph = await getSupertypeNode(item('A'), never)

        assert.strictEqual(graph.children.length, 2)
        assert.notStrictEqual(graph.children[0], graph.children[1])
    })
})
