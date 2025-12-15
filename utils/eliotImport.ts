
import { GameState, RoundData, PlayerMove, RoundStatus, BoardCell, Participant, Tile } from '../types';
import { createInitialBoard, parseInputWord, createTile, calculateRemainingBag, applyMoveToBoard as applyMoveToBoardUtils } from './scrabbleUtils';
import { ROW_LABELS, COL_LABELS } from '../constants';

// Helper to parse coordinates from Eliot (e.g., "H8" -> {row: 7, col: 7, dir: 'H'})
// Or "8H" -> {row: 7, col: 7, dir: 'V'}
const parseEliotCoord = (coordStr: string): { row: number, col: number, direction: 'H' | 'V' } | null => {
    if (!coordStr) return null;
    
    const cleanStr = coordStr.trim().toUpperCase();
    
    // Regex per Horitzontal: Lletra + Nombre (ex: H5, H12)
    const horizMatch = cleanStr.match(/^([A-O])([0-9]+)$/);
    if (horizMatch) {
        const rowChar = horizMatch[1];
        const colNum = parseInt(horizMatch[2]);
        const row = ROW_LABELS.indexOf(rowChar);
        const col = colNum - 1; // 1-based to 0-14
        if (row !== -1 && col >= 0 && col < 15) {
            return { row, col, direction: 'H' };
        }
    }

    // Regex per Vertical: Nombre + Lletra (ex: 5H, 12H)
    const vertMatch = cleanStr.match(/^([0-9]+)([A-O])$/);
    if (vertMatch) {
        const colNum = parseInt(vertMatch[1]);
        const rowChar = vertMatch[2];
        const row = ROW_LABELS.indexOf(rowChar);
        const col = colNum - 1; // 1-based to 0-14
        if (row !== -1 && col >= 0 && col < 15) {
            return { row, col, direction: 'V' };
        }
    }

    return null;
};

