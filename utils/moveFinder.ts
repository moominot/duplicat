
import { BoardCell, Tile, PlayerMove } from '../types';
import { BOARD_SIZE } from '../constants';
import { getTrie, FrozenTrie, FrozenTrieNode, calculateMoveScore, createTile } from './scrabbleUtils';

interface Anchor {
    row: number;
    col: number;
}

interface CrossCheck {
    [key: string]: boolean; 
}

// --- MAPPINGS ---
// Internal App Char -> Dictionary Trie Char
const INTERNAL_TO_TRIE: Record<string, string> = {
    'Ç': '1',
    'Ł': '2', // L·L
    'Ý': '3', // NY
    'Û': 'Q'  // QU - The dictionary stores QU as just Q
};

// Dictionary Trie Char -> Internal App Char
const TRIE_TO_INTERNAL: Record<string, string> = {
    '1': 'Ç',
    '2': 'Ł',
    '3': 'Ý',
    'Q': 'Û'
};

// The valid alphabet used in the Trie (A-Z plus 1, 2, 3 for Ç, L·L, NY)
const TRIE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ123".split("");

const getTrieChar = (internalChar: string): string => {
    const upper = internalChar.toUpperCase();
    return INTERNAL_TO_TRIE[upper] || upper;
};

const getInternalChar = (trieChar: string, isBlank: boolean): string => {
    const base = TRIE_TO_INTERNAL[trieChar] || trieChar;
    return isBlank ? base.toLowerCase() : base;
};

export const findBestMoves = (board: BoardCell[][], rack: string[], limit: number = 10): PlayerMove[] => {
    const trie = getTrie();
    if (!trie) {
        console.error("Dictionary not loaded");
        return [];
    }
    
    // If limit is 0, we practically want "all", but we set a safe high number
    const effectiveLimit = limit === 0 ? 5000 : limit;
    let moves: PlayerMove[] = [];

    // 1. Detect if board is empty
    let isEmpty = true;
    for(let r=0; r<BOARD_SIZE; r++) {
        for(let c=0; c<BOARD_SIZE; c++) {
            if (board[r][c].tile) {
                isEmpty = false;
                break;
            }
        }
    }

    // 2. Prepare Rack
    const trieRack = rack.map(c => c === '?' ? '?' : getTrieChar(c));

    const findMovesInDirection = (
        currentBoard: BoardCell[][], 
        direction: 'H' | 'V'
    ) => {
        const crossChecks = computeCrossChecks(currentBoard, trie);
        const anchors = findAnchors(currentBoard, isEmpty);

        for (let r = 0; r < BOARD_SIZE; r++) {
            const rowAnchors = anchors.filter(a => a.row === r);
            if (rowAnchors.length === 0) continue;

            for (const anchor of rowAnchors) {
                const c = anchor.col;
                
                // Check if there is a tile immediately to the left (Prefix exists)
                if (c > 0 && currentBoard[r][c-1].tile) {
                    // EXISTING PREFIX CASE
                    // 1. Scan back to find start of the existing word fragment
                    let start = c - 1;
                    while(start > 0 && currentBoard[r][start-1].tile) start--;
                    
                    // 2. Build prefix string and traverse Trie to find the node state
                    let prefixInternal = "";
                    let currNode = trie.getRoot();
                    let validPrefix = true;

                    // Walk forward from start to c (exclusive)
                    for(let k=start; k<c; k++) {
                        const char = currentBoard[r][k].tile!.char; // internal char
                        prefixInternal += char;
                        const trieChar = getTrieChar(char);
                        
                        // Traverse one step
                        let nextNode = null;
                        for(let i=0; i<currNode.getChildCount(); i++) {
                            if (currNode.getChild(i).letter === trieChar) {
                                nextNode = currNode.getChild(i);
                                break;
                            }
                        }
                        if (nextNode) {
                            currNode = nextNode;
                        } else {
                            // The existing word on board is not in dict? (Shouldn't happen in valid game)
                            validPrefix = false; 
                            break; 
                        }
                    }

                    if (validPrefix) {
                        // Continue extending right from the anchor using the prefix state
                        // limit=0 because we are attached to existing tiles
                        extendRight(
                            currentBoard, r, c, prefixInternal, currNode, 
                            trieRack, crossChecks, moves, direction
                        );
                    }
                } else {
                    // EMPTY SPACE CASE (Standard LeftPart)
                    // Calculate limit (consecutive empty spaces to the left)
                    let limitLeft = 0;
                    let k = c - 1;
                    while (k >= 0 && !currentBoard[r][k].tile) {
                        // Stop if we hit another anchor (handled by that anchor)
                        const isAnchor = anchors.some(a => a.row === r && a.col === k);
                        if (isAnchor) break; 
                        limitLeft++;
                        k--;
                    }
                    
                    leftPart(
                        currentBoard, r, c, "", trie.getRoot(), 
                        limitLeft, trieRack, crossChecks, moves, direction
                    );
                }
            }
        }
    };

    // Run Horizontal
    findMovesInDirection(board, 'H');

    // Run Vertical (Transpose board)
    const tBoard: BoardCell[][] = [];
    for(let c=0; c<BOARD_SIZE; c++) {
        const row: BoardCell[] = [];
        for(let r=0; r<BOARD_SIZE; r++) {
            const original = board[r][c];
            row.push({
                ...original,
                row: c, 
                col: r  
            });
        }
        tBoard.push(row);
    }
    
    findMovesInDirection(tBoard, 'V');

    // Post-processing: Calculate scores and sort
    // IMPORTANT: We must score using the Original Board state.
    const scoredMoves = moves.map(m => {
        const res = calculateMoveScore(board, m.tiles, rack, m.row, m.col, m.direction);
        return {
            ...m,
            score: res.isValid ? res.score : -1,
            isValid: res.isValid,
            error: res.error
        };
    }).filter(m => m.isValid && m.score !== undefined && m.score > 0);

    // Deduplicate based on word+pos
    const uniqueMoves = new Map<string, PlayerMove>();
    scoredMoves.forEach(m => {
        const key = `${m.word}-${m.row}-${m.col}-${m.direction}`;
        if (!uniqueMoves.has(key) || (m.score || 0) > (uniqueMoves.get(key)?.score || 0)) {
            uniqueMoves.set(key, m);
        }
    });

    return Array.from(uniqueMoves.values())
        .sort((a, b) => (b.score || 0) - (a.score || 0))
        .slice(0, effectiveLimit); 
};

