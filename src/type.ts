import * as vscode from 'vscode'
import { output } from './extension'

export interface TypeHierarchyNode {
    item: vscode.TypeHierarchyItem
    children: TypeHierarchyNode[]
}

/**
 * 'Super' walks towards base classes and implemented interfaces,
 * 'Sub' walks towards derived classes and implementers
 */
export type TypeDirection = 'Super' | 'Sub'

const itemKey = (item: vscode.TypeHierarchyItem) =>
    `${item.name}|${item.uri.toString()}|${item.range.start.line}:${item.range.start.character}`

async function getTypeNode(
    entryItem: vscode.TypeHierarchyItem,
    ignore: (item: { uri: vscode.Uri }) => boolean,
    direction: TypeDirection,
) {
    const maxDepth =
        vscode.workspace
            .getConfiguration()
            .get<number>('call-graph.maxDepth') || 0
    const command =
        direction === 'Super'
            ? 'vscode.provideSupertypes'
            : 'vscode.provideSubtypes'
    // every resolved type is expanded once and shared by all branches
    // referencing it, which also breaks cycles in the hierarchy
    const resolved = new Map<string, TypeHierarchyNode>()

    const insertNode = async (node: TypeHierarchyNode, depth = 0) => {
        if (maxDepth > 0 && depth >= maxDepth) return
        output.appendLine('resolve type: ' + node.item.name)
        const related: vscode.TypeHierarchyItem[] =
            (await vscode.commands.executeCommand(command, node.item)) ?? []

        for (const next of related) {
            if (ignore(next)) {
                output.appendLine('ignore it in config, ' + next.name)
                continue
            }

            const known = resolved.get(itemKey(next))
            if (known) {
                output.appendLine('skip, already resolve: ' + next.name)
                node.children.push(known)
                continue
            }

            const child: TypeHierarchyNode = { item: next, children: [] }
            resolved.set(itemKey(next), child)
            node.children.push(child)
            await insertNode(child, depth + 1)
        }
    }

    const graph: TypeHierarchyNode = { item: entryItem, children: [] }
    resolved.set(itemKey(entryItem), graph)
    await insertNode(graph)
    return graph
}

export async function getSupertypeNode(
    entryItem: vscode.TypeHierarchyItem,
    ignore: (item: { uri: vscode.Uri }) => boolean,
) {
    return await getTypeNode(entryItem, ignore, 'Super')
}

export async function getSubtypeNode(
    entryItem: vscode.TypeHierarchyItem,
    ignore: (item: { uri: vscode.Uri }) => boolean,
) {
    return await getTypeNode(entryItem, ignore, 'Sub')
}
