
import { useEffect, useState } from 'react';
import { db } from '../firebaseConfig';
import { GameState, PlayerMove, RoundStatus, RoundData } from '../types';
import { createInitialBoard } from '../utils/scrabbleUtils';

// Helper to ensure move objects are valid even if Firebase strips empty arrays
const normalizeMove = (m: any): PlayerMove => ({
    ...m,
    tiles: m.tiles || []
});

export const useGame = (gameId: string | null) => {
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!gameId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    // Compat Syntax: Create reference
    const gameRef = db.ref(`games/${gameId}`);

    // Compat Syntax: Listen for value changes
    const onValueChange = (snapshot: any) => {
      const data = snapshot.val();
      if (data) {
        // --- DATA TRANSFORMATION LAYER ---
        // Firebase stores rounds as an object (1: {...}, 2: {...}).
        // The UI expects a flat GameState. We must merge them here.

        const currentRoundNum = data.currentRound || 1;
        const rounds = data.rounds || {};
        const currentRoundData: RoundData = rounds[currentRoundNum] || {};

        // 1. Get Rack: Priority to current round rack, fallback to global
        const activeRack = currentRoundData.rack || data.currentRack || [];

        // 2. Get Moves: Convert Firebase Object to Array and Sanitize
        let currentMoves: PlayerMove[] = [];
        if (currentRoundData.moves) {
            currentMoves = Object.values(currentRoundData.moves).map(normalizeMove);
        }

        // 3. Get Board: Priority to current round board snapshot, fallback to global
        const activeBoard = data.board || createInitialBoard();

        // 4. Build History Array
        const history: any[] = [];
        if (rounds) {
            Object.keys(rounds).forEach(key => {
                const rNum = parseInt(key);
                if (rNum < currentRoundNum) {
                    history.push({
                        ...rounds[key],
                        // Sanitize historical moves
                        moves: rounds[key].moves ? Object.values(rounds[key].moves).map(normalizeMove) : [],
                        // Sanitize master move if present
                        masterMove: rounds[key].masterMove ? normalizeMove(rounds[key].masterMove) : null
                    });
                }
            });
        }
        // Sort history just in case
        history.sort((a, b) => a.roundNumber - b.roundNumber);

        // 5. Construct final GameState object
        const constructedState: GameState = {
            id: gameId,
            // Critical: Read status from the specific round, default to IDLE
            status: currentRoundData.status || RoundStatus.IDLE,
            round: currentRoundNum,
            board: activeBoard,
            currentRack: activeRack,
            participants: data.participants || {},
            moves: currentMoves,
            lastPlayedMove: data.lastPlayedMove ? normalizeMove(data.lastPlayedMove) : null,
            history: history,
            config: data.config || {
                timerDurationSeconds: 180,
                gracePeriodSeconds: 10,
                judgeName: 'MÀSTER'
            },
            roundStartTime: currentRoundData.startTime || null,
            timerEndTime: data.timerEndTime || null,
            timerPausedRemaining: data.timerPausedRemaining || null
        };
        
        setGameState(constructedState);
      } else {
        setError("Partida no trobada");
        setGameState(null);
      }
      setLoading(false);
    };

    gameRef.on('value', onValueChange, (err: any) => {
      console.error("Firebase Error:", err);
      setError(err.message);
      setLoading(false);
    });

    return () => {
      gameRef.off('value', onValueChange);
    };
  }, [gameId]);

  return { gameState, loading, error };
};
