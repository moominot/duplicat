
import { 
  BOARD_SIZE, 
  TRIPLE_WORD_COORDS, 
  DOUBLE_WORD_COORDS, 
  TRIPLE_LETTER_COORDS, 
  DOUBLE_LETTER_COORDS,
  TILE_COUNTS
} from '../constants';
import { 
  BoardCell, 
  MultiplierType, 
  Tile, 
  DIGRAPH_MAP, 
  REVERSE_DIGRAPH_MAP, 
  LETTER_VALUES,
  PlayerMove 
} from '../types';
import { debugLog, debugWarn, debugGroup, debugGroupEnd } from './debug';
import { disc as fallbackDisc } from './dictionaryData';

// --- SUCCINCT TRIE IMPLEMENTATION (Ported from Steve Hanov's JS) ---

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const W = 6;
const CHR = (id: number) => BASE64[id];
const ORD = (ch: string) => BASE64.indexOf(ch);
const L1 = 32 * 32;
const L2 = 32;

const MaskTop = [ 
    0x3f, 0x1f, 0x0f, 0x07, 0x03, 0x01, 0x00 
];
const BitsInByte = [ 
    0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4, 1, 2, 2, 3, 2, 3, 3, 4, 2,
    3, 3, 4, 3, 4, 4, 5, 1, 2, 2, 3, 2, 3, 3, 4, 2, 3, 3, 4, 3, 4, 4, 5, 2, 3,
    3, 4, 3, 4, 4, 5, 3, 4, 4, 5, 4, 5, 5, 6, 1, 2, 2, 3, 2, 3, 3, 4, 2, 3, 3,
    4, 3, 4, 4, 5, 2, 3, 3, 4, 3, 4, 4, 5, 3, 4, 4, 5, 4, 5, 5, 6, 2, 3, 3, 4,
    3, 4, 4, 5, 3, 4, 4, 5, 4, 5, 5, 6, 3, 4, 4, 5, 4, 5, 5, 6, 4, 5, 5, 6, 5,
    6, 6, 7, 1, 2, 2, 3, 2, 3, 3, 4, 2, 3, 3, 4, 3, 4, 4, 5, 2, 3, 3, 4, 3, 4,
    4, 5, 3, 4, 4, 5, 4, 5, 5, 6, 2, 3, 3, 4, 3, 4, 4, 5, 3, 4, 4, 5, 4, 5, 5,
    6, 3, 4, 4, 5, 4, 5, 5, 6, 4, 5, 5, 6, 5, 6, 6, 7, 2, 3, 3, 4, 3, 4, 4, 5,
    3, 4, 4, 5, 4, 5, 5, 6, 3, 4, 4, 5, 4, 5, 5, 6, 4, 5, 5, 6, 5, 6, 6, 7, 3,
    4, 4, 5, 4, 5, 5, 6, 4, 5, 5, 6, 5, 6, 6, 7, 4, 5, 5, 6, 5, 6, 6, 7, 5, 6,
    6, 7, 6, 7, 7, 8 
];

class BitString {
    bytes: string;
    length: number;

    constructor(str: string) {
        this.bytes = str;
        this.length = this.bytes.length * W;
    }

    get(p: number, n: number): number {
        if ((p % W) + n <= W) {
            return (ORD(this.bytes[Math.floor(p / W)]) & MaskTop[p % W]) >> (W - p % W - n);
        } else {
            let result = (ORD(this.bytes[Math.floor(p / W)]) & MaskTop[p % W]);
            let l = W - p % W;
            p += l;
            n -= l;
            while (n >= W) {
                result = (result << W) | ORD(this.bytes[Math.floor(p / W)]);
                p += W;
                n -= W;
            }
            if (n > 0) {
                result = (result << n) | (ORD(this.bytes[Math.floor(p / W)]) >> (W - n));
            }
            return result;
        }
    }

    count(p: number, n: number): number {
        let count = 0;
        while (n >= 8) {
            count += BitsInByte[this.get(p, 8)];
            p += 8;
            n -= 8;
        }
        return count + BitsInByte[this.get(p, n)];
    }

    rank(x: number): number {
        let rank = 0;
        for (let i = 0; i <= x; i++) {
            if (this.get(i, 1)) {
                rank++;
            }
        }
        return rank;
    }
}

