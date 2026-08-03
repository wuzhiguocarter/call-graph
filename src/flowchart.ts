import { CallHierarchyNode } from './call'
import * as fs from 'fs'
import * as path from 'path'
import * as vscode from 'vscode'
import { output } from './extension'

/**
 * Generate a Mermaid flowchart from a call hierarchy node
 * @param graph The call hierarchy node to generate the diagram from
 * @param outputPath The path to save the generated mermaid file
 * @returns The generated Mermaid diagram object
 */
export function generateFlowchart(
    graph: CallHierarchyNode,
    outputPath: string,
) {
    const diagram = new MermaidFlowchart(
        vscode.workspace.workspaceFolders?.[0].uri.fsPath ?? '',
    )
    const visited = new Set<string>()

    const walk = (node: CallHierarchyNode) => {
        const key = getNodeKey(node.item)
        if (visited.has(key)) return
        visited.add(key)
        diagram.addSymbol(node.item)

        node.children.forEach(child => {
            diagram.addSymbol(child.item)
            diagram.addCall(node.item, child.item)
            walk(child)
        })
    }
    walk(graph)

    fs.writeFileSync(outputPath, diagram.toString())
    output.appendLine('Generated Mermaid flowchart: ' + outputPath)

    return diagram
}

/**
 * Identify a symbol by its declaration site, so that overloads and same named
 * functions of different files stay separate nodes
 */
const getNodeKey = (item: vscode.CallHierarchyItem) =>
    `${item.uri.toString()}#${item.name}@${item.range.start.line}:${item.range.start.character}`

/**
 * Escape a name for use as a Mermaid label. Mermaid renders labels as HTML,
 * so generics such as `List<T>` would otherwise be swallowed as tags, and a
 * quote would end the label early.
 */
const escapeLabel = (name: string) =>
    name
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '#quot;')

/**
 * Class to generate a Mermaid flowchart from a call hierarchy
 */
class MermaidFlowchart {
    private _ids = new Map<string, string>()
    private _files = new Map<string, { id: string; nodes: string[] }>()
    private _edges = new Set<string>()

    constructor(private _workspaceRoot: string) {}

    /**
     * Declare a symbol as a node inside the subgraph of its file, ignoring
     * symbols that were already declared
     * @param item The call hierarchy item to declare
     * @returns The Mermaid id of the node
     */
    addSymbol(item: vscode.CallHierarchyItem): string {
        const key = getNodeKey(item)
        const known = this._ids.get(key)
        if (known) return known

        const id = `node_${this._ids.size}`
        this._ids.set(key, id)
        this.getFile(item.uri).nodes.push(
            `        ${id}["${escapeLabel(item.name)}"]`,
        )
        return id
    }

    /**
     * Add a call edge between two symbols, ignoring duplicated calls
     * @param caller The calling symbol
     * @param callee The called symbol
     */
    addCall(
        caller: vscode.CallHierarchyItem,
        callee: vscode.CallHierarchyItem,
    ) {
        this._edges.add(
            `    ${this.addSymbol(caller)} --> ${this.addSymbol(callee)}`,
        )
    }

    /**
     * Map a file to the subgraph its symbols are grouped in
     * @param uri The uri of the file
     */
    private getFile(uri: vscode.Uri) {
        const filePath = this._workspaceRoot
            ? path.relative(this._workspaceRoot, uri.fsPath).replace(/\\/g, '/')
            : uri.fsPath
        const known = this._files.get(filePath)
        if (known) return known

        const file = { id: `file_${this._files.size}`, nodes: [] as string[] }
        this._files.set(filePath, file)
        return file
    }

    /**
     * Convert the diagram to a string
     */
    toString(): string {
        const subgraphs: string[] = []
        this._files.forEach((file, filePath) => {
            subgraphs.push(
                `    subgraph ${file.id}["${escapeLabel(filePath)}"]`,
                ...file.nodes,
                '    end',
            )
        })
        return ['flowchart LR', ...subgraphs, ...this._edges, ''].join('\n')
    }
}
