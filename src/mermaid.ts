import { CallHierarchyNode } from './call'
import * as fs from 'fs'
import * as crypto from 'crypto'
import * as path from 'path'
import * as vscode from 'vscode'
import { output } from './extension'

/**
 * Generate a Mermaid sequence diagram from a call hierarchy node
 * @param graph The call hierarchy node to generate the diagram from
 * @param path The path to save the generated mermaid file
 * @returns The generated Mermaid diagram object
 */
export function generateMermaid(graph: CallHierarchyNode, path: string) {
    const mermaid = new MermaidSequenceDiagram()

    // 存储参与者路径和对应的显示名称
    const participants = new Map<string, string>()
    // 存储调用关系用于拓扑排序
    const callGraph = new Map<string, Set<string>>()
    // 调用路径集合用于去重
    const callSignatures = new Set<string>()
    // 获取工作区根路径
    const workspaceRoot =
        vscode.workspace.workspaceFolders?.[0].uri.fsPath || ''

    // Store file paths and line numbers for click events
    const participantMetadata = new Map<string, { filePath: string; line: number; character: number }>()

    // Sets to track visited nodes and detect cycles
    const visited = new Set<string>()

    // Store calls in order of discovery to preserve sequence
    const orderedCalls: Array<[string, string, string]> = []

    // Get the in-degree threshold from settings
    const inDegreeThreshold =
        vscode.workspace
            .getConfiguration()
            .get<number>('call-graph.inDegreeThreshold') || 5

    output.appendLine(
        `Generating Mermaid sequence diagram with in-degree threshold: ${inDegreeThreshold}...`,
    )

    // 构建调用图并收集参与者
    traverseForCallGraph(
        graph,
        callGraph,
        participants,
        participantMetadata,
        workspaceRoot,
        visited,
        orderedCalls,
        inDegreeThreshold,
    )

    // 添加参与者到图表（使用相对路径）
    participants.forEach((displayName, filePath) => {
        mermaid.addParticipant(filePath, displayName)
        
        // Add click event for the participant if metadata exists
        if (participantMetadata.has(filePath)) {
            const metadata = participantMetadata.get(filePath)!
            mermaid.addClickEvent(
                displayName,
                metadata.filePath,
                metadata.line,
                metadata.character
            )
        }
    })

    // Use the ordered calls instead of topological sort
    // 生成Mermaid调用��列
    orderedCalls.forEach(([callerPath, calleePath, callLabel]) => {
        const signature = `${callerPath}->${calleePath}:${callLabel}`
        if (!callSignatures.has(signature)) {
            mermaid.addSimpleCall(
                participants.get(callerPath)!,
                participants.get(calleePath)!,
                callLabel,
            )
            callSignatures.add(signature)
        }
    })

    // Save the generated diagram to a file
    fs.writeFileSync(path, mermaid.toString())
    output.appendLine('Generated Mermaid sequence diagram: ' + path)

    return mermaid
}

/**
 * Traverse the call hierarchy to build a sequence of function calls
 */
/**
 * 构建调用图结构
 */
function traverseForCallGraph(
    node: CallHierarchyNode,
    callGraph: Map<string, Set<string>>,
    participants: Map<string, string>,
    participantMetadata: Map<string, { filePath: string; line: number; character: number }>,
    workspaceRoot: string,
    visited: Set<string> = new Set(),
    orderedCalls: Array<[string, string, string]> = [],
    inDegreeThreshold: number = 5,
) {
    // 获取文件相对路径作为参与者标识
    const fullPath = node.item.uri.fsPath
    const callerPath = workspaceRoot
        ? path.relative(workspaceRoot, fullPath).replace(/\\/g, '/')
        : fullPath

    // 添加调用方参与者
    if (!participants.has(callerPath)) {
        const callerShortName =
            path.basename(callerPath) +
            '#' +
            crypto.randomBytes(2).toString('hex')
        participants.set(callerPath, callerShortName)
        
        // Store metadata for click event
        participantMetadata.set(callerPath, {
            filePath: node.item.uri.toString(),
            line: node.item.range.start.line,
            character: node.item.range.start.character
        })
    }

    // Sort children by source position before processing
    const sortedChildren = [...node.children].sort((a, b) => {
        // If both nodes have source positions, sort by line and character
        if (a.sourcePosition && b.sourcePosition) {
            if (a.sourcePosition.line !== b.sourcePosition.line) {
                return a.sourcePosition.line - b.sourcePosition.line
            }
            return a.sourcePosition.character - b.sourcePosition.character
        }

        // If only one has source position, prioritize the one with position
        if (a.sourcePosition) return -1
        if (b.sourcePosition) return 1

        // If neither has source position, maintain original order
        return 0
    })

    // Log the sorted order for debugging
    if (sortedChildren.length > 1) {
        output.appendLine(
            `Sorted ${sortedChildren.length} children of ${node.item.name} by source position`,
        )
        sortedChildren.forEach((child, index) => {
            const pos = child.sourcePosition
                ? `Line ${child.sourcePosition.line}, Char ${child.sourcePosition.character}`
                : 'No position'
            output.appendLine(`  ${index}: ${child.item.name} (${pos})`)
        })
    }

    // 处理子节点时动态添加被调用方
    sortedChildren.forEach(child => {
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

        const childFullPath = child.item.uri.fsPath
        const calleePath = workspaceRoot
            ? path.relative(workspaceRoot, childFullPath).replace(/\\/g, '/')
            : childFullPath

        // 添加被调用方参与者（如果不存在）
        if (!participants.has(calleePath)) {
            const calleeShortName =
                path.basename(calleePath) +
                '#' +
                crypto.randomBytes(2).toString('hex')
            participants.set(calleePath, calleeShortName)
            
            // Store metadata for click event
            participantMetadata.set(calleePath, {
                filePath: child.item.uri.toString(),
                line: child.item.range.start.line,
                character: child.item.range.start.character
            })
        }

        // 添加调用关系到图
        const callLabel = child.item.name
        const edge = `${callerPath}->${calleePath}:${callLabel}`

        if (!callGraph.has(callerPath)) {
            callGraph.set(callerPath, new Set())
        }
        callGraph.get(callerPath)!.add(edge)

        // Add to ordered calls to preserve sequence
        orderedCalls.push([callerPath, calleePath, callLabel])

        // 递归处理子节点
        if (!visited.has(child.item.uri.fsPath)) {
            visited.add(child.item.uri.fsPath)
            traverseForCallGraph(
                child,
                callGraph,
                participants,
                participantMetadata,
                workspaceRoot,
                visited,
                orderedCalls,
                inDegreeThreshold,
            )
        }
    })
}