class RankDirectory {
    directory: BitString;
    data: BitString;
    l1Size: number;
    l2Size: number;
    l1Bits: number;
    l2Bits: number;
    sectionBits: number;
    numBits: number;

    constructor(directoryData: string, bitData: string, numBits: number, l1Size: number, l2Size: number) {
        this.directory = new BitString(directoryData);
        this.data = new BitString(bitData);
        this.l1Size = l1Size;
        this.l2Size = l2Size;
        this.l1Bits = Math.ceil(Math.log(numBits) / Math.log(2));
        this.l2Bits = Math.ceil(Math.log(l1Size) / Math.log(2));
        this.sectionBits = (l1Size / l2Size - 1) * this.l2Bits + this.l1Bits;
        this.numBits = numBits;
    }

    rank(which: number, x: number): number {
        if (which === 0) {
            return x - this.rank(1, x) + 1;
        }
        let rank = 0;
        let o = x;
        let sectionPos = 0;
        if (o >= this.l1Size) {
            sectionPos = Math.floor(o / this.l1Size) * this.sectionBits;
            rank = this.directory.get(sectionPos - this.l1Bits, this.l1Bits);
            o = o % this.l1Size;
        }
        if (o >= this.l2Size) {
            sectionPos += Math.floor(o / this.l2Size) * this.l2Bits;
            rank += this.directory.get(sectionPos - this.l2Bits, this.l2Bits);
        }
        rank += this.data.count(x - x % this.l2Size, x % this.l2Size + 1);
        return rank;
    }

    select(which: number, y: number): number {
        let high = this.numBits;
        let low = -1;
        let val = -1;
        while (high - low > 1) {
            const probe = Math.floor((high + low) / 2);
            const r = this.rank(which, probe);
            if (r === y) {
                val = probe;
                high = probe;
            } else if (r < y) {
                low = probe;
            } else {
                high = probe;
            }
        }
        return val;
    }
}

export class FrozenTrieNode {
    trie: FrozenTrie;
    index: number;
    letter: string;
    final: boolean;
    firstChild: number;
    childCount: number;

    constructor(trie: FrozenTrie, index: number, letter: string, final: boolean, firstChild: number, childCount: number) {
        this.trie = trie;
        this.index = index;
        this.letter = letter;
        this.final = final;
        this.firstChild = firstChild;
        this.childCount = childCount;
    }

    getChildCount(): number {
        return this.childCount;
    }

    getChild(index: number): FrozenTrieNode {
        return this.trie.getNodeByIndex(this.firstChild + index);
    }
}

export class FrozenTrie {
    data: BitString;
    directory: RankDirectory;
    letterStart: number;

    constructor(data: string, directoryData: string, nodeCount: number) {
        this.data = new BitString(data);
        this.directory = new RankDirectory(directoryData, data, nodeCount * 2 + 1, L1, L2);
        this.letterStart = nodeCount * 2 + 1;
    }

    getNodeByIndex(index: number): FrozenTrieNode {
        const final = this.data.get(this.letterStart + index * 6, 1) === 1;
        const chr = this.data.get(this.letterStart + index * 6 + 1, 5);
        const letter = String.fromCharCode(((chr < 6) ? chr + 48 : chr + 59));
        const firstChild = this.directory.select(0, index + 1) - index;
        const childOfNextNode = this.directory.select(0, index + 2) - index - 1;
        return new FrozenTrieNode(this, index, letter, final, firstChild, childOfNextNode - firstChild);
    }

    getRoot(): FrozenTrieNode {
        return this.getNodeByIndex(0);
    }

    lookup(word: string): boolean {
        let node = this.getRoot();
        for (let i = 0; i < word.length; i++) {
            let child: FrozenTrieNode | undefined;
            let j = 0;
            for (; j < node.getChildCount(); j++) {
                child = node.getChild(j);
                if (child.letter === word[i]) {
                    break;
                }
            }
            if (j === node.getChildCount()) {
                return false;
            }
            node = child!;
        }
        return node.final;
    }
}

// --- Main Validator Logic & Dictionary Management ---

let trieInstance: FrozenTrie | null = null;
let currentDictionaryName = '';
let currentDictionaryData: any = null;

export const AVAILABLE_DICTIONARIES = [
    { id: 'DISC', name: 'DISC (Diccionari de Scrabble en Català)' },
    { id: 'LEXIMOTS', name: 'LEXIMOTS (Diccionari Alternatiu)' }
];

