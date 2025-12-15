
import { db } from '../firebaseConfig';
import { GameState, PlayerMove, RoundStatus, GameConfig, Participant, RoundData, BoardCell } from '../types';
import { createInitialBoard, calculateRemainingBag, calculateMoveScore } from '../utils/scrabbleUtils';
import { parseEliotXML } from '../utils/eliotImport';

// --- Helper: Recalcular puntuacions globals ---
const recalculateAllScores = async (gameId: string) => {
    const gameRef = db.ref(`games/${gameId}`);
    const snapshot = await gameRef.get();
    if (!snapshot.exists()) return;
    const data = snapshot.val();

    const participants = data.participants || {};
    const rounds = data.rounds || {};

    // ID fix per al bot
    const botId = 'bot_master';

    // Reset scores locally for real players
    Object.keys(participants).forEach(pid => {
        if (pid !== botId) {
            participants[pid].totalScore = 0;
            participants[pid].roundScores = {};
            participants[pid].masterMovesCount = 0;
        }
    });

    // Prepare Bot Data structure
    let botTotalScore = 0;
    const botRoundScores: Record<number, number> = {};

    // Iterate rounds (1 to N)
    Object.keys(rounds).forEach(rKey => {
        const rNum = parseInt(rKey);
        const round: RoundData = rounds[rKey];
        const moves = round.moves || {};
        
        // Get Master Score for this round if exists
        const masterScore = round.masterMove?.score || 0;
        const hasMasterMove = !!round.masterMove;
        
        // Update Bot Score
        if (hasMasterMove) {
            botRoundScores[rNum] = masterScore;
            botTotalScore += masterScore;
        }
        
        Object.values(moves).forEach((move: any) => {
             const pid = move.playerId;
             // Skip if somehow bot ended up in moves list (shouldn't happen but safety check)
             if (pid === botId) return;

             if (participants[pid]) {
                 if (!participants[pid].roundScores) participants[pid].roundScores = {};
                 
                 const score = move.score || 0;
                 participants[pid].roundScores[rNum] = score;
                 participants[pid].totalScore = (participants[pid].totalScore || 0) + score;
                 
                 // Check for Master Move match (only if valid score > 0 and master move exists)
                 if (hasMasterMove && score > 0 && score >= masterScore) {
                     participants[pid].masterMovesCount = (participants[pid].masterMovesCount || 0) + 1;
                 }
             }
        });
    });

    // Ensure Bot Participant exists and is updated
    participants[botId] = {
        id: botId,
        name: 'PARTIDA',
        tableNumber: '0', // Taula 0 per ordenar
        group: '',
        totalScore: botTotalScore,
        roundScores: botRoundScores,
        masterMovesCount: 0
    };

    // Update participants in DB
    await db.ref(`games/${gameId}/participants`).update(participants);
};


// --- LLEGIR ESTAT ---
const fetchGameState = async (gameId: string): Promise<GameState | null> => {
    try {
        const snapshot = await db.ref(`games/${gameId}`).get();
        if (!snapshot.exists()) return null;
        
        // Note: We rely on useGame hook for the complex transformation for UI.
        // This helper is mainly for internal logic checks where we need raw data.
        return snapshot.val() as GameState;
    } catch (e) {
        console.error("Error fetching game state:", e);
        return null;
    }
};

// --- DATA IMPORT/EXPORT (JSON & ELIOT) ---

export const getFullGameData = async (gameId: string) => {
    const snapshot = await db.ref(`games/${gameId}`).get();
    if (!snapshot.exists()) return null;
    return snapshot.val();
};

export const restoreGameData = async (gameId: string, jsonData: any) => {
    // Basic validation
    if (!jsonData || typeof jsonData !== 'object' || !jsonData.rounds) {
        throw new Error("El fitxer JSON no sembla vàlid o no conté rondes.");
    }
    
    // Overwrite the game path with new data
    await db.ref(`games/${gameId}`).set(jsonData);
    
    // Also update public metadata just in case currentRound changed
    const currentRound = jsonData.currentRound || 1;
    await db.ref(`publicGames/${gameId}`).update({ round: currentRound });
};

