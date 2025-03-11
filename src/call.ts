import { CallHierarchyItem } from 'vscode'
import * as vscode from 'vscode'
import { output } from './extension'

export interface CallHierarchyNode {
    item: CallHierarchyItem
    children: CallHierarchyNode[]
    inDegree?: number
    sourcePosition?: vscode.Position
}

async function getCallNode(
    entryItem: CallHierarchyItem,
    ignore: (item: vscode.CallHierarchyItem) => boolean,
    outgoing: boolean = true,
) {
    const maxDepth =
        vscode.workspace
            .getConfiguration()
            .get<number>('call-graph.maxDepth') || 0
    const inDegreeThreshold =
        vscode.workspace
            .getConfiguration()
            .get<number>('call-graph.inDegreeThreshold') || 5
    const command = outgoing
        ? 'vscode.provideOutgoingCalls'
        : 'vscode.provideIncomingCalls'
    const nodes = new Set<CallHierarchyNode>()
    const inDegreeMap = new Map<string, number>()
    const sourcePositionMap = new Map<string, vscode.Position>()

    const calculateInDegrees = async (node: CallHierarchyNode, depth = 0) => {
        if (maxDepth > 0 && depth >= maxDepth) return

        const calls:
            | vscode.CallHierarchyOutgoingCall[]
            | vscode.CallHierarchyIncomingCall[] =
            await vscode.commands.executeCommand(command, node.item)

        await Promise.all(
            calls.map(call => {
                const next =
                    call instanceof vscode.CallHierarchyOutgoingCall
                        ? call.to
                        : call.from
                if (ignore(next)) {
                    return null
                }

                const nodeKey = `${next.name}|${next.uri.toString()}|${next.range.start.line}:${next.range.start.character}`

                if (outgoing) {
                    const currentCount = inDegreeMap.get(nodeKey) || 0
                    inDegreeMap.set(nodeKey, currentCount + 1)
                    output.appendLine(
                        `Incremented in-degree for ${next.name} to ${currentCount + 1}`,
                    )
                }

                if (call instanceof vscode.CallHierarchyOutgoingCall) {
                    if (call.fromRanges && call.fromRanges.length > 0) {
                        sourcePositionMap.set(nodeKey, call.fromRanges[0].start)
                        output.appendLine(
                            `Stored source position for ${next.name}: Line ${call.fromRanges[0].start.line}, Character ${call.fromRanges[0].start.character}`,
                        )
                    }
                }

                let isSkip = false
                for (const n of nodes) {
                    if (isCallHierarchyItemEqual(n.item, next)) {
                        isSkip = true
                        break
                    }
                }

                if (isSkip) return null

                const child = { item: next, children: [] }
                nodes.add(child)
                return calculateInDegrees(child, depth + 1)
            }),
        )
    }

    const insertNode = async (node: CallHierarchyNode, depth = 0) => {
        if (maxDepth > 0 && depth >= maxDepth) return
        output.appendLine('resolve: ' + node.item.name)
        nodes.add(node)
        const calls:
            | vscode.CallHierarchyOutgoingCall[]
            | vscode.CallHierarchyIncomingCall[] =
            await vscode.commands.executeCommand(command, node.item)

        if (outgoing) {
            calls.sort((a, b) => {
                if (
                    !(a instanceof vscode.CallHierarchyOutgoingCall) ||
                    !(b instanceof vscode.CallHierarchyOutgoingCall)
                ) {
                    return 0
                }

                const aRanges = a.fromRanges
                const bRanges = b.fromRanges

                if (
                    !aRanges ||
                    !aRanges.length ||
                    !bRanges ||
                    !bRanges.length
                ) {
                    return 0
                }

                const aPos = aRanges[0].start
                const bPos = bRanges[0].start

                if (aPos.line !== bPos.line) {
                    return aPos.line - bPos.line
                }

                return aPos.character - bPos.character
            })
        }

        await Promise.all(
            calls.map(call => {
                const next =
                    call instanceof vscode.CallHierarchyOutgoingCall
                        ? call.to
                        : call.from
                if (ignore(next)) {
                    output.appendLine('ignore it in config, ' + next.name)
                    return null
                }

                const nodeKey = `${next.name}|${next.uri.toString()}|${next.range.start.line}:${next.range.start.character}`

                const inDegree = inDegreeMap.get(nodeKey) || 0
                output.appendLine(
                    `Node ${next.name} has in-degree: ${inDegree}, threshold: ${inDegreeThreshold}`,
                )

                if (
                    outgoing &&
                    inDegreeThreshold > 0 &&
                    inDegree > inDegreeThreshold
                ) {
                    output.appendLine(
                        `ignore due to high in-degree (${inDegree} > ${inDegreeThreshold}): ${next.name}`,
                    )
                    return null
                }

                let isSkip = false
                for (const n of nodes) {
                    if (isCallHierarchyItemEqual(n.item, next)) {
                        output.appendLine('skip, already resolve: ' + next.name)
                        node.children.push(n)
                        isSkip = true
                        break
                    }
                }
                if (isSkip) return null

                const sourcePosition = sourcePositionMap.get(nodeKey)

                const child = {
                    item: next,
                    children: [],
                    inDegree: inDegree,
                    sourcePosition: sourcePosition,
                }
                node.children.push(child)
                return insertNode(child, depth + 1)
            }),
        )
    }

    const graph = {
        item: entryItem,
        children: [] as CallHierarchyNode[],
        inDegree: 0,
    }

    if (outgoing && inDegreeThreshold > 0) {
        nodes.add(graph)
        await calculateInDegrees(graph)
        nodes.clear()
    }

    await insertNode(graph)
    return graph
}

export async function getIncomingCallNode(
    entryItem: CallHierarchyItem,
    ignore: (item: vscode.CallHierarchyItem) => boolean,
) {
    return await getCallNode(entryItem, ignore, false)
}

export async function getOutgoingCallNode(
    entryItem: CallHierarchyItem,
    ignore: (item: vscode.CallHierarchyItem) => boolean,
) {
    return await getCallNode(entryItem, ignore, true)
}

function isCallHierarchyItemEqual(a: CallHierarchyItem, b: CallHierarchyItem) {
    return (
        a.name === b.name &&
        a.kind === b.kind &&
        a.uri.toString() === b.uri.toString() &&
        a.range.start.line === b.range.start.line &&
        a.range.start.character === b.range.start.character
    )
}
