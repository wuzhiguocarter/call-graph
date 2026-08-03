// the vscode stub installs a module hook and must be loaded before any source
import { makeRange, resetStub, SymbolKind } from './vscodeStub'
import { describe, it, beforeEach, afterEach } from 'node:test'
import * as assert from 'node:assert'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import type * as vscode from 'vscode'
import { CallHierarchyNode } from '../call'
import { TypeHierarchyNode } from '../type'
import { generateFlowchart } from '../flowchart'
import { generateClassDiagram } from '../class'
import { generateMermaid } from '../mermaid'
import { generateTypeDiagram } from '../typeDiagram'
import { DiagramNavigation, getNavigationPath } from '../navigation'

const item = (name: string, file: string, line: number) =>
    ({
        name,
        kind: SymbolKind.Function,
        uri: {
            fsPath: `/ws/${file}`,
            path: `/ws/${file}`,
            toString: () => `file:///ws/${file}`,
        },
        // the body starts at `line`, the name of the symbol sits behind it
        range: makeRange(line, line + 3),
        selectionRange: makeRange(line, line, 4, 4 + name.length),
    }) as unknown as vscode.CallHierarchyItem

const node = (
    callItem: vscode.CallHierarchyItem,
    children: CallHierarchyNode[] = [],
): CallHierarchyNode => ({ item: callItem, children })

let tmpDir: string

/** run a generator and read back the navigation data it wrote */
const generate = (
    write: (outputPath: string) => void,
): { diagram: string; navigation: DiagramNavigation } => {
    const file = path.join(tmpDir, 'diagram.mmd')
    write(file)
    return {
        diagram: fs.readFileSync(file).toString(),
        navigation: JSON.parse(
            fs.readFileSync(getNavigationPath(file)).toString(),
        ),
    }
}

describe('diagram navigation', () => {
    beforeEach(() => {
        resetStub()
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'callviz-'))
    })
    afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }))

    it('writes the navigation data next to the diagram', () => {
        assert.strictEqual(
            getNavigationPath('/tmp/graph_data_incoming.mmd'),
            '/tmp/graph_data_incoming.map.json',
        )
    })

    describe('call graph', () => {
        it('points every node at the name of its function', () => {
            const { diagram, navigation } = generate(file =>
                generateFlowchart(
                    node(item('main', 'app.ts', 10), [
                        node(item('log', 'util.ts', 5)),
                    ]),
                    file,
                ),
            )

            // the ids of the map are the ids the diagram was drawn with
            Object.keys(navigation.nodes!).forEach(id =>
                assert.ok(diagram.includes(`${id}["`), `${id} is not drawn`),
            )
            assert.deepStrictEqual(navigation.nodes!.node_0, {
                uri: 'file:///ws/app.ts',
                // the selection range, not the start of the body
                line: 10,
                character: 4,
                name: 'main',
            })
            assert.deepStrictEqual(navigation.nodes!.node_1, {
                uri: 'file:///ws/util.ts',
                line: 5,
                character: 4,
                name: 'log',
            })
        })

        it('keeps one entry for a symbol reached by several callers', () => {
            const shared = item('shared', 'util.ts', 1)
            const { navigation } = generate(file =>
                generateFlowchart(
                    node(item('main', 'app.ts', 10), [
                        node(item('a', 'app.ts', 20), [node(shared)]),
                        node(item('b', 'app.ts', 30), [node(shared)]),
                    ]),
                    file,
                ),
            )

            const shares = Object.values(navigation.nodes!).filter(
                location => location.name === 'shared',
            )
            assert.strictEqual(shares.length, 1)
        })
    })

    describe('class diagram', () => {
        it('points a class at its first symbol and a method at its own', () => {
            const { navigation } = generate(file =>
                generateClassDiagram(
                    node(item('App.main', 'app.ts', 10), [
                        node(item('Util.log', 'util.ts', 5)),
                    ]),
                    file,
                ),
            )

            assert.strictEqual(navigation.nodes!.App.name, 'App.main')
            assert.strictEqual(navigation.nodes!.App.line, 10)
            assert.strictEqual(navigation.nodes!.Util.line, 5)
            // rendered as `+log()` inside the class box
            assert.strictEqual(
                navigation.members!.Util['+log()'].uri,
                'file:///ws/util.ts',
            )
        })

        it('only maps the members the diagram draws', () => {
            const { diagram, navigation } = generate(file =>
                generateClassDiagram(
                    node(item('App.main', 'app.ts', 10), [
                        node(item('Util.log', 'util.ts', 5)),
                    ]),
                    file,
                ),
            )

            Object.entries(navigation.members ?? {}).forEach(([, members]) =>
                Object.keys(members).forEach(label =>
                    assert.ok(
                        diagram.includes(label),
                        `${label} is not drawn\n${diagram}`,
                    ),
                ),
            )
            // `main` is never called, so it is not drawn and not navigable
            assert.ok(!navigation.members?.App)
        })
    })

    describe('sequence diagram', () => {
        it('maps participants in declaration order and messages in draw order', () => {
            const { diagram, navigation } = generate(file =>
                generateMermaid(
                    node(item('main', 'app.ts', 10), [
                        node(item('log', 'util.ts', 5)),
                        node(item('query', 'db.ts', 22)),
                    ]),
                    file,
                ),
            )

            assert.deepStrictEqual(
                navigation.participants!.map(location => location.uri),
                ['file:///ws/app.ts', 'file:///ws/util.ts', 'file:///ws/db.ts'],
            )
            assert.deepStrictEqual(
                navigation.messages!.map(location => location.name),
                ['log', 'query'],
            )
            // one entry per arrow mermaid draws
            assert.strictEqual(
                (diagram.match(/->>/g) ?? []).length,
                navigation.messages!.length,
            )
            assert.strictEqual(
                (diagram.match(/^ {4}participant /gm) ?? []).length,
                navigation.participants!.length,
            )
        })

        it('drops a repeated call from the messages, like the diagram does', () => {
            const { diagram, navigation } = generate(file =>
                generateMermaid(
                    node(item('main', 'app.ts', 10), [
                        node(item('log', 'util.ts', 5)),
                        node(item('log', 'util.ts', 5)),
                    ]),
                    file,
                ),
            )

            assert.strictEqual(
                (diagram.match(/->>/g) ?? []).length,
                navigation.messages!.length,
            )
        })
    })

    describe('type hierarchy', () => {
        it('points every type at its declaration', () => {
            const typeItem = (name: string, file: string, line: number) =>
                item(name, file, line) as unknown as vscode.TypeHierarchyItem
            const typeNode = (
                type: vscode.TypeHierarchyItem,
                children: TypeHierarchyNode[] = [],
            ): TypeHierarchyNode => ({ item: type, children })

            const { diagram, navigation } = generate(file =>
                generateTypeDiagram(
                    typeNode(typeItem('Dog', 'dog.ts', 3), [
                        typeNode(typeItem('Animal', 'animal.ts', 7)),
                    ]),
                    'Super',
                    file,
                ),
            )

            Object.keys(navigation.nodes!).forEach(id =>
                assert.ok(
                    diagram.includes(`class ${id}[`),
                    `${id} is not drawn`,
                ),
            )
            assert.deepStrictEqual(
                Object.values(navigation.nodes!).map(
                    location => `${location.name}@${location.line}`,
                ),
                ['Dog@3', 'Animal@7'],
            )
        })
    })
})
