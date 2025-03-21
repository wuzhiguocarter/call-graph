import * as vscode from 'vscode'
import {
    CallHierarchyNode,
    getIncomingCallNode,
    getOutgoingCallNode,
} from './call'
import { generateDot } from './dot'
import { generateMermaid } from './mermaid'
import { generateClassDiagram } from './class'
import { generateControlFlowDiagram } from './controlflow'
import * as path from 'path'
import * as fs from 'fs'
import ignore from 'ignore'

export const output = vscode.window.createOutputChannel('CallGraph')

const getDefaultProgressOptions = (title: string): vscode.ProgressOptions => {
    return {
        location: vscode.ProgressLocation.Notification,
        title,
        cancellable: true,
    }
}

const getHtmlContent = (
    staticDir: string,
    fileUri: string,
    diagramType: 'Graph' | 'Sequence' | 'Class' | 'ControlFlow' = 'Graph',
) => {
    const htmlTemplate = fs
        .readFileSync(
            path.resolve(
                staticDir,
                diagramType === 'Graph'
                    ? 'index.html'
                    : diagramType === 'Sequence'
                      ? 'sequence.html'
                      : diagramType === 'Class'
                        ? 'class.html'
                        : 'controlflow.html',
            ),
        )
        .toString()

    if (diagramType === 'Graph') {
        return htmlTemplate.split('$DOT_FILE_URI').join(fileUri)
    } else {
        return htmlTemplate.split('$MERMAID_FILE_URI').join(fileUri)
    }
}

const generateDiagram = (
    type: 'Incoming' | 'Outgoing',
    callNodeFunction: (
        entryItem: vscode.CallHierarchyItem,
        ignore: (item: vscode.CallHierarchyItem) => boolean,
    ) => Promise<CallHierarchyNode>,
    outputFile: vscode.Uri,
    staticDir: string,
    onReceiveMsg: (msg: WebviewMsg) => void,
    diagramType: 'Graph' | 'Sequence' | 'Class' | 'ControlFlow' = 'Graph',
) => {
    return async () => {
        const activeTextEditor = vscode.window.activeTextEditor
        if (!activeTextEditor) {
            vscode.window.showErrorMessage("Can't get active text editor")
            return
        }

        const entry: vscode.CallHierarchyItem[] =
            await vscode.commands.executeCommand(
                'vscode.prepareCallHierarchy',
                activeTextEditor.document.uri,
                activeTextEditor.selection.active,
            )
        if (!entry || !entry[0]) {
            vscode.window.showErrorMessage("Can't resolve entry function")
            return
        }

        const workspace = vscode.workspace.workspaceFolders?.[0].uri
        if (!workspace) {
            vscode.window.showErrorMessage("Can't get workspace uri")
            return
        }

        let ignoreFile: string | null =
            vscode.workspace
                .getConfiguration()
                .get<string>('call-graph.ignoreFile')
                ?.replace('${workspace}', workspace.fsPath) ?? null

        if (ignoreFile && !fs.existsSync(ignoreFile)) ignoreFile = null
        const graph = await callNodeFunction(entry[0], item => {
            if (ignoreFile === null) return false
            // working in the current workspace
            if (!item.uri.fsPath.startsWith(workspace.fsPath)) return true
            const ig = ignore().add(fs.readFileSync(ignoreFile).toString())
            const itemPath = item.uri.path.replace(`${workspace.path}/`, '')
            const ignored = ig.test(itemPath).ignored
            return ignored
        })

        if (diagramType === 'Graph') {
            generateDot(graph, outputFile.fsPath)
        } else if (diagramType === 'Sequence') {
            generateMermaid(graph, outputFile.fsPath)
        } else if (diagramType === 'Class') {
            generateClassDiagram(graph, outputFile.fsPath)
        } else if (diagramType === 'ControlFlow') {
            generateControlFlowDiagram(graph, outputFile.fsPath)
        }

        const webviewType = `CallGraph.preview${diagramType}${type}`
        const panel = vscode.window.createWebviewPanel(
            webviewType,
            `${diagramType === 'Graph' ? 'Call Graph' : diagramType === 'Sequence' ? 'Sequence Diagram' : diagramType === 'Class' ? 'Class Diagram' : 'Control Flow Diagram'} ${type}`,
            vscode.ViewColumn.Beside,
            {
                localResourceRoots: [vscode.Uri.file(staticDir)],
                enableScripts: true,
            },
        )
        const fileUri = panel.webview.asWebviewUri(outputFile).toString()
        panel.webview.html = getHtmlContent(staticDir, fileUri, diagramType)
        panel.webview.onDidReceiveMessage(onReceiveMsg)
    }
}

