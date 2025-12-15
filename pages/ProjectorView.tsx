
import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useGame } from '../hooks/useGame';
import Board from '../components/Board';
import Tile from '../components/Tile';
import { createTile, calculateRemainingBag,internalToDisplayWord } from '../utils/scrabbleUtils';
import { RoundStatus, Participant } from '../types';
import { ROW_LABELS, COL_LABELS, TILE_COUNTS } from '../constants';

const ProjectorView: React.FC = () => {
  const [searchParams] = useSearchParams();
  const gameId = searchParams.get('gameId');
  const navigate = useNavigate();
  
  const { gameState, loading } = useGame(gameId);
  const [timeLeft, setTimeLeft] = useState(0);
  
  // --- RESIZING STATE ---
  const [splitRatio, setSplitRatio] = useState(65); // Horizontal split
  const [boardHeight, setBoardHeight] = useState(100); // Vertical height percentage
  
  const [isDraggingSplit, setIsDraggingSplit] = useState(false);
  const [isResizingHeight, setIsResizingHeight] = useState(false);

  // --- RANKING & BAG STATE ---
  const [showRanking, setShowRanking] = useState(false);
  const [showBag, setShowBag] = useState(false);
  const [showRoundScores, setShowRoundScores] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState<string>('ALL');

  useEffect(() => {
    if(!gameId) navigate('/');
  }, [gameId, navigate]);

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

  // Auto-hide ranking/bag when round changes or status changes (e.g. to PLAYING)
  useEffect(() => {
      setShowRanking(false);
      setShowBag(false);
  }, [gameState?.round, gameState?.status]);

  // --- DRAG HANDLERS ---
  const handleMouseDownSplit = (e: React.MouseEvent) => {
      e.preventDefault();
      setIsDraggingSplit(true);
  };

  const handleMouseDownHeight = (e: React.MouseEvent) => {
      e.preventDefault();
      setIsResizingHeight(true);
  }

  const handleMouseMove = useCallback((e: MouseEvent) => {
      if (isDraggingSplit) {
          const newRatio = (e.clientX / window.innerWidth) * 100;
          if (newRatio > 40 && newRatio < 85) {
              setSplitRatio(newRatio);
          }
      }
      if (isResizingHeight) {
          // Calculate height percentage relative to window height
          // We clamp it between 30% and 100%
          const newHeight = (e.clientY / window.innerHeight) * 100;
          if (newHeight > 30 && newHeight <= 100) {
              setBoardHeight(newHeight);
          }
      }
  }, [isDraggingSplit, isResizingHeight]);

  const handleMouseUp = useCallback(() => {
      setIsDraggingSplit(false);
      setIsResizingHeight(false);
  }, []);

  useEffect(() => {
      if (isDraggingSplit || isResizingHeight) {
          window.addEventListener('mousemove', handleMouseMove);
          window.addEventListener('mouseup', handleMouseUp);
          document.body.style.cursor = isDraggingSplit ? 'col-resize' : 'row-resize';
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
  }, [isDraggingSplit, isResizingHeight, handleMouseMove, handleMouseUp]);

  // --- HIGHLIGHT LAST MASTER MOVE ---
  // MOVED: Hook must be called before any conditional return.
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


  if (loading || !gameState) return <div className="min-h-screen bg-black text-white flex items-center justify-center text-3xl font-mono">Carregant partida...</div>;

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  // --- LOGIC FOR MASTER MOVE & LEFTOVER RACK ---
  const lastMove = gameState.lastPlayedMove;
  const isPlaying = gameState.status === RoundStatus.PLAYING;
  const showMasterMove = gameState.status === RoundStatus.IDLE && !!lastMove;
  
  let displayRack: string[] = [];
  let rackLabel = "";

  if (isPlaying) {
      displayRack = gameState.currentRack || [];
      rackLabel = "FARISTOL ACTUAL";
  } else {
      if (lastMove && gameState.history && gameState.history.length > 0) {
          const prevRound = gameState.history[gameState.history.length - 1];
          if (prevRound) {
              const originalRack = [...prevRound.rack];
              const usedChars = lastMove.tiles.map(t => t.char);
              
              for (const char of usedChars) {
                  const idx = originalRack.indexOf(char);
                  if (idx !== -1) {
                      originalRack.splice(idx, 1);
                  } else {
                      const wildIdx = originalRack.indexOf('?');
                      if (wildIdx !== -1) originalRack.splice(wildIdx, 1);
                  }
              }
              displayRack = originalRack;
              rackLabel = showMasterMove ? `FITXES RESTANTS (R${prevRound.roundNumber})` : "FITXES RESTANTS";
          } else {
              displayRack = []; 
          }
      } else {
          displayRack = []; 
          rackLabel = "ESPERANT...";
      }
  }

  const lastMoveLabel = lastMove 
    ? `${ROW_LABELS[lastMove.row]}${COL_LABELS[lastMove.col]} ${lastMove.direction === 'H' ? '→' : '↓'}`
    : '';

  // --- RANKING CALCULATION ---
  const allParticipants = Object.values(gameState.participants || {}) as Participant[];
  const uniqueGroups = Array.from(new Set(allParticipants.map(p => p.group).filter(Boolean))).sort();

  const getRankingData = () => {
      // Filter by group but keep Bot
      let filtered = allParticipants;
      if (selectedGroup !== 'ALL') {
          filtered = allParticipants.filter(p => p.group === selectedGroup || p.id === 'bot_master');
      }

      // Calculate total score
      const withScore = filtered.map(p => ({
          ...p,
          computedTotal: Object.values(p.roundScores || {}).reduce((a, b) => a + b, 0)
      }));

      // Isolate Bot and Humans
      const bot = withScore.find(p => p.id === 'bot_master');
      const humans = withScore.filter(p => p.id !== 'bot_master');

      // Sort humans
      humans.sort((a, b) => b.computedTotal - a.computedTotal);

      // Return bot first, then humans
      if (bot) {
          return [bot, ...humans];
      }
      return humans;
  };

  const rankingData = getRankingData();
  
  // Find Max Score for percentage calc (Prioritize Bot)
  const bot = rankingData.find(p => p.id === 'bot_master');
  const humanMax = Math.max(...rankingData.filter(p => p.id !== 'bot_master').map(p => p.computedTotal), 0);
  const maxScore = (bot && bot.computedTotal > 0) ? bot.computedTotal : (humanMax > 0 ? humanMax : 1);
  
  // Calculate previous rounds for columns
  const roundsArray = Array.from({length: gameState.round - 1}, (_, i) => i + 1);

  // Lookup for Master Scores per round to highlight matching players
  const masterScores: Record<number, number> = {};
  gameState.history.forEach(h => {
      if (h.masterMove?.score) {
          masterScores[h.roundNumber] = h.masterMove.score;
      }
  });

  // --- BAG CALCULATION ---
  const remainingBagTiles = calculateRemainingBag(gameState.board, gameState.currentRack || []).sort();
  
  return (
    <div className="h-screen w-screen bg-slate-900 text-white flex flex-col md:flex-row p-6 gap-6 overflow-hidden select-none relative">
        
        {/* LEFT COLUMN: THE BOARD & HEIGHT ADJUSTER */}
        <div 
            className="flex flex-col min-h-0 relative transition-[width] duration-75 ease-linear h-full order-2 md:order-1"
            style={{ flexBasis: `${splitRatio}%`, flexGrow: 0, flexShrink: 0 }}
        >
             {/* Board Container - Height Controlled */}
             <div 
                style={{ height: `${boardHeight}%` }}
                className="w-full flex items-center justify-center p-1 relative shrink-0"
             >
                 <div className="aspect-square h-full max-w-full max-h-full bg-black shadow-2xl rounded-lg overflow-hidden border-4 border-slate-700 flex items-center justify-center">
                    <Board 
                        board={gameState.board} 
                        isProjector={true} 
                        className="!p-0 !rounded-none w-full h-full"
                        highlightCells={highlightCells}
                    />
                </div>
             </div>

             {/* HEIGHT RESIZER HANDLE */}
             <div 
                className="w-full h-6 cursor-row-resize flex items-center justify-center hover:bg-slate-800/50 active:bg-blue-500/30 transition-colors z-50 shrink-0 group"
                onMouseDown={handleMouseDownHeight}
                title="Arrossega per ajustar l'alçada del tauler"
             >
                <div className="w-12 h-1.5 bg-slate-600 rounded-full group-hover:bg-slate-400 transition-colors"></div>
             </div>

             {/* Spacer to push everything up if board is small */}
             <div className="flex-grow"></div>
        </div>

        {/* WIDTH RESIZER HANDLE (Desktop) */}
        <div 
            className="hidden md:flex w-4 cursor-col-resize items-center justify-center hover:bg-slate-700/50 active:bg-blue-500/50 transition-colors z-50 order-2"
            onMouseDown={handleMouseDownSplit}
        >
            <div className="w-1 h-12 bg-slate-600 rounded-full"></div>
        </div>

        {/* RIGHT COLUMN: INFO PANEL */}
        <div className="flex-1 flex flex-col gap-6 min-h-0 w-full h-full min-w-0 order-1 md:order-3">
            
            {/* 1. TOP: ROUND & TIMER */}
            <div className="flex gap-4 h-[20%] shrink-0 min-h-[80px]">
                <div className="flex-1 bg-slate-800 rounded-xl border-2 border-slate-600 p-2 flex flex-col items-center justify-center shadow-lg relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-full h-1.5 bg-blue-500"></div>
                    <h2 className="text-slate-400 uppercase tracking-widest text-[1.5vh] font-bold mb-0">Ronda</h2>
                    <div className="text-[8vh] font-black text-white leading-none">{gameState.round}</div>
                </div>

                <div className={`
                    flex-[1.5] rounded-xl border-4 p-2 flex flex-col items-center justify-center shadow-lg transition-all duration-500 relative overflow-hidden
                    ${gameState.status === RoundStatus.PLAYING && timeLeft < 30 ? 'bg-red-900/80 border-red-500 animate-pulse' : 'bg-slate-800 border-slate-600'}
                    ${gameState.status === RoundStatus.IDLE ? 'border-yellow-500/50' : ''}
                `}>
                    <div className={`absolute top-0 left-0 w-full h-1.5 ${gameState.status === RoundStatus.PLAYING ? 'bg-green-500' : 'bg-yellow-500'}`}></div>
                    
                    {gameState.status === RoundStatus.PLAYING ? (
                        <div className={`text-[10vh] font-mono font-black leading-none tracking-tighter ${timeLeft < 30 ? 'text-red-400' : 'text-green-400'}`}>
                            {formatTime(timeLeft)}
                        </div>
                    ) : (
                        <div className="text-[4vh] font-black text-yellow-400 uppercase text-center leading-tight">
                            {gameState.status === RoundStatus.IDLE ? "PREPARANT..." : "REVISIÓ"}
                        </div>
                    )}
                </div>
            </div>

            {/* 2. MIDDLE: RACK */}
            <div className={`
                h-[22%] shrink-0 rounded-xl border-4 shadow-2xl flex flex-col transition-all duration-500 overflow-hidden relative min-h-[80px]
                ${isPlaying ? 'bg-[#fdf5e6] border-[#8b5a2b]' : 'bg-slate-800 border-slate-600'}
            `}>
                <div className={`absolute top-0 left-0 w-full h-2 ${isPlaying ? 'bg-[#8b5a2b]' : 'bg-slate-500'}`}></div>
                
                <div className={`absolute top-2 left-3 text-[1.2vh] font-bold uppercase tracking-widest ${isPlaying ? 'text-[#8b5a2b]' : 'text-slate-400'}`}>
                    {rackLabel}
                </div>

                {/* Rack Tiles Container */}
                <div className="flex-grow flex items-center justify-center px-2 pb-1 pt-4 w-full">
                    {(isPlaying || showMasterMove) ? (
                        <div className="flex gap-2 h-[80%] w-full justify-center items-center">
                            {displayRack.map((c, i) => (
                                <div key={i} className="w-full aspect-square max-w-[13%]">
                                    <Tile 
                                        tile={createTile(c)} 
                                        size="xl" 
                                        className={`
                                            shadow-lg !border-[3px] !w-full !h-full
                                            ${isPlaying ? '!border-[#cbbfa8]' : 'opacity-70 grayscale !bg-slate-200 !border-slate-400'}
                                        `} 
                                    />
                                </div>
                            ))}
                        </div>
                    ) : (
                        <span className="text-slate-600 font-bold text-[3vh] uppercase animate-pulse">
                            {gameState.status === RoundStatus.REVIEW ? "VALIDANT..." : "..."}
                        </span>
                    )}
                </div>
            </div>

             {/* 3. BOTTOM: MASTER MOVE BOX */}
             <div className="flex-1 relative min-h-[100px]">
                {showMasterMove ? (
                    <div className="absolute inset-0 bg-indigo-900/40 rounded-xl border-4 border-indigo-500 p-2 shadow-2xl flex flex-col overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-500">
                        <div className="absolute top-0 left-0 w-full h-1.5 bg-indigo-500"></div>
                        <h3 className="text-indigo-300 uppercase tracking-[0.2em] font-bold text-[1.5vh] mb-1 flex justify-between items-center border-b border-indigo-500/30 pb-1">
                            <span>JUGADA MESTRA (R{gameState.round - 1})</span>
                        </h3>
                        
                        <div className="flex-grow flex flex-col items-center justify-center gap-2">
                        <div className="text-[3.5vh] font-mono text-indigo-200 font-bold bg-indigo-950/80 px-4 py-1 rounded-lg border border-indigo-500/50">
                                    {lastMoveLabel}
                                </div>
                            <div className="text-[7vh] font-black text-white tracking-wide break-words leading-none drop-shadow-xl text-center">
                                {internalToDisplayWord(lastMove?.word)}
                            </div>
                        
                                
                                <div className="text-[5.5vh] text-white bg-indigo-600 px-5 py-1 rounded-xl font-black shadow-lg border-2 border-indigo-400">
                                    {lastMove?.score} pts
                                </div>
                           
                        </div>
                    </div>
                ) : (
                     <div className="w-full h-full flex items-center justify-center opacity-10">
                         <span className="text-[5vh] font-black">DUPLICAT</span>
                     </div>
                )}
             </div>
        </div>
        
        {/* BUTTONS CONTAINER */}
        <div className="fixed bottom-4 right-4 z-40 flex gap-4">
            {/* BAG BUTTON */}
            <button 
                onClick={() => setShowBag(!showBag)}
                className="bg-slate-700/80 hover:bg-slate-600 text-white p-3 rounded-full shadow-xl border border-slate-500 transition-all flex items-center justify-center"
                title="Mostrar Sac"
            >
                <span className="text-2xl">💰</span>
            </button>

            {/* RANKING TOGGLE BUTTON */}
            <button 
                onClick={() => setShowRanking(!showRanking)}
                className="bg-slate-700/80 hover:bg-slate-600 text-white p-3 rounded-full shadow-xl border border-slate-500 transition-all flex items-center justify-center"
                title="Mostrar/Amagar Classificació"
            >
                {showRanking ? <span className="text-xl font-bold">✕</span> : <span className="text-2xl">🏆</span>}
            </button>
        </div>

        {/* FULL SCREEN BAG OVERLAY */}
        {showBag && (
            <div className="fixed inset-0 z-50 bg-slate-900/95 backdrop-blur-sm flex flex-col p-8 animate-in fade-in duration-200 overflow-hidden">
                <div className="flex justify-between items-center mb-8 shrink-0">
                    <h1 className="text-5xl font-black text-white uppercase tracking-tight flex items-center gap-4">
                        <span className="text-yellow-500">💰</span> Fitxes del Sac
                        <span className="text-3xl text-slate-400 ml-4">({remainingBagTiles.length} restants)</span>
                    </h1>
                    <button 
                        onClick={() => setShowBag(false)}
                        className="bg-slate-700 hover:bg-slate-600 text-white px-6 py-3 rounded-xl font-bold text-2xl"
                    >
                        TANCAR
                    </button>
                </div>

                <div className="flex-grow overflow-y-auto p-4">
                    <div className="flex flex-wrap gap-4 justify-center content-start">
                        {Object.keys(TILE_COUNTS).sort((a, b) => {
                            // Sort alphabetically by display char (handles digraphs like QU, L·L, NY correctly)
                            // Puts '?' at the end.
                            if (a === '?' && b !== '?') return 1;
                            if (b === '?' && a !== '?') return -1;
                            return createTile(a).displayChar.localeCompare(createTile(b).displayChar, 'ca');
                        }).map(char => {
                            const total = TILE_COUNTS[char];
                            const remainingCount = remainingBagTiles.filter(c => c === char).length;
                            const usedCount = total - remainingCount;

                            return (
                                <div key={char} className="flex gap-2 p-3 bg-slate-800 rounded-xl border border-slate-600 shadow-md">
                                    {/* Remaining tiles (Normal) */}
                                    {Array.from({ length: remainingCount }).map((_, i) => (
                                        <Tile key={`rem-${char}-${i}`} tile={createTile(char)} size="lg" />
                                    ))}

                                    {/* Used tiles (Dimmed & Crossed out) */}
                                    {Array.from({ length: usedCount }).map((_, i) => (
                                        <div key={`used-${char}-${i}`} className="relative opacity-25 grayscale">
                                            <Tile tile={createTile(char)} size="lg" className="!border-slate-500 !bg-slate-700 !text-slate-400" />
                                            {/* Diagonal Line overlay */}
                                            <div className="absolute inset-0 overflow-hidden pointer-events-none">
                                                <div className="absolute top-1/2 left-[-20%] w-[140%] h-[3px] bg-red-500/60 -rotate-45 transform origin-center"></div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        )}

        {/* FULL SCREEN RANKING OVERLAY */}
        {showRanking && (
            <div className="fixed inset-0 z-50 bg-slate-900/95 backdrop-blur-sm flex flex-col p-8 animate-in fade-in duration-200 overflow-hidden">
                 <div className="flex flex-col gap-4 mb-6 shrink-0">
                     <div className="flex justify-between items-center">
                        <h1 className="text-5xl font-black text-white uppercase tracking-tight flex items-center gap-4">
                            <span className="text-yellow-500">🏆</span> Classificació {selectedGroup !== 'ALL' ? `- Grup ${selectedGroup}` : ''}
                        </h1>
                        
                        <div className="flex gap-4 items-center">
                            <div className="text-2xl text-slate-400 font-bold">Ronda {gameState.round - 1}</div>
                            <button 
                                onClick={() => setShowRoundScores(!showRoundScores)}
                                className="bg-indigo-700 hover:bg-indigo-600 text-white px-6 py-3 rounded-xl font-bold text-2xl transition-colors"
                            >
                                {showRoundScores ? 'AMAGAR RONDES' : 'VEURE RONDES'}
                            </button>
                            <button 
                                onClick={() => setShowRanking(false)}
                                className="bg-slate-700 hover:bg-slate-600 text-white px-6 py-3 rounded-xl font-bold text-2xl"
                            >
                                TANCAR
                            </button>
                        </div>
                     </div>

                     {/* Group Filter Tabs (Only if groups exist) */}
                     {uniqueGroups.length > 0 && (
                         <div className="flex gap-4 overflow-x-auto pb-2">
                             <button
                                 className={`px-6 py-2 rounded-lg font-bold text-xl transition-colors ${selectedGroup === 'ALL' ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}
                                 onClick={() => setSelectedGroup('ALL')}
                             >
                                 TOTAL
                             </button>
                             {uniqueGroups.map(g => (
                                 <button
                                     key={g}
                                     className={`px-6 py-2 rounded-lg font-bold text-xl transition-colors ${selectedGroup === g ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}
                                     onClick={() => setSelectedGroup(g!)}
                                 >
                                     GRUP {g}
                                 </button>
                             ))}
                         </div>
                     )}
                 </div>
                 
                 <div className="flex-grow overflow-y-auto pr-2">
                     <table className="w-full text-left border-collapse">
                         <thead className="bg-slate-800 text-slate-300 uppercase text-2xl font-bold sticky top-0 shadow-lg">
                             <tr>
                                 <th className="p-4 rounded-tl-xl">Pos</th>
                                 <th className="p-4">Taula</th>
                                 <th className="p-4">Nom</th>
                                 {showRoundScores && roundsArray.map(r => (
                                    <th key={r} className="p-4 text-center text-slate-500 text-xl">R{r}</th>
                                 ))}
                                 <th className="p-4 text-right">Punts</th>
                                 <th className="p-4 text-right">%</th>
                                 <th className="p-4 text-center rounded-tr-xl">Mestres</th>
                             </tr>
                         </thead>
                         <tbody className="text-2xl">
                             {rankingData.map((p, idx) => {
                                 const percentage = maxScore > 0 ? ((p.computedTotal / maxScore) * 100).toFixed(1) : '0.0';
                                 const isBot = p.id === 'bot_master';
                                 // Only calculate top 3 if not bot (bot is always index 0, but we want human ranks)
                                 const isTop3 = !isBot && idx < 4; 

                                 return (
                                     <tr key={p.id} className={`border-b border-slate-700 transition-colors ${isBot ? 'bg-slate-600 font-black text-yellow-400 border-b-4 border-slate-500' : 'hover:bg-slate-800/50'} ${isTop3 && !isBot ? 'text-yellow-100' : 'text-slate-200'}`}>
                                         <td className="p-4 font-black text-slate-500">
                                             {isBot ? '-' : (isTop3 ? ['🥇','🥈','🥉'][idx-1] : idx)}
                                         </td>
                                         <td className="p-4 font-mono font-bold text-slate-400">
                                            {isBot ? '---' : `#${p.tableNumber}`}
                                         </td>
                                         <td className="p-4 font-bold flex items-center gap-3">
                                             {p.name}
                                             {/* Show group badge only in ALL view */}
                                             {selectedGroup === 'ALL' && p.group && (
                                                 <span className="text-lg bg-slate-700 text-slate-300 px-2 py-0.5 rounded-md opacity-80 font-normal">
                                                     {p.group}
                                                 </span>
                                             )}
                                         </td>
                                         
                                         {showRoundScores && roundsArray.map(r => {
                                            const score = p.roundScores?.[r] || 0;
                                            const masterScore = masterScores[r];
                                            // Highlight if player found the master move
                                            const isMasterMatch = masterScore && score === masterScore;
                                            
                                            return (
                                                <td key={r} className={`p-4 text-center text-xl font-mono ${isMasterMatch && !isBot ? 'font-black text-green-400 bg-green-900/20' : 'text-slate-300'}`}>
                                                    {score}
                                                </td>
                                            );
                                         })}
                                         
                                         <td className="p-4 text-right font-mono font-black text-indigo-300">{p.computedTotal}</td>
                                         <td className="p-4 text-right font-mono text-slate-500">
                                            {isBot ? '' : `${percentage}%`}
                                         </td>
                                         <td className="p-4 text-center font-mono font-bold text-amber-500">
                                            {isBot ? '' : (p.masterMovesCount || 0)}
                                         </td>
                                     </tr>
                                 );
                             })}
                         </tbody>
                     </table>
                 </div>
            </div>
        )}

    </div>
  );
};

export default ProjectorView;