// --- Recursion Logic ---

const leftPart = (
    board: BoardCell[][],
    row: number,
    anchorCol: number,
    partialWordInternal: string,
    node: FrozenTrieNode,
    limit: number,
    rack: string[],
    crossChecks: CrossCheck[][],
    results: PlayerMove[],
    direction: 'H' | 'V'
) => {
    extendRight(board, row, anchorCol, partialWordInternal, node, rack, crossChecks, results, direction);

    if (limit > 0) {
        for (let i = 0; i < node.getChildCount(); i++) {
            const child = node.getChild(i);
            const trieLetter = child.letter;
            
            const rackIdx = rack.indexOf(trieLetter);
            const blankIdx = rack.indexOf('?');

            if (rackIdx !== -1) {
                const nextRack = [...rack];
                nextRack.splice(rackIdx, 1);
                const internalChar = getInternalChar(trieLetter, false);
                leftPart(board, row, anchorCol, partialWordInternal + internalChar, child, limit - 1, nextRack, crossChecks, results, direction);
            } else if (blankIdx !== -1) {
                const nextRack = [...rack];
                nextRack.splice(blankIdx, 1);
                const internalChar = getInternalChar(trieLetter, true);
                leftPart(board, row, anchorCol, partialWordInternal + internalChar, child, limit - 1, nextRack, crossChecks, results, direction);
            }
        }
    }
};

const extendRight = (
    board: BoardCell[][],
    row: number,
    col: number,
    partialWordInternal: string,
    node: FrozenTrieNode,
    rack: string[],
    crossChecks: CrossCheck[][],
    results: PlayerMove[],
    direction: 'H' | 'V'
) => {
    if (col >= BOARD_SIZE) {
        if (node.final) {
             addMove(board, row, col, partialWordInternal, results, direction);
        }
        return;
    }

    if (board[row][col].tile) {
        const existingInternal = board[row][col].tile!.char;
        const existingTrie = getTrieChar(existingInternal);

        let childNode: FrozenTrieNode | null = null;
        for(let i=0; i<node.getChildCount(); i++) {
            if (node.getChild(i).letter === existingTrie) {
                childNode = node.getChild(i);
                break;
            }
        }

        if (childNode) {
            extendRight(board, row, col + 1, partialWordInternal + existingInternal, childNode, rack, crossChecks, results, direction);
        }
        return;
    }

    if (node.final && (col === BOARD_SIZE || !board[row][col].tile)) {
        addMove(board, row, col, partialWordInternal, results, direction);
    }

    for (let i = 0; i < node.getChildCount(); i++) {
        const child = node.getChild(i);
        const trieLetter = child.letter;

        if (crossChecks[row][col] && !crossChecks[row][col][trieLetter]) {
            continue; 
        }

        const rackIdx = rack.indexOf(trieLetter);
        const blankIdx = rack.indexOf('?');

        if (rackIdx !== -1) {
            const nextRack = [...rack];
            nextRack.splice(rackIdx, 1);
            const internalChar = getInternalChar(trieLetter, false);
            extendRight(board, row, col + 1, partialWordInternal + internalChar, child, nextRack, crossChecks, results, direction);
        } else if (blankIdx !== -1) {
            const nextRack = [...rack];
            nextRack.splice(blankIdx, 1);
            const internalChar = getInternalChar(trieLetter, true);
            extendRight(board, row, col + 1, partialWordInternal + internalChar, child, nextRack, crossChecks, results, direction);
        }
    }
};