export const loadDictionary = async (name: string = 'DISC'): Promise<void> => {
    // If already loaded, do nothing
    if (trieInstance && currentDictionaryName === name) {
        return;
    }

    try {
        console.log(`Carregant diccionari: ${name}...`);
        
        let data: any = null;

        // 1. Try fetching from public/dictionaries
        try {
            const response = await fetch(`./dictionaries/${name}.json`);
            if (response.ok) {
                data = await response.json();
            } else {
                // response not ok, maybe file missing
                console.warn(`Could not fetch dictionary ${name} from server (Status ${response.status})`);
            }
        } catch (fetchError) {
            console.warn(`Fetch error for dictionary ${name}`, fetchError);
        }
        
        // 2. Fallback to embedded DISC data if fetch failed and requested name is DISC
        if (!data && name === 'DISC') {
            console.log("Using embedded fallback dictionary for DISC.");
            data = fallbackDisc;
        }
        
        if (!data || !data.trie) {
            throw new Error(`Dades de diccionari invàlides o no trobades per a: ${name}`);
        }
        
        trieInstance = new FrozenTrie(data.trie, data.directory, data.nodeCount);
        currentDictionaryName = name;
        currentDictionaryData = data;
        
        console.log(`Diccionari ${name} (v${data.version || '?'}) carregat correctament.`);
        
    } catch (e) {
        console.error(`Error carregant el diccionari ${name}:`, e);
        // Don't clear old dictionary if load fails, just log error
        // But if it was never loaded, ensure we know state is invalid
        if (!trieInstance) {
             currentDictionaryName = 'ERROR';
             currentDictionaryData = null;
        }
    }
};

export const getTrie = (): FrozenTrie | null => {
    return trieInstance;
};

export const getDictionaryVersion = (): string => {
    if (!currentDictionaryData) return "No carregat";
    return `${currentDictionaryName} v${currentDictionaryData.version || '?'}`;
};

export const isDictionaryLoaded = (): boolean => {
    return !!trieInstance;
};

const validateWord = (word: string): boolean => {
  const trie = getTrie();
  if (!trie) {
      // If dictionary is not loaded, we can't validate properly.
      // Return true to prevent blocking gameplay in case of load failure, but log warning.
      debugWarn(`[VALIDACIÓ] Diccionari no carregat. Acceptant "${word}" per defecte.`);
      return true; 
  }
  
  // 1. Convertir a majúscules
  let normalized = word.trim().toUpperCase();

  // 2. Mapar caràcters especials que no han de ser normalitzats com a vocals
  // Seguint la lògica de general.js:
  // 'Ç': "1"
  normalized = normalized.replace(/Ç/g, '1');

  // 3. Normalitzar accents (excepte Ç que ja és 1)
  // Això converteix À->A, É->E, Ü->U, etc.
  normalized = normalized.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  // 4. Validar regla Q(?!U) -> Q ha de ser seguida de U (que ara ja és U o Ü->U)
  if (/Q(?!U)/.test(normalized)) {
      debugLog(`[VALIDACIÓ] "${word}" -> Invàlida (Q sense U)`);
      return false;
  }

  // 5. Substitució de Dígrafs per caràcters interns del diccionari (DISC/LEXIMOTS standard)
  // 'QU': "Q"
  // "L·L": "2"
  // 'NY': "3"
  normalized = normalized.replace(/L·L|L\.L|L-L|ĿL/g, '2');
  normalized = normalized.replace(/QU/g, 'Q');
  normalized = normalized.replace(/NY/g, '3');
  
  // 6. Neteja final de punts volats o altres símbols
  normalized = normalized.replace(/[·\.]/g, '');

  const isValid = trie.lookup(normalized);
  
  const statusIcon = isValid ? '✅' : '❌';
  debugLog(`[VALIDACIÓ] "${word}" -> Norm: "${normalized}" -> ${statusIcon} ${isValid ? 'VÀLIDA' : 'NO VÀLIDA'}`);
  
  return isValid;
};

