import { CallHierarchyNode } from './call'
import * as fs from 'fs'
import * as path from 'path'
import * as vscode from 'vscode'
import { output } from './extension'

/**
 * Generate a Mermaid control flow diagram from a call hierarchy node
 * @param graph The call hierarchy node to generate the diagram from
 * @param path The path to save the generated mermaid file
 * @returns The generated Mermaid diagram object
 */
export function generateControlFlowDiagram(
    graph: CallHierarchyNode,
    path: string,
) {
    const mermaid = new MermaidControlFlowDiagram()

    // Store node information
    const nodes = new Map<string, string>()
    // Store edge information
    const edges = new Set<string>()
    // Get workspace root path
    const workspaceRoot =
        vscode.workspace.workspaceFolders?.[0].uri.fsPath || ''

    // Sets to track visited nodes and detect cycles
    const visited = new Set<string>()

    // Get the in-degree threshold from settings
    const inDegreeThreshold =
        vscode.workspace
            .getConfiguration()
            .get<number>('call-graph.inDegreeThreshold') || 5

    output.appendLine(
        `Generating Mermaid control flow diagram with in-degree threshold: ${inDegreeThreshold}...`,
    )

    // Build control flow diagram and collect nodes and edges
    buildControlFlowDiagram(
        graph,
        nodes,
        edges,
        workspaceRoot,
        visited,
        inDegreeThreshold,
    )

    // Add nodes to diagram
    nodes.forEach((nodeLabel, nodeId) => {
        mermaid.addNode(nodeId, nodeLabel)
    })

    // Add edges to diagram
    edges.forEach(edge => {
        mermaid.addEdge(edge)
    })

    // Save the generated diagram to a file
    fs.writeFileSync(path, mermaid.toString())
    output.appendLine('Generated Mermaid control flow diagram: ' + path)

    return mermaid
}

/**
 * Build the control flow diagram structure
 */
function buildControlFlowDiagram(
    node: CallHierarchyNode,
    nodes: Map<string, string>,
    edges: Set<string>,
    workspaceRoot: string,
    visited: Set<string> = new Set(),
    inDegreeThreshold: number = 5,
    parentId: string | null = null,
) {
    // Generate a unique ID for this node
    const nodeId = generateNodeId(node.item.name, node.item.uri.fsPath)

    // Skip if already visited to prevent cycles
    if (visited.has(nodeId)) {
        // If we have a parent, add an edge to this node
        if (parentId) {
            edges.add(`${parentId} --> ${nodeId}`)
        }
        return
    }
    visited.add(nodeId)

    // Get file path and function name
    const fullPath = node.item.uri.fsPath
    const relativePath = workspaceRoot
        ? path.relative(workspaceRoot, fullPath).replace(/\\/g, '/')
        : fullPath

    // Create node label with function name and file path
    const nodeLabel = `${node.item.name}<br><small>${relativePath}</small>`

    // Add node to the map
    nodes.set(nodeId, nodeLabel)

    // If we have a parent, add an edge from parent to this node
    if (parentId) {
        edges.add(`${parentId} --> ${nodeId}`)
    }

    // Process child nodes
    node.children.forEach(child => {
        // Apply in-degree filtering - skip nodes with high in-degree
        if (
            inDegreeThreshold > 0 &&
            child.inDegree &&
            child.inDegree > inDegreeThreshold
        ) {
            output.appendLine(
                `Skipping node due to high in-degree (${child.inDegree} > ${inDegreeThreshold}): ${child.item.name}`,
            )
            return
        }

        // Recursively process child nodes
        buildControlFlowDiagram(
            child,
            nodes,
            edges,
            workspaceRoot,
            visited,
            inDegreeThreshold,
            nodeId,
        )
    })
}

/**
 * Generate a unique ID for a node based on its name and file path
 */
function generateNodeId(name: string, filePath: string): string {
    // Create a unique identifier that's also a valid Mermaid node ID
    const combined = `${name}_${filePath}`
    // Use a hash function to create a shorter, unique ID
    let hash = 0
    for (let i = 0; i < combined.length; i++) {
        const char = combined.charCodeAt(i)
        hash = (hash << 5) - hash + char
        hash = hash & hash // Convert to 32bit integer
    }
    // Make sure it starts with a letter for Mermaid compatibility
    return `node_${Math.abs(hash).toString(16)}`
}

/**
 * Mermaid control flow diagram class
 */
class MermaidControlFlowDiagram {
    private _content = ''
    private _nodes: string[] = []
    private _edges: string[] = []

    constructor() {
        this._content = 'flowchart TD\n'
    }

    /**
     * Add a node to the diagram
     * @param id Node ID
     * @param label Node label
     */
    addNode(id: string, label: string) {
        const nodeDef = `  ${id}["${this.escapeLabel(label)}"]`
        if (!this._nodes.includes(nodeDef)) {
            this._nodes.push(nodeDef)
        }
    }

    /**
     * Add an edge to the diagram
     * @param edge Edge definition
     */
    addEdge(edge: string) {
        const edgeDef = `  ${edge}`
        if (!this._edges.includes(edgeDef)) {
            this._edges.push(edgeDef)
        }
    }

    /**
     * Escape special characters in the label
     */
    private escapeLabel(label: string): string {
        return label.replace(/"/g, '\\"')
    }

    /**
     * Convert the diagram to a string
     */
    toString(): string {
        return (
            this._content +
            this._nodes.join('\n') +
            (this._nodes.length > 0 && this._edges.length > 0 ? '\n' : '') +
            this._edges.join('\n')
        )
    }
}
