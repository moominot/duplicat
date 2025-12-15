import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useGame } from '../hooks/useGame';
import { RoundStatus, Tile as TileType, Participant } from '../types';
import Board from '../components/Board';
import Tile from '../components/Tile';
import { ROW_LABELS, COL_LABELS } from '../constants';
import { parseInputWord, getTileIndices, createTile } from '../utils/scrabbleUtils';
import { submitMove, registerParticipant } from '../services/gameService';
import { Shuffle, RotateCcw, Send, X, Keyboard, LogOut } from 'lucide-react';

const OnlinePlayerView: React.FC = () => {
    const [searchParams] = useSearchParams();
    const gameId = searchParams.get('gameId');
    const navigate = useNavigate();
    const { gameState, loading } = useGame(gameId);

    // --- LOGIN STATE ---
    const [storedName, setStoredName] = useState(localStorage.getItem('scrabble_player_name') || '');
    const [storedTable, setStoredTable] = useState(localStorage.getItem('scrabble_table_num') || '');
    const [inputName, setInputName] = useState(storedName);
    const [inputTable, setInputTable] = useState(storedTable);
    const [isLoggedIn, setIsLoggedIn] = useState(!!storedName && !!storedTable);

    // --- FORM STATE ---
    const [word, setWord] = useState('');
    const [col, setCol] = useState('');
    const [row, setRow] = useState('');
    const [direction, setDirection] = useState<'H' | 'V' | null>(null);
    const [submitted, setSubmitted] = useState(false);
    const [tilesPreview, setTilesPreview] = useState<TileType[]>([]);
    const [showConfirmModal, setShowConfirmModal] = useState(false);
    const [currentRound, setCurrentRound] = useState(1);

    // --- TIMER STATE ---
    const [timeLeft, setTimeLeft] = useState(0);

    // --- DRAG & DROP STATE ---
    const [localRack, setLocalRack] = useState<TileType[]>([]);
    const [placedTiles, setPlacedTiles] = useState<{ tile: TileType, row: number, col: number, rackIndex: number }[]>([]);
    const [isDragging, setIsDragging] = useState(false);
    const [draggedTile, setDraggedTile] = useState<{ tile: TileType, source: 'rack' | 'board', index: number } | null>(null);
    const [dragPosition, setDragPosition] = useState({ x: 0, y: 0 });
    const [lastInputSource, setLastInputSource] = useState<'form' | 'dnd'>('form');
    const [rackInitialized, setRackInitialized] = useState(false);
    
    const boardRef = useRef<HTMLDivElement>(null);
    const rackRef = useRef<HTMLDivElement>(null);

    // --- LAYOUT STATE ---
    const [isMobilePanelOpen, setIsMobilePanelOpen] = useState(false); 
    const [activeTab, setActiveTab] = useState<'form' | 'ranking' | 'history'>('form');
    
    // Missing layout states
    const [isLargeScreen, setIsLargeScreen] = useState(window.innerWidth >= 1024);
    const [rightPanelWidth, setRightPanelWidth] = useState(35); // Default 35% width for desktop panel
    const [isDraggingSplit, setIsDraggingSplit] = useState(false);

    const toggleMobilePanel = () => setIsMobilePanelOpen(!isMobilePanelOpen);

    // --- DERIVED STATE ---
    const isPlaying = gameState?.status === RoundStatus.PLAYING;
    const lastMove = gameState?.lastPlayedMove;
    const showMasterMove = gameState?.status === RoundStatus.IDLE && !!lastMove;

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

    // Sync round state & Rack
    useEffect(() => {
        if (gameState) {
            if (gameState.round > currentRound) {
                setCurrentRound(gameState.round);
                setWord('');
                setRow('');
                setCol('');
                setDirection(null);
                setSubmitted(false);
                setShowConfirmModal(false);
                setPlacedTiles([]);
                setRackInitialized(false); // Allow new rack load
                // Reset rack from game state
                if (gameState.currentRack) {
                    setLocalRack(gameState.currentRack.map(c => createTile(c)));
                    setRackInitialized(true);
                }
            } else if (gameState.round < currentRound) {
                setCurrentRound(gameState.round);
            }
            
            // Initial Rack Load
            if (!rackInitialized && gameState.currentRack && gameState.currentRack.length > 0) {
                setLocalRack(gameState.currentRack.map(c => createTile(c)));
                setRackInitialized(true);
            }
        }
    }, [gameState, currentRound, rackInitialized]);

    // Timer Logic
    useEffect(() => {
        if (!gameState) return;
        const updateTimer = () => {
            if (gameState.status === RoundStatus.PLAYING) {
                if (gameState.timerPausedRemaining) {
                    setTimeLeft(Math.ceil(gameState.timerPausedRemaining / 1000));
                } else if (gameState.timerEndTime) {
                    const now = Date.now();
                    const remaining = Math.max(0, Math.ceil((gameState.timerEndTime - now) / 1000));
                    setTimeLeft(remaining);
                }
            } else {
                setTimeLeft(gameState.config.timerDurationSeconds);
            }
        };
        updateTimer();
        const interval = setInterval(updateTimer, 200);
        return () => clearInterval(interval);
    }, [gameState?.status, gameState?.timerEndTime, gameState?.timerPausedRemaining]);

    // Auto-switch tabs
    useEffect(() => {
        if (gameState?.status === RoundStatus.PLAYING) {
            setActiveTab('form');
        } else {
            setActiveTab('ranking');
            setIsMobilePanelOpen(true); // Auto open ranking when round ends
        }
    }, [gameState?.status]);

    // Word parsing sync
    useEffect(() => {
        if (!word) {
            setTilesPreview([]);
            return;
        }
        const parsed = parseInputWord(word);
        setTilesPreview(parsed);
    }, [word]);

    // --- SYNC FORM -> BOARD (AND RACK) ---
    useEffect(() => {
        if (isDragging || lastInputSource === 'dnd') return;

        // 1. Construct Target Placements from Form
        if (!word || !row || !col || !direction) {
            if (placedTiles.length > 0 && !word) {
                 // If word is cleared, return tiles to rack
                 const returned = placedTiles.map(p => p.tile);
                 setLocalRack(prev => [...prev, ...returned]);
                 setPlacedTiles([]);
            }
            return;
        }

        const rIndex = ROW_LABELS.indexOf(row);
        const cIndex = COL_LABELS.indexOf(col);
        if (rIndex === -1 || cIndex === -1) return;

        const targetTiles = parseInputWord(word);
        const targetPlacements = targetTiles.map((t, i) => ({
            char: t.char,
            isBlank: t.isBlank,
            row: direction === 'H' ? rIndex : rIndex + i,
            col: direction === 'H' ? cIndex + i : cIndex
        }));

        // 2. Compare with current placedTiles (Sorted)
        const sortedPlaced = [...placedTiles].sort((a, b) => {
             if (a.row === b.row) return a.col - b.col;
             return a.row - b.row;
        });

        const isMatch = sortedPlaced.length === targetPlacements.length && sortedPlaced.every((pt, i) => {
            const tp = targetPlacements[i];
            return pt.row === tp.row && pt.col === tp.col && pt.tile.char === tp.char;
        });

        if (isMatch) return;

        // 3. Reconcile
        let pool = [...localRack, ...placedTiles.map(p => p.tile)];
        const newPlaced: { tile: TileType, row: number, col: number, rackIndex: number }[] = [];
        
        for (const tp of targetPlacements) {
            let foundIndex = -1;
            if (tp.isBlank) {
                foundIndex = pool.findIndex(p => p.isBlank);
            } else {
                foundIndex = pool.findIndex(p => p.char === tp.char && !p.isBlank);
            }
            
            if (foundIndex === -1 && !tp.isBlank) {
                 foundIndex = pool.findIndex(p => p.isBlank);
            }

            if (foundIndex !== -1) {
                const tile = pool[foundIndex];
                const tileToPlace = { ...tile };
                if (tile.isBlank) {
                    tileToPlace.char = tp.char; 
                }
                newPlaced.push({
                    tile: tileToPlace,
                    row: tp.row,
                    col: tp.col,
                    rackIndex: -1
                });
                pool.splice(foundIndex, 1);
            } else {
                newPlaced.push({
                    tile: { ...createTile(tp.char), isBlank: tp.isBlank },
                    row: tp.row,
                    col: tp.col,
                    rackIndex: -1
                });
            }
        }

        setPlacedTiles(newPlaced);
        setLocalRack(pool);

    }, [word, row, col, direction, isDragging, placedTiles, localRack]);

    // --- DRAG HANDLERS ---

    const handleTouchStart = (e: React.TouchEvent | React.MouseEvent, tile: TileType, source: 'rack' | 'board', index: number) => {
        if (!isPlaying || submitted) return;
        // e.preventDefault(); // Prevent scrolling while dragging? Maybe only if vertical movement
        
        const clientX = 'touches' in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
        const clientY = 'touches' in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY;

        setIsDragging(true);
        setDraggedTile({ tile, source, index });
        setDragPosition({ x: clientX, y: clientY });
        setLastInputSource('dnd');
    };

    const handleTouchMove = (e: React.TouchEvent | React.MouseEvent) => {
        if (!isDragging) return;
        // e.preventDefault(); // Important to prevent scroll
        
        const clientX = 'touches' in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
        const clientY = 'touches' in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY;
        
        setDragPosition({ x: clientX, y: clientY });
    };

    const handleTouchEnd = (e: React.TouchEvent | React.MouseEvent) => {
        if (!isDragging || !draggedTile) return;
        setIsDragging(false);

        const clientX = 'changedTouches' in e ? e.changedTouches[0].clientX : (e as React.MouseEvent).clientX;
        const clientY = 'changedTouches' in e ? e.changedTouches[0].clientY : (e as React.MouseEvent).clientY;

        // Check if dropped on Board
        if (boardRef.current) {
            const rect = boardRef.current.getBoundingClientRect();
            if (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) {
                // Dropped on Board
                // The board has 16x16 grid (1 header row/col + 15 game rows/cols)
                const x = clientX - rect.left;
                const y = clientY - rect.top;
                const cellSize = rect.width / 16; // 16 columns total
                
                // Subtract 1 because index 0 is the header
                const colIdx = Math.floor(x / cellSize) - 1;
                const rowIdx = Math.floor(y / cellSize) - 1;

                if (colIdx >= 0 && colIdx < 15 && rowIdx >= 0 && rowIdx < 15) {
                    handleDropOnBoard(draggedTile, rowIdx, colIdx);
                } else {
                    // Dropped on header or outside valid area
                    handleReturnToRack(draggedTile);
                }
                setDraggedTile(null);
                return;
            }
        }

        // Check if dropped on Rack
        if (rackRef.current) {
            const rect = rackRef.current.getBoundingClientRect();
            if (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) {
                // Dropped on Rack - Calculate index
                const x = clientX - rect.left;
                const totalTiles = localRack.length + (draggedTile.source === 'board' ? 1 : 0);
                // Estimate width per tile (approximate)
                const tileWidth = rect.width / (totalTiles || 1);
                const dropIndex = Math.min(Math.floor(x / tileWidth), localRack.length);
                
                handleDropOnRack(draggedTile, dropIndex);
                setDraggedTile(null);
                return;
            }
        }

        // Default return to rack (append)
        handleReturnToRack(draggedTile);
        setDraggedTile(null);
    };

    const handleBoardTileTouchStart = (e: React.TouchEvent | React.MouseEvent, tile: TileType, row: number, col: number) => {
        // Find index in placedTiles
        const index = placedTiles.findIndex(p => p.row === row && p.col === col);
        if (index !== -1) {
            handleTouchStart(e, tile, 'board', index);
        }
    };

    const handleDropOnBoard = (dragItem: { tile: TileType, source: 'rack' | 'board', index: number }, r: number, c: number) => {
        setLastInputSource('dnd');
        // Remove from source
        if (dragItem.source === 'rack') {
            const newRack = [...localRack];
            newRack.splice(dragItem.index, 1); // Remove from rack
            setLocalRack(newRack);
            
            // Add to board
            const newPlaced = [...placedTiles, { tile: dragItem.tile, row: r, col: c, rackIndex: -1 }]; // rackIndex lost once on board
            setPlacedTiles(newPlaced);
            updateFormFromPlacements(newPlaced);
        } else {
            // Move on board
            const newPlaced = [...placedTiles];
            newPlaced[dragItem.index] = { ...newPlaced[dragItem.index], row: r, col: c };
            setPlacedTiles(newPlaced);
            updateFormFromPlacements(newPlaced);
        }
    };

    const handleDropOnRack = (dragItem: { tile: TileType, source: 'rack' | 'board', index: number }, dropIndex: number) => {
        setLastInputSource('dnd');
        if (dragItem.source === 'rack') {
            // Reorder within rack
            const newRack = [...localRack];
            const [removed] = newRack.splice(dragItem.index, 1);
            // Adjust dropIndex if we removed an item before it
            const adjustedIndex = (dragItem.index < dropIndex) ? dropIndex - 1 : dropIndex;
            newRack.splice(adjustedIndex, 0, removed);
            setLocalRack(newRack);
        } else {
            // From board to rack at specific index
            const newPlaced = [...placedTiles];
            newPlaced.splice(dragItem.index, 1);
            setPlacedTiles(newPlaced);
            updateFormFromPlacements(newPlaced);

            const newRack = [...localRack];
            newRack.splice(dropIndex, 0, dragItem.tile);
            setLocalRack(newRack);
        }
    };

    const handleReturnToRack = (dragItem: { tile: TileType, source: 'rack' | 'board', index: number }) => {
        setLastInputSource('dnd');
        if (dragItem.source === 'board') {
            // Remove from board
            const newPlaced = [...placedTiles];
            newPlaced.splice(dragItem.index, 1);
            setPlacedTiles(newPlaced);
            updateFormFromPlacements(newPlaced);

            // Add back to rack (append)
            setLocalRack([...localRack, dragItem.tile]);
        }
        // If source was rack, it just stays in rack (reordering logic could go here)
    };

    const updateFormFromPlacements = (placements: { tile: TileType, row: number, col: number }[]) => {
        if (placements.length === 0) {
            setWord('');
            return;
        }

        // Sort by position
        // Determine orientation
        // This is a simple heuristic: if multiple tiles, check if they are mostly horizontal or vertical
        // If 1 tile, keep existing direction or default H
        
        const sorted = [...placements].sort((a, b) => {
            if (a.row === b.row) return a.col - b.col;
            return a.row - b.row;
        });

        const first = sorted[0];
        setRow(ROW_LABELS[first.row]);
        setCol(COL_LABELS[first.col]);

        // Guess direction
        if (sorted.length > 1) {
            const isH = sorted.every(p => p.row === first.row);
            const isV = sorted.every(p => p.col === first.col);
            if (isH) setDirection('H');
            else if (isV) setDirection('V');
            else setDirection('H'); // Ambiguous
        } else {
            if (!direction) setDirection('H');
        }

        // Construct word (Simple concatenation of placed tiles)
        // Note: This ignores existing board tiles, user might need to edit
        const newWord = sorted.map(p => p.tile.char).join('');
        setWord(newWord);
    };

    // --- HANDLERS ---

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        if (inputName.trim() && inputTable.trim()) {
            localStorage.setItem('scrabble_player_name', inputName.trim());
            localStorage.setItem('scrabble_table_num', inputTable.trim());
            setStoredName(inputName.trim());
            setStoredTable(inputTable.trim());
            setIsLoggedIn(true);
            
            if (gameId) {
                try {
                    await registerParticipant(gameId, {
                        id: `table_${inputTable.trim()}`,
                        name: inputName.trim(),
                        tableNumber: inputTable.trim()
                    });
                } catch (e) {
                    console.error("Error registering:", e);
                }
            }
        }
    };

    const handleLogout = () => {
        setIsLoggedIn(false);
        localStorage.removeItem('scrabble_player_name');
        localStorage.removeItem('scrabble_table_num');
    };

    const handleWordChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setWord(e.target.value.toUpperCase());
        setLastInputSource('form');
    };

    const handleTileClick = (index: number) => {
        const indices = getTileIndices(word);
        if (indices[index]) {
            const { start, end } = indices[index];
            const segment = word.substring(start, end);
            const isUpper = segment === segment.toUpperCase();
            const newSegment = isUpper ? segment.toLowerCase() : segment.toUpperCase();
            const newWord = word.substring(0, start) + newSegment + word.substring(end);
            setWord(newWord);
            setLastInputSource('form');
        }
    };

    const handlePreSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!word || !row || !col || !direction) return;
        setShowConfirmModal(true);
    };

    const executeSubmit = async () => {
        if (!gameId || !direction || !gameState) return;

        const rIndex = ROW_LABELS.indexOf(row);
        const cIndex = COL_LABELS.indexOf(col);
        const playerId = `table_${storedTable}`; 

        await submitMove(gameId, {
            id: Date.now().toString(),
            playerId: playerId,
            playerName: storedName,
            tableNumber: storedTable,
            word: word,
            tiles: tilesPreview,
            row: rIndex,
            col: cIndex,
            direction: direction,
            score: 0, 
            timestamp: Date.now(),
            roundNumber: currentRound
        });

        setSubmitted(true);
        setShowConfirmModal(false);
        setIsMobilePanelOpen(false);
    };

    const handleShuffleRack = () => {
        setLocalRack(prev => [...prev].sort(() => Math.random() - 0.5));
    };

    const handleRecallTiles = () => {
        const returned = placedTiles.map(p => p.tile);
        setLocalRack(prev => [...prev, ...returned]);
        setPlacedTiles([]);
        setWord('');
        setLastInputSource('dnd');
    };

    // --- DISPLAY LOGIC ---

    const highlightCells = useMemo(() => {
        if (gameState?.status === RoundStatus.IDLE && gameState.lastPlayedMove) {
            const { row, col, direction, tiles } = gameState.lastPlayedMove;
            const dr = direction === 'H' ? 0 : 1;
            const dc = direction === 'H' ? 1 : 0;
            return tiles.map((_, i) => ({
                row: row + (i * dr),
                col: col + (i * dc)
            }));
        }
        return [];
    }, [gameState?.status, gameState?.lastPlayedMove]);

    const formatTime = (seconds: number) => {
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        return `${m}:${s.toString().padStart(2, '0')}`;
    };

    // --- RANKING LOGIC ---
    const getRankingData = () => {
        if (!gameState) return [];
        const allParticipants = Object.values(gameState.participants || {}) as Participant[];
        const withScore = allParticipants.map(p => ({
            ...p,
            computedTotal: Object.values(p.roundScores || {}).reduce((a, b) => a + b, 0)
        }));
        return withScore.sort((a, b) => b.computedTotal - a.computedTotal);
    };
    const rankingData = getRankingData();

    // --- HISTORY LOGIC ---
    const getHistoryData = () => {
        if (!gameState || !gameState.history) return [];
        const playerId = `table_${storedTable}`;
        // Create a safe array from history
        const historyArray = Array.isArray(gameState.history) ? gameState.history : [];
        
        return historyArray.map(round => {
            let move: PlayerMove | undefined;
            // Check if moves is array or object
            if (Array.isArray(round.moves)) {
                move = round.moves.find((m: any) => m.playerId === playerId);
            } else if (round.moves && typeof round.moves === 'object') {
                move = round.moves[playerId];
            }
            return {
                round: round.roundNumber,
                word: move?.word || '-',
                score: move?.score || 0,
                found: !!move
            };
        }).sort((a, b) => b.round - a.round);
    };
    const historyData = getHistoryData();

    // --- RENDER ---

    if (!isLoggedIn) {
        return (
            <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
                <form onSubmit={handleLogin} className="bg-white p-8 rounded-2xl shadow-2xl w-full max-w-md space-y-6">
                    <div className="text-center">
                        <h2 className="text-3xl font-black text-slate-800 mb-2">JUGADOR ONLINE</h2>
                        <p className="text-slate-500">Introdueix les teves dades.</p>
                    </div>
                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm font-bold text-slate-600 uppercase mb-2">Número de Taula</label>
                            <input
                                type="text"
                                placeholder="1, 2, 3..."
                                className="w-full p-4 border-2 border-slate-200 rounded-xl text-xl font-bold text-center focus:ring-4 focus:ring-indigo-200 focus:border-indigo-500 outline-none"
                                value={inputTable}
                                onChange={(e) => setInputTable(e.target.value)}
                                autoFocus
                                required
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-bold text-slate-600 uppercase mb-2">Nom</label>
                            <input
                                type="text"
                                placeholder="EL TEU NOM"
                                className="w-full p-4 border-2 border-slate-200 rounded-xl text-xl font-bold uppercase focus:ring-4 focus:ring-indigo-200 focus:border-indigo-500 outline-none"
                                value={inputName}
                                onChange={(e) => setInputName(e.target.value.toUpperCase())}
                                required
                            />
                        </div>
                    </div>
                    <button 
                        type="submit"
                        disabled={!inputName.trim() || !inputTable.trim()}
                        className="w-full bg-indigo-600 text-white py-4 rounded-xl font-black text-lg hover:bg-indigo-700 shadow-lg disabled:opacity-50"
                    >
                        ENTRAR
                    </button>
                </form>
            </div>
        );
    }

    if (loading || !gameState) return <div className="flex items-center justify-center h-screen bg-slate-100">Carregant...</div>;

    return (
        <div 
            className="h-screen w-screen bg-slate-100 flex flex-col md:flex-row overflow-hidden relative select-none"
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            onMouseMove={handleTouchMove}
            onMouseUp={handleTouchEnd}
        >
            
            {/* --- LEFT COLUMN: BOARD & RACK --- */}
            <div className="flex-1 flex flex-col h-full relative overflow-hidden">
                {/* Header Mobile */}
                <div className="md:hidden bg-white p-2 shadow-sm flex justify-between items-center z-10 shrink-0">
                    <div className="flex items-center gap-2">
                        <div className="bg-indigo-100 px-2 py-1 rounded text-indigo-800 font-bold text-xs">T{storedTable}</div>
                        <div className="font-bold text-sm truncate max-w-[100px]">{storedName}</div>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className={`px-2 py-1 rounded text-xs font-bold ${isPlaying ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                            R{currentRound}
                        </div>
                        <div className={`font-mono font-black text-xl ${timeLeft < 30 ? 'text-red-500 animate-pulse' : 'text-slate-800'}`}>
                            {formatTime(timeLeft)}
                        </div>
                        <button onClick={handleLogout} className="p-1 hover:bg-gray-200 rounded">
                            <LogOut size={16} />
                        </button>
                    </div>
                </div>

                {/* Board Area */}
                <div className="flex-grow flex flex-col items-center justify-start md:justify-center bg-slate-200 overflow-hidden relative">
                    <div 
                        ref={boardRef}
                        className="bg-white p-1 md:p-2 rounded-lg shadow-2xl mb-2 md:mb-6 flex justify-center w-full max-w-2xl mx-auto shrink-0"
                    >
                        <Board 
                            board={gameState.board} 
                            isProjector={false} 
                            highlightCells={highlightCells}
                            previewTiles={placedTiles} 
                            onPreviewTileTouchStart={handleBoardTileTouchStart}
                        />
                    </div>
                </div>

                {/* Rack Area */}
                <div 
                    ref={rackRef}
                    className={`shrink-0 p-2 border-t-4 transition-colors pb-20 md:pb-2 ${isPlaying ? 'bg-[#fdf5e6] border-[#8b5a2b]' : 'bg-slate-800 border-slate-600'}`}
                    /* style={{ backgroundImage: isPlaying ? 'url("https://www.transparenttextures.com/patterns/wood-pattern.png")' : 'none' }} */
                >
                    {/* Rack Controls (New) */}
                    <div className="flex justify-between items-center mb-2 px-1">
                         <div className="flex gap-2">
                            <button 
                                onClick={handleShuffleRack}
                                className="bg-amber-700 text-white p-2 rounded-full shadow hover:bg-amber-600 active:scale-95 transition-transform border border-amber-600"
                                title="Mesclar"
                                disabled={!isPlaying}
                            >
                                <Shuffle size={16} />
                            </button>
                            <button 
                                onClick={handleRecallTiles}
                                className="bg-amber-700 text-white p-2 rounded-full shadow hover:bg-amber-600 active:scale-95 transition-transform border border-amber-600"
                                title="Recuperar fitxes"
                                disabled={!isPlaying || placedTiles.length === 0}
                            >
                                <RotateCcw size={16} />
                            </button>
                        </div>
                        <div className={`text-[10px] font-bold uppercase tracking-widest text-center ${isPlaying ? 'text-[#8b5a2b]' : 'text-slate-400'}`}>
                            {isPlaying ? "ARROSSEGA LES FITXES" : "ESPERANT..."}
                        </div>
                         <button 
                            onClick={handlePreSubmit}
                            disabled={submitted || !word}
                            className={`
                                flex items-center gap-2 px-3 py-1 rounded-full font-bold shadow transition-all text-xs
                                ${submitted 
                                    ? 'bg-gray-400 text-gray-200 cursor-not-allowed' 
                                    : !word 
                                        ? 'bg-gray-300 text-gray-500' 
                                        : 'bg-green-600 text-white hover:bg-green-500 active:scale-95'
                                }
                            `}
                        >
                            <span>Jugar</span>
                            <Send size={14} />
                        </button>
                    </div>

                    <div className="flex justify-center gap-1 h-12 md:h-14">
                        {isPlaying && localRack.map((tile, i) => (
                            <div
                                key={`${tile.id}-${i}`}
                                onTouchStart={(e) => handleTouchStart(e, tile, 'rack', i)}
                                onMouseDown={(e) => handleTouchStart(e, tile, 'rack', i)}
                                className="touch-none relative"
                                style={{ 
                                    width: '13%', 
                                    maxWidth: '50px', 
                                    aspectRatio: '1',
                                    opacity: isDragging && draggedTile?.tile.id === tile.id && draggedTile.source === 'rack' ? 0.3 : 1
                                }}
                            >
                                <Tile tile={tile} size="md" className="shadow-sm cursor-grab active:cursor-grabbing" />
                            </div>
                        ))}
                        {!isPlaying && gameState.currentRack && gameState.currentRack.map((c, i) => (
                             <Tile key={i} tile={createTile(c)} size="md" className="shadow-sm opacity-50" />
                        ))}
                    </div>
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
                        className={`flex-1 py-3 text-xs font-bold uppercase tracking-wider ${activeTab === 'form' ? 'text-indigo-600 border-b-2 border-indigo-600 bg-white rounded-tl-2xl' : 'text-gray-500'}`}
                        onClick={(e) => { e.stopPropagation(); setActiveTab('form'); setIsMobilePanelOpen(true); }}
                    >
                        Formulari
                    </button>
                    <button 
                        className={`flex-1 py-3 text-xs font-bold uppercase tracking-wider ${activeTab === 'ranking' ? 'text-indigo-600 border-b-2 border-indigo-600 bg-white rounded-tr-2xl' : 'text-gray-500'}`}
                        onClick={(e) => { e.stopPropagation(); setActiveTab('ranking'); setIsMobilePanelOpen(true); }}
                    >
                        Classificació
                    </button>
                </div>

                {/* Content Area */}
                <div className="flex-grow overflow-y-auto p-4 bg-white">
                    {/* FORM TAB */}
                    {activeTab === 'form' && (
                        <div className="space-y-4 max-w-sm mx-auto pb-10">
                            {!isPlaying && (
                                <div className="bg-yellow-100 text-yellow-800 p-3 rounded-xl text-center font-bold text-sm border border-yellow-200">
                                    Ronda tancada.
                                </div>
                            )}

                            {submitted && isPlaying && (
                                <div className="bg-green-100 text-green-800 p-3 rounded-xl text-center font-bold text-sm border border-green-200">
                                    Jugada enviada! Pots modificar-la.
                                </div>
                            )}

                            <form onSubmit={handlePreSubmit} className={`space-y-4 ${!isPlaying ? 'opacity-50 pointer-events-none' : ''}`}>
                                <div>
                                    <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Paraula</label>
                                    <input
                                        type="text"
                                        value={word}
                                        onChange={handleWordChange}
                                        className="w-full p-3 bg-gray-50 border-2 border-gray-200 rounded-xl text-2xl font-mono font-bold tracking-widest uppercase text-center focus:ring-2 focus:ring-indigo-500 outline-none"
                                        placeholder="PARAULA"
                                        autoComplete="off"
                                    />
                                </div>

                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="block text-xs font-bold text-gray-400 uppercase mb-1 text-center">Fila</label>
                                        <select 
                                            value={row} 
                                            onChange={(e) => setRow(e.target.value)} 
                                            className="w-full p-2 border border-gray-200 rounded-lg text-lg font-bold text-center bg-white"
                                        >
                                            <option value="" disabled>-</option>
                                            {ROW_LABELS.map(l => <option key={l} value={l}>{l}</option>)}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-gray-400 uppercase mb-1 text-center">Columna</label>
                                        <select 
                                            value={col} 
                                            onChange={(e) => setCol(e.target.value)} 
                                            className="w-full p-2 border border-gray-200 rounded-lg text-lg font-bold text-center bg-white"
                                        >
                                            <option value="" disabled>-</option>
                                            {COL_LABELS.map(c => <option key={c} value={c}>{c}</option>)}
                                        </select>
                                    </div>
                                </div>

                                <div className="flex bg-gray-100 p-1 rounded-lg">
                                    <button 
                                        type="button" 
                                        onClick={() => setDirection('H')} 
                                        className={`flex-1 py-2 rounded-md text-xs font-bold ${direction === 'H' ? 'bg-white shadow text-indigo-600' : 'text-gray-500'}`}
                                    >
                                        HORITZONTAL →
                                    </button>
                                    <button 
                                        type="button" 
                                        onClick={() => setDirection('V')} 
                                        className={`flex-1 py-2 rounded-md text-xs font-bold ${direction === 'V' ? 'bg-white shadow text-indigo-600' : 'text-gray-500'}`}
                                    >
                                        VERTICAL ↓
                                    </button>
                                </div>

                                <button
                                    type="submit"
                                    disabled={!word || !row || !col || !direction}
                                    className={`w-full py-3 text-white rounded-xl font-bold shadow-lg disabled:opacity-50 ${submitted ? 'bg-green-600 hover:bg-green-700' : 'bg-indigo-600 hover:bg-indigo-700'}`}
                                >
                                    {submitted ? 'ACTUALITZAR JUGADA' : 'ENVIAR JUGADA'}
                                </button>
                            </form>
                        </div>
                    )}

                    {/* RANKING TAB */}
                    {activeTab === 'ranking' && (
                        <div className="space-y-2 pb-10">
                            <table className="w-full text-sm text-left">
                                <thead className="text-xs text-gray-500 uppercase bg-gray-100">
                                    <tr>
                                        <th className="px-3 py-2">Pos</th>
                                        <th className="px-3 py-2">Nom</th>
                                        <th className="px-3 py-2 text-right">Punts</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {rankingData.map((p, idx) => (
                                        <tr key={p.id} className={`border-b ${p.id === `table_${storedTable}` ? 'bg-yellow-50 font-bold' : 'bg-white'}`}>
                                            <td className="px-3 py-2">{idx + 1}</td>
                                            <td className="px-3 py-2 truncate max-w-[120px]">{p.name}</td>
                                            <td className="px-3 py-2 text-right font-mono">{p.computedTotal}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </div>

            {/* DRAGGING GHOST */}
            {isDragging && draggedTile && (
                <div 
                    className="fixed pointer-events-none z-50 opacity-80"
                    style={{ 
                        left: dragPosition.x, 
                        top: dragPosition.y,
                        transform: 'translate(-50%, -50%) rotate(10deg) scale(1.2)' 
                    }}
                >
                    <Tile tile={draggedTile.tile} size="md" className="shadow-2xl" />
                </div>
            )}

            {/* CONFIRM MODAL */}
            {showConfirmModal && (
                <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-xl shadow-2xl p-6 max-w-sm w-full space-y-4">
                        <h3 className="text-lg font-black text-center uppercase">Confirmar</h3>
                        <div className="text-center space-y-1">
                            <div className="text-2xl font-mono font-bold text-indigo-600">{word}</div>
                            <div className="text-sm text-gray-500 font-bold">
                                {row}{col} {direction === 'H' ? 'HORITZONTAL' : 'VERTICAL'}
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3 pt-2">
                            <button onClick={() => setShowConfirmModal(false)} className="py-2 bg-gray-100 rounded-lg font-bold text-gray-600">Corregir</button>
                            <button onClick={executeSubmit} className="py-2 bg-indigo-600 text-white rounded-lg font-bold shadow-lg">Enviar</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default OnlinePlayerView;