interface WebviewMsg {
    command: string
    type: 'dot' | 'svg'
    data: string
    filename?: string
    contentType?: string
}

const registerWebviewPanelSerializer = (
    staticDir: string,
    webViewType: string,
    onReceiveMsg: (msg: WebviewMsg) => void,
) => {
    vscode.window.registerWebviewPanelSerializer(webViewType, {
        async deserializeWebviewPanel(
            webviewPanel: vscode.WebviewPanel,
            state: string,
        ) {
            if (!state) {
                vscode.window.showErrorMessage(
                    'CallGraph: fail to load previous state',
                )
                return
            }
            webviewPanel.webview.html = getHtmlContent(staticDir, state)
            webviewPanel.webview.onDidReceiveMessage(onReceiveMsg)
        },
    })
}

export function activate(context: vscode.ExtensionContext) {
    const staticDir = path.resolve(context.extensionPath, 'static')
    if (!fs.existsSync(staticDir)) fs.mkdirSync(staticDir)

    const workspace = vscode.workspace.workspaceFolders?.[0].uri
    if (!workspace) {
        vscode.window.showErrorMessage("Can't get workspace uri")
        return
    }

    const dotFileOutgoing = vscode.Uri.file(
        path.resolve(staticDir, 'graph_data_outgoing.dot'),
    )
    const dotFileIncoming = vscode.Uri.file(
        path.resolve(staticDir, 'graph_data_incoming.dot'),
    )
    const mermaidFileOutgoing = vscode.Uri.file(
        path.resolve(staticDir, 'sequence_data_outgoing.mmd'),
    )
    const mermaidFileIncoming = vscode.Uri.file(
        path.resolve(staticDir, 'sequence_data_incoming.mmd'),
    )
    const classFileOutgoing = vscode.Uri.file(
        path.resolve(staticDir, 'class_data_outgoing.mmd'),
    )
    const classFileIncoming = vscode.Uri.file(
        path.resolve(staticDir, 'class_data_incoming.mmd'),
    )
    const controlFlowFileOutgoing = vscode.Uri.file(
        path.resolve(staticDir, 'controlflow_data_outgoing.mmd'),
    )
    const controlFlowFileIncoming = vscode.Uri.file(
        path.resolve(staticDir, 'controlflow_data_incoming.mmd'),
    )

    const onReceiveMsgFactory =
        (
            type: 'Incoming' | 'Outgoing',
            diagramType:
                | 'Graph'
                | 'Sequence'
                | 'Class'
                | 'ControlFlow' = 'Graph',
        ) =>
        (msg: WebviewMsg) => {
            const savedName =
                type === 'Incoming'
                    ? diagramType === 'Graph'
                        ? 'call_graph_incoming'
                        : diagramType === 'Sequence'
                          ? 'sequence_diagram_incoming'
                          : diagramType === 'Class'
                            ? 'class_diagram_incoming'
                            : 'controlflow_diagram_incoming'
                    : diagramType === 'Graph'
                      ? 'call_graph_outgoing'
                      : diagramType === 'Sequence'
                        ? 'sequence_diagram_outgoing'
                        : diagramType === 'Class'
                          ? 'class_diagram_outgoing'
                          : 'controlflow_diagram_outgoing'
            if (msg.command === 'download') {
                const onDowload = async (fileType: 'dot' | 'svg') => {
                    const f = await vscode.window.showSaveDialog({
                        filters:
                            fileType === 'svg'
                                ? { Image: ['svg'] }
                                : { Graphviz: ['dot', 'gv'] },
                        defaultUri: vscode.Uri.joinPath(
                            workspace,
                            `${savedName}.${fileType}`,
                        ),
                    })
                    if (!f) return
                    fs.writeFileSync(f.fsPath, msg.data)
                    vscode.window.showInformationMessage(
                        'Call Graph file saved: ' + f.fsPath,
                    )
                }
                onDowload(msg.type)
            } else if (msg.command === 'exportFile') {
                // Handle the exportFile command from sequence.html
                const handleExport = async () => {
                    try {
                        // Determine file extension based on contentType or use the one in filename
                        const filename = msg.filename || `${savedName}.txt`

                        // Set up filters based on content type
                        const filters: { [key: string]: string[] } = {}
                        if (msg.contentType === 'image/svg+xml') {
                            filters.Image = ['svg']
                        } else if (msg.contentType === 'text/plain') {
                            filters.Text = ['mmd', 'txt']
                        } else {
                            filters.All = ['*']
                        }

                        const f = await vscode.window.showSaveDialog({
                            filters,
                            defaultUri: vscode.Uri.joinPath(
                                workspace,
                                filename,
                            ),
                        })

                        if (!f) return

                        fs.writeFileSync(f.fsPath, msg.data)
                        vscode.window.showInformationMessage(
                            'File saved: ' + f.fsPath,
                        )
                    } catch (error) {
                        console.error('Error exporting file:', error)
                        vscode.window.showErrorMessage(
                            'Failed to export file: ' +
                                (error instanceof Error
                                    ? error.message
                                    : String(error)),
                        )
                    }
                }

                handleExport()
            }
        }

    const incomingDisposable = vscode.commands.registerCommand(
        'CallGraph.showIncomingCallGraph',
        async () => {
            vscode.window.withProgress(
                getDefaultProgressOptions('Generate call graph'),
                generateDiagram(
                    'Incoming',
                    getIncomingCallNode,
                    dotFileIncoming,
                    staticDir,
                    onReceiveMsgFactory('Incoming', 'Graph'),
                    'Graph',
                ),
            )
        },
    )
    const outgoingDisposable = vscode.commands.registerCommand(
        'CallGraph.showOutgoingCallGraph',
        async () => {
            vscode.window.withProgress(
                getDefaultProgressOptions('Generate call graph'),
                generateDiagram(
                    'Outgoing',
                    getOutgoingCallNode,
                    dotFileOutgoing,
                    staticDir,
                    onReceiveMsgFactory('Outgoing', 'Graph'),
                    'Graph',
                ),
            )
        },
    )

    // New commands for sequence diagrams
    const incomingSequenceDisposable = vscode.commands.registerCommand(
        'CallGraph.showIncomingSequenceDiagram',
        async () => {
            vscode.window.withProgress(
                getDefaultProgressOptions('Generate sequence diagram'),
                generateDiagram(
                    'Incoming',
                    getIncomingCallNode,
                    mermaidFileIncoming,
                    staticDir,
                    onReceiveMsgFactory('Incoming', 'Sequence'),
                    'Sequence',
                ),
            )
        },
    )
    const outgoingSequenceDisposable = vscode.commands.registerCommand(
        'CallGraph.showOutgoingSequenceDiagram',
        async () => {
            vscode.window.withProgress(
                getDefaultProgressOptions('Generate sequence diagram'),
                generateDiagram(
                    'Outgoing',
                    getOutgoingCallNode,
                    mermaidFileOutgoing,
                    staticDir,
                    onReceiveMsgFactory('Outgoing', 'Sequence'),
                    'Sequence',
                ),
            )
        },
    )
    // New commands for class diagrams
    const incomingClassDisposable = vscode.commands.registerCommand(
        'CallGraph.showIncomingClassDiagram',
        async () => {
            vscode.window.withProgress(
                getDefaultProgressOptions('Generate class diagram'),
                generateDiagram(
                    'Incoming',
                    getIncomingCallNode,
                    classFileIncoming,
                    staticDir,
                    onReceiveMsgFactory('Incoming', 'Class'),
                    'Class',
                ),
            )
        },
    )
    const outgoingClassDisposable = vscode.commands.registerCommand(
        'CallGraph.showOutgoingClassDiagram',
        async () => {
            vscode.window.withProgress(
                getDefaultProgressOptions('Generate class diagram'),
                generateDiagram(
                    'Outgoing',
                    getOutgoingCallNode,
                    classFileOutgoing,
                    staticDir,
                    onReceiveMsgFactory('Outgoing', 'Class'),
                    'Class',
                ),
            )
        },
    )
    // New commands for control flow diagrams
    const incomingControlFlowDisposable = vscode.commands.registerCommand(
        'CallGraph.showIncomingControlFlowDiagram',
        async () => {
            vscode.window.withProgress(
                getDefaultProgressOptions(
                    'Generate incoming control flow diagram',
                ),
                generateDiagram(
                    'Incoming',
                    getIncomingCallNode,
                    controlFlowFileIncoming,
                    staticDir,
                    onReceiveMsgFactory('Incoming', 'ControlFlow'),
                    'ControlFlow',
                ),
            )
        },
    )
    const outgoingControlFlowDisposable = vscode.commands.registerCommand(
        'CallGraph.showOutgoingControlFlowDiagram',
        async () => {
            vscode.window.withProgress(
                getDefaultProgressOptions(
                    'Generate outgoing control flow diagram',
                ),
                generateDiagram(
                    'Outgoing',
                    getOutgoingCallNode,
                    controlFlowFileOutgoing,
                    staticDir,
                    onReceiveMsgFactory('Outgoing', 'ControlFlow'),
                    'ControlFlow',
                ),
            )
        },
    )

    // Register serializers for call graph webviews
    registerWebviewPanelSerializer(
        staticDir,
        `CallGraph.previewGraphIncoming`,
        onReceiveMsgFactory('Incoming', 'Graph'),
    )
    registerWebviewPanelSerializer(
        staticDir,
        'CallGraph.previewGraphOutgoing',
        onReceiveMsgFactory('Outgoing', 'Graph'),
    )

    // Register serializers for sequence diagram webviews
    registerWebviewPanelSerializer(
        staticDir,
        `CallGraph.previewSequenceIncoming`,
        onReceiveMsgFactory('Incoming', 'Sequence'),
    )
    registerWebviewPanelSerializer(
        staticDir,
        'CallGraph.previewSequenceOutgoing',
        onReceiveMsgFactory('Outgoing', 'Sequence'),
    )

    // Register serializers for class diagram webviews
    registerWebviewPanelSerializer(
        staticDir,
        `CallGraph.previewClassIncoming`,
        onReceiveMsgFactory('Incoming', 'Class'),
    )
    registerWebviewPanelSerializer(
        staticDir,
        'CallGraph.previewClassOutgoing',
        onReceiveMsgFactory('Outgoing', 'Class'),
    )

    // Register serializers for control flow diagram webviews
    registerWebviewPanelSerializer(
        staticDir,
        'CallGraph.previewControlFlowIncoming',
        onReceiveMsgFactory('Incoming', 'ControlFlow'),
    )
    registerWebviewPanelSerializer(
        staticDir,
        'CallGraph.previewControlFlowOutgoing',
        onReceiveMsgFactory('Outgoing', 'ControlFlow'),
    )

    // Add all disposables to context
    context.subscriptions.push(
        incomingDisposable,
        outgoingDisposable,
        incomingSequenceDisposable,
        outgoingSequenceDisposable,
        incomingClassDisposable,
        outgoingClassDisposable,
        incomingControlFlowDisposable,
        outgoingControlFlowDisposable,
    )
}
