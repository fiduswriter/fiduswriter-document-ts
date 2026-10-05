import type {FidusNode} from "../../types.js"

// Return a json that is the same as the existing json, but with all parts
// marked as hidden removed.

export const removeHidden = (
    node: FidusNode,
    // Whether to leave the outer part of the removed node.
    // True for tree-walking exporters, false for DOM-changing exporters.
    leaveStub = true,
    removeTableCaption = false,
    removeTableCaptionText = false,
    removeFigureCaption = false,
    removeFigureCaptionText = false
): FidusNode | false => {
    const returnNode: FidusNode = {type: node.type}

    Object.keys(node).forEach(key => {
        if (key !== "content") {
            ;(returnNode as unknown as Record<string, unknown>)[key] = (node as unknown as Record<string, unknown>)[key]
        }
    })
    if (node.attrs?.hidden) {
        return leaveStub ? returnNode : false
    } else if ("table_caption" === node.type) {
        if (removeTableCaption) {
            return leaveStub ? returnNode : false
        } else if (removeTableCaptionText) {
            return returnNode
        }
    } else if ("figure_caption" === node.type) {
        if (removeFigureCaption) {
            return leaveStub ? returnNode : false
        } else if (removeFigureCaptionText) {
            return returnNode
        }
    }
    if (node.attrs?.caption === false) {
        if (node.attrs.category === "none") {
            if (node.type === "figure") {
                removeFigureCaption = true
            } else {
                removeTableCaption = true
            }
        } else {
            if (node.type === "figure") {
                removeFigureCaptionText = true
            } else {
                removeTableCaptionText = true
            }
        }
    }
    if (node.content) {
        returnNode.content = []
        node.content.forEach(child => {
            const cleanedChild = removeHidden(
                child,
                leaveStub,
                removeTableCaption,
                removeTableCaptionText,
                removeFigureCaption,
                removeFigureCaptionText
            )
            if (cleanedChild) {
                returnNode.content!.push(cleanedChild)
            }
        })
    }
    return returnNode
}

export const descendantNodes = (node: FidusNode): FidusNode[] => {
    let returnValue: FidusNode[] = [node]
    if (node.content) {
        node.content.forEach(childNode => {
            returnValue = returnValue.concat(descendantNodes(childNode))
        })
    }
    return returnValue
}

export const textContent = (node: FidusNode): string =>
    descendantNodes(node).reduce((returnString, subNode) => {
        if (subNode.text) {
            returnString += subNode.text
        }
        return returnString
    }, "")

// PM/HTML don't have cells that have been covered, but in ODT/DOCX, these cells
// need to be present. So we add them.

interface TableCellAttrs {
    rowspan?: number
    colspan?: number
    [key: string]: unknown
}

const addCoveredTableCells = (node: FidusNode): void => {
    const rows = node.content!
    // Covered cells carry rowspan=0 & colspan=0. They are (re-)created by
    // this function, so filtering them out first makes it idempotent.
    const isCoveredMarker = (cell: FidusNode): boolean =>
        (cell.attrs as TableCellAttrs | undefined)?.rowspan === 0 &&
        (cell.attrs as TableCellAttrs | undefined)?.colspan === 0
    // Grid width: the widest row, ignoring covered cells.
    const columns = rows.reduce((max, row) => {
        const rowWidth = (row.content || [])
            .filter(cell => !isCoveredMarker(cell))
            .reduce(
                (cols, cell) => cols + (((cell.attrs as TableCellAttrs | undefined)?.colspan as number) || 1),
                0
            )
        return Math.max(max, rowWidth)
    }, 0)
    if (!columns) {
        return
    }
    // A matrix with one slot per grid position. Slots start out undefined
    // ("free") and are filled with the real cell or with a covered-cell
    // marker as the cells are placed.
    const matrix: Array<Array<FidusNode | undefined>> = Array.from(
        {length: rows.length},
        () => Array.from({length: columns}, () => undefined)
    )
    const coveredCell = (): FidusNode => ({
        type: "table_cell",
        attrs: {rowspan: 0, colspan: 0}
    })
    rows.forEach((row, currentRow) => {
        let columnIndex = 0
        ;(row.content || []).forEach(cell => {
            if (isCoveredMarker(cell)) {
                return
            }
            // Skip positions that are covered by an earlier row/colspan.
            while (matrix[currentRow][columnIndex]) {
                columnIndex++
            }
            const rowspan = ((cell.attrs as TableCellAttrs)?.rowspan as number) || 1
            const colspan = ((cell.attrs as TableCellAttrs)?.colspan as number) || 1
            for (let i = 0; i < rowspan; i++) {
                for (let j = 0; j < colspan; j++) {
                    let fixedCell: FidusNode
                    if (i === 0 && j === 0) {
                        fixedCell = cell
                    } else {
                        fixedCell = coveredCell()
                    }
                    if (
                        currentRow + i < rows.length &&
                        columnIndex + j < columns
                    ) {
                        matrix[currentRow + i][columnIndex + j] = fixedCell
                    }
                }
            }
        })
    })
    // Fill any grid positions that no cell covers (ragged rows, or cells
    // clipped by a rowspan/colspan overshoot) so the grid stays rectangular.
    matrix.forEach(rowCells =>
        rowCells.forEach((cell, index) => {
            if (!cell) {
                rowCells[index] = coveredCell()
            }
        })
    )
    node.content = matrix.map(cells => ({
        type: "table_row",
        content: cells.map(cell => cell as FidusNode)
    }))
}

export const fixTables = (node: FidusNode): FidusNode => {
    if (node.type === "table_body") {
        addCoveredTableCells(node)
    }
    if (node.content) {
        node.content.forEach(child => fixTables(child))
    }
    return node
}