export const createInitialBoard = (): BoardCell[][] => {
  const board: BoardCell[][] = [];
  for (let r = 0; r < BOARD_SIZE; r++) {
    const row: BoardCell[] = [];
    for (let c = 0; c < BOARD_SIZE; c++) {
      const key = `${r},${c}`;
      let multiplier = MultiplierType.Normal;
      
      if (r === 7 && c === 7) multiplier = MultiplierType.Center;
      else if (TRIPLE_WORD_COORDS.includes(key)) multiplier = MultiplierType.TripleWord;
      else if (DOUBLE_WORD_COORDS.includes(key)) multiplier = MultiplierType.DoubleWord;
      else if (TRIPLE_LETTER_COORDS.includes(key)) multiplier = MultiplierType.TripleLetter;
      else if (DOUBLE_LETTER_COORDS.includes(key)) multiplier = MultiplierType.DoubleLetter;

      row.push({
        row: r,
        col: c,
        multiplier,
        tile: null
      });
    }
    board.push(row);
  }
  return board;
};

/**
 * Deep clones a board.
 */
export const cloneBoard = (board: BoardCell[][]): BoardCell[][] => {
    return board.map(row => row.map(cell => ({ ...cell })));
};

/**
 * Applies a move to a given board (mutates or returns new depending on usage, 
 * but here we assume it modifies the passed board object).
 */
export const applyMoveToBoard = (board: BoardCell[][], move: PlayerMove) => {
    const { row, col, direction, tiles } = move;
    const dr = direction === 'H' ? 0 : 1;
    const dc = direction === 'H' ? 1 : 0;

    tiles.forEach((tile, i) => {
        const r = row + (i * dr);
        const c = col + (i * dc);
        if (r >= 0 && r < 15 && c >= 0 && c < 15) {
            board[r][c].tile = tile;
        }
    });
};

/**
 * Creates a Tile object from an internal char string.
 * Exported so MasterView can generate Tiles with correct values for the rack.
 */
export const createTile = (char: string): Tile => {
  const isBlank = char === char.toLowerCase() && char.toUpperCase() !== char.toLowerCase();
  const upperChar = char.toUpperCase();
  
  // Calculate display char
  let displayChar = REVERSE_DIGRAPH_MAP[upperChar] || upperChar;
  // If it's a wildcard from the rack (represented as '?'), display as is
  if (char === '?') {
      displayChar = '?';
      return { char: '?', value: 0, isBlank: true, displayChar: '?' };
  }
  
  // Calculate value
  let value = isBlank ? 0 : (LETTER_VALUES[upperChar] || 0);

  return {
    char,
    value,
    isBlank,
    displayChar
  };
};

/**
 * Converts a word string potentially containing internal chars (like 'Û', 'Ł')
 * back to a display friendly string (like 'QU', 'L·L').
 * Used for pre-filling the edit inputs in MasterView.
 */
export const internalToDisplayWord = (word: string): string => {
  if (!word) return "";
  return word.split('').map(char => {
     // Map internal characters back to digraphs or keep as is
     // Note: This keeps the case (e.g. blank tiles might be lowercase in 'word')
     // but usually for display input we want uppercase. 
     // We check map against uppercase key.
     const key = char//.toUpperCase();
     return REVERSE_DIGRAPH_MAP[key] || key;
  }).join('');
};

/**
 * Parses a raw input string into Scrabble Tiles.
 * FIX: Automatically converts 'Q' to the 'QU' tile ('Û') because
 * 'Q' does not exist alone in Catalan Scrabble.
 */
export const parseInputWord = (input: string): Tile[] => {
  const tiles: Tile[] = [];
  let i = 0;
  
  while (i < input.length) {
    let char = input[i];
    let nextChar = input[i + 1] || '';
    
    const threeChars = char + nextChar + (input[i + 2] || '');
    const twoChars = char + nextChar;

    // Handle L·L (could be 3 chars)
    if (['L·L', 'L.L', 'L-L'].includes(threeChars.toUpperCase())) {
      const isBlank = threeChars[0] === threeChars[0].toLowerCase();
      const internal = isBlank ? 'ł' : 'Ł';
      tiles.push(createTile(internal));
      i += 3;
      continue;
    }

    // Handle QU, NY
    // Check if user typed "QU" explicitly
    if (['QU', 'NY'].includes(twoChars.toUpperCase())) {
       const upperDigraph = twoChars.toUpperCase();
       const mapped = DIGRAPH_MAP[upperDigraph];
       if (mapped) {
         const isBlank = twoChars[0] === twoChars[0].toLowerCase();
         const internal = isBlank ? mapped.toLowerCase() : mapped;
         tiles.push(createTile(internal));
         i += 2;
         continue;
       }
    }

    // FIX: Handle "Q" typed alone (auto-convert to QU tile 'Û')
    if (char.toUpperCase() === 'Q') {
        const isBlank = char === 'q'; // lowercase q means blank
        const internal = isBlank ? 'û' : 'Û';
        tiles.push(createTile(internal));
        i += 1;
        continue;
    }

    tiles.push(createTile(char));
    i++;
  }
  return tiles;
};

