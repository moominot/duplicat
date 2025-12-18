
import {
    ref,
    get,
    set,
    update,
    remove,
    push,
    query,
    orderByChild,
    equalTo,
    DataSnapshot
} from "firebase/database";
import { db } from '../firebaseConfig';
import { GameState, PlayerMove, RoundStatus, GameConfig, Participant, RoundData, BoardCell, Tile } from '../types';
import { createInitialBoard, calculateRemainingBag, calculateMoveScore } from '../utils/scrabbleUtils';
import { parseEliotXML } from '../utils/eliotImport';

// Helper to convert snapshot to a sorted array
const snapshotToArray = (snapshot: DataSnapshot) => {
    const data: any[] = [];
    snapshot.forEach(childSnapshot => {
        data.push(childSnapshot.val());
    });
    return data.sort((a: any, b: any) => b.createdAt - a.createdAt);
};

// --- LOBBY & CREATION ---

export const createNewGame = async (hostName: string, masterId: string, isPublic: boolean): Promise<string> => {
    const newGameRef = push(ref(db, 'games'));
    const gameId = newGameRef.key;
    if (!gameId) throw new Error("Error generating game ID");

    const initialBoard = createInitialBoard();
    const initialRack: string[] = [];

    const initialData = {
        masterId: masterId,
        currentRound: 1,
        board: initialBoard,
        currentRack: initialRack,
        lastPlayedMove: null,
        participants: {},
        config: {
            timerDurationSeconds: 180,
            gracePeriodSeconds: 10,
            judgeName: hostName || 'MASTER',
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
    await set(newGameRef, initialData);

    const summaryData = {
        id: gameId,
        host: hostName,
        createdAt: Date.now(),
        round: 1,
        masterId: masterId,
        isPublic: isPublic,
    };
    await set(ref(db, `gameSummaries/${gameId}`), summaryData);

    return gameId;
};

export const getAllGames = async () => {
    try {
        const snapshot = await get(ref(db, 'gameSummaries'));
        return snapshot.exists() ? snapshotToArray(snapshot) : [];
    } catch (e) {
        console.error("Error getting all games:", e);
        return [];
    }
};

export const getPublicGames = async () => {
    try {
        const q = query(ref(db, 'gameSummaries'), orderByChild('isPublic'), equalTo(true));
        const snapshot = await get(q);
        return snapshot.exists() ? snapshotToArray(snapshot) : [];
    } catch (e) {
        console.error("Error getting public games:", e);
        return [];
    }
};

export const getGamesByMaster = async (masterId: string) => {
    try {
        const q = query(ref(db, 'gameSummaries'), orderByChild('masterId'), equalTo(masterId));
        const snapshot = await get(q);
        return snapshot.exists() ? snapshotToArray(snapshot) : [];
    } catch (e) {
        console.error("Error getting games by master:", e);
        return [];
    }
};

// --- GAME STATE & DATA ---

const recalculateAllScores = async (gameId: string) => {
    const snapshot = await get(ref(db, `games/${gameId}`));
    if (!snapshot.exists()) return;
    const data = snapshot.val();

    const participants = data.participants || {};
    const rounds = data.rounds || {};
    const botId = 'bot_master';

    Object.keys(participants).forEach(pid => {
        if (pid !== botId) {
            participants[pid].totalScore = 0;
            participants[pid].roundScores = {};
            participants[pid].masterMovesCount = 0;
        }
    });

    let botTotalScore = 0;
    const botRoundScores: Record<number, number> = {};

    for (const rKey of Object.keys(rounds).sort((a, b) => parseInt(a) - parseInt(b))) {
        const rNum = parseInt(rKey);
        const round: RoundData = rounds[rKey];
        const moves = round.moves || {};
        const masterScore = round.masterMove?.score || 0;
        const hasMasterMove = !!round.masterMove;

        if (hasMasterMove) {
            botRoundScores[rNum] = masterScore;
        }

        Object.values(moves).forEach((move: any) => {
            const pid = move.playerId;
            if (pid === botId) return;
            if (participants[pid]) {
                if (!participants[pid].roundScores) participants[pid].roundScores = {};
                const score = move.score || 0;
                participants[pid].roundScores[rNum] = score;
                if (hasMasterMove && score > 0 && score >= masterScore) {
                    participants[pid].masterMovesCount = (participants[pid].masterMovesCount || 0) + 1;
                }
            }
        });
    }

    Object.keys(participants).forEach(pid => {
        if (pid !== botId) {
             participants[pid].totalScore = Object.values(participants[pid].roundScores || {}).reduce((sum: number, score: any) => sum + score, 0);
        }
    });
    
    botTotalScore = Object.values(botRoundScores).reduce((sum, score) => sum + score, 0);

    participants[botId] = {
        id: botId, name: 'PARTIDA', tableNumber: '0', group: '',
        totalScore: botTotalScore, roundScores: botRoundScores, masterMovesCount: 0
    };

    await update(ref(db, `games/${gameId}/participants`), participants);
};

export const getFullGameData = async (gameId: string) => {
    const snapshot = await get(ref(db, `games/${gameId}`));
    return snapshot.exists() ? snapshot.val() : null;
};

export const restoreGameData = async (gameId: string, jsonData: any) => {
    if (!jsonData || typeof jsonData !== 'object' || !jsonData.rounds) {
        throw new Error("JSON file does not appear valid.");
    }
    await set(ref(db, `games/${gameId}`), jsonData);

    const summaryUpdate: any = {
        round: jsonData.currentRound || 1,
        host: jsonData.config?.judgeName || 'N/A',
        masterId: jsonData.masterId
    };
    if (jsonData.isPublic !== undefined) {
        summaryUpdate.isPublic = jsonData.isPublic;
    }
    await update(ref(db, `gameSummaries/${gameId}`), summaryUpdate);
    await recalculateAllScores(gameId);
};

export const resetGame = async (gameId: string) => {
    await remove(ref(db, `games/${gameId}`));
    await remove(ref(db, `gameSummaries/${gameId}`));
};

// --- GAMEPLAY ACTIONS ---

export const updateConfig = async (gameId: string, config: Partial<GameConfig>) => {
    await update(ref(db, `games/${gameId}/config`), config);
};

export const registerParticipant = async (gameId: string, participant: {id: string, name: string, tableNumber: string, group?: string}) => {
    const { id, name, tableNumber, group } = participant;
    const participantRef = ref(db, `games/${gameId}/participants/${id}`);
    const updates: any = { id, name, tableNumber };
    if (group) {
        updates.group = group;
    }
    await update(participantRef, updates);
};

export const importPlayers = async (gameId: string, players: Partial<Participant>[]) => {
    const updates: any = {};
    players.forEach(p => {
        if (p.id) {
            updates[`/games/${gameId}/participants/${p.id}`] = p;
        }
    });
    await update(ref(db), updates);
};

export const removeParticipant = async (gameId: string, participantId: string) => {
    await remove(ref(db, `games/${gameId}/participants/${participantId}`));
};

export const submitMove = async (gameId: string, move: PlayerMove) => {
  const movePath = `games/${gameId}/rounds/${move.roundNumber}/moves/${move.playerId}`;
  try {
      await set(ref(db, movePath), move);
      const pSnap = await get(ref(db, `games/${gameId}/participants/${move.playerId}`));
      const currentGroup = pSnap.exists() ? pSnap.val().group : undefined;
      await registerParticipant(gameId, {
          id: move.playerId,
          name: move.playerName,
          tableNumber: move.tableNumber,
          group: currentGroup
      });
  } catch (e) {
      console.error("[GameService] Error submitting move:", e);
      throw e;
  }
};

export const submitManualMoves = async (gameId: string, moves: PlayerMove[]) => {
    const updates: any = {};
    if (!moves || moves.length === 0) return;
    for (const move of moves) {
        updates[`/games/${gameId}/rounds/${move.roundNumber}/moves/${move.playerId}`] = move;
    }
    await update(ref(db), updates);
    await recalculateAllScores(gameId);
};

export const updateHistoricalMove = async (gameId: string, roundNumber: number, move: PlayerMove) => {
    const roundSnap = await get(ref(db, `games/${gameId}/rounds/${roundNumber}`));
    const rData = roundSnap.val();
    const boardSnapshot = rData?.boardSnapshot || createInitialBoard();
    const rackSnapshot = rData?.rack || [];

    const calcResult = calculateMoveScore(boardSnapshot, move.tiles, rackSnapshot, move.row, move.col, move.direction);
    const validMove = { ...move, score: calcResult.score, isValid: calcResult.isValid, error: calcResult.error || null, roundNumber };

    await set(ref(db, `games/${gameId}/rounds/${roundNumber}/moves/${move.playerId}`), validMove);
    await recalculateAllScores(gameId);
};

export const updateRack = async (gameId: string, newRack: string[]) => {
    const roundSnap = await get(ref(db, `games/${gameId}/currentRound`));
    const currentRound = roundSnap.val() || 1;
    const updates: any = {};
    updates[`/games/${gameId}/rounds/${currentRound}/rack`] = newRack;
    updates[`/games/${gameId}/currentRack`] = newRack;
    await update(ref(db), updates);
};

export const refillRack = async (gameId: string) => {
    const snapshot = await get(ref(db, `games/${gameId}`));
    if (!snapshot.exists()) return;
    const data = snapshot.val();
    const currentRound = data.currentRound || 1;
    const currentRack = data.currentRack || [];
    const currentBoard = data.board || createInitialBoard();
    
    if ((data.rounds?.[currentRound]?.status || RoundStatus.IDLE) !== RoundStatus.IDLE) return;

    if (currentRack.length < 7) {
        const bag = calculateRemainingBag(currentBoard, currentRack);
        if (bag.length > 0) {
            const needed = 7 - currentRack.length;
            const newRack = [...currentRack, ...bag.slice(0, needed)];
            const updates: any = {};
            updates[`/games/${gameId}/rounds/${currentRound}/rack`] = newRack;
            updates[`/games/${gameId}/currentRack`] = newRack;
            await update(ref(db), updates);
        }
    }
};

// --- TIMER & ROUND MANAGEMENT ---

export const openRound = async (gameId: string) => {
    const gameRef = ref(db, `games/${gameId}`);
    const snapshot = await get(gameRef);
    if (!snapshot.exists()) return;
    const data = snapshot.val();
    
    const currentRound = data.currentRound || 1;
    const currentRack = data.currentRack || [];
    const bag = calculateRemainingBag(data.board || createInitialBoard(), currentRack);
    
    if (bag.length > 0 && currentRack.length < 7) {
        throw new Error(`Rack is not full! (${currentRack.length}/7)`);
    }

    const durationMs = (data.config?.timerDurationSeconds || 180) * 1000;
    const updates: any = {};
    updates[`/games/${gameId}/rounds/${currentRound}/status`] = RoundStatus.PLAYING;
    updates[`/games/${gameId}/rounds/${currentRound}/startTime`] = Date.now();
    updates[`/games/${gameId}/timerEndTime`] = null;
    updates[`/games/${gameId}/timerPausedRemaining`] = durationMs;
    await update(ref(db), updates);
};

export const closeRound = async (gameId: string) => {
    const roundSnap = await get(ref(db, `games/${gameId}/currentRound`));
    const currentRound = roundSnap.val() || 1;
    const updates: any = {};
    updates[`/games/${gameId}/rounds/${currentRound}/status`] = RoundStatus.REVIEW;
    updates[`/games/${gameId}/timerEndTime`] = null;
    updates[`/games/${gameId}/timerPausedRemaining`] = null;
    await update(ref(db), updates);
};

export const reopenRound = async (gameId: string) => {
    const gameRef = ref(db, `games/${gameId}`);
    const snapshot = await get(gameRef);
    if (!snapshot.exists()) return;
    const data = snapshot.val();
    const currentRound = data.currentRound || 1;
    const durationMs = (data.config?.timerDurationSeconds || 180) * 1000;
    const newEndTime = Date.now() + 30000; // 30 seconds extra
    const newStartTime = newEndTime - durationMs;

    const updates: any = {};
    updates[`/games/${gameId}/rounds/${currentRound}/status`] = RoundStatus.PLAYING;
    updates[`/games/${gameId}/rounds/${currentRound}/startTime`] = newStartTime;
    updates[`/games/${gameId}/timerEndTime`] = newEndTime;
    updates[`/games/${gameId}/timerPausedRemaining`] = null;
    await update(ref(db), updates);
};

export const toggleTimer = async (gameId: string) => {
    const gameRef = ref(db, `games/${gameId}`);
    const snapshot = await get(gameRef);
    if (!snapshot.exists()) return;
    const data = snapshot.val();
    const currentRound = data.currentRound || 1;
    
    if (data.rounds?.[currentRound]?.status !== RoundStatus.PLAYING) return;

    const now = Date.now();
    const durationMs = (data.config?.timerDurationSeconds || 180) * 1000;
    const updates: any = {};

    if (data.timerPausedRemaining) { // RESUME
        const newEndTime = now + data.timerPausedRemaining;
        updates[`/games/${gameId}/timerEndTime`] = newEndTime;
        updates[`/games/${gameId}/timerPausedRemaining`] = null;
        updates[`/games/${gameId}/rounds/${currentRound}/startTime`] = newEndTime - durationMs;
    } else if (data.timerEndTime) { // PAUSE
        const remaining = data.timerEndTime - now;
        if (remaining > 0) {
            updates[`/games/${gameId}/timerEndTime`] = null;
            updates[`/games/${gameId}/timerPausedRemaining`] = remaining;
        }
    }
    await update(ref(db), updates);
};

export const resetTimer = async (gameId: string) => {
    const gameRef = ref(db, `games/${gameId}`);
    const snapshot = await get(gameRef);
    if (!snapshot.exists()) return;
    const data = snapshot.val();
    const currentRound = data.currentRound || 1;

    if (data.rounds?.[currentRound]?.status !== RoundStatus.PLAYING) return;

    const durationMs = (data.config?.timerDurationSeconds || 180) * 1000;
    const now = Date.now();
    const updates: any = {};
    updates[`/games/${gameId}/timerEndTime`] = now + durationMs;
    updates[`/games/${gameId}/timerPausedRemaining`] = null;
    updates[`/games/${gameId}/rounds/${currentRound}/startTime`] = now;
    await update(ref(db), updates);
};

export const finalizeRound = async (gameId: string, masterMove: PlayerMove) => {
    const gameSnapshot = await get(ref(db, `games/${gameId}`));
    if (!gameSnapshot.exists()) throw new Error("Game not found");
    const data = gameSnapshot.val();
    const currentRoundNum = data.currentRound || 1;
    const nextRoundNum = currentRoundNum + 1;
    const boardSnapshot = data.board || createInitialBoard();
    const rackSnapshot = data.rounds?.[currentRoundNum]?.rack || [];

    const masterScoreResult = calculateMoveScore(
        boardSnapshot, masterMove.tiles, rackSnapshot, masterMove.row, masterMove.col, masterMove.direction
    );
    const finalMasterMove = { ...masterMove, id: `auto_${Date.now()}`, playerId: 'bot', score: masterScoreResult.score, isValid: true };

    const updates: any = {};
    updates[`/games/${gameId}/rounds/${currentRoundNum}/status`] = RoundStatus.COMPLETED;
    updates[`/games/${gameId}/rounds/${currentRoundNum}/masterMove`] = finalMasterMove;

    const { row, col, direction, tiles } = finalMasterMove;
    const newBoard = boardSnapshot.map((r: BoardCell[]) => r.map(c => ({...c})));
    const tilesUsed: string[] = [];

    tiles.forEach((tile: Tile, index: number) => {
        const r = direction === 'H' ? row : row + index;
        const c = direction === 'H' ? col + index : col;
        if (r < 15 && c < 15 && !newBoard[r][c].tile) {
            newBoard[r][c].tile = tile;
            tilesUsed.push(tile.isBlank ? '?' : tile.char.toUpperCase());
        }
    });

    const newRack = [...rackSnapshot];
    tilesUsed.forEach(char => {
        const idx = newRack.indexOf(char);
        if (idx !== -1) newRack.splice(idx, 1);
    });

    updates[`/games/${gameId}/rounds/${nextRoundNum}`] = {
        roundNumber: nextRoundNum, status: RoundStatus.IDLE, boardSnapshot: newBoard,
        rack: newRack, moves: {}, startTime: null
    };
    updates[`/games/${gameId}/currentRound`] = nextRoundNum;
    updates[`/games/${gameId}/board`] = newBoard;
    updates[`/games/${gameId}/currentRack`] = newRack;
    updates[`/games/${gameId}/lastPlayedMove`] = finalMasterMove;
    updates[`/gameSummaries/${gameId}/round`] = nextRoundNum;

    await update(ref(db), updates);
    await recalculateAllScores(gameId);
};

export const deleteLastRound = async (gameId: string) => {
    const gameSnapshot = await get(ref(db, `games/${gameId}`));
    if (!gameSnapshot.exists()) throw new Error("Game not found");
    const data = gameSnapshot.val();
    const currentRound = data.currentRound;
    if (currentRound <= 1) return;

    const prevRound = currentRound - 1;
    const prevRoundData: RoundData = data.rounds?.[prevRound];

    const updates: any = {};
    updates[`/games/${gameId}/rounds/${currentRound}`] = null;
    updates[`/games/${gameId}/currentRound`] = prevRound;
    
    if (prevRoundData) {
        updates[`/games/${gameId}/rounds/${prevRound}/status`] = RoundStatus.REVIEW;
        if (prevRoundData.boardSnapshot) updates[`/games/${gameId}/board`] = prevRoundData.boardSnapshot;
        if (prevRoundData.rack) updates[`/games/${gameId}/currentRack`] = prevRoundData.rack;
    }
    
    updates[`/gameSummaries/${gameId}/round`] = prevRound;
    await update(ref(db), updates);
    await recalculateAllScores(gameId);
};
