import * as vscode from 'vscode'
import { output } from './extension'

const CALLABLE_SYMBOL_KINDS = new Set([
    vscode.SymbolKind.Function,
    vscode.SymbolKind.Method,
    vscode.SymbolKind.Constructor,
])

const TYPE_SYMBOL_KINDS = new Set([
    vscode.SymbolKind.Class,
    vscode.SymbolKind.Interface,
    vscode.SymbolKind.Struct,
    vscode.SymbolKind.Enum,
])

const CALL_ENTRY_NOT_FOUND =
    "CallGraph: Can't resolve entry function. Put the cursor on a function or method name — interfaces, types and fields have no call hierarchy — and wait until the language server for this file has finished loading."

const TYPE_ENTRY_NOT_FOUND =
    "CallGraph: Can't resolve entry type. Put the cursor on a class, interface, struct or enum name, and wait until the language server for this file has finished loading. Note that not every language server implements type hierarchy."

/** how long to wait before retrying a language server that is still starting up */
const RETRY_DELAY_MS = 500

const prepareHierarchy = async <T>(
    command: string,
    uri: vscode.Uri,
    position: vscode.Position,
) => {
    const items = await vscode.commands.executeCommand<T[] | undefined>(
        command,
        uri,
        position,
    )
    return items?.[0] ?? null
}

/**
 * Find the innermost symbol of one of the given kinds containing the position
 */
export const findEnclosingSymbol = (
    symbols: vscode.DocumentSymbol[] | undefined,
    position: vscode.Position,
    kinds: Set<vscode.SymbolKind>,
): vscode.DocumentSymbol | null => {
    for (const symbol of symbols ?? []) {
        // a legacy SymbolInformation provider has no `range`, skip it
        if (!symbol.range || !symbol.range.contains(position)) continue
        const inner = findEnclosingSymbol(symbol.children, position, kinds)
        if (inner) return inner
        if (kinds.has(symbol.kind)) return symbol
    }
    return null
}

/**
 * Resolve the hierarchy item the diagram should start from. The cursor is
 * often not exactly on a symbol name, so this widens the search instead of
 * failing on the first empty result.
 */
const resolveEntry = async <T>(
    editor: vscode.TextEditor,
    command: string,
    kinds: Set<vscode.SymbolKind>,
    notFoundMessage: string,
): Promise<T | null> => {
    const uri = editor.document.uri
    const position = editor.selection.active

    const atCursor = await prepareHierarchy<T>(command, uri, position)
    if (atCursor) return atCursor

    // the language server may still be starting up, retry once
    await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS))
    const afterRetry = await prepareHierarchy<T>(command, uri, position)
    if (afterRetry) return afterRetry

    // the cursor is not on a matching symbol name (body, declaration line or a
    // neighbouring declaration), fall back to the enclosing symbol
    const symbols = await vscode.commands.executeCommand<
        vscode.DocumentSymbol[] | undefined
    >('vscode.executeDocumentSymbolProvider', uri)
    const enclosing = findEnclosingSymbol(symbols, position, kinds)
    if (enclosing) {
        output.appendLine(`fallback to enclosing symbol: ${enclosing.name}`)
        const fromSymbol = await prepareHierarchy<T>(
            command,
            uri,
            (enclosing.selectionRange ?? enclosing.range).start,
        )
        if (fromSymbol) return fromSymbol
    }

    output.appendLine(
        `can't resolve entry at ${uri.fsPath}:${position.line + 1}:${position.character + 1}`,
    )
    vscode.window.showErrorMessage(notFoundMessage)
    return null
}

export const resolveCallEntry = (editor: vscode.TextEditor) =>
    resolveEntry<vscode.CallHierarchyItem>(
        editor,
        'vscode.prepareCallHierarchy',
        CALLABLE_SYMBOL_KINDS,
        CALL_ENTRY_NOT_FOUND,
    )

export const resolveTypeEntry = (editor: vscode.TextEditor) =>
    resolveEntry<vscode.TypeHierarchyItem>(
        editor,
        'vscode.prepareTypeHierarchy',
        TYPE_SYMBOL_KINDS,
        TYPE_ENTRY_NOT_FOUND,
    )