/**
 * Class to generate a Mermaid sequence diagram
 */
class MermaidSequenceDiagram {
    private _content = ''
    private _participants: string[] = []
    private _calls: string[] = []
    private _clicks: string[] = []
    private _participantIds: Map<string, string> = new Map()
    private _idCounter = 0

    constructor() {
        this._content = 'sequenceDiagram\n'
    }

    /**
     * Get a safe ID for use in Mermaid syntax
     * @param name Original name that needs to be made safe
     */
    private getSafeId(name: string): string {
        // If we already created an ID for this name, return it
        if (this._participantIds.has(name)) {
            return this._participantIds.get(name)!
        }

        // Create a new unique ID
        const id = `participant_${this._idCounter++}`
        this._participantIds.set(name, id)
        return id
    }

    /**
     * Add a participant to the diagram
     * @param fullName The full name of the participant
     * @param shortName The short name to display in the diagram
     */
    addParticipant(fullName: string, shortName: string) {
        // Get a safe ID for this participant
        const safeId = this.getSafeId(shortName)

        // Escape any special characters in the shortName
        const safeShortName = shortName.replace(/[\"\\]/g, '\\$&').slice(0, -5)

        // Use just the shortName as the display name - it's already more readable
        // in the getUniqueShortName function
        this._participants.push(`    participant ${safeId} as ${safeShortName}`)
    }

    /**
     * Add a click event to a participant
     * @param participantName The name of the participant to add the click event to
     * @param filePath The file path to navigate to
     * @param line The line number to navigate to
     * @param character The character position to navigate to
     */
    addClickEvent(participantName: string, filePath: string, line: number, character: number) {
        const safeId = this.getSafeId(participantName)
        
        // Create a callback that will be handled by the webview
        // The callback includes the file URI, line, and character position
        this._clicks.push(`    click ${safeId} callback "navigate:${filePath}:${line}:${character}"`)
    }

    /**
     * Add a call between two participants with activation
     * @param from The participant making the call
     * @param to The participant receiving the call
     * @param label The label for the call arrow
     */
    addCall(from: string, to: string, label: string) {
        // Get safe IDs for both participants
        const safeFrom = this.getSafeId(from)
        const safeTo = this.getSafeId(to)

        // Escape any special characters in the label
        const safeLabel = label.replace(/[\"\\]/g, '\\$&')

        this._calls.push(`    ${safeFrom}->>+${safeTo}: ${safeLabel}`)
    }

    /**
     * Add a simple call between two participants without activation
     * @param from The participant making the call
     * @param to The participant receiving the call
     * @param label The label for the call arrow
     */
    addSimpleCall(from: string, to: string, label: string) {
        // Get safe IDs for both participants
        const safeFrom = this.getSafeId(from)
        const safeTo = this.getSafeId(to)

        // Escape any special characters in the label
        const safeLabel = label.replace(/[\"\\]/g, '\\$&')

        // Use simple arrow without activation
        this._calls.push(`    ${safeFrom}->>${safeTo}: ${safeLabel}`)
    }

    /**
     * Add a return from one participant to another with deactivation
     * @param from The participant returning
     * @param to The participant receiving the return
     * @param label The label for the return arrow
     */
    addReturn(from: string, to: string, label: string = 'return') {
        // Get safe IDs for both participants
        const safeFrom = this.getSafeId(from)
        const safeTo = this.getSafeId(to)

        // Escape any special characters in the label
        const safeLabel = label.replace(/[\"\\]/g, '\\$&')

        this._calls.push(`    ${safeFrom}-->>-${safeTo}: ${safeLabel}`)
    }

    /**
     * Add a simple return from one participant to another without deactivation
     * @param from The participant returning
     * @param to The participant receiving the return
     * @param label The label for the return arrow
     */
    addSimpleReturn(from: string, to: string, label: string = 'return') {
        // Get safe IDs for both participants
        const safeFrom = this.getSafeId(from)
        const safeTo = this.getSafeId(to)

        // Escape any special characters in the label
        const safeLabel = label.replace(/[\"\\]/g, '\\$&')

        // Use dashed arrow without deactivation
        this._calls.push(`    ${safeFrom}-->>${safeTo}: ${safeLabel}`)
    }

    /**
     * Convert the diagram to a string
     */
    toString(): string {
        // Combine all participants, calls, and click events
        return (
            this._content +
            this._participants.join('\n') +
            '\n' +
            this._calls.join('\n') +
            '\n' +
            this._clicks.join('\n') +
            '\n'
        )
    }
}