export const importEliotGame = async (gameId: string, xmlString: string) => {
    try {
        console.log("Iniciant importació Eliot...");
        const gameData = parseEliotXML(xmlString);
        console.log("XML Parsejat:", gameData);
        
        if (!gameData || !gameData.rounds) {
            throw new Error("No s'han trobat dades vàlides a l'XML.");
        }

        // Overwrite the game path with new data
        await db.ref(`games/${gameId}`).set(gameData);
        console.log("Dades desades a Firebase.");
        
        // Update metadata
        const currentRound = gameData.currentRound || 1;
        await db.ref(`publicGames/${gameId}`).update({ round: currentRound });
        
    } catch (e: any) {
        console.error("Eliot Import Error:", e);
        throw new Error(`Error important Eliot XML: ${e.message}`);
    }
};

export const importEliotGameAsGroup = async (gameId: string, xmlString: string, groupNum: number, merge: boolean) => {
    try {
        console.log(`Iniciant importació Eliot (Grup ${groupNum}, Merge: ${merge})...`);
        const gameData = parseEliotXML(xmlString);
        
        if (!gameData || !gameData.rounds) {
            throw new Error("No s'han trobat dades vàlides a l'XML.");
        }

        // 1. Remap Participants
        const newParticipants: Record<string, any> = {};
        const idMap: Record<string, string> = {}; // Old ID -> New ID

        Object.values(gameData.participants).forEach((p: any) => {
            // Skip bot/master if they are in participants list
            if (p.id === 'bot_master' || p.id === 'bot') return;

            const oldTable = parseInt(p.tableNumber);
            if (isNaN(oldTable)) return;

            const newTable = groupNum * 100 + oldTable;
            const newId = `table_${newTable}`;
            
            idMap[p.id] = newId;
            
            newParticipants[newId] = {
                ...p,
                id: newId,
                tableNumber: newTable.toString(),
                group: groupNum.toString()
            };
        });

        // 2. Remap Moves in Rounds
        gameData.rounds.forEach((round: any) => {
            if (!round || !round.moves) return;
            
            const newMoves: Record<string, any> = {};
            
            Object.values(round.moves).forEach((move: any) => {
                if (idMap[move.playerId]) {
                    const newPid = idMap[move.playerId];
                    // Ensure ID uniqueness if it contains PID, or just generate new one
                    const newMoveId = move.id.includes(move.playerId) 
                        ? move.id.replace(move.playerId, newPid) 
                        : `${move.id}_${groupNum}`;

                    newMoves[newPid] = {
                        ...move,
                        id: newMoveId,
                        playerId: newPid,
                        tableNumber: newParticipants[newPid].tableNumber
                    };
                }
            });
            
            // Replace moves with remapped ones (excluding master moves from this list, they are separate usually)
            // Note: parseEliotXML puts masterMove in round.masterMove, not in moves list usually.
            // But if it was in moves, we filtered it out by not having it in idMap.
            round.moves = newMoves;
        });

        // 3. Save to Firebase
        if (merge) {
            // Merge mode: Add players and moves to existing game
            const updates: any = {};
            
            // Add Participants
            Object.values(newParticipants).forEach((p: any) => {
                updates[`games/${gameId}/participants/${p.id}`] = p;
            });
            
            // Add Moves
            gameData.rounds.forEach((round: any) => {
                if (!round) return;
                const rNum = round.roundNumber;
                if (round.moves) {
                    Object.values(round.moves).forEach((move: any) => {
                        updates[`games/${gameId}/rounds/${rNum}/moves/${move.playerId}`] = move;
                    });
                }
            });
            
            await db.ref().update(updates);
            await recalculateAllScores(gameId);
            console.log("Dades fusionades a Firebase.");

        } else {
            // Overwrite mode: Replace game with remapped data
            // We need to put the remapped participants back into gameData
            gameData.participants = newParticipants;
            // And we already updated round.moves in place
            
            await db.ref(`games/${gameId}`).set(gameData);
            
            // Update metadata
            const currentRound = gameData.currentRound || 1;
            await db.ref(`publicGames/${gameId}`).update({ round: currentRound });
            console.log("Dades (Grup) desades a Firebase.");
        }
        
    } catch (e: any) {
        console.error("Eliot Import Error:", e);
        throw new Error(`Error important Eliot XML: ${e.message}`);
    }
};



// --- LOBBY & CREATION ---