const addMove = (
    board: BoardCell[][],
    rowParam: number, // Row in the current (possibly transposed) board
    endColParam: number, // Column index (exclusive)
    wordStrInternal: string, 
    results: PlayerMove[],
    direction: 'H' | 'V'
) => {
    const len = wordStrInternal.length;
    const startColIndex = endColParam - len;
    
    // IMPORTANT: calculateMoveScore expects a dense array of tiles representing the *entire* word,
    // overlapping with existing tiles on the board.
    const tiles: Tile[] = [];
    let newTilesCount = 0;

    // Determine real coordinates for the Move object
    let moveRow: number;
    let moveCol: number;

    if (direction === 'H') {
        moveRow = rowParam;
        moveCol = startColIndex;
    } else {
        // If vertical, the board passed was transposed.
        // rowParam is actually the Real Column.
        // startColIndex is actually the Real Row.
        moveRow = startColIndex;
        moveCol = rowParam;
    }

    for (let i = 0; i < len; i++) {
        const r = rowParam;
        const c = startColIndex + i;
        const cell = board[r][c];
        
        if (cell.tile) {
            // Include existing tile in the array so scorer can align indices
            tiles.push(cell.tile);
        } else {
            // Create new tile
            newTilesCount++;
            tiles.push(createTile(wordStrInternal[i]));
        }
    }

    // Filter out moves that use NO new tiles (shouldn't happen with logic, but safety check)
    if (newTilesCount === 0) return;

    // Ensure single-letter placements connect (though anchor logic usually handles this)
    if (len < 2 && newTilesCount === len) {
        // This is a standalone single tile. Only valid if it connects cross-wise.
        // The cross-checks logic should have filtered invalid ones, 
        // but we let calculateMoveScore have the final say.
    }

    results.push({
        id: `auto_${Date.now()}_${Math.random()}`,
        playerId: 'bot',
        playerName: 'MÀQUINA',
        tableNumber: '0',
        word: wordStrInternal, 
        tiles: tiles,
        row: moveRow,
        col: moveCol,
        direction: direction,
        timestamp: Date.now(),
        roundNumber: 0
    });
};

// --- Pre-calculation Helpers ---

const computeCrossChecks = (board: BoardCell[][], trie: FrozenTrie): CrossCheck[][] => {
    const checks: CrossCheck[][] = Array(BOARD_SIZE).fill(null).map(() => Array(BOARD_SIZE).fill(null));

    for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
            if (board[r][c].tile) continue; 

            let up = r - 1;
            while (up >= 0 && board[up][c].tile) up--;
            up++; 

            let down = r + 1;
            while (down < BOARD_SIZE && board[down][c].tile) down++;
            down--; 

            if (up === r && down === r) {
                continue;
            }

            const allowed: CrossCheck = {};
            
            let prefix = "";
            for (let k = up; k < r; k++) {
                prefix += getTrieChar(board[k][c].tile!.char);
            }
            let suffix = "";
            for (let k = r + 1; k <= down; k++) {
                suffix += getTrieChar(board[k][c].tile!.char);
            }

            for (const trieChar of TRIE_ALPHABET) {
                 const cand = prefix + trieChar + suffix;
                 if (trie.lookup(cand)) {
                     allowed[trieChar] = true;
                 }
            }
            checks[r][c] = allowed;
        }
    }
    return checks;
};

const findAnchors = (board: BoardCell[][], isBoardEmpty: boolean): Anchor[] => {
    const anchors: Anchor[] = [];

    if (isBoardEmpty) {
        anchors.push({ row: 7, col: 7 }); 
        return anchors;
    }

    for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
            if (board[r][c].tile) continue;

            let isAnchor = false;
            if (r > 0 && board[r - 1][c].tile) isAnchor = true;
            else if (r < BOARD_SIZE - 1 && board[r + 1][c].tile) isAnchor = true;
            else if (c > 0 && board[r][c - 1].tile) isAnchor = true;
            else if (c < BOARD_SIZE - 1 && board[r][c + 1].tile) isAnchor = true;

            if (isAnchor) {
                anchors.push({ row: r, col: c });
            }
        }
    }
    return anchors;
};