
import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { PlayerMove, RoundStatus, Participant, Tile as TileType, BoardCell } from '../types';
import { COL_LABELS, ROW_LABELS, TILE_COUNTS } from '../constants';
import { updateRack, refillRack, openRound, closeRound, finalizeRound, toggleTimer, resetTimer, reopenRound, submitManualMoves, updateHistoricalMove, prepareNextRound } from '../services/gameService';
import { calculateMoveScore, parseInputWord, createTile, calculateRemainingBag, getDictionaryVersion, getTileIndices, internalToDisplayWord, applyMoveToBoard, cloneBoard, createInitialBoard, loadDictionary } from '../utils/scrabbleUtils';
import Board from '../components/Board';
import Tile from '../components/Tile';
import { useGame } from '../hooks/useGame';
import { findBestMoves } from '../utils/moveFinder';

type ProcessedMove = PlayerMove & {
    calculatedScore: number;
    valid: boolean;
    error?: string;
    participant?: Participant; // Attach participant info to move for group display
};

type SortConfig = {
    key: string;
    direction: 'asc' | 'desc';
};

// Define View Mode
type ViewMode = 'list' | 'ranking' | 'best' | 'manual';

const MasterView: React.FC = () => {
    const [searchParams] = useSearchParams();
    const gameId = searchParams.get('gameId');
    const navigate = useNavigate();

    const { gameState, loading, error } = useGame(gameId);

    // --- STATE DEFINITIONS ---
    const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
    const [previewMove, setPreviewMove] = useState<ProcessedMove | null>(null);
    const [isApplying, setIsApplying] = useState(false);

    const [rackInput, setRackInput] = useState('');
    const [isEditingRack, setIsEditingRack] = useState(false);
    const [bagCount, setBagCount] = useState(0);

    // Bag Modal State
    const [showBagModal, setShowBagModal] = useState(false);

    const [timeLeft, setTimeLeft] = useState(180);
    const [timerFinished, setTimerFinished] = useState(false);
    const audioCtxRef = useRef<AudioContext | null>(null);

    // Navigation State
    const [viewingRound, setViewingRound] = useState<number>(0);
    const [viewMode, setViewMode] = useState<ViewMode>('list');

    // Mobile UI State: True = Panel Expanded (covering board), False = Panel Collapsed (only tabs visible)
    const [isMobilePanelOpen, setIsMobilePanelOpen] = useState(false);

    const [showConfirmModal, setShowConfirmModal] = useState(false);
    
    // Custom Modal for Manual Override Warning
    const [overrideModal, setOverrideModal] = useState<{pid: string, name: string, word: string, score: number} | null>(null);

    // Dictionary Version
    const [dictVersion, setDictVersion] = useState<string>('');
    const [dictLoaded, setDictLoaded] = useState(false);    
    // --- Manual Entry State ---
    const [manualWord, setManualWord] = useState('');
    // Default to empty strings/null to force selection
    const [manualRow, setManualRow] = useState('');
    const [manualCol, setManualCol] = useState('');
    const [manualDirection, setManualDirection] = useState<'H' | 'V' | null>(null);
    const [manualTiles, setManualTiles] = useState<TileType[]>([]);
    const [manualSelectedPlayers, setManualSelectedPlayers] = useState<string[]>([]);
    const [isManualFieldsLocked, setIsManualFieldsLocked] = useState(false);

    // --- Best Moves State ---
    const [bestMoves, setBestMoves] = useState<ProcessedMove[]>([]);
    const [isFindingMoves, setIsFindingMoves] = useState(false);

    // --- Sorting & Filtering State ---
    const [sortConfig, setSortConfig] = useState<SortConfig>({ key: 'totalScore', direction: 'desc' });
    const [selectedGroup, setSelectedGroup] = useState<string>('ALL');

    // --- RESIZING STATE ---
    const [isDraggingSplit, setIsDraggingSplit] = useState(false);
    const [rightPanelWidth, setRightPanelWidth] = useState(42); // Percentage (approx 5/12)
    const [isLargeScreen, setIsLargeScreen] = useState(window.innerWidth >= 1024);

    // --- DERIVED STATE (Must be before handlers) ---
    const isHistoryView = gameState ? viewingRound < gameState.round : false;

    const historyItem = (gameState && isHistoryView)
        ? gameState.history.find(h => h.roundNumber === viewingRound)
        : null;

    const rawParticipants = Object.values(gameState?.participants || {}) as Participant[];

    // Extract unique groups for filter tabs
    const uniqueGroups = Array.from(new Set(rawParticipants.map(p => p.group).filter(Boolean))).sort();

    const effectiveParticipants = rawParticipants.map(p => {
        let currentViewTotal = 0;
        const scoresMap = p.roundScores || {};

        // Sum scores only up to the round we are viewing
        Object.entries(scoresMap).forEach(([rStr, score]) => {
            const r = parseInt(rStr);
            if (r <= viewingRound) {
                currentViewTotal += score;
            }
        });

        return {
            ...p,
            viewTotalScore: currentViewTotal
        };
    });

    // Filter participants based on selected group, but ALWAYS keep bot_master if present
    const filteredParticipants = selectedGroup === 'ALL'
        ? effectiveParticipants
        : effectiveParticipants.filter(p => p.group === selectedGroup || p.id === 'bot_master');

    // Separate 'Partida' bot from ranking
    const botPartida = filteredParticipants.find(p => p.id === 'bot_master');
    const humanParticipants = filteredParticipants.filter(p => p.id !== 'bot_master');

    // Calculate max score reference (Bot score if > 0, else max human score)
    const currentViewMaxScore = (botPartida && botPartida.viewTotalScore > 0) 
        ? botPartida.viewTotalScore 
        : Math.max(...humanParticipants.map(p => p.viewTotalScore), 1);

    const displayRoundsArray = Array.from({ length: viewingRound }, (_, i) => i + 1);

    const roundMaxScores: Record<number, number> = {};
    displayRoundsArray.forEach(r => {
        roundMaxScores[r] = Math.max(...rawParticipants.map(p => p.roundScores?.[r] || 0));
    });

    const sortedHumans = [...humanParticipants].sort((a, b) => {
        let valA: any = 0;
        let valB: any = 0;

        if (sortConfig.key === 'percentage' || sortConfig.key === 'totalScore') {
            valA = a.viewTotalScore;
            valB = b.viewTotalScore;
        } else if (sortConfig.key === 'masterMoves') {
            valA = a.masterMovesCount || 0;
            valB = b.masterMovesCount || 0;
        } else if (sortConfig.key === 'tableNumber') {
            valA = parseInt(a.tableNumber) || 0;
            valB = parseInt(b.tableNumber) || 0;
        } else if (sortConfig.key === 'name') {
            valA = a.name.toLowerCase();
            valB = b.name.toLowerCase();
        }

        if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
        if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
    });

    // Combine Bot (always first) + Humans
    const sortedRanking = botPartida ? [botPartida, ...sortedHumans] : sortedHumans;

    const sortedParticipantsForManual = [...rawParticipants].filter(p => p.id !== 'bot_master').sort((a, b) => {
        const numA = parseInt(a.tableNumber) || 999;
        const numB = parseInt(b.tableNumber) || 999;
        return numA - numB;
    });

    const currentRackCount = (gameState?.currentRack || []).length;

    // --- HOOKS: Determine display rack HERE, before any conditional return ---
    // Use rackInput as the source of truth for display in current round to ensure perfect sync
    // The input box itself is kept in sync with DB via useEffect when not editing
    const displayRack = useMemo(() => {
        if (isHistoryView && historyItem) return historyItem.rack;
        
        // Always visualize what is in the input box for the current round
        // This ensures visual tiles match the text input immediately
        return parseInputWord(rackInput).map(t => t.char);
    }, [isHistoryView, historyItem, rackInput]);
    
    // --- SENYOR DETECTION LOGIC ---
    const senyorStatus = useMemo(() => {
        // Only check for Senyor if not in history mode and we have a decent amount of tiles
        if (isHistoryView || !displayRack || displayRack.length < 7) return null;

        // If there is a blank/joker ('?'), it's never a Senyor
        if (displayRack.includes('?')) return null;

        const VOWELS = new Set(['A', 'E', 'I', 'O', 'U']);
        let vowelCount = 0;
        let consonantCount = 0;

        for (const char of displayRack) {
            // Use uppercase comparison. Internal chars like 'Û' (QU) or 'Ł' (L·L) are consonants.
            // VOWELS Set only contains standard vowels.
            if (VOWELS.has(char.toUpperCase())) {
                vowelCount++;
            } else {
                consonantCount++;
            }
        }

        if (vowelCount === displayRack.length) return 'VOCALS';
        if (consonantCount === displayRack.length) return 'CONSONANTS';
        
        return null;
    }, [displayRack, isHistoryView]);

    // --- MEMOIZED PROCESSED MOVES ---
    // Moved up so it can be used in handlers
    const processedMoves: ProcessedMove[] = useMemo(() => {
        if (!gameState || !dictLoaded) return [];
        let moves: ProcessedMove[] = [];

        if (isHistoryView && historyItem && historyItem.moves) {
            moves = Object.values(historyItem.moves).map((m: any) => ({
                ...m,
                // Sanitization: Ensure tiles is always an array, even if Firebase removed it (e.g. pass move)
                tiles: m.tiles || [],
                calculatedScore: m.score || 0,
                valid: (m as any).valid ?? m.isValid ?? false,
                error: m.error,
                participant: rawParticipants.find(p => p.id === m.playerId)
            }));

            // INJECT MASTER MOVE INTO LIST IF HISTORY VIEW
            // Ensure the master move is present (it might not be in the 'moves' collection if manually added)
            if (historyItem.masterMove) {
                const mm = historyItem.masterMove;
                // Check if it's already in the moves list (by ID or precise equality)
                const exists = moves.some(m => m.id === mm.id);
                if (!exists) {
                    moves.push({
                        ...mm,
                        // Sanitization
                        tiles: mm.tiles || [],
                        calculatedScore: mm.score || 0,
                        valid: true,
                        isMasterMove: true,
                        participant: { 
                            id: 'bot_master', 
                            name: 'PARTIDA', 
                            tableNumber: '0', 
                            totalScore: 0, 
                            roundScores: {} 
                        }
                    });
                } else {
                    // If exists, mark it as master move for sorting
                    moves = moves.map(m => m.id === mm.id ? { ...m, isMasterMove: true } : m);
                }
            }

        } else if (!isHistoryView) {
            const currentMoves = gameState.moves || [];
            const roundEndTime = (gameState.roundStartTime || 0) + (gameState.config.timerDurationSeconds * 1000);
            const gracePeriod = (gameState.config.gracePeriodSeconds || 10) * 1000;

            moves = currentMoves.map(m => {
                const result = calculateMoveScore(
                    gameState.board,
                    m.tiles,
                    gameState.currentRack || [],
                    m.row,
                    m.col,
                    m.direction
                );
                const isLate = (!m.isManual && gameState.roundStartTime && m.timestamp > (roundEndTime + gracePeriod));
                if (isLate) {
                    result.isValid = false;
                    result.score = 0;
                    result.error = "Fora de temps";
                }
                return {
                    ...m,
                    calculatedScore: result.score,
                    valid: result.isValid,
                    error: result.error,
                    participant: rawParticipants.find(p => p.id === m.playerId)
                };
            });
        }

        if (selectedGroup !== 'ALL') {
            moves = moves.filter(m => m.participant?.group === selectedGroup || m.isMasterMove);
        }

        // Sort: Master Move first, then Score Descending
        return moves.sort((a, b) => {
            if (a.isMasterMove) return -1;
            if (b.isMasterMove) return 1;
            return b.calculatedScore - a.calculatedScore;
        });
    }, [gameState, isHistoryView, historyItem, selectedGroup, rawParticipants, dictLoaded]);


    // --- EFFECTS ---

    useEffect(() => {
        if (!gameId) navigate('/');
    }, [gameId, navigate]);

    // Screen resize listener for layout
    useEffect(() => {
        const handleResize = () => setIsLargeScreen(window.innerWidth >= 1024);
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    // Dragging logic
    const handleMouseDownSplit = (e: React.MouseEvent) => {
        e.preventDefault();
        setIsDraggingSplit(true);
    };

    const handleMouseMove = useCallback((e: MouseEvent) => {
        if (isDraggingSplit) {
            // Calculate percentage from right side
            const newWidth = ((window.innerWidth - e.clientX) / window.innerWidth) * 100;
            // Clamp between 20% and 70%
            if (newWidth > 20 && newWidth < 70) {
                setRightPanelWidth(newWidth);
            }
        }
    }, [isDraggingSplit]);

    const handleMouseUp = useCallback(() => {
        setIsDraggingSplit(false);
    }, []);

    useEffect(() => {
        if (isDraggingSplit) {
            window.addEventListener('mousemove', handleMouseMove);
            window.addEventListener('mouseup', handleMouseUp);
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
        } else {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        }
        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isDraggingSplit, handleMouseMove, handleMouseUp]);


    useEffect(() => {
        if (gameState && viewingRound === 0) {
            setViewingRound(gameState.round);
        } else if (gameState && gameState.round !== viewingRound && viewingRound > gameState.round) {
            setViewingRound(gameState.round);
        } else if (gameState && gameState.status === RoundStatus.IDLE && viewingRound < gameState.round) {
            setViewingRound(gameState.round);
        } else if (gameState && gameState.status === RoundStatus.COMPLETED) {
            // Special case: if we are in COMPLETED state (e.g. after deleting the last round),
            // we are technically at the end of that round.
            setViewingRound(gameState.round);
        }
    }, [gameState?.round, gameState?.status]);

    useEffect(() => {
        if (isHistoryView && historyItem && historyItem.masterMove) {
            // Default: Show the master move if it exists
            setPreviewMove({
                ...historyItem.masterMove,
                // Sanitization
                tiles: historyItem.masterMove.tiles || [],
                calculatedScore: historyItem.masterMove.score || 0,
                valid: true
            });
        } else if (!isHistoryView) {
            setPreviewMove(null);
        }
    }, [viewingRound, isHistoryView]);

    // Clear best moves when round changes or view changes
    useEffect(() => {
        setBestMoves([]);
    }, [viewingRound, gameState?.round]);

    useEffect(() => {
        if (gameState) {
            const remaining = calculateRemainingBag(gameState.board, (gameState.currentRack || []));
            setBagCount(remaining.length);
        }
    }, [gameState]);

    // Load Dictionary
    useEffect(() => {
        const load = async () => {
            if (gameState?.config?.dictionary) {
                setDictLoaded(false);
                setDictVersion('Carregant...');
                await loadDictionary(gameState.config.dictionary);
                setDictVersion(getDictionaryVersion());
                setDictLoaded(true);
            } else {
                // Default fallback
                setDictVersion(getDictionaryVersion());
                setDictLoaded(true);
            }
        };
        load();
    }, [gameState?.config?.dictionary]);

    useEffect(() => {
        if (gameState && !isEditingRack) {
            const dbRackString = (gameState.currentRack || [])
                .map(c => createTile(c).displayChar)
                .join('');

            if (dbRackString !== rackInput) {
                setRackInput(dbRackString);
            }
        }
    }, [gameState?.currentRack, isEditingRack]);

    useEffect(() => {
        if (gameState && gameState.status === RoundStatus.IDLE) {
            setSelectedCandidateId(null);
            setPreviewMove(null);
            setIsApplying(false);
            setShowConfirmModal(false);
        }
    }, [gameState?.round, gameState?.status]);

    useEffect(() => {
        // Preview manual word tiles instantly
        if (manualWord) {
            setManualTiles(parseInputWord(manualWord));
        } else {
            setManualTiles([]);
        }
    }, [manualWord]);

    // Sync previewMove with manual input when in manual view
    useEffect(() => {
        if (viewMode === 'manual' && manualWord && manualRow && manualCol && manualDirection) {
            const rIndex = ROW_LABELS.indexOf(manualRow);
            const cIndex = COL_LABELS.indexOf(manualCol);
            
            if (rIndex !== -1 && cIndex !== -1) {
                // Real-time validation logic
                const boardToUse = (isHistoryView && historyItem) ? historyItem.boardSnapshot : gameState?.board || createInitialBoard();
                const rackToUse = (isHistoryView && historyItem) ? historyItem.rack : gameState?.currentRack || [];

                // We check validity. Note: manual entry might use tiles not in rack (correction/override).
                // calculateMoveScore checks rack but we want to see score even if missing tiles.
                // To force score calculation, we can pass a 'super rack' consisting of the needed tiles plus actual rack.
                const neededChars = manualTiles.map(t => t.char);
                const forcedRack = [...rackToUse, ...neededChars];

                const validation = calculateMoveScore(
                    boardToUse,
                    manualTiles,
                    forcedRack, // Use forced rack to bypass missing tile errors for manual entry score preview
                    rIndex,
                    cIndex,
                    manualDirection
                );

                // However, we still want to know if it IS valid with the REAL rack.
                const strictValidation = calculateMoveScore(
                     boardToUse,
                     manualTiles,
                     rackToUse,
                     rIndex,
                     cIndex,
                     manualDirection
                );

                setPreviewMove({
                    id: 'manual_preview',
                    playerId: 'manual',
                    playerName: 'Manual',
                    tableNumber: '0',
                    word: manualWord,
                    tiles: manualTiles,
                    row: rIndex,
                    col: cIndex,
                    direction: manualDirection,
                    timestamp: Date.now(),
                    roundNumber: viewingRound,
                    calculatedScore: validation.score, // Show potential score
                    valid: strictValidation.isValid,   // But strict validity status
                    error: strictValidation.error
                });
            }
        } else if (viewMode === 'manual' && (!manualWord || !manualRow || !manualCol || !manualDirection)) {
            // Clear preview if manual input is incomplete
            setPreviewMove(null);
        }
    }, [viewMode, manualWord, manualRow, manualCol, manualDirection, manualTiles, viewingRound, isHistoryView, historyItem, gameState]);


    // --- SYNCED TIMER LOGIC ---
    useEffect(() => {
        if (!gameState) return;

        const updateTimer = () => {
            const now = Date.now();

            if (gameState.status === RoundStatus.PLAYING) {
                if (gameState.timerPausedRemaining !== null && gameState.timerPausedRemaining !== undefined) {
                    setTimeLeft(Math.ceil(gameState.timerPausedRemaining / 1000));
                } else if (gameState.timerEndTime) {
                    const remainingMs = gameState.timerEndTime - now;
                    const remainingSec = Math.max(0, Math.ceil(remainingMs / 1000));

                    setTimeLeft(remainingSec);

                    if (remainingSec === 0 && !timerFinished) {
                        setTimerFinished(true);
                        playBeep(1.5, 600, 'square');
                        handleCloseRound();
                    } else if (remainingSec > 0) {
                        setTimerFinished(false);
                    }

                    if (remainingSec === 30) playBeep(0.5, 440);
                }
            } else {
                setTimeLeft(gameState.config.timerDurationSeconds);
                setTimerFinished(false);
            }
        };

        updateTimer();
        const interval = setInterval(updateTimer, 200);
        return () => clearInterval(interval);
    }, [gameState?.status, gameState?.timerEndTime, gameState?.timerPausedRemaining, gameState?.config]);


    const playBeep = (duration: number, frequency: number, type: OscillatorType = 'sine') => {
        try {
            if (!audioCtxRef.current) {
                audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
            }
            const ctx = audioCtxRef.current;
            if (ctx.state === 'suspended') ctx.resume();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = type;
            osc.frequency.value = frequency;
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start();
            gain.gain.exponentialRampToValueAtTime(0.00001, ctx.currentTime + duration);
            osc.stop(ctx.currentTime + duration);
        } catch (e) {
            console.error("Audio play failed", e);
        }
    };

    // --- Action Handlers ---

    const handleOpenRound = async () => {
        if (!gameId) return;
        try {
            await openRound(gameId);
        } catch (e: any) {
            alert(e.message);
        }
    };

    const handlePrepareNextRound = async () => {
        if (!gameId) return;
        try {
            await prepareNextRound(gameId);
        } catch (e: any) {
            alert(e.message);
        }
    }

    const handleCloseRound = async () => {
        if (!gameId) return;
        await closeRound(gameId);
    };

    const handleReopenRound = async () => {
        if (!gameId || isHistoryView) return;
        await reopenRound(gameId);
    };

    const handleToggleTimer = async () => {
        if (!gameId) return;
        await toggleTimer(gameId);
    };

    const handleResetTimer = async () => {
        if (!gameId) return;
        await resetTimer(gameId);
    };

    const handlePrevRound = () => {
        if (viewingRound > 1) setViewingRound(viewingRound - 1);
    };

    const handleNextRound = () => {
        if (gameState && viewingRound < gameState.round) setViewingRound(viewingRound + 1);
    };

    const handleSort = (key: string) => {
        setSortConfig(current => ({
            key,
            direction: current.key === key && current.direction === 'desc' ? 'asc' : 'desc'
        }));
    };

    const handleFindBestMoves = () => {
        if (!gameState || !dictLoaded) {
             alert("El diccionari encara no s'ha carregat.");
             return;
        }

        // Use snapshot board if history, else current board
        // FIX: Specifically use historyItem.boardSnapshot for historical rounds
        const boardToUse = (isHistoryView && historyItem) ? historyItem.boardSnapshot : gameState.board;
        const rackToUse = (isHistoryView && historyItem) ? historyItem.rack : gameState.currentRack;

        setIsFindingMoves(true);

        // Run in timeout to allow UI to show loading state
        setTimeout(() => {
            try {
                const limit = gameState.config.bestMovesLimit ?? 10;
                const rawMoves = findBestMoves(boardToUse, rackToUse, limit);
                const processed = rawMoves.map(m => ({
                    ...m,
                    calculatedScore: m.score || 0,
                    valid: true // findBestMoves returns valid ones
                }));
                setBestMoves(processed);
            } catch (e) {
                console.error("Error finding moves:", e);
                alert("Error calculant jugades.");
            } finally {
                setIsFindingMoves(false);
            }
        }, 100);
    };

    const formatTime = (seconds: number) => {
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    };

    const getCoordsLabel = (row: number, col: number, dir: string) => {
        const rLabel = ROW_LABELS[row];
        const cLabel = COL_LABELS[col];
        return `${rLabel}${cLabel}${dir === 'H' ? '→' : '↓'}`;
    }

    // --- Manual Entry Handlers ---

    const handleManualTileClick = (index: number) => {
        if (isManualFieldsLocked) return;
        const indices = getTileIndices(manualWord);
        if (indices[index]) {
            const { start, end } = indices[index];
            const segment = manualWord.substring(start, end);
            const isUpper = segment === segment.toUpperCase();
            const newSegment = isUpper ? segment.toLowerCase() : segment.toUpperCase();
            const newWord = manualWord.substring(0, start) + newSegment + manualWord.substring(end);
            setManualWord(newWord);
        }
    };

    const toggleManualPlayer = (pid: string) => {
        // If already selected, remove it
        if (manualSelectedPlayers.includes(pid)) {
            setManualSelectedPlayers(prev => prev.filter(p => p !== pid));
            return;
        }

        // If not selected, check if player already has a move
        const participant = rawParticipants.find(p => p.id === pid);
        const existingMove = processedMoves.find(m => m.playerId === pid && !m.isMasterMove);
        
        if (existingMove) {
             // Show modal confirmation instead of alert
             setOverrideModal({
                 pid,
                 name: participant?.name || 'Desconegut',
                 word: internalToDisplayWord(existingMove.word),
                 score: existingMove.calculatedScore
             });
             return;
        }

        // If no existing move, add to selection
        setManualSelectedPlayers(prev => [...prev, pid]);
    };

    const handleConfirmOverride = () => {
        if (overrideModal) {
            setManualSelectedPlayers(prev => [...prev, overrideModal.pid]);
            setOverrideModal(null);
        }
    };

    const submitManualEntry = async () => {
        if (!gameId || !gameState || manualSelectedPlayers.length === 0 || !manualWord) return;

        if (!manualRow || !manualCol) {
            alert("Has de seleccionar Fila i Columna.");
            return;
        }
        
        if (!manualDirection) {
            alert("Has de seleccionar la Direcció (Horitzontal o Vertical).");
            return;
        }

        const rIndex = ROW_LABELS.indexOf(manualRow);
        const cIndex = COL_LABELS.indexOf(manualCol);

        // Prepare common move data
        const baseMoveData = {
            word: manualWord,
            tiles: manualTiles,
            row: rIndex,
            col: cIndex,
            direction: manualDirection,
            timestamp: Date.now(),
            roundNumber: viewingRound, // Use current VIEWING round, not active game round
            isManual: true // FLAG THE MOVE AS MANUALLY ENTERED
        };

        try {
            if (isHistoryView) {
                // --- HISTORICAL UPDATE ---
                for (const pid of manualSelectedPlayers) {
                    const participant = rawParticipants.find(p => p.id === pid);
                    const move: PlayerMove = {
                        ...baseMoveData,
                        id: `${Date.now()}_${pid}_hist`,
                        playerId: pid,
                        playerName: participant?.name || 'Desconegut',
                        tableNumber: participant?.tableNumber || '?',
                        score: 0 // Calculated in service
                    };
                    await updateHistoricalMove(gameId, viewingRound, move);
                }
            } else {
                // --- CURRENT ROUND UPDATE ---
                const movesToSend: PlayerMove[] = manualSelectedPlayers.map(pid => {
                    const participant = rawParticipants.find(p => p.id === pid);
                    return {
                        ...baseMoveData,
                        id: `${Date.now()}_${pid}`,
                        playerId: pid,
                        playerName: participant?.name || 'Desconegut',
                        tableNumber: participant?.tableNumber || '?',
                        score: 0
                    };
                });
                await submitManualMoves(gameId, movesToSend);
            }

            // Reset manual inputs but keep view open
            setManualWord('');
            setManualSelectedPlayers([]);
            setManualTiles([]);
            setManualRow('');
            setManualCol('');
            setManualDirection(null);
            setPreviewMove(null); 
            setIsManualFieldsLocked(false);
            
            // Switch back to list view for better flow
            setViewMode('list');

        } catch (e: any) {
            alert(`Error enviant jugada manual: ${e.message}`);
        }
    };

    const handleEditMove = (e: React.MouseEvent, move: ProcessedMove) => {
        e.stopPropagation(); // Prevent preview when clicking "Edit"
        // Pre-fill manual entry and switch view
        setManualWord(internalToDisplayWord(move.word));
        setManualRow(ROW_LABELS[move.row]);
        setManualCol(COL_LABELS[move.col]);
        setManualDirection(move.direction);
        setManualSelectedPlayers([move.playerId]);
        setIsManualFieldsLocked(false);
        setViewMode('manual');
        setIsMobilePanelOpen(true);
    };

    const handleAssignBestMove = (e: React.MouseEvent, move: ProcessedMove) => {
        e.stopPropagation();
        // Pre-fill manual entry and switch view
        setManualWord(internalToDisplayWord(move.word));
        setManualRow(ROW_LABELS[move.row]);
        setManualCol(COL_LABELS[move.col]);
        setManualDirection(move.direction);
        setManualSelectedPlayers([]); // Start empty so master picks players
        setIsManualFieldsLocked(true);
        setViewMode('manual');
        setIsMobilePanelOpen(true);
    };

    // Helper to switch to manual add mode
    const handleAddNewManual = () => {
        setManualWord('');
        setManualRow('');
        setManualCol('');
        setManualDirection(null);
        setManualSelectedPlayers([]);
        setManualTiles([]);
        setIsManualFieldsLocked(false);
        setViewMode('manual');
        setIsMobilePanelOpen(true);
    }


    // --- Render Preparation (Conditionals moved down to fix Hook error) ---

    if (loading) return <div className="flex h-screen items-center justify-center text-2xl text-gray-400">Carregant...</div>;
    if (error || !gameState) return <div className="flex h-screen items-center justify-center text-red-500">Error</div>;
    
    // --- DETERMINE WHICH BOARD TO DISPLAY ---
    const getHistoryBoard = () => {
        if (!isHistoryView || !historyItem) return gameState.board;
        const snapshot = historyItem.boardSnapshot;
        
        // Case 1: Previewing a candidate/best move/manual (that isn't the applied master move)
        if (previewMove && previewMove.id !== historyItem.masterMove?.id) {
            return snapshot; 
        }
        // Case 2: Previewing Master Move or Default View
        if (historyItem.masterMove) {
            const resultBoard = cloneBoard(snapshot);
            applyMoveToBoard(resultBoard, historyItem.masterMove);
            return resultBoard;
        }
        return snapshot;
    };

    const displayBoard = isHistoryView ? getHistoryBoard() : gameState.board;

    const handlePreview = (move: ProcessedMove) => {
        setPreviewMove(move);
    };

    const handleSelectCandidate = (e: React.MouseEvent, move: ProcessedMove) => {
        e.stopPropagation();
        if (isHistoryView) return;
        if (move.valid) {
            setSelectedCandidateId(move.id);
            setPreviewMove(move);
        }
    };

    const executeApplyRound = async () => {
        let candidate = processedMoves.find(m => m.id === selectedCandidateId);
        if (!candidate) candidate = bestMoves.find(m => m.id === selectedCandidateId);
        
        // Also check if it's a manual move currently being previewed (created ad-hoc)
        if (!candidate && previewMove && previewMove.playerId === 'manual') {
             // Convert manual preview to a real move payload
             candidate = { ...previewMove, id: `manual_${Date.now()}` };
        }

        if (!candidate || !gameId) return;
        setIsApplying(true);
        setShowConfirmModal(false);
        try {
            const masterMovePayload: PlayerMove = {
                id: candidate.id,
                playerId: candidate.playerId,
                playerName: candidate.playerName,
                tableNumber: candidate.tableNumber,
                word: candidate.word,
                tiles: candidate.tiles,
                row: candidate.row,
                col: candidate.col,
                direction: candidate.direction,
                timestamp: candidate.timestamp,
                roundNumber: viewingRound,
                isMasterMove: true
            };

            await finalizeRound(gameId, masterMovePayload);
            setSelectedCandidateId(null);
            setPreviewMove(null);
            setViewMode('list');
            setIsMobilePanelOpen(false);
        } catch (err: any) {
            console.error(err);
            alert(`Error: ${err.message}`);
        } finally {
            setIsApplying(false);
        }
    };

    const handleRefillRack = async () => {
        if (!gameId || isHistoryView) return;
        await refillRack(gameId);
        setIsEditingRack(false);
    };

    const handleRackSubmit = async () => {
        setIsEditingRack(false);
        if (!gameId || isHistoryView) return;
        const tiles = parseInputWord(rackInput);
        await updateRack(gameId, tiles.map(t => t.char));
    };

    const handleClearRack = () => {
        setRackInput('');
        if (gameId && !isHistoryView) {
            updateRack(gameId, []);
        }
    }

    const getPreviewTiles = () => {
        if (!previewMove) return [];
        // Don't show preview tiles if it's the applied master move in history view (already on board)
        //if (isHistoryView && historyItem?.masterMove?.id === previewMove.id) return [];

        return previewMove.tiles.map((t, i) => ({
            tile: t,
            row: previewMove.direction === 'H' ? previewMove.row : previewMove.row + i,
            col: previewMove.direction === 'H' ? previewMove.col + i : previewMove.col
        }));
    };

    const getUsedRackIndices = () => {
        if (!previewMove) return [];
        if (isHistoryView && historyItem?.masterMove?.id === previewMove.id) return [];

        const usedIndices: number[] = [];
        const rack = [...(displayRack || [])];
        const { row, col, direction, tiles } = previewMove;
        const dr = direction === 'H' ? 0 : 1;
        const dc = direction === 'H' ? 1 : 0;
        
        const referenceBoard = (isHistoryView && historyItem && previewMove.id !== historyItem.masterMove?.id) 
            ? historyItem.boardSnapshot 
            : displayBoard;

        // Use standard tiles array access (sanitized by useGame)
        // Note: Sanitization happens in useGame hook, so we rely on it here.
        // However, to prevent potential crashes if data is malformed during render, we can add optional chaining/fallback
        (tiles || []).forEach((tile, i) => {
            const r = row + (i * dr);
            const c = col + (i * dc);
            if (r < 0 || r >= 15 || c < 0 || c >= 15) return;
            const cell = referenceBoard[r][c];
            if (!cell.tile) {
                const charToFind = tile.isBlank ? '?' : tile.char.toUpperCase();
                const idx = rack.findIndex((rChar, rIdx) => {
                    const normRChar = rChar === '?' ? '?' : rChar.toUpperCase();
                    return normRChar === charToFind && !usedIndices.includes(rIdx);
                });
                if (idx !== -1) usedIndices.push(idx);
            }
        });
        return usedIndices;
    };

    const usedRackIndices = getUsedRackIndices();
    
    // For the modal confirmation
    let selectedCandidate = processedMoves.find(m => m.id === selectedCandidateId);
    if (!selectedCandidate) selectedCandidate = bestMoves.find(m => m.id === selectedCandidateId);
    if (!selectedCandidate && previewMove && previewMove.id === selectedCandidateId) selectedCandidate = previewMove; // Allow manual move selection

    //const remainingBagTiles = gameState ? calculateRemainingBag(gameState.board, gameState.currentRack || []).sort() : [];
    const remainingBagTiles = calculateRemainingBag(gameState.board, gameState.currentRack || []).sort();


    const toggleMobilePanel = () => setIsMobilePanelOpen(!isMobilePanelOpen);
    const showInstructionBanner = !isHistoryView && gameState.status === RoundStatus.REVIEW && !selectedCandidateId;

    // Calculate correct count for "Respostes" tab (excluding master move)
    const movesCount = processedMoves.filter(m => !m.isMasterMove).length;

    return (
        // ROOT CONTAINER
        <div className="flex flex-col h-screen bg-gray-100 overflow-hidden">

            {/* --- Header --- */}
            <div className="bg-white border-b shadow-sm z-10 shrink-0 p-2 md:px-4 md:py-2 flex flex-col md:flex-row md:justify-between md:items-center gap-2">

                {/* Row 1 (Mobile): Navigation & Status & Settings */}
                <div className="flex items-center justify-between w-full md:w-auto">
                    <div className="flex items-center gap-2 md:gap-4">
                        <Link to="/" className="text-gray-400 hover:text-indigo-600 p-1">
                            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>
                        </Link>

                        <div className="flex items-center bg-gray-100 rounded-lg p-0.5 md:p-1">
                            <button onClick={handlePrevRound} disabled={viewingRound <= 1} className="p-1 hover:bg-white rounded disabled:opacity-30">◀</button>
                            <div className="px-2 font-bold text-xs md:text-sm whitespace-nowrap">
                                R {viewingRound}
                                {isHistoryView && <span className="ml-1 text-[9px] bg-gray-300 px-1 rounded text-gray-700">HIST</span>}
                            </div>
                            <button onClick={handleNextRound} disabled={viewingRound >= gameState.round} className="p-1 hover:bg-white rounded disabled:opacity-30">▶</button>
                        </div>

                        {!isHistoryView && (
                            <div className={`text-[9px] md:text-[10px] font-black px-2 py-1 rounded border uppercase tracking-wider whitespace-nowrap
                        ${gameState.status === RoundStatus.IDLE ? 'bg-gray-100 text-gray-500' : ''}
                        ${gameState.status === RoundStatus.PLAYING ? 'bg-green-100 text-green-600 animate-pulse' : ''}
                        ${gameState.status === RoundStatus.REVIEW ? 'bg-amber-100 text-amber-600' : ''}
                        ${gameState.status === RoundStatus.COMPLETED ? 'bg-purple-100 text-purple-600' : ''}
                    `}>
                                {gameState.status === RoundStatus.IDLE && 'PREPARACIÓ'}
                                {gameState.status === RoundStatus.PLAYING && 'EN JOC'}
                                {gameState.status === RoundStatus.REVIEW && 'REVISIÓ'}
                                {gameState.status === RoundStatus.COMPLETED && 'FINALITZADA'}
                            </div>
                        )}
                    </div>

                    {/* Settings Icon - Mobile Only */}
                    <Link to={`/settings?gameId=${gameId}`} className="md:hidden text-gray-400 hover:text-gray-600 p-2">
                        <span className="text-xl">⚙</span>
                    </Link>
                </div>

                {/* Row 2 (Mobile): Timer & Actions & Settings (Desktop) */}
                <div className="flex items-center gap-2 w-full md:w-auto">

                    {/* Timer */}
                    <div
                        onClick={handleToggleTimer}
                        onDoubleClick={handleResetTimer}
                        className={`
                            relative flex items-center justify-center h-10 md:h-10 rounded-md border-2 font-mono text-xl font-bold select-none transition-colors shadow-inner cursor-pointer
                            ${timerFinished ? 'bg-red-100 border-red-500 text-red-600' :
                                (gameState.status === RoundStatus.PLAYING && !gameState.timerPausedRemaining) ? 'bg-white border-green-500 text-green-600' : 'bg-gray-50 border-gray-300 text-gray-400'}
                            w-20 md:w-24 shrink-0
                        `}
                    >
                        {formatTime(timeLeft)}
                    </div>

                    {/* Action Buttons */}
                    <div className="flex-1 flex justify-end md:justify-start md:flex-none gap-2">
                        {!isHistoryView && (
                            <>
                                {gameState.status === RoundStatus.IDLE && (
                                    <button
                                        onClick={handleOpenRound}
                                        disabled={bagCount > 0 && currentRackCount < 7}
                                        className="bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white px-4 py-2 rounded shadow font-bold text-sm transition-colors whitespace-nowrap w-full md:w-auto"
                                    >
                                        ▶ OBRE
                                    </button>
                                )}

                                {gameState.status === RoundStatus.COMPLETED && (
                                    <button
                                        onClick={handlePrepareNextRound}
                                        className="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded shadow font-bold text-sm transition-colors whitespace-nowrap flex items-center justify-center gap-2 w-full md:w-auto"
                                    >
                                        <span>↻</span> SEGÜENT
                                    </button>
                                )}

                                {gameState.status === RoundStatus.PLAYING && (
                                    <button onClick={handleCloseRound} className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded shadow font-bold text-sm whitespace-nowrap w-full md:w-auto">
                                        ⏹ TANCA
                                    </button>
                                )}

                                {gameState.status === RoundStatus.REVIEW && (
                                    <>
                                        <button
                                            onClick={handleReopenRound}
                                            className="bg-amber-500 hover:bg-amber-600 text-white px-3 py-2 rounded shadow font-bold text-sm transition-colors whitespace-nowrap flex-1 md:flex-none"
                                        >
                                            REOBRE
                                        </button>
                                        <button
                                            onClick={() => selectedCandidateId && setShowConfirmModal(true)}
                                            disabled={!selectedCandidateId || isApplying}
                                            className={`px-3 py-2 rounded shadow text-sm font-bold flex items-center justify-center gap-2 transition-all whitespace-nowrap flex-1 md:flex-none
                                            ${selectedCandidateId
                                                    ? 'bg-blue-600 hover:bg-blue-700 text-white'
                                                    : 'bg-gray-200 text-gray-400 cursor-not-allowed'}
                                        `}
                                        >
                                            {isApplying ? '...' : selectedCandidateId ? `APLICA` : 'SELECCIONA'}
                                        </button>
                                    </>
                                )}
                            </>
                        )}
                    </div>

                    {/* Settings Icon - Desktop Only */}
                    <Link to={`/settings?gameId=${gameId}`} className="hidden md:block text-gray-400 hover:text-gray-600 p-2">
                        <span className="text-xl">⚙</span>
                    </Link>
                </div>
            </div>

            {/* --- Main Content --- */}
            <div className="flex flex-col lg:flex-row flex-grow overflow-hidden relative">

                {/* Left Column: Board & Rack */}
                <div
                    className="w-full bg-gray-200 p-2 md:p-4 flex flex-col items-center border-r border-gray-300 overflow-y-auto shrink-0 h-full pb-24 lg:pb-4"
                    style={isLargeScreen ? { width: `${100 - rightPanelWidth}%` } : {}}
                >
                    {/* Instruction Banner */}
                    {showInstructionBanner && (
                        <div className="w-full max-w-2xl mb-2 bg-amber-50 border-l-4 border-amber-500 p-3 rounded-r shadow-sm flex items-center justify-between animate-in fade-in slide-in-from-top-2">
                            <div className="flex items-center gap-2">
                                <span className="text-xl">👆</span>
                                <div>
                                    <p className="text-sm font-bold text-amber-800 uppercase">Selecciona una jugada</p>
                                    <p className="text-xs text-amber-700">Fes clic a una jugada de la llista o afegeix-ne una manual per aplicar-la.</p>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Board Container */}
                    <div className="bg-white p-1 md:p-2 rounded-lg shadow-2xl mb-2 md:mb-6 flex justify-center w-full max-w-2xl mx-auto shrink-0">
                        <div className="w-full">
                            <Board board={displayBoard} previewTiles={getPreviewTiles()} />
                        </div>
                    </div>

                    <div className="bg-white p-2 md:p-5 rounded-xl shadow-lg w-full max-w-2xl relative border border-gray-200 mt-auto md:mt-0 shrink-0">
                        <div className="flex justify-between items-end mb-1 md:mb-3">
                            <h3 className="font-bold text-gray-700 text-xs md:text-base uppercase tracking-wide">
                                Faristol ({currentRackCount}/7)
                            </h3>
                            <div className="flex gap-2 items-center">
                                <span className="text-[9px] md:text-xs font-bold text-gray-400 bg-gray-100 px-2 py-1 rounded uppercase">
                                    Diccionari: {dictVersion}
                                </span>
                                <span
                                    onClick={() => setShowBagModal(true)}
                                    className="text-[10px] md:text-xs font-bold text-indigo-600 bg-indigo-50 px-2 py-1 rounded uppercase cursor-pointer hover:bg-indigo-100 border border-indigo-200 transition-colors"
                                >
                                    Sac: {bagCount}
                                </span>
                            </div>
                        </div>
                        <div className="flex gap-1 md:gap-2 justify-center flex-wrap mb-2 md:mb-4 min-h-[3rem] bg-[#f8f4eb] p-2 rounded-lg border-inner shadow-inner">
                            {(displayRack || []).map((c, i) => {
                                const isUsed = usedRackIndices.includes(i);
                                return (
                                    <Tile
                                        key={i}
                                        tile={createTile(c)}
                                        size="md"
                                        className={`
                                    transition-all duration-200
                                    ${isHistoryView ? 'opacity-70' : ''}
                                    ${isUsed ? 'opacity-30 grayscale scale-90' : ''}
                                `}
                                    />
                                );
                            })}
                        </div>
                        
                        {/* SENYOR WARNING */}
                        {senyorStatus && (
                            <div className="mt-1 mb-3 p-2 md:p-3 bg-orange-50 border border-orange-200 text-orange-800 rounded-lg text-xs md:text-sm shadow-sm flex items-start gap-2 animate-in fade-in slide-in-from-top-1">
                                <span className="text-xl">⚠️</span>
                                <div>
                                    <span className="font-black uppercase block mb-0.5">SENYOR DETECTAT (Tot {senyorStatus})</span>
                                    <p className="leading-tight">Es recomana canviar fitxes o esborrar-ne algunes per tenir un millor faristol.</p>
                                </div>
                            </div>
                        )}

                        {!isHistoryView && (
                            <div className="flex items-center gap-2">
                                <div className="relative w-full">
                                    <input
                                        type="text"
                                        value={rackInput}
                                        onChange={(e) => { setRackInput(e.target.value.toUpperCase()); setIsEditingRack(true); }}
                                        onBlur={handleRackSubmit}
                                        onKeyDown={(e) => e.key === 'Enter' && handleRackSubmit()}
                                        disabled={gameState.status !== RoundStatus.IDLE}
                                        placeholder="LLETRES MANUALS..."
                                        className="w-full p-2 md:p-3 pl-4 pr-8 border-2 border-gray-200 rounded-lg font-mono font-bold uppercase tracking-widest focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 outline-none disabled:bg-gray-50 disabled:text-gray-400 text-sm md:text-base transition-colors"
                                    />
                                    {rackInput && gameState.status === RoundStatus.IDLE && (
                                        <button
                                            onClick={handleClearRack}
                                            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-red-500 p-1 rounded-full"
                                        >
                                            ✕
                                        </button>
                                    )}
                                </div>
                                <button
                                    onClick={handleRefillRack}
                                    disabled={gameState.status !== RoundStatus.IDLE || currentRackCount >= 7}
                                    title="Completar 7 fitxes al faristol des del sac"
                                    className="bg-indigo-100 text-indigo-700 p-2 md:p-3 rounded-lg hover:bg-indigo-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-bold text-sm whitespace-nowrap"
                                >
                                    🔄 OMPLE
                                </button>
                            </div>
                        )}
                    </div>
                </div>

                {/* RESIZER HANDLE */}
                <div
                    className="hidden lg:flex w-3 cursor-col-resize bg-gray-300 hover:bg-indigo-400 transition-colors items-center justify-center z-50 border-l border-r border-gray-300/50"
                    onMouseDown={handleMouseDownSplit}
                    title="Arrossega per ajustar l'amplada"
                >
                    <div className="w-1 h-8 bg-gray-400 rounded-full" />
                </div>

                {/* Right Column: Moves, Ranking, Best Moves, Manual */}
                <div
                    className={`
                w-full bg-white flex flex-col border-l border-gray-200 shadow-[0_-4px_20px_rgba(0,0,0,0.1)] 
                fixed bottom-0 left-0 z-40 transition-all duration-300 ease-out
                lg:static lg:h-full lg:shadow-none lg:z-20 lg:translate-y-0 rounded-t-2xl
                ${isMobilePanelOpen ? 'h-[85vh]' : 'h-14'} 
            `}
                    style={isLargeScreen ? { width: `${rightPanelWidth}%` } : {}}
                >
                    {/* Mobile Toggle Handle */}
                    <div
                        className="w-full flex justify-center items-center pt-1 pb-1 cursor-pointer lg:hidden bg-gray-50 border-t border-gray-200 rounded-t-2xl"
                        onClick={toggleMobilePanel}
                    >
                        <div className="w-12 h-1.5 bg-gray-300 rounded-full"></div>
                    </div>

                    <div className="flex border-b shrink-0 bg-gray-100 sticky top-0 z-30 items-center p-1 gap-1 overflow-x-auto scrollbar-hide">
                        <button
                            className={`flex-1 py-2 md:py-3 font-bold text-xs md:text-sm uppercase tracking-wide rounded-t-lg transition-colors whitespace-nowrap ${viewMode === 'list' ? 'bg-white text-indigo-700 shadow-sm border-t-2 border-indigo-500' : 'text-gray-500 hover:bg-gray-100'}`}
                            onClick={() => {
                                setViewMode('list');
                                setIsMobilePanelOpen(true);
                            }}
                        >
                            {isHistoryView ? `Històric` : `Respostes`} <span className="bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded-full text-[10px]">{movesCount}</span>
                        </button>

                        <button
                            className={`flex-1 py-2 md:py-3 font-bold text-xs md:text-sm uppercase tracking-wide rounded-t-lg transition-colors whitespace-nowrap ${viewMode === 'best' ? 'bg-white text-indigo-700 shadow-sm border-t-2 border-indigo-500' : 'text-gray-500 hover:bg-gray-100'}`}
                            onClick={() => {
                                setViewMode('best');
                                setIsMobilePanelOpen(true);
                            }}
                        >
                            🔍 Millors
                        </button>

                         <button
                            className={`flex-1 py-2 md:py-3 font-bold text-xs md:text-sm uppercase tracking-wide rounded-t-lg transition-colors whitespace-nowrap ${viewMode === 'manual' ? 'bg-white text-indigo-700 shadow-sm border-t-2 border-indigo-500' : 'text-gray-500 hover:bg-gray-100'}`}
                            onClick={() => {
                                setViewMode('manual');
                                setIsMobilePanelOpen(true);
                            }}
                        >
                            ✏️ Manual
                        </button>

                        <button
                            className={`flex-1 py-2 md:py-3 font-bold text-xs md:text-sm uppercase tracking-wide rounded-t-lg transition-colors whitespace-nowrap ${viewMode === 'ranking' ? 'bg-white text-indigo-700 shadow-sm border-t-2 border-indigo-500' : 'text-gray-500 hover:bg-gray-100'}`}
                            onClick={() => {
                                setViewMode('ranking');
                                setIsMobilePanelOpen(true);
                            }}
                        >
                            🏆 Clas.
                        </button>
                        
                        {viewMode === 'list' && (
                             <button
                                onClick={handleAddNewManual}
                                className="ml-1 px-2 py-1 bg-indigo-100 hover:bg-indigo-200 text-indigo-700 rounded-md text-xl font-bold shadow-sm transition-all active:scale-95"
                                title="Afegir resposta manualment"
                            >
                                +
                            </button>
                        )}
                    </div>

                    {/* Group Filter Tabs for Ranking */}
                    {viewMode === 'ranking' && uniqueGroups.length > 0 && (
                        <div className="flex border-b border-gray-200 bg-gray-50 overflow-x-auto scrollbar-hide shrink-0">
                            <button
                                className={`px-4 py-2 text-xs font-bold uppercase whitespace-nowrap ${selectedGroup === 'ALL' ? 'text-indigo-700 border-b-2 border-indigo-500' : 'text-gray-500 hover:text-gray-700'}`}
                                onClick={() => setSelectedGroup('ALL')}
                            >
                                Tots
                            </button>
                            {uniqueGroups.map(g => (
                                <button
                                    key={g}
                                    className={`px-4 py-2 text-xs font-bold uppercase whitespace-nowrap ${selectedGroup === g ? 'text-indigo-700 border-b-2 border-indigo-500' : 'text-gray-500 hover:text-gray-700'}`}
                                    onClick={() => setSelectedGroup(g!)}
                                >
                                    Grup {g}
                                </button>
                            ))}
                        </div>
                    )}

                    <div className="flex-grow flex flex-col min-h-0 bg-white h-full">
                        {/* VIEW: LIST (Submitted Moves) */}
                        {viewMode === 'list' && (
                            <div className="flex-grow overflow-y-auto p-0 divide-y divide-gray-100 pb-20 lg:pb-0">
                                {processedMoves.length === 0 && (
                                    <div className="flex flex-col items-center justify-center h-64 text-gray-400 gap-4">
                                        <div className="italic">Cap resposta disponible.</div>
                                        {!isHistoryView && (
                                            <button
                                                onClick={handleAddNewManual}
                                                className="px-4 py-2 bg-white border-2 border-dashed border-gray-300 rounded-lg text-gray-500 hover:border-indigo-400 hover:text-indigo-600 transition-colors font-bold text-sm block"
                                            >
                                                + Afegir Primera Jugada
                                            </button>
                                        )}
                                    </div>
                                )}
                                {processedMoves.map((move) => {
                                    const isSelected = selectedCandidateId === move.id;
                                    const isPreview = previewMove?.id === move.id;
                                    const coordsLabel = getCoordsLabel(move.row, move.col, move.direction);
                                    const participant = move.participant;
                                    const isMaster = move.isMasterMove;

                                    return (
                                        <div
                                            key={move.id}
                                            onClick={() => handlePreview(move)}
                                            className={`
                                            p-2 md:p-3 cursor-pointer transition-all flex gap-2 items-start
                                            ${isMaster ? 'bg-amber-50 border-l-4 border-amber-500' : (isPreview ? 'bg-indigo-50' : 'hover:bg-gray-50')}
                                            ${isSelected ? 'bg-green-50' : ''}
                                        `}
                                        >
                                            {/* Checkbox for selection only in REVIEW and not history */}
                                            {gameState.status === RoundStatus.REVIEW && !isHistoryView && !isMaster && (
                                                <div className="pt-1">
                                                    <div
                                                        onClick={(e) => handleSelectCandidate(e, move)}
                                                        className={`
                                                        w-5 h-5 rounded-full border-2 flex items-center justify-center
                                                        ${isSelected ? 'border-green-500 bg-green-500 text-white' : 'border-gray-300 text-transparent hover:border-green-400'}
                                                        ${!move.valid ? 'opacity-30 cursor-not-allowed' : ''}
                                                    `}
                                                    >
                                                        ✓
                                                    </div>
                                                </div>
                                            )}
                                            
                                            {/* History view indicator for master move */}
                                            {isMaster && (
                                                 <div className="pt-1 text-xl" title="Jugada Mestra">👑</div>
                                            )}

                                            <div className="flex-grow">
                                                {/* Player Info Row */}
                                                <div className="flex items-center gap-2 mb-1 text-xs">
                                                    {isMaster ? (
                                                        <span className="font-black text-amber-700 uppercase tracking-wider">JUGADA MESTRA</span>
                                                    ) : (
                                                        <>
                                                            <span className="font-bold bg-gray-200 text-gray-700 px-2 py-0.5 rounded-full">
                                                                T {move.tableNumber || '?'}
                                                            </span>
                                                            {participant?.group && (
                                                                <span className="font-bold bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded text-[10px]">
                                                                    {participant.group}
                                                                </span>
                                                            )}
                                                            <span className="font-semibold text-gray-600 truncate max-w-[150px]">
                                                                {move.playerName || 'Desconegut'}
                                                            </span>
                                                        </>
                                                    )}
                                                    
                                                    {!move.valid && (
                                                        <span className="text-[10px] text-white bg-red-500 px-1.5 py-0.5 rounded uppercase font-bold ml-auto">
                                                            INVÀLID
                                                        </span>
                                                    )}
                                                    {/* Edit/assign button */}
                                                    {!isMaster && 
                                                    (
                                                        <span
                                                            className="ml-auto text-[10px] text-indigo-600 font-bold hover:underline cursor-pointer px-2 py-0.5 hover:bg-indigo-50 rounded"
                                                            onClick={(e) => handleEditMove(e, move)}
                                                        >
                                                            EDITA/ASSIGNA
                                                        </span>
                                                    )}
                                                     {isMaster && 
                                                    (
                                                        <span
                                                            className="ml-auto text-[10px] text-indigo-600 font-bold hover:underline cursor-pointer px-2 py-0.5 hover:bg-indigo-50 rounded"
                                                            onClick={(e) => handleAssignBestMove(e, move)}
                                                        >
                                                            ASSIGNA
                                                        </span>
                                                    )}
                                                </div>

                                                {/* Word & Score Row */}
                                                <div className="flex items-center justify-between gap-2">
                                                    <div className="flex items-center gap-3">
                                                        <span className="font-mono text-lg md:text-xl font-bold text-slate-400 shrink-0 w-14 text-right leading-none">
                                                            {coordsLabel}
                                                        </span>

                                                        <div className="font-mono text-xl md:text-2xl font-black tracking-widest text-slate-800">
                                                            {/* Safe access to tiles array */}
                                                            {(move.tiles || []).map((t, i) => (
                                                                <span key={i} className={t.isBlank ? 'lowercase text-blue-600' : ''}>{t.displayChar}</span>
                                                            ))}
                                                        </div>
                                                    </div>

                                                    <div className="text-xl md:text-2xl font-black text-indigo-600">
                                                        {move.calculatedScore}
                                                    </div>
                                                </div>

                                                {move.error && (
                                                    <div className="text-[10px] text-red-600 italic text-right mt-1">
                                                        {move.error}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}

                        {/* VIEW: BEST MOVES (Machine) */}
                        {viewMode === 'best' && (
                            <div className="flex-grow overflow-y-auto p-0 divide-y divide-gray-100 pb-20 lg:pb-0">
                                {isFindingMoves ? (
                                    <div className="flex flex-col items-center justify-center h-64 text-indigo-500">
                                        <div className="w-8 h-8 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin mb-2"></div>
                                        <div className="font-bold animate-pulse">Calculant jugades...</div>
                                    </div>
                                ) : bestMoves.length === 0 ? (
                                    <div className="flex flex-col items-center justify-center h-64 text-gray-400 gap-4">
                                        <div className="text-4xl">🤖</div>
                                        <div className="text-center">
                                            <p className="font-bold mb-1">Encara no s'han calculat.</p>
                                            <p className="text-xs">Fes clic per trobar les millors opcions.</p>
                                        </div>
                                        <button
                                            onClick={handleFindBestMoves}
                                            className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-3 rounded-lg font-bold shadow-lg transition-transform active:scale-95"
                                        >
                                            🔍 RECALCULA
                                        </button>
                                    </div>
                                ) : (
                                    <div className="space-y-0">
                                        <div className="flex justify-between items-center p-3 bg-gray-50 border-b border-gray-200 sticky top-0 z-10">
                                            <h3 className="font-black text-gray-700 uppercase text-xs">Top {bestMoves.length} Jugades</h3>
                                            <button onClick={handleFindBestMoves} className="text-xs text-indigo-600 hover:underline font-bold">
                                                ⟳ RECALCULA
                                            </button>
                                        </div>

                                        {bestMoves.map((move, idx) => {
                                            const isSelected = selectedCandidateId === move.id;
                                            const isPreview = previewMove?.id === move.id;
                                            const coordsLabel = getCoordsLabel(move.row, move.col, move.direction);

                                            return (
                                                <div
                                                    key={move.id}
                                                    onClick={() => handlePreview(move)}
                                                    className={`
                                                p-2 md:p-3 cursor-pointer transition-all flex gap-2 items-start
                                                ${isPreview ? 'bg-indigo-50' : 'hover:bg-gray-50'}
                                                ${isSelected ? 'bg-green-50' : ''}
                                            `}
                                                >
                                                    {/* Select Radio Button */}
                                                    {gameState.status === RoundStatus.REVIEW && !isHistoryView && (
                                                        <div className="pt-1">
                                                            <div
                                                                onClick={(e) => handleSelectCandidate(e, move)}
                                                                className={`
                                                            w-5 h-5 rounded-full border-2 flex items-center justify-center
                                                            ${isSelected ? 'border-green-500 bg-green-500 text-white' : 'border-gray-300 text-transparent hover:border-green-400'}
                                                        `}
                                                            >
                                                                ✓
                                                            </div>
                                                        </div>
                                                    )}

                                                    <div className="flex-grow">
                                                        {/* Info Row */}
                                                        <div className="flex items-center gap-2 mb-1 text-xs">
                                                            <span className="font-bold bg-gray-200 text-gray-500 px-2 py-0.5 rounded-full">
                                                                #{idx + 1}
                                                            </span>
                                                            <span className="font-semibold text-gray-400 truncate max-w-[150px]">
                                                                MÀQUINA
                                                            </span>
                                                            <span
                                                                className="ml-auto text-[10px] text-indigo-600 font-bold hover:underline cursor-pointer px-2 py-0.5 hover:bg-indigo-50 rounded"
                                                                onClick={(e) => handleAssignBestMove(e, move)}
                                                            >
                                                                ASSIGNA
                                                            </span>
                                                        </div>

                                                        {/* Word & Score Row */}
                                                        <div className="flex items-center justify-between gap-2">
                                                            <div className="flex items-center gap-3">
                                                                <span className="font-mono text-lg md:text-xl font-bold text-slate-400 shrink-0 w-14 text-right leading-none">
                                                                    {coordsLabel}
                                                                </span>

                                                                <div className="font-mono text-xl md:text-2xl font-black tracking-widest text-slate-800 flex gap-0.5">
                                                                    {move.word.split('').map((char, i) => {
                                                                        const t = createTile(char);
                                                                        return (
                                                                            <span key={i} className={t.isBlank ? 'lowercase text-blue-600' : ''}>{t.displayChar}</span>
                                                                        );
                                                                    })}
                                                                </div>
                                                            </div>

                                                            <div className="text-xl md:text-2xl font-black text-indigo-600">
                                                                {move.calculatedScore}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* VIEW: MANUAL ENTRY FORM */}
                        {viewMode === 'manual' && (
                           <div className="flex-grow flex flex-col min-h-0">
                                <div className="flex-grow overflow-y-auto p-4 space-y-6">
                                    <div className="bg-gray-50 p-4 rounded-xl border border-gray-200 space-y-4">
                                        <div className="flex justify-between items-center border-b border-gray-200 pb-2">
                                            <h3 className="font-bold text-gray-700 uppercase tracking-wide text-sm">
                                                {isHistoryView ? `Editar (Ronda ${viewingRound})` : 'Introduir Jugada'}
                                            </h3>
                                            {isManualFieldsLocked && (
                                                <span className="text-[10px] font-bold bg-amber-100 text-amber-700 px-2 py-1 rounded uppercase border border-amber-200">
                                                    Bloquejat (Màquina)
                                                </span>
                                            )}
                                        </div>
                                        
                                        {/* Word Input */}
                                        <div>
                                            <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1 ml-1">Paraula</label>
                                            <input
                                                type="text"
                                                value={manualWord}
                                                onChange={(e) => setManualWord(e.target.value.toUpperCase())}
                                                className={`w-full p-3 border-2 border-gray-200 rounded-xl text-2xl font-mono font-bold tracking-widest uppercase text-center outline-none ${isManualFieldsLocked ? 'bg-gray-100 text-gray-500 cursor-not-allowed' : 'bg-white focus:ring-4 focus:ring-blue-100 focus:border-blue-500'}`}
                                                placeholder="LLIBRE"
                                                autoComplete="off"
                                                disabled={isManualFieldsLocked}
                                            />
                                        </div>

                                        {/* Tile Preview & Toggle Blank */}
                                        {manualTiles.length > 0 && (
                                            <div className={`p-2 rounded-xl border border-gray-200 ${isManualFieldsLocked ? 'bg-gray-100' : 'bg-white'}`}>
                                                <div className="text-[9px] text-gray-400 mb-1 text-center uppercase tracking-wider font-bold">
                                                    {isManualFieldsLocked ? 'Fitxes fixes' : 'Clica per marcar Escarràs'}
                                                </div>
                                                <div className="flex flex-nowrap gap-[2px] justify-center w-full py-1 px-1 overflow-x-auto">
                                                    {manualTiles.map((t, i) => (
                                                        <Tile
                                                            key={i}
                                                            tile={t}
                                                            size="md"
                                                            onClick={() => handleManualTileClick(i)}
                                                            className={`shadow-sm flex-1 min-w-0 aspect-square !w-auto !h-auto max-w-[2.5rem] ${isManualFieldsLocked ? 'cursor-default' : 'cursor-pointer'}`}
                                                        />
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        {/* Coordinates */}
                                        <div className="grid grid-cols-2 gap-3">
                                            <div className={`p-2 rounded-lg border border-gray-200 ${isManualFieldsLocked ? 'bg-gray-100' : 'bg-white'}`}>
                                                <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1 text-center">Fila</label>
                                                <select
                                                    value={manualRow}
                                                    onChange={(e) => setManualRow(e.target.value)}
                                                    className={`w-full p-2 border-0 rounded-md text-xl font-bold text-center shadow-sm focus:ring-0 ${!manualRow || isManualFieldsLocked ? 'text-gray-400' : 'text-black'} ${isManualFieldsLocked ? 'bg-transparent cursor-not-allowed' : ''}`}
                                                    disabled={isManualFieldsLocked}
                                                >
                                                    <option value="" disabled>-</option>
                                                    {ROW_LABELS.map(l => <option key={l} value={l}>{l}</option>)}
                                                </select>
                                            </div>
                                            <div className={`p-2 rounded-lg border border-gray-200 ${isManualFieldsLocked ? 'bg-gray-100' : 'bg-white'}`}>
                                                <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1 text-center">Columna</label>
                                                <select
                                                    value={manualCol}
                                                    onChange={(e) => setManualCol(e.target.value)}
                                                    className={`w-full p-2 border-0 rounded-md text-xl font-bold text-center shadow-sm focus:ring-0 ${!manualCol || isManualFieldsLocked ? 'text-gray-400' : 'text-black'} ${isManualFieldsLocked ? 'bg-transparent cursor-not-allowed' : ''}`}
                                                    disabled={isManualFieldsLocked}
                                                >
                                                    <option value="" disabled>-</option>
                                                    {COL_LABELS.map(l => <option key={l} value={l}>{l}</option>)}
                                                </select>
                                            </div>
                                        </div>

                                        {/* Direction */}
                                        <div className={`flex p-1 rounded-lg shadow-inner select-none border border-gray-200 ${isManualFieldsLocked ? 'bg-gray-100' : 'bg-white'}`}>
                                            <button 
                                            onClick={() => setManualDirection('H')} 
                                            disabled={isManualFieldsLocked}
                                            className={`flex-1 py-2 rounded-md text-sm font-bold transition-all ${manualDirection === 'H' ? 'bg-indigo-100 text-indigo-700 shadow-sm ring-1 ring-black/5' : (isManualFieldsLocked ? 'text-gray-400' : 'text-gray-500 hover:text-gray-700')}`}
                                            >
                                            HORITZONTAL →
                                            </button>
                                            <button 
                                            onClick={() => setManualDirection('V')} 
                                            disabled={isManualFieldsLocked}
                                            className={`flex-1 py-2 rounded-md text-sm font-bold transition-all ${manualDirection === 'V' ? 'bg-indigo-100 text-indigo-700 shadow-sm ring-1 ring-black/5' : (isManualFieldsLocked ? 'text-gray-400' : 'text-gray-500 hover:text-gray-700')}`}
                                            >
                                            VERTICAL ↓
                                            </button>
                                        </div>
                                        {/* Validation Preview Logic */}
                                        {previewMove && previewMove.playerId === 'manual' && (
                                            <div className={`text-center p-2 rounded-lg text-sm font-bold border-2 ${previewMove.valid ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
                                                {previewMove.valid 
                                                    ? `✅ VÀLIDA: ${previewMove.calculatedScore} pts` 
                                                    : `❌ INVÀLIDA: ${previewMove.error || 'Error desconegut'}`}
                                            </div>
                                        )}
                                    </div>

                                    {/* Player Selection */}
                                    <div className="bg-gray-50 p-4 rounded-xl border border-gray-200">
                                        <div className="flex justify-between items-center border-b border-gray-200 pb-2 mb-3">
                                            <h4 className="text-xs font-bold text-gray-500 uppercase">Assignar a ({manualSelectedPlayers.length})</h4>
                                            <div className="flex gap-2">
                                                <span className="text-[10px] font-bold text-green-600 bg-green-100 px-1.5 rounded">VERD: Ja té jugada</span>
                                                {manualSelectedPlayers.length > 0 && (
                                                    <button onClick={() => setManualSelectedPlayers([])} className="text-xs text-red-500 hover:underline">Desmarca'ls tots</button>
                                                )}
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3 gap-2 max-h-60 overflow-y-auto p-1">
                                            {sortedParticipantsForManual.map((p) => {
                                                const isSelected = manualSelectedPlayers.includes(p.id);
                                                const hasSubmitted = processedMoves.some(m => m.playerId === p.id && !m.isMasterMove);

                                                return (
                                                    <div
                                                        key={p.id}
                                                        onClick={() => toggleManualPlayer(p.id)}
                                                        className={`
                                                    cursor-pointer p-2 rounded-lg border text-xs flex items-center gap-2 transition-all select-none
                                                    ${isSelected ? 'bg-indigo-600 text-white border-indigo-600 shadow-md ring-2 ring-indigo-200' : 'hover:bg-white bg-gray-50'}
                                                    ${hasSubmitted && !isSelected ? 'bg-green-50 border-green-300 text-green-800' : ''}
                                                    ${!hasSubmitted && !isSelected ? 'border-gray-200 text-gray-500' : ''}
                                                `}
                                                    >
                                                        <div className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] shrink-0 font-bold
                                                            ${isSelected ? 'bg-white text-indigo-600' : (hasSubmitted ? 'bg-green-500 text-white' : 'bg-gray-200 text-gray-400')}
                                                        `}>
                                                            {isSelected ? '✓' : (hasSubmitted ? '✓' : '')}
                                                        </div>
                                                        <div className="overflow-hidden truncate flex flex-col leading-tight">
                                                            <span className={`font-bold ${isSelected ? 'text-white' : (hasSubmitted ? 'text-green-900' : 'text-gray-800')}`}>#{p.tableNumber}</span>
                                                            <span className={`truncate ${isSelected ? 'text-indigo-100' : (hasSubmitted ? 'text-green-700' : 'text-gray-400')}`}>{p.name}</span>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                </div>
                                
                                {/* Sticky Footer Action Buttons */}
                                <div className="shrink-0 p-4 bg-white border-t border-gray-200 z-10 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1)]">
                                    <div className="flex gap-3">
                                      
                                        <button
                                            onClick={submitManualEntry}
                                            disabled={!manualWord || manualSelectedPlayers.length === 0 || !manualDirection || !manualRow || !manualCol}
                                            className="flex-[2] py-3 bg-indigo-600 text-white font-black rounded-xl hover:bg-indigo-700 shadow-lg disabled:opacity-50 disabled:cursor-not-allowed transform active:scale-95 transition-all"
                                        >
                                            {isHistoryView ? 'MODIFICA JUGADA' : `AFEGEIX (${manualSelectedPlayers.length})`}
                                        </button>
                                    </div>
                                </div>
                           </div>
                        )}

                        {/* VIEW: RANKING */}
                        {viewMode === 'ranking' && (
                            <div className="flex-grow overflow-x-auto overflow-y-auto">
                                <table className="w-full text-left mb-20 lg:mb-0 text-xs md:text-sm">
                                    <thead className="bg-gray-50 text-gray-500 uppercase sticky top-0 z-10 shadow-sm">
                                        <tr>
                                            <th className="p-2 md:p-3 font-bold cursor-pointer hover:bg-gray-100 whitespace-nowrap" onClick={() => handleSort('tableNumber')}>
                                                T {sortConfig.key === 'tableNumber' && (sortConfig.direction === 'asc' ? '▲' : '▼')}
                                            </th>
                                            <th className="p-2 md:p-3 font-bold cursor-pointer hover:bg-gray-100" onClick={() => handleSort('name')}>
                                                Nom {sortConfig.key === 'name' && (sortConfig.direction === 'asc' ? '▲' : '▼')}
                                            </th>
                                            {displayRoundsArray.map(r => (
                                                <th key={r} className="p-2 md:p-3 text-center font-normal text-gray-400">
                                                    R{r}
                                                </th>
                                            ))}
                                            <th className="p-2 md:p-3 text-right font-bold cursor-pointer hover:bg-gray-100 whitespace-nowrap" onClick={() => handleSort('totalScore')}>
                                                Total {sortConfig.key === 'totalScore' && (sortConfig.direction === 'asc' ? '▲' : '▼')}
                                            </th>
                                            <th className="p-2 md:p-3 text-right font-bold cursor-pointer hover:bg-gray-100 whitespace-nowrap" onClick={() => handleSort('percentage')}>
                                                % {sortConfig.key === 'percentage' && (sortConfig.direction === 'asc' ? '▲' : '▼')}
                                            </th>
                                            <th className="p-2 md:p-3 text-center font-bold cursor-pointer hover:bg-gray-100 whitespace-nowrap" onClick={() => handleSort('masterMoves')}>
                                                ★ {sortConfig.key === 'masterMoves' && (sortConfig.direction === 'asc' ? '▲' : '▼')}
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100">
                                        {sortedRanking.map((participant) => {
                                            const percentage = currentViewMaxScore > 0 ? ((participant.viewTotalScore / currentViewMaxScore) * 100).toFixed(1) : '0.0';
                                            const isBot = participant.id === 'bot_master';

                                            return (
                                                <tr key={participant.id} className={`transition-colors ${isBot ? 'bg-slate-200 font-black border-b-2 border-slate-400' : 'hover:bg-gray-50'}`}>
                                                    <td className={`p-2 md:p-3 font-mono ${isBot ? 'text-slate-700' : 'font-bold text-gray-500'}`}>
                                                        {isBot ? '---' : `#${participant.tableNumber}`}
                                                    </td>
                                                    <td className="p-2 md:p-3 font-bold text-slate-700 whitespace-nowrap">
                                                        {participant.name}
                                                        {/* Show group badge only in ALL view */}
                                                        {selectedGroup === 'ALL' &&
                                                            participant.group && (<span className="ml-2 text-[10px] bg-indigo-100 text-indigo-600 px-1.5 py-0.5 rounded-full">{participant.group}</span>)}
                                                    </td>
                                                    {displayRoundsArray.map(r => {
                                                        const score = participant.roundScores?.[r] || 0;
                                                        const isMax = score > 0 && score === roundMaxScores[r];
                                                        return (
                                                            <td key={r} className={`p-2 md:p-3 text-center ${isBot ? 'text-slate-900' : (isMax ? 'font-black text-green-600 bg-green-50' : 'text-gray-500')}`}>
                                                                {score}
                                                            </td>
                                                        );
                                                    })}
                                                    <td className={`p-2 md:p-3 text-right font-mono ${isBot ? 'text-slate-900 text-lg' : 'font-black text-indigo-600 bg-indigo-50/50'}`}>{participant.viewTotalScore}</td>
                                                    <td className="p-2 md:p-3 text-right font-mono text-gray-500 text-[10px] md:text-xs">
                                                        {isBot ? '' : `${percentage}%`}
                                                    </td>
                                                    <td className="p-2 md:p-3 text-center font-bold text-amber-500">
                                                        {isBot ? '' : (participant.masterMovesCount || 0)}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                        {sortedRanking.length === 0 && (
                                            <tr><td colSpan={displayRoundsArray.length + 5} className="p-8 text-center text-gray-400 italic">No hi ha dades encara.</td></tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* --- CONFIRMATION MODAL --- */}
            {showConfirmModal && (
                <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-xl shadow-2xl p-6 max-w-sm w-full">
                        <h3 className="text-lg font-bold mb-2 text-gray-800">Confirmar Jugada Mestra</h3>
                        <div className="bg-gray-50 p-3 rounded border mb-4">
                            <div className="text-2xl font-black text-center mb-1 text-indigo-700 break-words">{internalToDisplayWord(selectedCandidate?.word)}</div>
                            <div className="flex justify-between text-sm text-gray-600">
                                <span>Punts: <strong>{selectedCandidate?.calculatedScore}</strong></span>
                                <span>Taula: <strong>{selectedCandidate?.tableNumber}</strong></span>
                            </div>
                        </div>
                        <div className="flex gap-3">
                            <button onClick={() => setShowConfirmModal(false)} className="flex-1 py-3 font-bold text-gray-600 bg-gray-100 hover:bg-gray-200 rounded">Cancel·la</button>
                            <button onClick={executeApplyRound} className="flex-1 py-3 font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded shadow">Confirma</button>
                        </div>
                    </div>
                </div>
            )}

            {/* --- MANUAL OVERRIDE MODAL --- */}
            {overrideModal && (
                <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in zoom-in duration-200">
                    <div className="bg-white rounded-xl shadow-2xl p-6 max-w-sm w-full space-y-4">
                        <div className="flex items-center gap-3 text-amber-600">
                            <span className="text-3xl">⚠️</span>
                            <h3 className="text-xl font-black text-gray-800">Jugada ja existent</h3>
                        </div>
                        
                        <p className="text-gray-600 text-sm leading-relaxed">
                            El jugador <span className="font-bold text-gray-900">{overrideModal.name}</span> ja té una jugada assignada:
                        </p>
                        
                        <div className="bg-amber-50 p-3 rounded-lg border border-amber-200 text-center">
                            <div className="text-xl font-black text-amber-800">{overrideModal.word}</div>
                            <div className="text-sm font-bold text-amber-600">{overrideModal.score} punts</div>
                        </div>

                        <p className="text-gray-600 text-sm font-medium">
                            Vols substituir-la per la nova jugada?
                        </p>

                        <div className="flex gap-3 pt-2">
                            <button 
                                onClick={() => setOverrideModal(null)} 
                                className="flex-1 py-3 rounded-lg font-bold text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors text-sm"
                            >
                                NO, MANTENIR
                            </button>
                            <button 
                                onClick={handleConfirmOverride} 
                                className="flex-1 py-3 rounded-lg font-bold text-white bg-amber-500 hover:bg-amber-600 shadow-md transition-colors text-sm"
                            >
                                SÍ, SUBSTITUIR
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* --- BAG MODAL --- */}
            {showBagModal && (
                <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl flex flex-col max-h-[90vh] overflow-hidden">
                        <div className="bg-indigo-50 p-4 flex justify-between items-center border-b border-indigo-100 shrink-0">
                            <h3 className="text-lg font-black text-indigo-800 uppercase tracking-wide flex items-center gap-2">
                                <span>💰</span> Fitxes del Sac ({remainingBagTiles.length} restants)
                            </h3>
                            <button onClick={() => setShowBagModal(false)} className="text-gray-400 hover:text-gray-700 font-bold p-1 rounded-full hover:bg-gray-200/50 transition-colors">
                                ✕
                            </button>
                        </div>
                        <div className="p-6 overflow-y-auto bg-white">
                            <div className="flex flex-wrap gap-2 justify-center content-start">
                                {Object.keys(TILE_COUNTS).sort((a, b) => {
                                    if (a === '?' && b !== '?') return 1;
                                    if (b === '?' && a !== '?') return -1;
                                    return createTile(a).displayChar.localeCompare(createTile(b).displayChar, 'ca');
                                }).map(char => {
                                    const total = TILE_COUNTS[char];
                                    const remainingCount = remainingBagTiles.filter(c => c === char).length;
                                    const usedCount = total - remainingCount;

                                    // Render all tiles for this char: first the remaining ones, then the used ones
                                    return (
                                        <div key={char} className="flex gap-1 p-1 bg-slate-50 rounded-lg border border-slate-100 m-1 shadow-sm">
                                            {/* Remaining tiles (Normal) */}
                                            {Array.from({ length: remainingCount }).map((_, i) => (
                                                <Tile key={`rem-${char}-${i}`} tile={createTile(char)} size="sm" />
                                            ))}

                                            {/* Used tiles (Dimmed & Crossed out) */}
                                            {Array.from({ length: usedCount }).map((_, i) => (
                                                <div key={`used-${char}-${i}`} className="relative opacity-30 grayscale contrast-50">
                                                    <Tile tile={createTile(char)} size="sm" className="!border-gray-300 !bg-gray-200" />
                                                    {/* Diagonal Line overlay */}
                                                    <div className="absolute inset-0 overflow-hidden pointer-events-none">
                                                        <div className="absolute top-1/2 left-[-20%] w-[140%] h-[2px] bg-red-400/60 -rotate-45 transform origin-center"></div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                        <div className="p-4 bg-gray-50 border-t border-gray-100 text-center shrink-0">
                            <button onClick={() => setShowBagModal(false)} className="text-indigo-600 font-bold text-sm hover:underline uppercase tracking-wider">
                                Tanca
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default MasterView;