/**
 * Returns the start and end indices in the original string for each tile.
 * Used to handle click-to-toggle-blank logic.
 */
export const getTileIndices = (input: string) => {
    const indices: {start: number, end: number}[] = [];
    let i = 0;
    while (i < input.length) {
        let start = i;
        let char = input[i];
        let nextChar = input[i + 1] || '';
        const threeChars = char + nextChar + (input[i + 2] || '');
        const twoChars = char + nextChar;

        if (['L·L', 'L.L', 'L-L'].includes(threeChars.toUpperCase())) {
            indices.push({start, end: i + 3});
            i += 3;
        } else if (['QU', 'NY'].includes(twoChars.toUpperCase())) {
            indices.push({start, end: i + 2});
            i += 2;
        } else if (char.toUpperCase() === 'Q') {
            // Single Q counts as 1 char index but maps to QU tile
            indices.push({start, end: i + 1});
            i += 1;
        } else {
            indices.push({start, end: i + 1});
            i += 1;
        }
    }
    return indices;
};

export interface ScoreResult {
  score: number;
  isValid: boolean;
  error?: string;
}

// Helper to get multiplier value
const getMultiplierVal = (type: MultiplierType, isWord: boolean): number => {
    if (isWord) {
        if (type === MultiplierType.DoubleWord || type === MultiplierType.Center) return 2;
        if (type === MultiplierType.TripleWord) return 3;
    } else {
        if (type === MultiplierType.DoubleLetter) return 2;
        if (type === MultiplierType.TripleLetter) return 3;
    }
    return 1;
};

// Helper to construct a word string from the board state + tentative tiles
const getFullWordString = (
    board: BoardCell[][], 
    newTilesMap: Record<string, Tile>, 
    startR: number, 
    startC: number, 
    dr: number, 
    dc: number
): string => {
    let word = "";
    let currR = startR;
    let currC = startC;

    // 1. Scan backwards to find the true start of the word
    while (true) {
        const prevR = currR - dr;
        const prevC = currC - dc;
        const prevKey = `${prevR},${prevC}`;
        
        // Check if previous cell has a tile (either on board or new)
        const hasBoardTile = prevR >= 0 && prevC >= 0 && prevR < BOARD_SIZE && prevC < BOARD_SIZE && board[prevR][prevC].tile;
        const hasNewTile = newTilesMap[prevKey];

        if (hasBoardTile || hasNewTile) {
            currR = prevR;
            currC = prevC;
        } else {
            break;
        }
    }

    // 2. Scan forwards collecting characters
    while (currR >= 0 && currC >= 0 && currR < BOARD_SIZE && currC < BOARD_SIZE) {
        const key = `${currR},${currC}`;
        const boardTile = board[currR][currC].tile;
        const newTile = newTilesMap[key];

        if (boardTile) {
            word += boardTile.displayChar;
        } else if (newTile) {
            word += newTile.displayChar;
        } else {
            break; // End of word
        }
        currR += dr;
        currC += dc;
    }

    return word;
};

