import * as vscode from 'vscode'
import {
    CallHierarchyNode,
    getIncomingCallNode,
    getOutgoingCallNode,
} from './call'
import { generateFlowchart } from './flowchart'
import { generateMermaid } from './mermaid'
import { generateClassDiagram } from './class'
import { getSubtypeNode, getSupertypeNode, TypeDirection } from './type'
import { generateTypeDiagram } from './typeDiagram'
import { resolveCallEntry, resolveTypeEntry } from './entry'
import * as path from 'path'
import * as fs from 'fs'
import ignore from 'ignore'

export const output = vscode.window.createOutputChannel('CallGraph')

/** the webview template a diagram is rendered with */
type Template = 'Graph' | 'Sequence' | 'Class'

const TEMPLATE_FILES: Record<Template, string> = {
    Graph: 'index.html',
    Sequence: 'sequence.html',
    Class: 'class.html',
}

/** decides whether a symbol is excluded by the configured ignore file */
type IgnorePredicate = (item: { uri: vscode.Uri }) => boolean

/**
 * Resolves the entry symbol and writes the diagram source file.
 * Returns false when no entry symbol could be resolved.
 */
type DiagramBuilder = (
    editor: vscode.TextEditor,
    isIgnored: IgnorePredicate,
    outputPath: string,
) => Promise<boolean>

const getDefaultProgressOptions = (title: string): vscode.ProgressOptions => {
    return {
        location: vscode.ProgressLocation.Notification,
        title,
        cancellable: true,
    }
}

const renderHtml = (
    staticDir: string,
    webview: vscode.Webview,
    fileUri: string,
    template: Template,
) => {
    const htmlTemplate = fs
        .readFileSync(path.resolve(staticDir, TEMPLATE_FILES[template]))
        .toString()

    const html = htmlTemplate.split('$MERMAID_FILE_URI').join(fileUri)

    // assets referenced relative to the static directory, such as the bundled
    // mermaid library, have to be rewritten to webview uris to be reachable
    const staticUri = webview
        .asWebviewUri(vscode.Uri.file(staticDir))
        .toString()
    return html.replace(
        /(src|href)="\.\/([^"]+)"/g,
        (_, attr, file) => `${attr}="${staticUri}/${file}"`,
    )
}

const callDiagramBuilder = (
    getNode: (
        entryItem: vscode.CallHierarchyItem,
        isIgnored: IgnorePredicate,
    ) => Promise<CallHierarchyNode>,
    write: (graph: CallHierarchyNode, outputPath: string) => void,
): DiagramBuilder => {
    return async (editor, isIgnored, outputPath) => {
        const entry = await resolveCallEntry(editor)
        if (!entry) return false

        output.appendLine('entry: ' + entry.name)
        write(await getNode(entry, isIgnored), outputPath)
        return true
    }
}

const typeDiagramBuilder = (direction: TypeDirection): DiagramBuilder => {
    return async (editor, isIgnored, outputPath) => {
        const entry = await resolveTypeEntry(editor)
        if (!entry) return false

        output.appendLine('entry type: ' + entry.name)
        const getNode =
            direction === 'Super' ? getSupertypeNode : getSubtypeNode
        generateTypeDiagram(
            await getNode(entry, isIgnored),
            direction,
            outputPath,
        )
        return true
    }
}

const createIgnorePredicate = (workspace: vscode.Uri): IgnorePredicate => {
    let ignoreFile: string | null =
        vscode.workspace
            .getConfiguration()
            .get<string>('call-graph.ignoreFile')
            ?.replace('${workspace}', workspace.fsPath) ?? null

    if (ignoreFile && !fs.existsSync(ignoreFile)) ignoreFile = null

    return item => {
        if (ignoreFile === null) return false
        // working in the current workspace
        if (!item.uri.fsPath.startsWith(workspace.fsPath)) return true
        const ig = ignore().add(fs.readFileSync(ignoreFile).toString())
        const itemPath = item.uri.path.replace(`${workspace.path}/`, '')
        return ig.test(itemPath).ignored
    }
}