export const createNewGame = async (hostName: string): Promise<string> => {
    const gamesRef = db.ref('games');
    const newGameRef = gamesRef.push();
    const gameId = newGameRef.key;
    if (!gameId) throw new Error("Error generant ID");

    const initialBoard = createInitialBoard();
    // Start with empty rack as requested - Master will fill it manually or auto-fill
    const initialRack: string[] = []; 

    const initialData = {
        currentRound: 1,
        board: initialBoard, 
        currentRack: initialRack, 
        lastPlayedMove: null,
        participants: {},
        config: {
            timerDurationSeconds: 180,
            gracePeriodSeconds: 10,
            judgeName: hostName || 'MÀSTER',
            bestMovesLimit: 10,
            dictionary: 'DISC'
        },
        rounds: {
            1: {
                roundNumber: 1,
                status: RoundStatus.IDLE,
                boardSnapshot: initialBoard, 
                rack: initialRack, 
                moves: {},
                startTime: null
            }
        }
    };

    await newGameRef.set(initialData);
    
    const metadata = {
        id: gameId,
        host: hostName,
        createdAt: Date.now(),
        round: 1
    };
    await db.ref(`publicGames/${gameId}`).set(metadata);

    return gameId;
};

export const getPublicGames = async () => {
    try {
        const snapshot = await db.ref('publicGames').get();
        if (!snapshot.exists()) return [];
        const data = snapshot.val();
        return Object.values(data).sort((a: any, b: any) => b.createdAt - a.createdAt);
    } catch (e) {
        console.error("Error getting public games:", e);
        return [];
    }
};

// --- GAMEPLAY ACTIONS ---

export const updateConfig = async (gameId: string, config: Partial<GameConfig>) => {
    await db.ref(`games/${gameId}/config`).update(config);
};

export const registerParticipant = async (gameId: string, participant: {id: string, name: string, tableNumber: string, group?: string}) => {
    const refPath = db.ref(`games/${gameId}/participants/${participant.id}`);
    const updates: any = {
        id: participant.id,
        name: participant.name,
        tableNumber: participant.tableNumber
    };
    if (participant.group) {
        updates.group = participant.group;
    }
    await refPath.update(updates);
};

export const importPlayers = async (gameId: string, players: Partial<Participant>[]) => {
    const updates: any = {};
    players.forEach(p => {
        if (p.id) {
            updates[`games/${gameId}/participants/${p.id}`] = p;
        }
    });
    await db.ref().update(updates);
};

export const removeParticipant = async (gameId: string, participantId: string) => {
    await db.ref(`games/${gameId}/participants/${participantId}`).remove();
};

export const submitMove = async (gameId: string, move: PlayerMove) => {
  const path = `games/${gameId}/rounds/${move.roundNumber}/moves/${move.playerId}`;
  
  try {
      await db.ref(path).set(move);
      
      // Retrieve existing group if any to preserve it
      const pRef = db.ref(`games/${gameId}/participants/${move.playerId}`);
      const pSnap = await pRef.get();
      const currentGroup = pSnap.exists() ? pSnap.val().group : undefined;

      await registerParticipant(gameId, {
          id: move.playerId,
          name: move.playerName,
          tableNumber: move.tableNumber,
          group: currentGroup
      });
  } catch (e) {
      console.error("[GameService] Error enviant jugada:", e);
      throw e;
  }
};

export const submitManualMoves = async (gameId: string, moves: PlayerMove[]) => {
    const updates: any = {};
    if (!moves || moves.length === 0) return;

    for (const move of moves) {
        updates[`games/${gameId}/rounds/${move.roundNumber}/moves/${move.playerId}`] = move;
    }
    await db.ref().update(updates);
    await recalculateAllScores(gameId);
};

export const updateHistoricalMove = async (gameId: string, roundNumber: number, move: PlayerMove) => {
    let boardSnapshot: BoardCell[][] = [];
    let rackSnapshot: string[] = [];
    
    const roundRef = db.ref(`games/${gameId}/rounds/${roundNumber}`);
    const roundSnap = await roundRef.get();
    
    if (roundSnap.exists()) {
        const rData = roundSnap.val();
        boardSnapshot = rData.boardSnapshot || createInitialBoard();
        rackSnapshot = rData.rack || [];
    } else {
         boardSnapshot = createInitialBoard();
    }

    const calcResult = calculateMoveScore(
        boardSnapshot,
        move.tiles,
        rackSnapshot,
        move.row,
        move.col,
        move.direction
    );

    const newScore = calcResult.isValid ? calcResult.score : 0;
    const validMove = {
        ...move,
        score: newScore,
        isValid: calcResult.isValid,
        error: calcResult.error || null,
        roundNumber: roundNumber
    };

    await db.ref(`games/${gameId}/rounds/${roundNumber}/moves/${move.playerId}`).set(validMove);
    await recalculateAllScores(gameId);
};


