// the vscode stub installs a module hook and must be loaded before any source
import { makeRange, resetStub, SymbolKind } from './vscodeStub'
import { describe, it, beforeEach, afterEach } from 'node:test'
import * as assert from 'node:assert'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import type * as vscode from 'vscode'
import { TypeHierarchyNode } from '../type'
import { generateTypeDiagram } from '../typeDiagram'

const item = (name: string, kind: number, line = 0) =>
    ({
        name,
        kind,
        uri: {
            fsPath: `/ws/${name}.ts`,
            path: `/ws/${name}.ts`,
            toString: () => `file:///ws/${name}.ts`,
        },
        range: makeRange(line, line),
        selectionRange: makeRange(line, line),
    }) as unknown as vscode.TypeHierarchyItem

const node = (
    typeItem: vscode.TypeHierarchyItem,
    children: TypeHierarchyNode[] = [],
): TypeHierarchyNode => ({ item: typeItem, children })

let tmpDir: string
const render = (graph: TypeHierarchyNode, direction: 'Super' | 'Sub') => {
    const file = path.join(tmpDir, 'diagram.mmd')
    generateTypeDiagram(graph, direction, file)
    return fs.readFileSync(file).toString()
}

/** resolve the generated id of a type by its rendered label */
const idOf = (diagram: string, label: string) => {
    const match = diagram.match(new RegExp(`class (type_\\d+)\\["${label}"\\]`))
    assert.ok(match, `no class declared with label ${label}\n${diagram}`)
    return match[1]
}

describe('generateTypeDiagram', () => {
    beforeEach(() => {
        resetStub()
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'callviz-'))
    })
    afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }))

    it('starts the file with a classDiagram header', () => {
        const diagram = render(node(item('Foo', SymbolKind.Class)), 'Sub')
        assert.ok(diagram.startsWith('classDiagram\n'))
    })

    it('flips the edge for supertypes so the base type is on the left', () => {
        // children of the entry are its base types
        const graph = node(item('Dog', SymbolKind.Class), [
            node(item('Animal', SymbolKind.Class)),
        ])
        const diagram = render(graph, 'Super')

        const dog = idOf(diagram, 'Dog')
        const animal = idOf(diagram, 'Animal')
        assert.ok(diagram.includes(`${animal} <|-- ${dog}`), diagram)
    })

    it('keeps the edge direction for subtypes', () => {
        // children of the entry are its derived types
        const graph = node(item('Animal', SymbolKind.Class), [
            node(item('Dog', SymbolKind.Class)),
        ])
        const diagram = render(graph, 'Sub')

        const dog = idOf(diagram, 'Dog')
        const animal = idOf(diagram, 'Animal')
        assert.ok(diagram.includes(`${animal} <|-- ${dog}`), diagram)
    })

    it('draws realization when a class implements an interface', () => {
        const graph = node(item('Dog', SymbolKind.Class), [
            node(item('Pet', SymbolKind.Interface)),
        ])
        const diagram = render(graph, 'Super')

        assert.ok(
            diagram.includes(
                `${idOf(diagram, 'Pet')} <|.. ${idOf(diagram, 'Dog')}`,
            ),
            diagram,
        )
    })

    it('draws generalization when an interface extends an interface', () => {
        const graph = node(item('Pet', SymbolKind.Interface), [
            node(item('Named', SymbolKind.Interface)),
        ])
        const diagram = render(graph, 'Super')

        assert.ok(
            diagram.includes(
                `${idOf(diagram, 'Named')} <|-- ${idOf(diagram, 'Pet')}`,
            ),
            diagram,
        )
    })

    it('escapes generic parameters so mermaid does not treat them as html', () => {
        const diagram = render(node(item('List<T>', SymbolKind.Class)), 'Sub')
        assert.ok(diagram.includes('class type_0["List&lt;T&gt;"]'), diagram)
        assert.ok(!diagram.includes('List<T>'), diagram)
    })

    it('escapes ampersands before angle brackets', () => {
        const diagram = render(node(item('A&B', SymbolKind.Class)), 'Sub')
        assert.ok(diagram.includes('"A&amp;B"'), diagram)
    })

    it('annotates interfaces, enums and structs with a stereotype', () => {
        const graph = node(item('Root', SymbolKind.Class), [
            node(item('Iface', SymbolKind.Interface)),
            node(item('Kind', SymbolKind.Enum)),
            node(item('Point', SymbolKind.Struct)),
        ])
        const diagram = render(graph, 'Sub')

        assert.ok(diagram.includes('<<interface>>'), diagram)
        assert.ok(diagram.includes('<<enumeration>>'), diagram)
        assert.ok(diagram.includes('<<struct>>'), diagram)
        // a plain class gets no stereotype and therefore no body
        assert.ok(diagram.includes(`class ${idOf(diagram, 'Root')}["Root"]\n`))
    })

    it('declares a type once even when several branches reference it', () => {
        const shared = node(item('Base', SymbolKind.Class))
        const graph = node(item('Root', SymbolKind.Class), [
            node(item('Left', SymbolKind.Class), [shared]),
            node(item('Right', SymbolKind.Class), [shared]),
        ])
        const diagram = render(graph, 'Super')

        const declarations = diagram.match(/class type_\d+\["Base"\]/g) ?? []
        assert.strictEqual(declarations.length, 1, diagram)
    })

    it('deduplicates identical edges', () => {
        const shared = node(item('Base', SymbolKind.Class))
        const child = node(item('Child', SymbolKind.Class), [shared, shared])
        const diagram = render(child, 'Super')

        const edges = diagram.match(/type_\d+ <\|-- type_\d+/g) ?? []
        assert.strictEqual(edges.length, 1, diagram)
    })

    it('terminates on a cyclic hierarchy', () => {
        const a = node(item('A', SymbolKind.Class))
        const b = node(item('B', SymbolKind.Class), [a])
        a.children.push(b)

        const diagram = render(a, 'Super')
        assert.ok(diagram.includes('"A"'), diagram)
        assert.ok(diagram.includes('"B"'), diagram)
    })
})
