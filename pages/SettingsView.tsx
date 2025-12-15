
import React, { useState, useEffect, useRef } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { updateConfig, resetGame, registerParticipant, removeParticipant, deleteLastRound, getFullGameData, restoreGameData, importEliotGame, importEliotGameAsGroup, importPlayers } from '../services/gameService';
import { useGame } from '../hooks/useGame';
import { Participant } from '../types';
import { generateEliotXML } from '../utils/eliotExport';
import { parsePlayersCSV } from '../utils/csvHelpers';
import { isDebugEnabled, setDebugEnabled } from '../utils/debug';
import { AVAILABLE_DICTIONARIES } from '../utils/scrabbleUtils';

const SettingsView: React.FC = () => {
    const [searchParams] = useSearchParams();
    const gameId = searchParams.get('gameId');
    const navigate = useNavigate();
    const { gameState, loading } = useGame(gameId);
    
    // Game Config State
    const [timerDuration, setTimerDuration] = useState('180');
    const [gracePeriod, setGracePeriod] = useState('10');
    const [judgeName, setJudgeName] = useState('');
    const [bestMovesLimit, setBestMovesLimit] = useState('10');
    const [dictionary, setDictionary] = useState('DISC');
    
    // Player Management State
    const [showPlayerModal, setShowPlayerModal] = useState(false);
    const [editingParticipant, setEditingParticipant] = useState<Participant | null>(null);
    const [pName, setPName] = useState('');
    const [pTable, setPTable] = useState('');
    const [pGroup, setPGroup] = useState('');

    // Developer State
    const [debugMode, setDebugModeState] = useState(isDebugEnabled());

    // Danger Zone state
    const [deleteStep, setDeleteStep] = useState(0);
    const [deleteRoundStep, setDeleteRoundStep] = useState(0);
    
    // Backup state
    const fileInputRef = useRef<HTMLInputElement>(null);
    const eliotInputRef = useRef<HTMLInputElement>(null);
    const csvInputRef = useRef<HTMLInputElement>(null);
    const [isRestoring, setIsRestoring] = useState(false);

    // Custom UI State (Replacing alert/confirm)
    const [confirmation, setConfirmation] = useState<{
        message: string;
        onConfirm: () => void;
        onCancel: () => void;
    } | null>(null);
    
    const [uiMessage, setUiMessage] = useState<{type: 'success' | 'error', text: string} | null>(null);

    useEffect(() => {
        if(gameState && gameState.config) {
            setTimerDuration(gameState.config.timerDurationSeconds.toString());
            setGracePeriod((gameState.config.gracePeriodSeconds || 10).toString());
            setJudgeName(gameState.config.judgeName);
            setBestMovesLimit((gameState.config.bestMovesLimit ?? 10).toString());
            setDictionary(gameState.config.dictionary || 'DISC');
        }
    }, [gameState]);

    const showMessage = (type: 'success' | 'error', text: string) => {
        setUiMessage({ type, text });
        setTimeout(() => setUiMessage(null), 5000);
    };

    const handleSave = async () => {
        if(!gameId) return;
        await updateConfig(gameId, {
            timerDurationSeconds: parseInt(timerDuration) || 180,
            gracePeriodSeconds: parseInt(gracePeriod) || 10,
            judgeName: judgeName,
            bestMovesLimit: parseInt(bestMovesLimit) || 0,
            dictionary: dictionary
        });
        navigate(`/master?gameId=${gameId}`);
    };

    const handleToggleDebug = () => {
        const newValue = !debugMode;
        setDebugModeState(newValue);
        setDebugEnabled(newValue);
    };

    const handleReset = async () => {
        if (deleteStep === 0) {
            setDeleteStep(1);
            return;
        }
        
        if (gameId) {
            await resetGame(gameId);
            navigate('/');
        }
    }

    const handleDeleteLastRound = async () => {
        if (deleteRoundStep === 0) {
            setDeleteRoundStep(1);
            return;
        }
        if (gameId) {
            try {
                await deleteLastRound(gameId);
                setDeleteRoundStep(0);
                showMessage('success', 'Ronda esborrada correctament.');
            } catch (e: any) {
                showMessage('error', e.message);
            }
        }
    }
    
    // --- Player Management Handlers ---
    
    const openAddPlayer = () => {
        setEditingParticipant(null);
        setPName('');
        setPTable('');
        setPGroup('');
        setShowPlayerModal(true);
    };

    const openEditPlayer = (p: Participant) => {
        setEditingParticipant(p);
        setPName(p.name);
        setPTable(p.tableNumber);
        setPGroup(p.group || '');
        setShowPlayerModal(true);
    };

    const handleSavePlayer = async () => {
        if (!gameId || !pName || !pTable) return;
        
        const pid = editingParticipant ? editingParticipant.id : `table_${pTable.trim()}`;
        
        await registerParticipant(gameId, {
            id: pid,
            name: pName.trim().toUpperCase(),
            tableNumber: pTable.trim(),
            group: pGroup.trim().toUpperCase() || undefined
        });
        
        setShowPlayerModal(false);
    };

    const handleDeletePlayer = (pid: string) => {
        setConfirmation({
            message: "Segur que vols eliminar aquest jugador? S'esborraran les seves puntuacions.",
            onConfirm: async () => {
                if (gameId) {
                    await removeParticipant(gameId, pid);
                }
                setConfirmation(null);
            },
            onCancel: () => setConfirmation(null)
        });
    };

    const handleUploadPlayersCSV = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !gameId) return;

        const reader = new FileReader();
        reader.onload = async (event) => {
            try {
                const csvContent = event.target?.result as string;
                const players = parsePlayersCSV(csvContent);
                
                if (players.length > 0) {
                    await importPlayers(gameId, players);
                    showMessage('success', `${players.length} jugadors importats correctament.`);
                } else {
                    showMessage('error', "No s'han trobat jugadors vàlids al CSV.");
                }
            } catch (err: any) {
                console.error("CSV Import Error:", err);
                showMessage('error', `Error important CSV: ${err.message}`);
            } finally {
                if (csvInputRef.current) csvInputRef.current.value = "";
            }
        };
        reader.readAsText(file);
    };
    
    // --- Backup Handlers ---
    
    const handleDownloadJSON = async () => {
        if (!gameId) return;
        try {
            const data = await getFullGameData(gameId);
            if (!data) return;
            
            const jsonString = JSON.stringify(data, null, 2);
            const blob = new Blob([jsonString], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            
            const now = new Date();
            const dateStr = now.toISOString().split('T')[0];
            const timeStr = now.toTimeString().split(' ')[0].replace(/:/g, '-');
            
            const a = document.createElement('a');
            a.href = url;
            a.download = `scrabble_game_${gameId}_R${data.currentRound}_${dateStr}_${timeStr}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (e) {
            console.error("Error downloading JSON:", e);
            showMessage('error', "Error generant la còpia de seguretat.");
        }
    };

    const handleDownloadEliot = () => {
        if (!gameState) return;
        try {
            const xmlString = generateEliotXML(gameState);
            const blob = new Blob([xmlString], { type: "text/xml" });
            const url = URL.createObjectURL(blob);
            
            const now = new Date();
            const dateStr = now.toISOString().split('T')[0];
            
            const a = document.createElement('a');
            a.href = url;
            a.download = `eliot_export_${gameId}_${dateStr}.xml`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (e) {
            console.error("Error generating Eliot XML:", e);
            showMessage('error', "Error generant el fitxer Eliot.");
        }
    };
    
    const handleUploadJSON = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !gameId) return;
        
        setConfirmation({
            message: "ATENCIÓ: Això sobreescriurà TOTALMENT l'estat actual de la partida amb les dades del fitxer JSON. N'estàs segur?",
            onConfirm: () => {
                setIsRestoring(true);
                setConfirmation(null);
                
                const reader = new FileReader();
                reader.onload = async (event) => {
                    try {
                        const jsonString = event.target?.result as string;
                        const data = JSON.parse(jsonString);
                        
                        if (!data.rounds || !data.board) {
                            throw new Error("L'estructura del JSON no és vàlid per a una partida.");
                        }
                        
                        await restoreGameData(gameId, data);
                        // alert("Partida restaurada correctament!"); // Removed alert
                        navigate(`/master?gameId=${gameId}`);
                    } catch (err: any) {
                        console.error("Error restoring JSON:", err);
                        showMessage('error', `Error restaurant la partida: ${err.message}`);
                    } finally {
                        setIsRestoring(false);
                        if (fileInputRef.current) fileInputRef.current.value = "";
                    }
                };
                reader.readAsText(file);
            },
            onCancel: () => {
                if (fileInputRef.current) fileInputRef.current.value = "";
                setConfirmation(null);
            }
        });
    };

    const handleUploadEliot = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !gameId) return;
        
        setConfirmation({
            message: "ATENCIÓ: Això sobreescriurà TOTALMENT l'estat actual de la partida amb les dades del fitxer Eliot XML. N'estàs segur?",
            onConfirm: () => {
                setIsRestoring(true);
                setConfirmation(null);
                
                const reader = new FileReader();
                reader.onload = async (event) => {
                    try {
                        const xmlString = event.target?.result;
                        if (typeof xmlString !== 'string') {
                             throw new Error("No s'ha pogut llegir el fitxer com a text.");
                        }
                        
                        await importEliotGame(gameId, xmlString);
                        navigate(`/master?gameId=${gameId}`);
                        
                    } catch (err: any) {
                        console.error("Error importing Eliot XML:", err);
                        showMessage('error', `Error important Eliot XML: ${err.message}`);
                    } finally {
                        setIsRestoring(false);
                        if (eliotInputRef.current) eliotInputRef.current.value = "";
                    }
                };
                
                reader.onerror = () => {
                    setIsRestoring(false);
                    showMessage('error', "Error llegint el fitxer.");
                    if (eliotInputRef.current) eliotInputRef.current.value = "";
                };

                reader.readAsText(file);
            },
            onCancel: () => {
                if (eliotInputRef.current) eliotInputRef.current.value = "";
                setConfirmation(null);
            }
        });
    };

    if(loading) return <div className="p-8 text-center text-gray-500">Carregant configuració...</div>;

    const participants = (Object.values(gameState?.participants || {}) as Participant[]).sort((a, b) => {
        const numA = parseInt(a.tableNumber) || 999;
        const numB = parseInt(b.tableNumber) || 999;
        return numA - numB;
    });

    return (
        <div className="min-h-screen bg-gray-100 sm:p-4 md:p-8 flex justify-center items-start sm:items-center">
            {/* Main Card: Full width/height on mobile, constrained card on desktop */}
            <div className="bg-white w-full max-w-3xl sm:rounded-xl shadow-lg overflow-hidden flex flex-col relative h-screen sm:h-auto sm:max-h-[90vh]">
                
                {/* UI Message Toast */}
                {uiMessage && (
                    <div className={`absolute top-16 left-1/2 transform -translate-x-1/2 px-6 py-3 rounded-lg shadow-xl z-50 text-white font-bold text-sm md:text-base w-[90%] text-center ${uiMessage.type === 'error' ? 'bg-red-600' : 'bg-green-600'}`}>
                        {uiMessage.text}
                    </div>
                )}

                {/* Header */}
                <div className="bg-gray-900 text-white p-4 sm:p-6 flex justify-between items-center shrink-0 sticky top-0 z-20">
                    <h1 className="text-xl md:text-2xl font-bold flex items-center gap-2">
                        <span>⚙️</span> Configuració
                    </h1>
                    <Link to={`/master?gameId=${gameId}`} className="text-gray-300 hover:text-white p-2">
                        <span className="text-2xl font-bold">✕</span>
                    </Link>
                </div>
                
                {/* Scrollable Content */}
                <div className="p-4 sm:p-6 overflow-y-auto space-y-6 sm:space-y-8 flex-grow bg-white">
                    
                    {/* --- Game Settings Section --- */}
                    <section className="space-y-4">
                        <h2 className="text-lg md:text-xl font-bold text-gray-800 border-b pb-2">Paràmetres de Partida</h2>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
                            <div className="space-y-2">
                                <label className="block font-bold text-gray-700 text-sm uppercase">Durada Ronda (s)</label>
                                <input 
                                    type="number" 
                                    value={timerDuration}
                                    onChange={(e) => setTimerDuration(e.target.value)}
                                    className="border-2 border-gray-300 p-3 rounded-lg w-full font-mono text-lg focus:border-indigo-500 outline-none"
                                />
                            </div>

                            <div className="space-y-2">
                                <label className="block font-bold text-gray-700 text-sm uppercase">Temps de Gràcia (s)</label>
                                <input 
                                    type="number" 
                                    value={gracePeriod}
                                    onChange={(e) => setGracePeriod(e.target.value)}
                                    className="border-2 border-gray-300 p-3 rounded-lg w-full font-mono text-lg focus:border-indigo-500 outline-none"
                                />
                            </div>
                            
                             <div className="space-y-2">
                                <label className="block font-bold text-gray-700 text-sm uppercase">Límit Millors Jugades</label>
                                <input 
                                    type="number" 
                                    value={bestMovesLimit}
                                    onChange={(e) => setBestMovesLimit(e.target.value)}
                                    className="border-2 border-gray-300 p-3 rounded-lg w-full font-mono text-lg focus:border-indigo-500 outline-none"
                                />
                            </div>

                            <div className="space-y-2">
                                <label className="block font-bold text-gray-700 text-sm uppercase">Nom del Jutge</label>
                                <input 
                                    type="text" 
                                    value={judgeName}
                                    onChange={(e) => setJudgeName(e.target.value)}
                                    className="border-2 border-gray-300 p-3 rounded-lg w-full text-lg focus:border-indigo-500 outline-none"
                                />
                            </div>

                            <div className="space-y-2 md:col-span-2">
                                <label className="block font-bold text-gray-700 text-sm uppercase">Diccionari</label>
                                <select
                                    value={dictionary}
                                    onChange={(e) => setDictionary(e.target.value)}
                                    className="border-2 border-gray-300 p-3 rounded-lg w-full text-lg focus:border-indigo-500 outline-none bg-white"
                                >
                                    {AVAILABLE_DICTIONARIES.map(d => (
                                        <option key={d.id} value={d.id}>{d.name}</option>
                                    ))}
                                </select>
                                <p className="text-xs text-gray-500 mt-1">Els fitxers JSON han d'estar a la carpeta <code>/dictionaries/</code>.</p>
                            </div>
                        </div>
                    </section>

                     {/* --- Developer Settings --- */}
                     <section className="space-y-4">
                        <h2 className="text-lg md:text-xl font-bold text-gray-800 border-b pb-2">Opcions per Desenvolupadors</h2>
                        <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                            <div className="flex items-center justify-between">
                                <div>
                                    <h3 className="font-bold text-slate-700">Depuració i Logs</h3>
                                    <p className="text-xs text-slate-500 mt-1">Habilitar la sortida de logs a la consola.</p>
                                    <p className="text-xs text-slate-500 mt-1">Desactivar per millorar rendiment.</p>
                                </div>
                                <button 
                                    onClick={handleToggleDebug}
                                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 ${debugMode ? 'bg-indigo-600' : 'bg-gray-200'}`}
                                >
                                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${debugMode ? 'translate-x-6' : 'translate-x-1'}`} />
                                </button>
                            </div>
                        </div>
                    </section>

                    {/* --- Backup & Data Section --- */}
                    <section className="space-y-4">
                         <h2 className="text-lg md:text-xl font-bold text-gray-800 border-b pb-2">Dades i Exportació</h2>
                         <div className="bg-blue-50 p-4 rounded-xl border border-blue-100">
                             <p className="text-sm text-blue-800 mb-4 font-medium">
                                 Opcions per guardar, restaurar i analitzar la partida.
                             </p>
                             {/* Flex column on mobile, row on desktop */}
                             <div className="flex flex-col sm:flex-row gap-3">
                                 {/* Backup JSON */}
                                 <button 
                                     onClick={handleDownloadJSON}
                                     className="flex items-center justify-center gap-2 bg-white border border-blue-200 text-blue-700 hover:bg-blue-100 px-4 py-3 rounded-lg font-bold shadow-sm transition-colors text-sm w-full sm:w-auto"
                                 >
                                     <span>💾</span> Còpia JSON
                                 </button>
                                 
                                 {/* Eliot Export */}
                                 <button 
                                     onClick={handleDownloadEliot}
                                     className="flex items-center justify-center gap-2 bg-white border border-teal-200 text-teal-700 hover:bg-teal-50 px-4 py-3 rounded-lg font-bold shadow-sm transition-colors text-sm w-full sm:w-auto"
                                     title="Exportar per analitzar amb Eliot"
                                 >
                                     <span>📊</span> Exp. Eliot
                                 </button>

                                 {/* Restore JSON */}
                                 <div className="w-full sm:w-auto">
                                     <input 
                                         type="file" 
                                         accept=".json"
                                         ref={fileInputRef}
                                         onChange={handleUploadJSON}
                                         className="hidden"
                                         id="upload-json"
                                     />
                                     <label 
                                         htmlFor="upload-json"
                                         className={`flex items-center justify-center gap-2 px-4 py-3 rounded-lg font-bold shadow-sm cursor-pointer transition-colors text-sm w-full ${isRestoring ? 'bg-gray-200 text-gray-500' : 'bg-amber-100 text-amber-800 hover:bg-amber-200 border border-amber-200'}`}
                                     >
                                         <span>📂</span> {isRestoring ? '...' : 'Imp. JSON'}
                                     </label>
                                 </div>
                                 
                                 {/* Import Eliot */}
                                 <div className="w-full sm:w-auto">
                                     <input 
                                         type="file" 
                                         accept=".xml"
                                         ref={eliotInputRef}
                                         onChange={handleUploadEliot}
                                         className="hidden"
                                         id="upload-eliot"
                                     />
                                     <label 
                                         htmlFor="upload-eliot"
                                         className={`flex items-center justify-center gap-2 px-4 py-3 rounded-lg font-bold shadow-sm cursor-pointer transition-colors text-sm w-full ${isRestoring ? 'bg-gray-200 text-gray-500' : 'bg-purple-100 text-purple-800 hover:bg-purple-200 border border-purple-200'}`}
                                     >
                                         <span>🔄</span> {isRestoring ? '...' : 'Imp. Eliot'}
                                     </label>
                                 </div>
                             </div>
                             
                             {/* Advanced Merge Section */}
                             <div className="mt-4 pt-4 border-t border-blue-200">
                                <h3 className="text-sm font-bold text-blue-800 mb-2">Fusionar Partides (Multi-Grup)</h3>
                                <div className="flex flex-col sm:flex-row gap-3 items-end">
                                    <div className="w-full sm:w-32">
                                        <label className="block text-xs font-bold text-gray-600 mb-1">Grup (1, 2...)</label>
                                        <input 
                                            type="number" 
                                            min="1" 
                                            defaultValue="1"
                                            id="merge-group-num"
                                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                                        />
                                    </div>
                                    <div className="w-full sm:w-auto flex items-center mb-2">
                                        <input type="checkbox" id="merge-mode" className="mr-2 h-4 w-4" />
                                        <label htmlFor="merge-mode" className="text-sm text-gray-700">Fusionar (no esborrar)</label>
                                    </div>
                                    <div className="w-full sm:w-auto">
                                        <input 
                                            type="file" 
                                            accept=".xml"
                                            className="hidden"
                                            id="upload-eliot-merge"
                                            onChange={(e) => {
                                                const file = e.target.files?.[0];
                                                const groupInput = document.getElementById('merge-group-num') as HTMLInputElement;
                                                const mergeInput = document.getElementById('merge-mode') as HTMLInputElement;
                                                
                                                if (!file || !gameId || !groupInput) return;
                                                
                                                const groupNum = parseInt(groupInput.value) || 1;
                                                const isMerge = mergeInput.checked;

                                                setConfirmation({
                                                    message: isMerge 
                                                        ? `Vols FUSIONAR el fitxer com a GRUP ${groupNum}? S'afegiran els jugadors amb taules ${groupNum}01, ${groupNum}02...`
                                                        : `ATENCIÓ: Vols SOBREESCRIURE la partida amb el fitxer com a GRUP ${groupNum}? Es perdran les dades actuals.`,
                                                    onConfirm: () => {
                                                        setIsRestoring(true);
                                                        setConfirmation(null);
                                                        
                                                        const reader = new FileReader();
                                                        reader.onload = async (event) => {
                                                            try {
                                                                const xmlString = event.target?.result;
                                                                if (typeof xmlString !== 'string') throw new Error("Error llegint fitxer");
                                                                
                                                                await importEliotGameAsGroup(gameId, xmlString, groupNum, isMerge);
                                                                showMessage('success', `Partida ${isMerge ? 'fusionada' : 'importada'} correctament (Grup ${groupNum})`);
                                                                if (!isMerge) navigate(`/master?gameId=${gameId}`);
                                                            } catch (err: any) {
                                                                console.error("Error merging:", err);
                                                                showMessage('error', `Error: ${err.message}`);
                                                            } finally {
                                                                setIsRestoring(false);
                                                                e.target.value = ""; // Reset input
                                                            }
                                                        };
                                                        reader.readAsText(file);
                                                    },
                                                    onCancel: () => {
                                                        e.target.value = "";
                                                        setConfirmation(null);
                                                    }
                                                });
                                            }}
                                        />
                                        <label 
                                            htmlFor="upload-eliot-merge"
                                            className="flex items-center justify-center gap-2 px-4 py-2 bg-indigo-100 text-indigo-800 hover:bg-indigo-200 border border-indigo-200 rounded-lg font-bold shadow-sm cursor-pointer transition-colors text-sm w-full"
                                        >
                                            <span>⚡</span> Importar Grup
                                        </label>
                                    </div>
                                </div>
                             </div>
                         </div>
                    </section>

                    {/* --- Player Management Section --- */}
                    <section className="space-y-4">
                        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center border-b pb-2 gap-2">
                            <h2 className="text-lg md:text-xl font-bold text-gray-800">Jugadors ({participants.length})</h2>
                            <div className="flex gap-2 w-full sm:w-auto">
                                {/* CSV Upload */}
                                <div className="relative flex-1 sm:flex-none">
                                    <input 
                                        type="file" 
                                        accept=".csv"
                                        ref={csvInputRef}
                                        onChange={handleUploadPlayersCSV}
                                        className="hidden"
                                        id="upload-csv"
                                    />
                                    <label 
                                        htmlFor="upload-csv"
                                        className="flex items-center justify-center gap-2 bg-gray-100 hover:bg-gray-200 text-gray-700 border border-gray-300 px-3 py-2 rounded-lg text-sm font-bold cursor-pointer h-full"
                                        title="Format: Taula, Nom, [Grup]"
                                    >
                                        <span>📄</span> CSV
                                    </label>
                                </div>

                                <button 
                                    onClick={openAddPlayer}
                                    className="flex-1 sm:flex-none bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg text-sm font-bold shadow-sm"
                                >
                                    + Nou Jugador
                                </button>
                            </div>
                        </div>
                        
                        <div className="bg-gray-50 rounded-xl border border-gray-200 overflow-hidden max-h-64 sm:max-h-80 overflow-y-auto">
                            <table className="w-full text-left text-sm">
                                <thead className="bg-gray-100 text-gray-600 uppercase text-xs font-bold sticky top-0 z-10 shadow-sm">
                                    <tr>
                                        <th className="p-3 w-16 text-center">T.</th>
                                        <th className="p-3">Nom</th>
                                        <th className="p-3 w-16 text-center">Gr.</th>
                                        <th className="p-3 text-right">Accions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-200 bg-white">
                                    {participants.length === 0 ? (
                                        <tr><td colSpan={4} className="p-6 text-center text-gray-400 italic">Cap jugador registrat.</td></tr>
                                    ) : (
                                        participants.map(p => (
                                            <tr key={p.id} className="hover:bg-gray-50">
                                                <td className="p-3 font-mono font-bold text-gray-700 text-center">{p.tableNumber}</td>
                                                <td className="p-3 font-bold text-slate-800 truncate max-w-[120px] sm:max-w-none">{p.name}</td>
                                                <td className="p-3 text-slate-500 text-xs text-center font-mono">{p.group || '-'}</td>
                                                <td className="p-3 text-right space-x-1 whitespace-nowrap">
                                                    <button onClick={() => openEditPlayer(p)} className="text-indigo-600 hover:text-indigo-800 bg-indigo-50 p-2 rounded-lg font-bold text-xs">✏️</button>
                                                    <button onClick={() => handleDeletePlayer(p.id)} className="text-red-500 hover:text-red-700 bg-red-50 p-2 rounded-lg font-bold text-xs">🗑️</button>
                                                </td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </section>

                    {/* --- Danger Zone --- */}
                    <section className="pt-6 border-t border-gray-200 space-y-4 pb-20 sm:pb-0">
                         <h3 className="text-red-800 font-black uppercase text-xs tracking-widest"> Zona de Perill </h3>
                         
                         {/* Delete Last Round */}
                         <div className="bg-amber-50 p-4 rounded-xl border border-amber-200 flex flex-col sm:flex-row justify-between items-center gap-4">
                            <div className="text-center sm:text-left">
                                <h4 className="text-amber-900 font-bold">Esborra Darrera Ronda ({gameState?.round})</h4>
                                <p className="text-amber-700 text-xs mt-1">Si hi ha hagut un error, esborra la ronda actual i torna a l'anterior.</p>
                            </div>
                            <div className="flex items-center gap-2 w-full sm:w-auto">
                                {deleteRoundStep === 1 && (
                                    <button 
                                        onClick={() => setDeleteRoundStep(0)} 
                                        className="flex-1 sm:flex-none py-3 px-4 text-gray-600 font-bold bg-white border border-gray-300 rounded-lg text-sm"
                                    >
                                        No
                                    </button>
                                )}
                                <button 
                                    onClick={handleDeleteLastRound}
                                    disabled={gameState?.round <= 1}
                                    className={`flex-1 sm:flex-none text-white px-4 py-3 rounded-lg font-bold text-sm transition-all shadow-sm whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed
                                        ${deleteRoundStep === 1 ? 'bg-red-600 animate-pulse' : 'bg-amber-500 hover:bg-amber-600'}
                                    `}
                                >
                                    {deleteRoundStep === 1 ? 'CONFIRMA ESBORRAT' : 'Esborra Ronda'}
                                </button>
                            </div>
                        </div>

                         {/* Reset Game */}
                         <div className="bg-red-50 p-4 rounded-xl border border-red-200 flex flex-col sm:flex-row justify-between items-center gap-4">
                            <div className="text-center sm:text-left">
                                <h4 className="text-red-900 font-bold">Reinicia Partida</h4>
                                <p className="text-red-700 text-xs mt-1">Esborra la partida completament i totes les dades associades.</p>
                            </div>
                            <div className="flex items-center gap-2 w-full sm:w-auto">
                                {deleteStep === 1 && (
                                    <button 
                                        onClick={() => setDeleteStep(0)} 
                                        className="flex-1 sm:flex-none py-3 px-4 text-gray-600 font-bold bg-white border border-gray-300 rounded-lg text-sm"
                                    >
                                        No
                                    </button>
                                )}
                                <button 
                                    onClick={handleReset}
                                    className={`flex-1 sm:flex-none text-white px-4 py-3 rounded-lg font-bold text-sm transition-all shadow-sm whitespace-nowrap
                                        ${deleteStep === 1 ? 'bg-red-700 animate-pulse' : 'bg-red-600 hover:bg-red-700'}
                                    `}
                                >
                                    {deleteStep === 1 ? 'SEGUR? ESBORRA TOT' : 'Esborra Partida'}
                                </button>
                            </div>
                        </div>
                    </section>
                </div>

                {/* Footer Actions */}
                <div className="bg-gray-50 p-4 border-t border-gray-200 flex flex-col sm:flex-row justify-end gap-3 shrink-0">
                    <Link to={`/master?gameId=${gameId}`} className="order-2 sm:order-1 w-full sm:w-auto px-6 py-3 text-gray-600 font-bold bg-white border border-gray-300 hover:bg-gray-100 rounded-xl text-center text-sm">
                        Cancel·la
                    </Link>
                    <button onClick={handleSave} className="order-1 sm:order-2 w-full sm:w-auto px-8 py-3 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 shadow-lg text-sm">
                        Guarda i Surt
                    </button>
                </div>
            </div>

            {/* Player Modal */}
            {showPlayerModal && (
                <div className="fixed inset-0 bg-black/70 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 backdrop-blur-sm">
                    <div className="bg-white w-full sm:w-full max-w-md rounded-t-2xl sm:rounded-xl shadow-2xl p-6 space-y-5 animate-slide-up sm:animate-zoom-in">
                        <div className="flex justify-between items-center border-b pb-3">
                             <h3 className="text-xl font-black text-gray-800 uppercase">
                                {editingParticipant ? 'Editar Jugador' : 'Nou Jugador'}
                            </h3>
                            <button onClick={() => setShowPlayerModal(false)} className="text-gray-400 hover:text-gray-600 text-2xl font-bold">✕</button>
                        </div>
                        
                        <div className="space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Número de Taula</label>
                                <input 
                                    type="number" 
                                    value={pTable}
                                    onChange={(e) => setPTable(e.target.value)}
                                    className="w-full p-4 border-2 border-gray-200 rounded-xl font-bold text-2xl text-center focus:border-indigo-500 outline-none text-indigo-900"
                                    placeholder="Ex: 5"
                                    autoFocus
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Nom del Jugador</label>
                                <input 
                                    type="text" 
                                    value={pName}
                                    onChange={(e) => setPName(e.target.value)}
                                    className="w-full p-3 border-2 border-gray-200 rounded-xl font-bold text-lg focus:border-indigo-500 outline-none"
                                    placeholder="Nom..."
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Grup (Opcional)</label>
                                <input 
                                    type="text" 
                                    value={pGroup}
                                    onChange={(e) => setPGroup(e.target.value.toUpperCase())}
                                    className="w-full p-3 border-2 border-gray-200 rounded-xl font-bold text-lg focus:border-indigo-500 outline-none"
                                    placeholder="A, B, C..."
                                />
                            </div>
                        </div>

                        <div className="flex gap-3 pt-2">
                            <button 
                                onClick={() => setShowPlayerModal(false)}
                                className="flex-1 py-4 rounded-xl font-bold text-gray-600 bg-gray-100 hover:bg-gray-200"
                            >
                                Cancel·la
                            </button>
                            <button 
                                onClick={handleSavePlayer}
                                disabled={!pName || !pTable}
                                className="flex-1 py-4 rounded-xl font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 shadow-lg"
                            >
                                Guarda
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* CUSTOM CONFIRMATION MODAL */}
            {confirmation && (
                <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="bg-white rounded-xl shadow-2xl p-6 max-w-sm w-full space-y-6 transform scale-100 transition-transform">
                        <div className="flex items-center gap-3 text-amber-600">
                            <span className="text-3xl">⚠️</span>
                            <h3 className="text-xl font-black text-gray-800">Atenció</h3>
                        </div>
                        <p className="text-gray-600 font-medium text-lg leading-relaxed">
                            {confirmation.message}
                        </p>
                        <div className="flex gap-3 justify-end pt-2 flex-col sm:flex-row">
                            <button 
                                onClick={confirmation.onCancel}
                                className="w-full sm:w-auto px-6 py-3 rounded-lg font-bold text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors"
                            >
                                Cancel·la
                            </button>
                            <button 
                                onClick={confirmation.onConfirm}
                                className="w-full sm:w-auto px-6 py-3 rounded-lg font-bold text-white bg-red-600 hover:bg-red-700 shadow-md transition-colors"
                            >
                                Confirma
                            </button>
                        </div>
                    </div>
                </div>
            )}

        </div>
    );
};

export default SettingsView;