export const updateRack = async (gameId: string, newRack: string[]) => {
    // Need to know current round to update correct place
    const roundSnap = await db.ref(`games/${gameId}/currentRound`).get();
    const currentRound = roundSnap.val() || 1;

    const updates: any = {};
    updates[`games/${gameId}/rounds/${currentRound}/rack`] = newRack;
    updates[`games/${gameId}/currentRack`] = newRack;
    
    await db.ref().update(updates);
};

export const refillRack = async (gameId: string) => {
    // We need the whole state to calculate bag
    const gameRef = db.ref(`games/${gameId}`);
    const snapshot = await gameRef.get();
    if (!snapshot.exists()) return;
    const data = snapshot.val();

    const currentRound = data.currentRound || 1;
    const currentRack = data.currentRack || [];
    const currentBoard = data.board || createInitialBoard();
    
    const roundStatus = data.rounds?.[currentRound]?.status || RoundStatus.IDLE;
    if (roundStatus !== RoundStatus.IDLE) return;

    const currentCount = currentRack.length;
    if (currentCount < 7) {
        const bag = calculateRemainingBag(currentBoard, currentRack);
        const needed = 7 - currentCount;
        if (bag.length > 0) {
            const tilesToAdd = bag.slice(0, needed);
            const newRack = [...currentRack, ...tilesToAdd];
            
            const updates: any = {};
            updates[`games/${gameId}/rounds/${currentRound}/rack`] = newRack;
            updates[`games/${gameId}/currentRack`] = newRack;
            
            await db.ref().update(updates);
        }
    }
};

// --- TIMER ---

export const openRound = async (gameId: string) => {
    const gameRef = db.ref(`games/${gameId}`);
    const snapshot = await gameRef.get();
    if (!snapshot.exists()) return;
    const data = snapshot.val();
    
    const currentRound = data.currentRound || 1;
    const currentRack = data.currentRack || [];
    const config = data.config || {};

    // Calculate bag to know if we are at end game
    const bag = calculateRemainingBag(data.board || createInitialBoard(), currentRack);
    
    // Validate Rack Fullness (unless bag is empty)
    if (bag.length > 0 && currentRack.length < 7) {
        throw new Error(`Falten fitxes al faristol! (${currentRack.length}/7)`);
    }

    const durationMs = (config.timerDurationSeconds || 180) * 1000;
    
    const updates: any = {};
    updates[`games/${gameId}/rounds/${currentRound}/status`] = RoundStatus.PLAYING;
    updates[`games/${gameId}/rounds/${currentRound}/startTime`] = Date.now();
    
    // Global timer state
    updates[`games/${gameId}/timerEndTime`] = null;
    updates[`games/${gameId}/timerPausedRemaining`] = durationMs;
    
    await db.ref().update(updates);
};

export const closeRound = async (gameId: string) => {
    const roundSnap = await db.ref(`games/${gameId}/currentRound`).get();
    const currentRound = roundSnap.val() || 1;

    const updates: any = {};
    updates[`games/${gameId}/rounds/${currentRound}/status`] = RoundStatus.REVIEW;
    updates[`games/${gameId}/timerEndTime`] = null;
    updates[`games/${gameId}/timerPausedRemaining`] = null;
    await db.ref().update(updates);
};

export const reopenRound = async (gameId: string) => {
    const gameRef = db.ref(`games/${gameId}`);
    const snapshot = await gameRef.get();
    if (!snapshot.exists()) return;
    const data = snapshot.val();
    
    const currentRound = data.currentRound || 1;
    const config = data.config || {};

    const extraTimeMs = 30 * 1000; 
    const now = Date.now();
    const durationMs = (config.timerDurationSeconds || 180) * 1000;
    
    const newEndTime = now + extraTimeMs;
    const newStartTime = newEndTime - durationMs; 

    const updates: any = {};
    updates[`games/${gameId}/rounds/${currentRound}/status`] = RoundStatus.PLAYING;
    updates[`games/${gameId}/rounds/${currentRound}/startTime`] = newStartTime;
    updates[`games/${gameId}/timerEndTime`] = newEndTime;
    updates[`games/${gameId}/timerPausedRemaining`] = null;

    await db.ref().update(updates);
};