interface DiagramPanelOptions {
    title: string
    webviewType: string
    template: Template
    build: DiagramBuilder
    outputFile: vscode.Uri
    staticDir: string
    onReceiveMsg: (msg: WebviewMsg) => void
}

const generateDiagram = (options: DiagramPanelOptions) => {
    return async () => {
        const activeTextEditor = vscode.window.activeTextEditor
        if (!activeTextEditor) {
            vscode.window.showErrorMessage("Can't get active text editor")
            return
        }

        const workspace = vscode.workspace.workspaceFolders?.[0]?.uri
        if (!workspace) {
            vscode.window.showErrorMessage("Can't get workspace uri")
            return
        }

        const built = await options.build(
            activeTextEditor,
            createIgnorePredicate(workspace),
            options.outputFile.fsPath,
        )
        if (!built) return

        const panel = vscode.window.createWebviewPanel(
            options.webviewType,
            options.title,
            vscode.ViewColumn.Beside,
            {
                localResourceRoots: [vscode.Uri.file(options.staticDir)],
                enableScripts: true,
            },
        )
        panel.webview.html = renderHtml(
            options.staticDir,
            panel.webview,
            panel.webview.asWebviewUri(options.outputFile).toString(),
            options.template,
        )
        panel.webview.onDidReceiveMessage(options.onReceiveMsg)
    }
}

interface WebviewMsg {
    command: string
    data: string
    filename?: string
    contentType?: string
}

const registerWebviewPanelSerializer = (
    staticDir: string,
    webViewType: string,
    template: Template,
    onReceiveMsg: (msg: WebviewMsg) => void,
) => {
    return vscode.window.registerWebviewPanelSerializer(webViewType, {
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

            webviewPanel.webview.html = renderHtml(
                staticDir,
                webviewPanel.webview,
                state,
                template,
            )
            webviewPanel.webview.onDidReceiveMessage(onReceiveMsg)
        },
    })
}

interface DiagramCommand {
    command: string
    progressTitle: string
    title: string
    webviewType: string
    template: Template
    /** name of the generated file inside the static directory */
    dataFile: string
    /** default file name offered when the user exports the diagram */
    savedName: string
    build: DiagramBuilder
}