export const calculateMoveScore = (
  board: BoardCell[][], 
  tiles: Tile[] , 
  currentRack: string[],
  startRow: number, 
  startCol: number, 
  direction: 'H' | 'V'
): ScoreResult => {
  let totalScore = 0;
  
  let mainWordScore = 0;
  let mainWordMultiplier = 1;
  let tilesUsedFromRack = 0;
  
  const rackAvailable = [...(currentRack || [])]; 
  const dr = direction === 'H' ? 0 : 1;
  const dc = direction === 'H' ? 1 : 0;

  // Map for easy lookup of new tiles
  const newTilesMap: Record<string, Tile> = {};
  for (let i = 0; i < tiles.length; i++) {
      newTilesMap[`${startRow + i*dr},${startCol + i*dc}`] = tiles[i];
  }

  // --- 1. BOARD EMPTY CHECK (First Move Logic) ---
  let isBoardEmpty = true;
  for(let r=0; r<BOARD_SIZE; r++) {
      for(let c=0; c<BOARD_SIZE; c++) {
          if(board[r][c].tile) {
              isBoardEmpty = false;
              break;
          }
      }
      if(!isBoardEmpty) break;
  }

  // --- VALIDATION & LOGGING ---
  debugGroup(`Validant jugada a ${String.fromCharCode(65+startRow)}${startCol+1} (${direction})`);
  let allWordsValid = true;
  let invalidWordError = "";
  
  let touchesExisting = false;
  let touchesCenter = false;

  // 1. Validate Main Word
  const mainWordStr = getFullWordString(board, newTilesMap, startRow, startCol, dr, dc);
  if (mainWordStr.length > 1) {
      if (!validateWord(mainWordStr)) {
          allWordsValid = false;
          invalidWordError = `Paraula no vàlida: ${mainWordStr}`;
      }
  } else if (tiles.length === 0) {
      // Handle empty move?
  }

  // 3. Calculate Scores & Check Cross Words
  for (let i = 0; i < tiles.length; i++) {
    const r = startRow + (i * dr);
    const c = startCol + (i * dc);

    // Boundary Check
    if (r >= BOARD_SIZE || c >= BOARD_SIZE) {
        debugGroupEnd();
        return { score: 0, isValid: false, error: "Fora del tauler" };
    }

    // Check for Center intersection (H8 -> 7,7)
    if (r === 7 && c === 7) touchesCenter = true;

    const cell = board[r][c];
    const tile = tiles[i];
    const tileInternalChar = tile.char.toUpperCase(); 
    
    // Validate and Calculate Points for this cell
    if (cell.tile) {
      // --- EXISTING TILE ---
      if (cell.tile.char.toUpperCase() !== tileInternalChar) {
        debugGroupEnd();
        return { 
            score: 0, 
            isValid: false, 
            error: `Conflicte a ${String.fromCharCode(65+r)}${c+1}: El tauler té '${cell.tile.displayChar}' però has posat '${tile.displayChar}'.`
        };
      }
      // Existing tiles retain their face value, but NO multipliers apply
      mainWordScore += cell.tile.value;
      
      // If we use an existing tile, we are touching the board
      touchesExisting = true;
    } else {
      // --- NEW TILE ---
      
      // Connectivity Check (Neighbors)
      const neighbors = [
          {r: r-1, c: c}, {r: r+1, c: c},
          {r: r, c: c-1}, {r: r, c: c+1}
      ];
      for (const n of neighbors) {
          if (n.r >= 0 && n.r < BOARD_SIZE && n.c >= 0 && n.c < BOARD_SIZE) {
               if (board[n.r][n.c].tile) {
                   touchesExisting = true;
               }
          }
      }

      // Check Rack
      const rackIndex = rackAvailable.indexOf(tileInternalChar);
      if (rackIndex !== -1) {
        rackAvailable.splice(rackIndex, 1);
      } else {
          const jokerIndex = rackAvailable.indexOf('?'); 
          if (jokerIndex !== -1) {
              rackAvailable.splice(jokerIndex, 1);
          } else {
             debugGroupEnd();
             if (tile.isBlank) {
                 return { score: 0, isValid: false, error: `No tens cap Escarràs (?) per '${tile.displayChar}'.` };
             } else {
                 return { score: 0, isValid: false, error: `Et falta la lletra '${tile.displayChar}'.` };
             }
          }
      }
      tilesUsedFromRack++;

      // Apply Letter Multipliers to the Tile Value
      let letterVal = tile.value;
      const letterMult = getMultiplierVal(cell.multiplier, false);
      letterVal *= letterMult;
      
      mainWordScore += letterVal;

      // Accumulate Word Multiplier
      const wordMult = getMultiplierVal(cell.multiplier, true);
      mainWordMultiplier *= wordMult;

      // --- CROSS WORD CALCULATION (Perpendicular) ---
      // If we placed a NEW tile, check if it forms a word in the other direction
      const crossDr = direction === 'H' ? 1 : 0;
      const crossDc = direction === 'H' ? 0 : 1;
      
      // Check immediate neighbors
      const prevR = r - crossDr; 
      const prevC = c - crossDc;
      const nextR = r + crossDr; 
      const nextC = c + crossDc;

      const hasPrev = (prevR >= 0 && prevC >= 0 && prevR < BOARD_SIZE && prevC < BOARD_SIZE && board[prevR][prevC].tile);
      const hasNext = (nextR >= 0 && nextC >= 0 && nextR < BOARD_SIZE && nextC < BOARD_SIZE && board[nextR][nextC].tile);

      if (hasPrev || hasNext) {
          // Identify Cross Word String for Validation
          const crossWordStr = getFullWordString(board, newTilesMap, r, c, crossDr, crossDc);
          if (!validateWord(crossWordStr)) {
              allWordsValid = false;
              invalidWordError = `Paraula no vàlida: ${crossWordStr}`;
          }

          let crossWordScore = 0;
          let crossWordMultiplier = wordMult; // The multiplier of the CURRENT cell applies to the cross word too
          
          // 1. Add current tile value (with its letter multiplier)
          crossWordScore += letterVal; 

          // 2. Scan Backwards
          let currR = prevR;
          let currC = prevC;
          while (currR >= 0 && currC >= 0 && currR < BOARD_SIZE && currC < BOARD_SIZE && board[currR][currC].tile) {
              crossWordScore += board[currR][currC].tile!.value;
              currR -= crossDr;
              currC -= crossDc;
          }

          // 3. Scan Forwards
          currR = nextR;
          currC = nextC;
          while (currR >= 0 && currC >= 0 && currR < BOARD_SIZE && currC < BOARD_SIZE && board[currR][currC].tile) {
              crossWordScore += board[currR][currC].tile!.value;
              currR += crossDr;
              currC += crossDc;
          }

          // 4. Apply Word Multiplier to the whole cross word
          totalScore += (crossWordScore * crossWordMultiplier);
      }
    }
  }

  debugGroupEnd();

  // --- RULES VALIDATION ---
  if (isBoardEmpty) {
      // First Move Rules
      if (!touchesCenter) {
          return {
              score: 0,
              isValid: false,
              error: "La primera jugada ha de passar per la casella central (H8) ★."
          };
      }
      if (tiles.length < 2) {
          return {
              score: 0,
              isValid: false,
              error: "La primera jugada ha de tenir almenys 2 lletres."
          };
      }
  } else {
      // Subsequent Moves Rules
      if (!touchesExisting) {
          return {
              score: 0,
              isValid: false,
              error: "La jugada ha d'estar connectada amb les fitxes existents."
          };
      }
  }

  if (!allWordsValid) {
      return {
          score: 0,
          isValid: false,
          error: invalidWordError
      };
  }

  // Apply Main Word Multiplier
  totalScore += (mainWordScore * mainWordMultiplier);

  // Bingo Bonus (+50 points for using 7 tiles)
  if (tilesUsedFromRack === 7) {
    totalScore += 50;
  }

  return {
      score: totalScore,
      isValid: true
  };
};

/**
 * Calculates the remaining tiles in the bag by subtracting used tiles (board + rack) from the total definition.
 */
export const calculateRemainingBag = (board: BoardCell[][], currentRack: string[]): string[] => {
    // 1. Count all tiles currently on board
    const usedCounts: Record<string, number> = {};
    
    // Initialize with board usage
    for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
            const tile = board[r][c].tile;
            if (tile) {
                const key = tile.isBlank ? '?' : tile.char.toUpperCase();
                usedCounts[key] = (usedCounts[key] || 0) + 1;
            }
        }
    }

    // 2. Add current rack usage
    for (const char of (currentRack || [])) {
        const key = char === '?' ? '?' : char.toUpperCase();
        usedCounts[key] = (usedCounts[key] || 0) + 1;
    }

    // 3. Reconstruct bag from Total - Used
    const bag: string[] = [];
    Object.entries(TILE_COUNTS).forEach(([char, total]) => {
        const used = usedCounts[char] || 0;
        const remaining = Math.max(0, total - used);
        for(let i=0; i<remaining; i++) {
            bag.push(char);
        }
    });

    // 4. Shuffle
    for (let i = bag.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [bag[i], bag[j]] = [bag[j], bag[i]];
    }

    return bag;
};