export const toggleTimer = async (gameId: string) => {
    const gameRef = db.ref(`games/${gameId}`);
    const snapshot = await gameRef.get();
    if (!snapshot.exists()) return;
    const data = snapshot.val();
    const currentRound = data.currentRound || 1;
    
    if (data.rounds?.[currentRound]?.status !== RoundStatus.PLAYING) return;

    const now = Date.now();
    const durationMs = (data.config?.timerDurationSeconds || 180) * 1000;

    if (data.timerPausedRemaining) {
        // RESUME
        const newEndTime = now + data.timerPausedRemaining;
        const newStartTime = newEndTime - durationMs;
        
        const updates: any = {};
        updates[`games/${gameId}/timerEndTime`] = newEndTime;
        updates[`games/${gameId}/timerPausedRemaining`] = null;
        updates[`games/${gameId}/rounds/${currentRound}/startTime`] = newStartTime;
        
        await db.ref().update(updates);

    } else if (data.timerEndTime) {
        // PAUSE
        const remaining = data.timerEndTime - now;
        if (remaining > 0) {
            const updates: any = {};
            updates[`games/${gameId}/timerEndTime`] = null;
            updates[`games/${gameId}/timerPausedRemaining`] = remaining;
            await db.ref().update(updates);
        }
    }
};

export const resetTimer = async (gameId: string) => {
    const gameRef = db.ref(`games/${gameId}`);
    const snapshot = await gameRef.get();
    if (!snapshot.exists()) return;
    const data = snapshot.val();
    const currentRound = data.currentRound || 1;

    if (data.rounds?.[currentRound]?.status !== RoundStatus.PLAYING) return;

    const durationMs = (data.config?.timerDurationSeconds || 180) * 1000;
    const now = Date.now();

    const updates: any = {};
    updates[`games/${gameId}/timerEndTime`] = now + durationMs;
    updates[`games/${gameId}/timerPausedRemaining`] = null;
    updates[`games/${gameId}/rounds/${currentRound}/startTime`] = now;
    
    await db.ref().update(updates);
};

/**
 * TANCAR RONDA I PASSAR A LA SEGÜENT
 */
