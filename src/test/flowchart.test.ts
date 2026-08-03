// the vscode stub installs a module hook and must be loaded before any source
import { makeRange, resetStub } from './vscodeStub'
import { describe, it, beforeEach, afterEach } from 'node:test'
import * as assert from 'node:assert'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import type * as vscode from 'vscode'
import { CallHierarchyNode } from '../call'
import { generateFlowchart } from '../flowchart'

const item = (name: string, file = `${name}.ts`, line = 0) =>
    ({
        name,
        uri: {
            fsPath: `/ws/${file}`,
            path: `/ws/${file}`,
            toString: () => `file:///ws/${file}`,
        },
        range: makeRange(line, line),
        selectionRange: makeRange(line, line),
    }) as unknown as vscode.CallHierarchyItem

const node = (
    callItem: vscode.CallHierarchyItem,
    children: CallHierarchyNode[] = [],
): CallHierarchyNode => ({ item: callItem, children })

let tmpDir: string
const render = (graph: CallHierarchyNode) => {
    const file = path.join(tmpDir, 'diagram.mmd')
    generateFlowchart(graph, file)
    return fs.readFileSync(file).toString()
}

/** resolve the generated id of a symbol by its rendered label */
const idOf = (diagram: string, label: string) => {
    const match = diagram.match(new RegExp(`(node_\\d+)\\["${label}"\\]`))
    assert.ok(match, `no node declared with label ${label}\n${diagram}`)
    return match[1]
}

describe('generateFlowchart', () => {
    beforeEach(() => {
        resetStub()
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'callviz-'))
    })
    afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }))

    it('starts the file with a left to right flowchart header', () => {
        const diagram = render(node(item('main')))
        assert.ok(diagram.startsWith('flowchart LR\n'))
    })

    it('draws an edge from the caller to the callee', () => {
        const diagram = render(node(item('main'), [node(item('helper'))]))
        assert.match(
            diagram,
            new RegExp(
                `^\\s*${idOf(diagram, 'main')} --> ${idOf(diagram, 'helper')}$`,
                'm',
            ),
        )
    })

    it('groups the symbols of a file in one subgraph', () => {
        const diagram = render(
            node(item('main', 'app.ts'), [
                node(item('helper', 'app.ts', 10)),
                node(item('log', 'util.ts')),
            ]),
        )

        const app = diagram.match(
            /subgraph file_\d+\["app\.ts"\]\n([\s\S]*?)\n {4}end/,
        )
        assert.ok(app, `no subgraph for app.ts\n${diagram}`)
        assert.ok(app[1].includes(idOf(diagram, 'main')))
        assert.ok(app[1].includes(idOf(diagram, 'helper')))
        assert.ok(!app[1].includes(idOf(diagram, 'log')))
        assert.match(diagram, /subgraph file_\d+\["util\.ts"\]/)
    })

    it('declares a symbol reached by several callers only once', () => {
        const shared = item('shared')
        const diagram = render(
            node(item('main'), [
                node(item('a'), [node(shared)]),
                node(item('b'), [node(shared)]),
            ]),
        )

        const declarations = diagram.match(/node_\d+\["shared"\]/g) ?? []
        assert.strictEqual(declarations.length, 1)
        assert.strictEqual(
            (diagram.match(/--> node_\d+$/gm) ?? []).length,
            4,
            diagram,
        )
    })

    it('terminates on a recursive call', () => {
        const recursive = node(item('loop'))
        recursive.children.push(recursive)

        const diagram = render(recursive)
        const id = idOf(diagram, 'loop')
        assert.match(diagram, new RegExp(`^\\s*${id} --> ${id}$`, 'm'))
    })

    it('escapes characters mermaid would read as markup', () => {
        const diagram = render(node(item('map<K, V>')))
        assert.ok(diagram.includes('node_0["map&lt;K, V&gt;"]'), diagram)
    })
})