export const parseEliotXML = (xmlString: string): any => {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlString, "text/xml");

    const parseError = xmlDoc.querySelector("parsererror");
    if (parseError) {
        throw new Error("L'XML no és vàlid.");
    }

    // 1. Initialize Participants
    const participants: Record<string, Participant> = {};
    const playerNodes = xmlDoc.querySelectorAll("Player");
    const eliotIdToInternalId: Record<string, string> = {};

    playerNodes.forEach((pNode, idx) => {
        const eliotId = pNode.getAttribute("id") || String(idx);
        const type = pNode.querySelector("Type")?.textContent || "human";
        
        // Ignorem jugadors 'computer' (Eliot) per a la llista de participants humans,
        // però guardem la referència per si necessitem processar els seus moviments.
        if (type === 'computer') {
            return; 
        }

        let name = pNode.querySelector("Name")?.textContent || `Jugador ${eliotId}`;
        name = name.trim().toUpperCase();
        let tableNb = pNode.querySelector("TableNb")?.textContent || String(idx + 1);
        // Ensure table number is clean
        tableNb = tableNb.replace(/[^0-9]/g, '');
        
        // Si no hi ha número de taula (o és 0), n'assignem un de seqüencial segur
        if (!tableNb || tableNb === '0') tableNb = String(100 + idx);

        const internalId = `table_${tableNb}`;
        
        eliotIdToInternalId[eliotId] = internalId;
        
        // Initialize with empty scores
        participants[internalId] = { 
            id: internalId, 
            name, 
            tableNumber: tableNb, 
            totalScore: 0, 
            roundScores: {} // Will be populated as array-like object
        };
    });

    // 2. Rounds Processing
    const roundsArray: any[] = [null]; // Index 0 null to align with round 1..N
    
    const turnNodes = xmlDoc.querySelectorAll("Turn");
    let currentBoard = createInitialBoard();
    let lastPlayedMove: PlayerMove | null = null;
    let lastRack: string[] = [];
    let roundCounter = 1;

    turnNodes.forEach((turnNode, index) => {
        const roundNum = roundCounter;
        
        // Extract Rack for this turn
        const gameRackStr = turnNode.querySelector("GameRack")?.textContent || "";
        const rackTiles = parseInputWord(gameRackStr);
        const rackChars = rackTiles.map(t => t.char); 
        lastRack = rackChars;

        // Determine the chosen move node
        // Priority: GameMove (explicit played move) > Last valid MasterMove > Any MasterMove
        let chosenMoveNode = turnNode.querySelector("GameMove");
        
        if (!chosenMoveNode) {
            const masterMoves = Array.from(turnNode.querySelectorAll("MasterMove"));
            // Try to find the last "valid" one, or just the last one
            const validMoves = masterMoves.filter(m => m.getAttribute("type") === "valid");
            if (validMoves.length > 0) {
                chosenMoveNode = validMoves[validMoves.length - 1];
            } else if (masterMoves.length > 0) {
                chosenMoveNode = masterMoves[masterMoves.length - 1];
            }
        }

        let masterMove: PlayerMove | null = null;

        if (chosenMoveNode) {
             const type = chosenMoveNode.getAttribute("type");
             const points = parseInt(chosenMoveNode.getAttribute("points") || "0");
             const word = chosenMoveNode.getAttribute("word") || "";
             const coordStr = chosenMoveNode.getAttribute("coord") || "";
             
             const parsedCoord = parseEliotCoord(coordStr);
             
             if (type === 'valid' && word && parsedCoord) {
                 // Valid Move
                 masterMove = {
                     id: `auto_${Date.now()}_${index}`,
                     playerId: 'bot_master',
                     playerName: 'MÀSTER',
                     tableNumber: '0',
                     word: word,
                     tiles: parseInputWord(word),
                     row: parsedCoord.row,
                     col: parsedCoord.col,
                     direction: parsedCoord.direction,
                     score: points,
                     timestamp: Date.now(),
                     roundNumber: roundNum,
                     isMasterMove: true,
                     isValid: true
                 };
             } else {
                 // Pass Move (or invalid treated as pass for master)
                 masterMove = {
                     id: `auto_pass_${Date.now()}_${index}`,
                     playerId: 'bot_master',
                     playerName: 'MÀSTER',
                     tableNumber: '0',
                     word: '',
                     tiles: [],
                     row: 7,
                     col: 7,
                     direction: 'H',
                     score: 0,
                     timestamp: Date.now(),
                     roundNumber: roundNum,
                     isMasterMove: true,
                     isValid: true
                 };
             }
        } else {
             // Fallback if absolutely no move node found (should imply pass)
             masterMove = {
                 id: `auto_pass_${Date.now()}_${index}`,
                 playerId: 'bot_master',
                 playerName: 'MÀSTER',
                 tableNumber: '0',
                 word: '',
                 tiles: [],
                 row: 7,
                 col: 7,
                 direction: 'H',
                 score: 0,
                 timestamp: Date.now(),
                 roundNumber: roundNum,
                 isMasterMove: true,
                 isValid: true
             };
        }

        // Process Player Moves for this round
        const roundMoves: Record<string, PlayerMove> = {};
        const playerMoveNodes = turnNode.querySelectorAll("PlayerMove");
        
        playerMoveNodes.forEach(pmNode => {
                const eliotPid = pmNode.getAttribute("playerId");
                if (!eliotPid) return;
                const internalPid = eliotIdToInternalId[eliotPid];
                if (!internalPid) return; // Skip unknown players (or computer)

                const type = pmNode.getAttribute("type");
                const points = parseInt(pmNode.getAttribute("points") || "0");
                const word = pmNode.getAttribute("word") || "";
                const coord = pmNode.getAttribute("coord") || "";
                
                let pMove: PlayerMove | null = null;

                if (type !='none' && word && coord) {
                    const parsed = parseEliotCoord(coord);
                    if (parsed) {
                        pMove = {
                            id: `${Date.now()}_${internalPid}_${roundNum}`,
                            playerId: internalPid,
                            playerName: participants[internalPid]?.name || "Unknown",
                            tableNumber: participants[internalPid]?.tableNumber || "?",
                            word,
                            tiles: parseInputWord(word),
                            row: parsed.row,
                            col: parsed.col,
                            direction: parsed.direction,
                            score: points,
                            timestamp: Date.now(),
                            roundNumber: roundNum,
                            isValid: type === 'invalid' ? false : true,
                            error: type === 'invalid' ? 'Jugada invàlida (Eliot)' : null
                        };
                    }
                }/*  else {
                    // Invalid or pass move
                    pMove = {
                        id: `${Date.now()}_${internalPid}_${roundNum}`,
                        playerId: internalPid,
                        playerName: participants[internalPid]?.name || "Unknown",
                        tableNumber: participants[internalPid]?.tableNumber || "?",
                        word: word || "",
                        tiles: word ? parseInputWord(word) : [],
                        row: 0,
                        col: 0,
                        direction: 'H',
                        score: 0,
                        timestamp: Date.now(),
                        roundNumber: roundNum,
                        isValid: false,
                        error: type === 'invalid' ? 'Jugada invàlida (Eliot)' : 'Passa'
                    };
                } */

                if (pMove) {
                    roundMoves[internalPid] = pMove;
                    
                    // Update Participant Scores
                    if (!participants[internalPid].roundScores) participants[internalPid].roundScores = {};
                    participants[internalPid].roundScores[roundNum] = points;
                    participants[internalPid].totalScore += points;
                    
                    // Check for master match
                    if (masterMove && points > 0 && points === masterMove.score) {
                        participants[internalPid].masterMovesCount = (participants[internalPid].masterMovesCount || 0) + 1;
                    }
                }
        });

        // Create the COMPLETED round entry
        // We must clone the board BEFORE applying the master move to save the "Start of Round" state
        const boardSnapshot = currentBoard.map(row => row.map(cell => ({...cell})));

        const roundData: RoundData = {
            roundNumber: roundNum,
            status: RoundStatus.COMPLETED,
            boardSnapshot: boardSnapshot,
            rack: rackChars,
            moves: roundMoves,
            masterMove: masterMove,
            startTime: Date.now(),
            endTime: Date.now()
        };

        roundsArray.push(roundData);
        
        // Apply Master Move to the running board for the NEXT round
        if (masterMove && masterMove.word.length > 0 && masterMove.isValid) {
            // We use the utility from scrabbleUtils to update the board state
            applyMoveToBoardUtils(currentBoard, masterMove);
        }
        
        lastPlayedMove = masterMove;
        roundCounter++;
    });

    // 3. Create the Active (Next) Round
    // Determine next rack.
    
    let nextRack: string[] = [];
    const bag = calculateRemainingBag(currentBoard, []);
    
    // Logic to refill rack to 7 from the remaining bag
    nextRack = bag.slice(0, 7);

    const nextRoundNum = roundCounter;
    
    // Snapshot for the NEW round is the board AFTER the last master move
    const nextRoundBoardSnapshot = currentBoard.map(row => row.map(cell => ({...cell})));

    const currentRoundData: RoundData = {
        roundNumber: nextRoundNum,
        status: RoundStatus.IDLE, // Start as IDLE so master can review/start
        boardSnapshot: nextRoundBoardSnapshot, // The board after all history moves
        rack: nextRack,
        moves: {},
        startTime: null
    };
    
    roundsArray[nextRoundNum] = currentRoundData;

    // Normalize participant score arrays (fill missing rounds with 0/null)
    Object.values(participants).forEach(p => {
        const scoresArray: (number|null)[] = [null]; // Round 0 is null
        for (let i = 1; i < nextRoundNum; i++) {
            // Use existing score or 0 if missing
            scoresArray[i] = (p.roundScores as any)[i] ?? 0;
        }
        p.roundScores = scoresArray as any; 
    });

    return {
        board: currentBoard, // Global board is the current state
        config: {
            bestMovesLimit: 10,
            gracePeriodSeconds: 10,
            judgeName: "Importat",
            timerDurationSeconds: 180
        },
        currentRack: nextRack,
        currentRound: nextRoundNum,
        lastPlayedMove: lastPlayedMove,
        participants: participants,
        rounds: roundsArray,
        timerPausedRemaining: 180000
    };
};