export const finalizeRound = async (gameId: string, masterMove: PlayerMove) => {
    const gameRef = db.ref(`games/${gameId}`);
    const snapshot = await gameRef.get();
    if (!snapshot.exists()) throw new Error("Partida no trobada");
    
    const data = snapshot.val();
    const currentRoundNum = data.currentRound || 1;
    const nextRoundNum = currentRoundNum + 1;

    const boardSnapshot = data.board || createInitialBoard();
    const rackSnapshot = data.rounds?.[currentRoundNum]?.rack || [];

    // RECALCULATE MASTER MOVE SCORE TO BE SURE
    const masterScoreResult = calculateMoveScore(
        boardSnapshot,
        masterMove.tiles,
        rackSnapshot,
        masterMove.row,
        masterMove.col,
        masterMove.direction
    );

    const finalMasterMove = {
        ...masterMove,
        id: `auto_${Date.now()}_${Math.random()}`,
        playerId: 'bot',
        playerName: 'MÀQUINA',
        tableNumber: '0',        
        timestamp: Date.now(),        
        score: masterScoreResult.score,
        isValid: true
    };
    
    const updates: any = {};

    // Update Current Round
    updates[`games/${gameId}/rounds/${currentRoundNum}/status`] = RoundStatus.COMPLETED;
    updates[`games/${gameId}/rounds/${currentRoundNum}/masterMove`] = finalMasterMove;
    updates[`games/${gameId}/rounds/${currentRoundNum}/endTime`] = Date.now();
    
    // Calculate Scores for players
    const roundMovesMap = data.rounds?.[currentRoundNum]?.moves || {};
    const roundMoves: PlayerMove[] = Object.values(roundMovesMap);
    
    const config = data.config || { gracePeriodSeconds: 10, timerDurationSeconds: 180 };
    const gracePeriod = (config.gracePeriodSeconds || 10) * 1000;
    const roundStartTime = data.rounds?.[currentRoundNum]?.startTime || Date.now();
    const roundEndTime = roundStartTime + (config.timerDurationSeconds * 1000);

    for (const move of roundMoves) {
        let score = 0;
        let isValid = false;
        let error: string | null = null;

        // Only check time if it's NOT a master move AND NOT manually entered by admin
        const isLate = (!move.isMasterMove && !move.isManual && roundStartTime && move.timestamp > (roundEndTime + gracePeriod));
        const isChosen = (move.id === masterMove.id);

        if (isLate && !isChosen) {
             isValid = false;
             error = "Fora de temps";
        } else {
             const res = calculateMoveScore(boardSnapshot, move.tiles, rackSnapshot, move.row, move.col, move.direction);
             if (res.isValid || isChosen) {
                 isValid = true;
                 score = res.score;
                 if (isChosen) error = null;
             } else {
                 error = res.error || "Invàlid";
             }
        }

        const updatedMove = { ...move, score, isValid, error: error || null };
        updates[`games/${gameId}/rounds/${currentRoundNum}/moves/${move.playerId}`] = updatedMove;
    }

    // Generate New Board
    const { row, col, direction, tiles } = finalMasterMove;
    const newBoard = boardSnapshot.map((r: any) => r.map((c: any) => ({ ...c })));
    const tilesUsed: string[] = [];

    tiles.forEach((tile: any, index: number) => {
        const r = direction === 'H' ? row : row + index;
        const c = direction === 'H' ? col + index : col;
        if (r >= 0 && r < 15 && c >= 0 && c < 15) {
            if (!newBoard[r][c].tile) {
                newBoard[r][c] = { ...newBoard[r][c], tile };
                tilesUsed.push(tile.isBlank ? '?' : tile.char.toUpperCase());
            }
        }
    });

    // Generate New Rack (Remove used tiles from old rack)
    const newRack = [...rackSnapshot];
    for (const char of tilesUsed) {
        const idx = newRack.indexOf(char);
        if (idx !== -1) newRack.splice(idx, 1);
        else {
             if (char === '?') {
                 const idx2 = newRack.indexOf('?');
                 if (idx2 !== -1) newRack.splice(idx2, 1);
             }
        }
    }

    // --- DO NOT REFILL AUTOMATICALLY ---
    // We only keep the leftovers. The master must explicitly fill the rack in the UI.
    const finalNextRack = [...newRack];

    // Initialize Next Round
    updates[`games/${gameId}/rounds/${nextRoundNum}`] = {
        roundNumber: nextRoundNum,
        status: RoundStatus.IDLE,
        boardSnapshot: newBoard,
        rack: finalNextRack,
        moves: {},
        startTime: null
    };

    // Update Global Pointers
    updates[`games/${gameId}/currentRound`] = nextRoundNum;
    updates[`games/${gameId}/board`] = newBoard; 
    updates[`games/${gameId}/currentRack`] = finalNextRack;
    updates[`games/${gameId}/lastPlayedMove`] = finalMasterMove;
    
    updates[`games/${gameId}/timerEndTime`] = null;
    updates[`games/${gameId}/timerPausedRemaining`] = null;
    updates[`publicGames/${gameId}/round`] = nextRoundNum;

    await db.ref().update(updates);
    await recalculateAllScores(gameId);
};

/**
 * GENERAR LA SEGÜENT RONDA (Quan l'anterior està tancada però no s'ha avançat)
 * Útil si s'esborra l'última ronda i es vol tornar a generar.
 */