const DIAGRAM_COMMANDS: DiagramCommand[] = [
    {
        command: 'CallGraph.showIncomingCallGraph',
        progressTitle: 'Generate call graph',
        title: 'Call Graph Incoming',
        webviewType: 'CallGraph.previewGraphIncoming',
        template: 'Graph',
        dataFile: 'graph_data_incoming.mmd',
        savedName: 'call_graph_incoming',
        build: callDiagramBuilder(getIncomingCallNode, generateFlowchart),
    },
    {
        command: 'CallGraph.showOutgoingCallGraph',
        progressTitle: 'Generate call graph',
        title: 'Call Graph Outgoing',
        webviewType: 'CallGraph.previewGraphOutgoing',
        template: 'Graph',
        dataFile: 'graph_data_outgoing.mmd',
        savedName: 'call_graph_outgoing',
        build: callDiagramBuilder(getOutgoingCallNode, generateFlowchart),
    },
    {
        command: 'CallGraph.showIncomingSequenceDiagram',
        progressTitle: 'Generate sequence diagram',
        title: 'Sequence Diagram Incoming',
        webviewType: 'CallGraph.previewSequenceIncoming',
        template: 'Sequence',
        dataFile: 'sequence_data_incoming.mmd',
        savedName: 'sequence_diagram_incoming',
        build: callDiagramBuilder(getIncomingCallNode, generateMermaid),
    },
    {
        command: 'CallGraph.showOutgoingSequenceDiagram',
        progressTitle: 'Generate sequence diagram',
        title: 'Sequence Diagram Outgoing',
        webviewType: 'CallGraph.previewSequenceOutgoing',
        template: 'Sequence',
        dataFile: 'sequence_data_outgoing.mmd',
        savedName: 'sequence_diagram_outgoing',
        build: callDiagramBuilder(getOutgoingCallNode, generateMermaid),
    },
    {
        command: 'CallGraph.showIncomingClassDiagram',
        progressTitle: 'Generate class diagram',
        title: 'Class Diagram Incoming',
        webviewType: 'CallGraph.previewClassIncoming',
        template: 'Class',
        dataFile: 'class_data_incoming.mmd',
        savedName: 'class_diagram_incoming',
        build: callDiagramBuilder(getIncomingCallNode, generateClassDiagram),
    },
    {
        command: 'CallGraph.showOutgoingClassDiagram',
        progressTitle: 'Generate class diagram',
        title: 'Class Diagram Outgoing',
        webviewType: 'CallGraph.previewClassOutgoing',
        template: 'Class',
        dataFile: 'class_data_outgoing.mmd',
        savedName: 'class_diagram_outgoing',
        build: callDiagramBuilder(getOutgoingCallNode, generateClassDiagram),
    },
    {
        command: 'CallGraph.showSupertypes',
        progressTitle: 'Generate type hierarchy',
        title: 'Type Hierarchy Supertypes',
        webviewType: 'CallGraph.previewTypeSuper',
        template: 'Class',
        dataFile: 'type_data_super.mmd',
        savedName: 'type_hierarchy_supertypes',
        build: typeDiagramBuilder('Super'),
    },
    {
        command: 'CallGraph.showSubtypes',
        progressTitle: 'Generate type hierarchy',
        title: 'Type Hierarchy Subtypes',
        webviewType: 'CallGraph.previewTypeSub',
        template: 'Class',
        dataFile: 'type_data_sub.mmd',
        savedName: 'type_hierarchy_subtypes',
        build: typeDiagramBuilder('Sub'),
    },
]

/** default extension of an exported file, by the content type it was sent with */
const EXPORT_EXTENSIONS: Record<string, string> = {
    'image/svg+xml': 'svg',
    'text/plain': 'mmd',
}

const onReceiveMsgFactory =
    (workspace: vscode.Uri, savedName: string) => (msg: WebviewMsg) => {
        if (msg.command === 'exportFile') {
            // Handle the exportFile command from the diagram templates
            const handleExport = async () => {
                try {
                    // Determine file extension based on contentType or use the one in filename
                    const extension =
                        EXPORT_EXTENSIONS[msg.contentType ?? ''] ?? 'txt'
                    const filename = msg.filename || `${savedName}.${extension}`

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
                        defaultUri: vscode.Uri.joinPath(workspace, filename),
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

export function activate(context: vscode.ExtensionContext) {
    const staticDir = path.resolve(context.extensionPath, 'static')
    if (!fs.existsSync(staticDir)) fs.mkdirSync(staticDir)

    const workspace = vscode.workspace.workspaceFolders?.[0]?.uri
    if (!workspace) {
        vscode.window.showErrorMessage("Can't get workspace uri")
        return
    }

    for (const spec of DIAGRAM_COMMANDS) {
        const outputFile = vscode.Uri.file(
            path.resolve(staticDir, spec.dataFile),
        )
        const onReceiveMsg = onReceiveMsgFactory(workspace, spec.savedName)

        context.subscriptions.push(
            vscode.commands.registerCommand(spec.command, async () => {
                vscode.window.withProgress(
                    getDefaultProgressOptions(spec.progressTitle),
                    generateDiagram({
                        title: spec.title,
                        webviewType: spec.webviewType,
                        template: spec.template,
                        build: spec.build,
                        outputFile,
                        staticDir,
                        onReceiveMsg,
                    }),
                )
            }),
            registerWebviewPanelSerializer(
                staticDir,
                spec.webviewType,
                spec.template,
                onReceiveMsg,
            ),
        )
    }
}
