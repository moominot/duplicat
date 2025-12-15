
import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { ROW_LABELS, COL_LABELS } from '../constants';
import { parseInputWord, getTileIndices, calculateMoveScore, loadDictionary, getDictionaryVersion } from '../utils/scrabbleUtils';
import { submitMove, registerParticipant } from '../services/gameService';
import { Tile as TileType, RoundStatus } from '../types';
import Tile from '../components/Tile';
import { useGame } from '../hooks/useGame';

const PlayerView: React.FC = () => {
  const [searchParams] = useSearchParams();
  const gameId = searchParams.get('gameId');
  const navigate = useNavigate();
  
  const { gameState, loading, error } = useGame(gameId);

  // Login State
  const [storedName, setStoredName] = useState(localStorage.getItem('scrabble_player_name') || '');
  const [storedTable, setStoredTable] = useState(localStorage.getItem('scrabble_table_num') || '');
  
  const [inputName, setInputName] = useState(storedName);
  const [inputTable, setInputTable] = useState(storedTable);
  const [isPlaying, setIsPlaying] = useState(!!storedName && !!storedTable);

  // Game State
  const [word, setWord] = useState('');
  // Default Col/Row/Dir to empty/null strings to force user selection
  const [col, setCol] = useState('');
  const [row, setRow] = useState('');
  const [direction, setDirection] = useState<'H' | 'V' | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [tilesPreview, setTilesPreview] = useState<TileType[]>([]);
  
  const [currentRound, setCurrentRound] = useState(1);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  
  // Error de validació local (ex: primer torn centre)
  const [validationError, setValidationError] = useState<string | null>(null);
  
  // Dictionary Loading State
  const [dictVersion, setDictVersion] = useState<string>('');

  useEffect(() => {
      if(!gameId) navigate('/');
  }, [gameId, navigate]);

  useEffect(() => {
      if (gameState) {
          setCurrentRound(gameState.round);
          // Reset form on new round
          if (gameState.round > currentRound) {
              setWord('');
              setRow('');
              setCol('');
              setDirection(null);
              setSubmitted(false);
              setShowConfirmModal(false);
              setValidationError(null);
          }
      }
  }, [gameState, currentRound]);

  // Load Dictionary on GameState Config Change
  useEffect(() => {
      const load = async () => {
          if (gameState?.config?.dictionary) {
              await loadDictionary(gameState.config.dictionary);
              setDictVersion(getDictionaryVersion());
          } else {
               setDictVersion(getDictionaryVersion());
          }
      };
      load();
  }, [gameState?.config?.dictionary]);

  useEffect(() => {
      if (!word) {
          setTilesPreview([]);
          return;
      }
      const parsed = parseInputWord(word);
      setTilesPreview(parsed);
      setValidationError(null); // Netejar error en escriure
  }, [word]);

  const handleLogin = async (e: React.FormEvent) => {
      e.preventDefault();
      if (inputName.trim() && inputTable.trim()) {
          localStorage.setItem('scrabble_player_name', inputName.trim());
          localStorage.setItem('scrabble_table_num', inputTable.trim());
          setStoredName(inputName.trim());
          setStoredTable(inputTable.trim());
          setIsPlaying(true);
          
          // Registrar el participant immediatament
          if (gameId) {
              try {
                  await registerParticipant(gameId, {
                      id: `table_${inputTable.trim()}`,
                      name: inputName.trim(),
                      tableNumber: inputTable.trim()
                  });
              } catch (e) {
                  console.error("Error registrant participant:", e);
              }
          }
      }
  };

  const handleLogout = () => {
      setIsPlaying(false);
      localStorage.removeItem('scrabble_player_name');
      localStorage.removeItem('scrabble_table_num');
  };

  const handleWordChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setWord(e.target.value.toUpperCase());
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
      }
  };

  const handlePreSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!word || !storedName || !storedTable || !gameId || !gameState) return;
    if (tilesPreview.length === 0) return;

    if (!row || !col) {
        setValidationError("Has de seleccionar la Fila i la Columna.");
        return;
    }
    
    if (!direction) {
        setValidationError("Has de seleccionar la Direcció (Horitzontal o Vertical).");
        return;
    }

    const rIndex = ROW_LABELS.indexOf(row);
    const cIndex = COL_LABELS.indexOf(col);

    // Use core validation logic to check move validity before sending
    const validationResult = calculateMoveScore(
        gameState.board,
        tilesPreview,
        gameState.currentRack || [],
        rIndex,
        cIndex,
        direction
    );

    if (!validationResult.isValid) {
        //setValidationError(validationResult.error || "Jugada invàlida.");
       // return;
    }
    
    setValidationError(null);
    setShowConfirmModal(true);
  };

  const executeSubmit = async () => {
    if (!gameId || !direction) return;

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
      score: 0, // El servidor (master) calcularà la puntuació real si cal, però normalment es fa en el MasterView
      timestamp: Date.now(),
      roundNumber: currentRound
    });

    setSubmitted(true);
    setShowConfirmModal(false);
  };

  if (!isPlaying) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
        <form onSubmit={handleLogin} className="bg-white p-8 rounded-2xl shadow-2xl w-full max-w-md space-y-6">
          <div className="text-center">
              <h2 className="text-3xl font-black text-slate-800 mb-2">BENVINGUT/DA</h2>
              <p className="text-slate-500">Introdueix les teves dades de joc.</p>
          </div>
          <div className="space-y-4">
              <div>
                  <label className="block text-sm font-bold text-slate-600 uppercase mb-2">Número de Taula</label>
                  <input
                    type="text"
                    placeholder="1, 2, 3..."
                    className="w-full p-4 border-2 border-slate-200 rounded-xl text-xl font-bold text-center focus:ring-4 focus:ring-indigo-200 focus:border-indigo-500 outline-none transition-all"
                    value={inputTable}
                    onChange={(e) => setInputTable(e.target.value)}
                    autoFocus
                    required
                  />
              </div>
              <div>
                  <label className="block text-sm font-bold text-slate-600 uppercase mb-2">Nom del Jugador/a</label>
                  <input
                    type="text"
                    placeholder="EL TEU NOM"
                    className="w-full p-4 border-2 border-slate-200 rounded-xl text-xl font-bold uppercase focus:ring-4 focus:ring-indigo-200 focus:border-indigo-500 outline-none transition-all"
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
            ENTRAR A LA PARTIDA
          </button>
        </form>
      </div>
    );
  }

  if (loading) return <div className="text-center p-10">Carregant...</div>;
  if (error) return <div className="text-center p-10 text-red-500">Error: {error}</div>;

  const isRoundOpen = gameState?.status === RoundStatus.PLAYING;

  return (
    <div className="min-h-screen bg-gray-50 p-2 pb-24">
      <div className="max-w-lg mx-auto space-y-3">
        
        <header className="flex justify-between items-center bg-white p-3 rounded-xl shadow-sm border border-gray-100">
          <div className="flex items-center gap-2">
              <div className="bg-indigo-100 p-1 px-2 rounded-lg text-center min-w-[2.5rem]">
                  <span className="block text-[9px] uppercase font-bold text-indigo-400">Taula</span>
                  <span className="text-lg font-black text-indigo-700 leading-none">{storedTable}</span>
              </div>
              <div className="leading-tight">
                  <div className="text-[10px] text-gray-400 font-bold uppercase">Jugador</div>
                  <div className="text-base font-black text-slate-800">{storedName}</div>
              </div>
          </div>
          <div className="flex items-center gap-2">
              <span className="text-[9px] font-bold text-gray-300 uppercase">{dictVersion}</span>
              <button onClick={handleLogout} className="text-[10px] font-bold text-red-500 bg-red-50 px-2 py-1.5 rounded-lg">SORTIR</button>
          </div>
        </header>

        {/* Feedback d'estat de ronda */}
        {!isRoundOpen && (
            <div className="bg-yellow-100 text-yellow-800 p-2 rounded-xl text-center font-bold shadow-sm text-xs border border-yellow-200">
                ⚠ RONDA NO OBERTA (Prepara la jugada)
            </div>
        )}
        {isRoundOpen && (
            <div className="flex justify-between items-center bg-green-600 text-white p-2 px-3 rounded-xl shadow-md animate-pulse">
                 <span className="text-xs font-bold uppercase tracking-widest">RONDA EN JOC</span>
                 <div className="flex items-center gap-2 bg-green-700 px-2 py-1 rounded-lg">
                     <span className="font-black text-lg">#{currentRound}</span>
                 </div>
            </div>
        )}

        <form 
          onSubmit={handlePreSubmit} 
          className={`bg-white p-3 rounded-xl shadow-lg border border-gray-200 space-y-4 transition-opacity ${!isRoundOpen ? 'ring-2 ring-yellow-400' : ''}`}
        >
          <div>
            <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1 ml-1">Paraula</label>
            <input
              type="text"
              value={word}
              onChange={handleWordChange}
              className="w-full p-3 bg-gray-50 border-2 border-gray-200 rounded-xl text-3xl font-mono font-bold tracking-widest uppercase text-center focus:ring-4 focus:ring-blue-100 focus:border-blue-500 outline-none"
              placeholder="PARAULA..."
              autoComplete="off"
            />
          </div>

          {/* Validation Error Message */}
          {validationError && (
              <div className="bg-red-100 text-red-700 p-3 rounded-lg text-sm font-bold border border-red-200 animate-pulse">
                  {validationError}
              </div>
          )}

          {tilesPreview.length > 0 && (
            <div className="bg-indigo-50 p-2 rounded-xl border border-indigo-100">
                <div className="text-[9px] text-indigo-400 mb-1 text-center uppercase tracking-wider font-bold">Clica una fitxa per marcar Escarràs</div>
                
                {/* Flex container that centers and shrinks items instead of scrolling */}
                <div className="flex flex-nowrap gap-[2px] justify-center w-full py-1 px-1">
                    {tilesPreview.map((t, i) => (
                        <Tile 
                            key={i} 
                            tile={t} 
                            size="md" 
                            onClick={() => handleTileClick(i)} 
                            // !w-auto !h-auto and flex-1 allow the tile to shrink below its default size 
                            // while aspect-square maintains shape
                            className="shadow-sm flex-1 min-w-0 aspect-square !w-auto !h-auto max-w-[2.5rem]" 
                        />
                    ))}
                </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            {/* FILA (Lletres) */}
            <div className="bg-gray-50 p-2 rounded-lg border border-gray-100">
              <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1 text-center">Fila</label>
              <select 
                value={row} 
                onChange={(e) => setRow(e.target.value)} 
                className={`w-full p-2 border border-gray-200 rounded-md text-xl font-bold text-center shadow-sm ${!row ? 'text-gray-400' : 'text-black bg-white'}`}
              >
                <option value="" disabled>-</option>
                {ROW_LABELS.map(l => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>

            {/* COLUMNA (Nombres) */}
            <div className="bg-gray-50 p-2 rounded-lg border border-gray-100">
              <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1 text-center">Columna</label>
              <select 
                value={col} 
                onChange={(e) => setCol(e.target.value)} 
                className={`w-full p-2 border border-gray-200 rounded-md text-xl font-bold text-center shadow-sm ${!col ? 'text-gray-400' : 'text-black bg-white'}`}
              >
                <option value="" disabled>-</option>
                {COL_LABELS.map(l => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
          </div>

          {/* DIRECTION SELECTOR - SEGMENTED CONTROL STYLE */}
          <div className="flex bg-gray-100 p-1 rounded-lg shadow-inner select-none">
               <button 
                type="button" 
                onClick={() => setDirection('H')} 
                className={`flex-1 py-2 rounded-md text-sm font-bold transition-all ${direction === 'H' ? 'bg-white text-indigo-600 shadow-sm ring-1 ring-black/5' : 'text-gray-500 hover:text-gray-700'}`}
               >
                 HORITZONTAL →
               </button>
               <button 
                type="button" 
                onClick={() => setDirection('V')} 
                className={`flex-1 py-2 rounded-md text-sm font-bold transition-all ${direction === 'V' ? 'bg-white text-indigo-600 shadow-sm ring-1 ring-black/5' : 'text-gray-500 hover:text-gray-700'}`}
               >
                 VERTICAL ↓
               </button>
          </div>

          <button
            type="submit"
            disabled={!word || !row || !col || !direction}
            className={`w-full py-4 rounded-xl text-white font-black text-xl shadow-xl transition-all mt-2 transform active:scale-95
              ${submitted ? 'bg-green-600 hover:bg-green-700' : 'bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700'}
              disabled:opacity-50 disabled:cursor-not-allowed
            `}
          >
            {submitted ? 'ACTUALITZAR JUGADA' : 'ENVIAR JUGADA'}
          </button>
          
          {submitted && (
              <div className="text-center text-xs font-bold text-green-600 mt-2 animate-pulse">
                  Jugada registrada. Pots modificar-la fins que s'acabi el temps.
              </div>
          )}
        </form>
      </div>

      {/* CONFIRMATION MODAL */}
      {showConfirmModal && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-2xl p-5 max-w-sm w-full space-y-4 animate-in fade-in zoom-in duration-200">
                <h3 className="text-lg font-black text-center text-gray-800 uppercase">Confirmar Jugada</h3>
                
                <div className="bg-gray-50 p-3 rounded-xl border-2 border-gray-100 text-center space-y-2">
                    {/* Visual Tiles in Modal - Shrinking behavior */}
                    <div className="flex flex-nowrap gap-[2px] justify-center w-full py-1 px-1">
                        {tilesPreview.map((t, i) => (
                            <Tile 
                                key={i} 
                                tile={t} 
                                size="md" 
                                className="shadow-md flex-1 min-w-0 aspect-square !w-auto !h-auto max-w-[2.5rem]" 
                            />
                        ))}
                    </div>
                    <div className="flex justify-center gap-4 text-xs font-bold text-gray-500 uppercase border-t pt-2 border-gray-200">
                        <span>Fila: <span className="text-gray-800">{row}</span></span>
                        <span>Col: <span className="text-gray-800">{col}</span></span>
                        <span>Dir: <span className="text-gray-800">{direction === 'H' ? 'HOR' : 'VER'}</span></span>
                    </div>
                </div>

                <div className="text-center text-[10px] text-gray-400 font-semibold px-4 leading-tight">
                    Verifica que els Escarrassos (?) estiguin ben marcats (vora verda).
                </div>

                <div className="grid grid-cols-2 gap-3 pt-2">
                    <button 
                        onClick={() => setShowConfirmModal(false)}
                        className="py-3 rounded-lg font-bold text-sm text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors"
                    >
                        CORREGIR
                    </button>
                    <button 
                        onClick={executeSubmit}
                        className="py-3 rounded-lg font-bold text-sm text-white bg-indigo-600 hover:bg-indigo-700 shadow-lg transition-transform active:scale-95"
                    >
                        SÍ, ENVIAR
                    </button>
                </div>
            </div>
        </div>
      )}

    </div>
  );
};

export default PlayerView;