export const prepareNextRound = async (gameId: string) => {
    const gameRef = db.ref(`games/${gameId}`);
    const snapshot = await gameRef.get();
    if (!snapshot.exists()) throw new Error("Partida no trobada");
    
    const data = snapshot.val();
    const currentRoundNum = data.currentRound;
    const roundData: RoundData = data.rounds[currentRoundNum];
    
    if (roundData.status !== RoundStatus.COMPLETED || !roundData.masterMove) {
        throw new Error("La ronda actual no està completada o falta la jugada mestra.");
    }
    
    const nextRoundNum = currentRoundNum + 1;
    
    // 1. Regenerate Board based on completed round
    const boardSnapshot = roundData.boardSnapshot || createInitialBoard();
    const { row, col, direction, tiles } = roundData.masterMove;
    const newBoard = boardSnapshot.map((r: any) => r.map((c: any) => ({ ...c })));
    const tilesUsed: string[] = [];

    tiles.forEach((tile: any, index: number) => {
        const r = direction === 'H' ? row : row + index;
        const c = direction === 'H' ? col + index : col;
        if (r >= 0 && r < 15 && c >= 0 && c < 15) {
            if (!newBoard[r][c].tile) {
                newBoard[r][c] = { ...newBoard[r][c], tile };
                tilesUsed.push(tile.isBlank ? '?' : tile.char.toUpperCase());
            }
        }
    });

    // 2. Generate New Rack (Remove used tiles)
    const oldRack = roundData.rack || [];
    const nextRackBase = [...oldRack];
    for (const char of tilesUsed) {
        const idx = nextRackBase.indexOf(char);
        if (idx !== -1) nextRackBase.splice(idx, 1);
        else {
             if (char === '?') {
                 const idx2 = nextRackBase.indexOf('?');
                 if (idx2 !== -1) nextRackBase.splice(idx2, 1);
             }
        }
    }
    
    // 3. DO NOT Refill Rack automatically
    const finalNextRack = [...nextRackBase];

    const updates: any = {};
    
    // Initialize Next Round
    updates[`games/${gameId}/rounds/${nextRoundNum}`] = {
        roundNumber: nextRoundNum,
        status: RoundStatus.IDLE,
        boardSnapshot: newBoard,
        rack: finalNextRack,
        moves: {},
        startTime: null
    };

    // Update Global Pointers
    updates[`games/${gameId}/currentRound`] = nextRoundNum;
    updates[`games/${gameId}/board`] = newBoard; 
    updates[`games/${gameId}/currentRack`] = finalNextRack;
    updates[`games/${gameId}/lastPlayedMove`] = roundData.masterMove;
    
    updates[`games/${gameId}/timerEndTime`] = null;
    updates[`games/${gameId}/timerPausedRemaining`] = null;
    updates[`publicGames/${gameId}/round`] = nextRoundNum;

    await db.ref().update(updates);
};


export const deleteLastRound = async (gameId: string) => {
    const gameRef = db.ref(`games/${gameId}`);
    const snapshot = await gameRef.get();
    if (!snapshot.exists()) throw new Error("Partida no trobada");
    
    const data = snapshot.val();
    const currentRound = data.currentRound;
    
    if (currentRound <= 1) return; // Cannot delete round 1 (or prevent deleting if it's the only one)

    const prevRound = currentRound - 1;
    const prevRoundData: RoundData = data.rounds?.[prevRound];

    if (!prevRoundData) {
         // Fallback just in case data is corrupted
         const updates: any = {};
         updates[`games/${gameId}/rounds/${currentRound}`] = null;
         updates[`games/${gameId}/currentRound`] = prevRound;
         updates[`publicGames/${gameId}/round`] = prevRound;
         await db.ref().update(updates);
         return;
    }

    const updates: any = {};
    
    // 1. Delete current round (which is likely empty/idle)
    updates[`games/${gameId}/rounds/${currentRound}`] = null;
    
    // 2. Move pointer back
    updates[`games/${gameId}/currentRound`] = prevRound;
    updates[`publicGames/${gameId}/round`] = prevRound;

    // 3. Restore global board/rack to the state of the PREVIOUS round
    // This effectively "Undo" the finalization of prevRound.
    // We want to allow editing/re-choosing move for prevRound.
    
    // Reset prev round to REVIEW state so Master can choose again
    updates[`games/${gameId}/rounds/${prevRound}/status`] = RoundStatus.REVIEW;
    
    // Restore Global Board to the SNAPSHOT of the prev round (before any move was applied)
    if (prevRoundData.boardSnapshot) {
        updates[`games/${gameId}/board`] = prevRoundData.boardSnapshot;
    }
    
    // Restore Global Rack to the RACK of the prev round
    if (prevRoundData.rack) {
        updates[`games/${gameId}/currentRack`] = prevRoundData.rack;
    }
    
    // Optional: Remove the master move from prev round if we want to force re-selection
    // updates[`games/${gameId}/rounds/${prevRound}/masterMove`] = null; 
    // OR keep it so the master sees what they selected before. 
    // Let's keep it but allow overwrite.

    // Reset timers
    updates[`games/${gameId}/timerEndTime`] = null;
    updates[`games/${gameId}/timerPausedRemaining`] = null;

    await db.ref().update(updates);
    await recalculateAllScores(gameId);
};


export const resetGame = async (gameId: string) => {
    await db.ref(`games/${gameId}`).remove();
    await db.ref(`publicGames/${gameId}`).remove();
};
