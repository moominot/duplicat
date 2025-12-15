
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createNewGame, getPublicGames } from '../services/gameService';

const LobbyView: React.FC = () => {
  const navigate = useNavigate();
  const [games, setGames] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [hostName, setHostName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [helpTab, setHelpTab] = useState<'intro' | 'manual' | 'config' | 'faq'>('intro');

  useEffect(() => {
    loadGames();
  }, []);

  const loadGames = async () => {
    setLoading(true);
    try {
        const list = await getPublicGames();
        setGames(list);
    } catch (e) {
        console.error("Error carregant partides:", e);
    } finally {
        setLoading(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hostName) return;
    
    setIsCreating(true);
    setErrorMsg(null);

    try {
        const gameId = await createNewGame(hostName);
        navigate(`/master?gameId=${gameId}`);
    } catch (error: any) {
        console.error("Error detallat:", error);
        let msg = "Error desconegut creant la partida.";
        
        if (error.code === 'PERMISSION_DENIED') {
            msg = "PERMÍS DENEGAT: Comprova les 'Rules' a Firebase Console. Han de ser '.read': true, '.write': true.";
        } else if (error.message) {
            msg = `Error: ${error.message}`;
        }
        
        setErrorMsg(msg);
    } finally {
        setIsCreating(false);
    }
  };

  const joinGame = (gameId: string, role: 'player' | 'master' | 'projector') => {
      navigate(`/${role}?gameId=${gameId}`);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans selection:bg-indigo-100 selection:text-indigo-700">
      
      {/* Navbar simple */}
      <nav className="w-full p-4 flex justify-end max-w-6xl mx-auto">
          <button 
            onClick={() => setShowHelp(true)}
            className="flex items-center gap-2 text-slate-500 hover:text-indigo-600 font-medium transition-colors px-4 py-2 rounded-full hover:bg-white hover:shadow-sm"
          >
            <span className="text-xl">?</span> Ajuda i Manual
          </button>
      </nav>

      <div className="max-w-5xl mx-auto px-4 pb-12 space-y-12">
        
        {/* Header Elegant */}
        <div className="text-center space-y-6 pt-4">
            <div className="inline-block relative">
                <h1 className="text-5xl md:text-7xl font-black tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-slate-800 via-indigo-800 to-slate-800 mb-2">
                    Scrabble DupliCat
                </h1>
                <div className="h-1.5 w-24 bg-indigo-500 mx-auto rounded-full opacity-80"></div>
            </div>
            <p className="text-slate-500 text-lg md:text-xl font-light tracking-wide max-w-2xl mx-auto">
                Plataforma de gestió de partides de Scrabble en modalitat Duplicada.
                <br/><span className="text-sm text-slate-400">Dissenyat per a clubs i competicions.</span>
            </p>
        </div>

        <div className="grid md:grid-cols-12 gap-8 items-start">
            
            {/* COLUMNA ESQUERRA: Partides Actives (8/12) */}
            <div className="md:col-span-7 lg:col-span-8 space-y-6">
                <div className="flex justify-between items-center px-2">
                    <h2 className="text-2xl font-bold text-slate-700 flex items-center gap-2">
                        <span className="text-3xl">🌍</span> Partides en Curs
                    </h2>
                    <button 
                        onClick={loadGames} 
                        className="text-xs font-bold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-full transition-colors flex items-center gap-1"
                    >
                        ↻ Actualitzar
                    </button>
                </div>

                {loading ? (
                    <div className="bg-white rounded-2xl p-12 border border-slate-100 shadow-xl text-center">
                        <div className="inline-block w-8 h-8 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin mb-4"></div>
                        <p className="text-slate-400 font-medium">Cercant partides...</p>
                    </div>
                ) : games.length === 0 ? (
                    <div className="bg-white rounded-2xl p-12 border border-slate-100 shadow-xl text-center">
                        <div className="text-6xl mb-4">📭</div>
                        <p className="text-slate-600 text-lg font-medium">No hi ha partides actives.</p>
                        <p className="text-slate-400 text-sm mt-2">Utilitza el formulari de la dreta per crear-ne una!</p>
                    </div>
                ) : (
                    <div className="space-y-4">
                        {games.map((g) => (
                            <div key={g.id} className="bg-white p-6 rounded-2xl border border-slate-200 shadow-lg hover:shadow-xl transition-all duration-300 transform hover:-translate-y-1 group">
                                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 border-b border-slate-100 pb-4">
                                    <div>
                                        <div className="font-black text-xl text-slate-800 group-hover:text-indigo-700 transition-colors">
                                            {g.host}
                                        </div>
                                        <div className="text-xs font-medium text-slate-400 uppercase tracking-wider mt-1">
                                            ID: {g.id.substring(0,8)}...
                                        </div>
                                    </div>
                                    <div className="mt-2 sm:mt-0 flex items-center gap-3">
                                        <span className="bg-indigo-50 text-indigo-700 px-3 py-1 rounded-lg text-sm font-bold border border-indigo-100">
                                            Ronda {g.round}
                                        </span>
                                        <span className="text-xs text-slate-400 font-mono">
                                            {new Date(g.createdAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                                        </span>
                                    </div>
                                </div>
                                
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    {/* Primary Action: PLAY */}
                                    <button 
                                        onClick={() => joinGame(g.id, 'player')}
                                        className="col-span-1 sm:col-span-2 bg-indigo-600 hover:bg-indigo-700 text-white py-4 px-6 rounded-xl font-bold text-lg shadow-md hover:shadow-lg transition-all flex items-center justify-center gap-3 active:scale-95"
                                    >
                                        <span>🎮</span> ENTRAR COM A JUGADOR
                                    </button>

                                    {/* Secondary Actions */}
                                    <button 
                                        onClick={() => joinGame(g.id, 'projector')}
                                        className="bg-white hover:bg-emerald-50 text-slate-600 hover:text-emerald-700 border-2 border-slate-200 hover:border-emerald-300 py-3 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2"
                                    >
                                        <span>📺</span> Projector (Sala)
                                    </button>
                                    <button 
                                        onClick={() => joinGame(g.id, 'master')}
                                        className="bg-white hover:bg-amber-50 text-slate-400 hover:text-amber-700 border-2 border-slate-100 hover:border-amber-300 py-3 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2"
                                        title="Només per a l'organitzador"
                                    >
                                        <span>👑</span> Panell del Màster
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* COLUMNA DRETA: Crear Partida (4/12) */}
            <div className="md:col-span-5 lg:col-span-4 sticky top-8">
                <div className="bg-white rounded-2xl p-6 border border-slate-100 shadow-xl">
                    <h2 className="text-xl font-bold mb-4 flex items-center gap-2 text-slate-800 border-b pb-4 border-slate-100">
                        <span>🚀</span> Crear Nova Partida
                    </h2>
                    <form onSubmit={handleCreate} className="space-y-4">
                        <div>
                            <label className="block text-xs font-bold text-slate-500 mb-1 uppercase tracking-wide">Organitzador / Club</label>
                            <input 
                                type="text" 
                                value={hostName}
                                onChange={(e) => setHostName(e.target.value)}
                                placeholder="Ex: Club Scrabble..."
                                className="w-full p-3 bg-slate-50 border-2 border-slate-200 rounded-xl text-slate-800 font-bold focus:ring-4 focus:ring-indigo-100 focus:border-indigo-500 outline-none transition-all placeholder:font-normal"
                                required
                            />
                        </div>

                        {errorMsg && (
                            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-xs font-bold">
                                {errorMsg}
                            </div>
                        )}

                        <button 
                            type="submit" 
                            disabled={isCreating || !hostName}
                            className="w-full py-4 bg-slate-900 hover:bg-slate-800 text-white font-bold text-base rounded-xl shadow-lg transform active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex justify-center items-center gap-2"
                        >
                            {isCreating ? 'Creant...' : 'CREAR I ENTRAR'} 
                            {!isCreating && <span>→</span>}
                        </button>
                        
                        <p className="text-[10px] text-slate-400 text-center leading-tight px-4">
                            En crear la partida entraràs automàticament com a Màster per configurar-la.
                        </p>
                    </form>
                </div>

                {/* Mini Footer */}
                <div className="mt-8 text-center">
                    <p className="text-xs text-slate-400">
                        Scrabble DupliCat v2.0
                        <br/>Desenvolupat per a la comunitat.
                    </p>
                </div>
            </div>
        </div>
      </div>

      {/* MODAL D'AJUDA */}
      {showHelp && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
              <div className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
                  
                  {/* Modal Header */}
                  <div className="bg-slate-900 text-white p-5 flex justify-between items-center shrink-0">
                      <h2 className="text-xl font-bold flex items-center gap-2">
                          <span>📚</span> Guia d'Ús
                      </h2>
                      <button onClick={() => setShowHelp(false)} className="text-slate-400 hover:text-white transition-colors text-2xl leading-none">
                          &times;
                      </button>
                  </div>

                  {/* Tabs */}
                  <div className="flex border-b border-slate-200 bg-slate-50 shrink-0">
                      <button 
                        onClick={() => setHelpTab('intro')}
                        className={`flex-1 py-3 text-sm font-bold uppercase tracking-wide transition-colors ${helpTab === 'intro' ? 'bg-white text-indigo-600 border-b-2 border-indigo-600' : 'text-slate-500 hover:text-slate-700'}`}
                      >
                          Propòsit
                      </button>
                      <button 
                        onClick={() => setHelpTab('manual')}
                        className={`flex-1 py-3 text-sm font-bold uppercase tracking-wide transition-colors ${helpTab === 'manual' ? 'bg-white text-indigo-600 border-b-2 border-indigo-600' : 'text-slate-500 hover:text-slate-700'}`}
                      >
                          Manual
                      </button>
                       <button 
                        onClick={() => setHelpTab('config')}
                        className={`flex-1 py-3 text-sm font-bold uppercase tracking-wide transition-colors ${helpTab === 'config' ? 'bg-white text-indigo-600 border-b-2 border-indigo-600' : 'text-slate-500 hover:text-slate-700'}`}
                      >
                          Configuració
                      </button>
                      <button 
                        onClick={() => setHelpTab('faq')}
                        className={`flex-1 py-3 text-sm font-bold uppercase tracking-wide transition-colors ${helpTab === 'faq' ? 'bg-white text-indigo-600 border-b-2 border-indigo-600' : 'text-slate-500 hover:text-slate-700'}`}
                      >
                          FAQ
                      </button>
                  </div>

                  {/* Modal Content (Scrollable) */}
                  <div className="p-6 overflow-y-auto text-slate-600 space-y-4 text-sm leading-relaxed">
                      
                      {helpTab === 'intro' && (
                          <div className="space-y-4">
                              <p className="text-lg font-medium text-slate-800">Què és Scrabble DupliCat?</p>
                              <p>
                                  És una aplicació web dissenyada per gestionar partides de <strong>Scrabble en modalitat Duplicada</strong> de manera centralitzada i en temps real.
                              </p>
                              <p>
                                  A la modalitat duplicada, tots els jugadors juguen amb les <strong>mateixes lletres</strong> i el mateix tauler. L'objectiu és trobar la millor jugada possible a cada torn. Quan s'acaba el temps, s'aplica la "Jugada Mestra" (la millor trobada) al tauler de tots, i es continua des d'allà.
                              </p>
                              <div className="bg-indigo-50 p-4 rounded-xl border border-indigo-100 mt-4">
                                  <h4 className="font-bold text-indigo-800 mb-2">Característiques Clau:</h4>
                                  <ul className="list-disc list-inside space-y-1 text-indigo-700">
                                      <li>Validació automàtica amb diccionari <strong>DISC</strong>.</li>
                                      <li>Càlcul de puntuacions automàtic.</li>
                                      <li>Vista de Projector per a la sala.</li>
                                      <li>Suport per a dígrafs catalans (L·L, NY, etc).</li>
                                  </ul>
                              </div>
                          </div>
                      )}

                      {helpTab === 'manual' && (
                          <div className="space-y-6">
                              <section>
                                  <h3 className="font-bold text-slate-900 border-b pb-1 mb-2">🎮 Jugador</h3>
                                  <ul className="list-disc list-inside space-y-1 pl-2">
                                      <li>Entra a la partida amb el teu nom i número de taula.</li>
                                      <li>Quan el rellotge estigui en marxa, escriu la teva jugada, selecciona coordenades i envia.</li>
                                      <li>Pots fer clic a les fitxes de la previsualització per marcar <strong>Escarrassos (?)</strong>.</li>
                                  </ul>
                              </section>
                              <section>
                                  <h3 className="font-bold text-slate-900 border-b pb-1 mb-2">👑 Màster (Jutge)</h3>
                                  <ul className="list-disc list-inside space-y-1 pl-2">
                                      <li>Controla el rellotge de la partida (Iniciar/Pausar/Reset).</li>
                                      <li>Introdueix el faristol manualment o genera'l aleatòriament.</li>
                                      <li>Revisa les jugades enviades pels jugadors.</li>
                                      <li>Selecciona la <strong>Jugada Mestra</strong> per avançar a la següent ronda.</li>
                                      <li>Permet gestionar la partida només des de la posició de màster i assignar jugades als participants.</li>
                                      <li>El màster pot introduir i corregir jugades de rondes anteriors ja tancades.</li>
                                      <li>Les jugades introduides pel màster no tenen limitació de temps.</li>
                                  </ul>
                              </section>
                              <section>
                                  <h3 className="font-bold text-slate-900 border-b pb-1 mb-2">📺 Projector</h3>
                                  <ul className="list-disc list-inside space-y-1 pl-2">
                                      <li>Mostra el tauler, el rellotge i el faristol a la sala.</li>
                                      <li>A les pauses, mostra la jugada mestra anterior i la classificació.</li>
                                      <li>Dissenyat per ser projectat en pantalla gran.</li>
                                  </ul>
                              </section>
                          </div>
                      )}

                      {helpTab === 'config' && (
                          <div className="space-y-6">
                              <section>
                                  <h3 className="font-bold text-slate-900 border-b pb-1 mb-2">⚙️ Paràmetres</h3>
                                  <ul className="list-disc list-inside space-y-1 pl-2">
                                      <li><strong>Durada Ronda:</strong> Temps en segons per a cada torn.</li>
                                      <li><strong>Temps de Gràcia:</strong> Segons extra abans de marcar "fora de temps".</li>
                                      <li><strong>Límit Millors Jugades:</strong> Quantes jugades de la màquina es mostren al màster.</li>
                                  </ul>
                              </section>
                              <section>
                                  <h3 className="font-bold text-slate-900 border-b pb-1 mb-2">👥 Gestió de Jugadors</h3>
                                  <ul className="list-disc list-inside space-y-1 pl-2">
                                      <li><strong>Afegir/Editar:</strong> Pots registrar jugadors manualment durant la partida.</li>
                                      <li><strong>Importar CSV:</strong> Carrega una llista de jugadors. Format: <code className="bg-gray-100 px-1 rounded">Taula, Nom, [Grup]</code> (El grup és opcional).</li>
                                  </ul>
                              </section>
                              <section>
                                  <h3 className="font-bold text-slate-900 border-b pb-1 mb-2">💾 Dades i Còpies</h3>
                                  <ul className="list-disc list-inside space-y-1 pl-2">
                                      <li><strong>Còpia JSON:</strong> Descarrega l'estat complet de la partida per seguretat.</li>
                                      <li><strong>Exp. Eliot:</strong> Exporta la partida en format XML compatible amb Eliot per a l'anàlisi.</li>
                                      <li><strong>Importar:</strong> Permet restaurar una partida des d'un fitxer JSON o XML d'Eliot.</li>
                                  </ul>
                              </section>
                              <section>
                                  <h3 className="font-bold text-red-800 border-b border-red-200 pb-1 mb-2">⚠️ Zona de Perill</h3>
                                  <ul className="list-disc list-inside space-y-1 pl-2">
                                      <li><strong>Esborra Ronda:</strong> Elimina l'última ronda jugada i torna a l'estat anterior (útil si hi ha hagut un error en la jugada mestra).</li>
                                      <li><strong>Reinicia:</strong> Esborra totes les dades de la partida actual permanentment.</li>
                                  </ul>
                              </section>
                          </div>
                      )}

                      {helpTab === 'faq' && (
                           <div className="space-y-4">
                               <div className="bg-slate-50 p-3 rounded-lg">
                                   <p className="font-bold text-slate-800">P: Com s'introdueixen els Escarrassos?</p>
                                   <p>R: Escriu la lletra que representa l'escarràs i, a la previsualització de fitxes, fes clic a sobre d'ella. Es marcarà amb una vora verda.</p>
                               </div>
                               <div className="bg-slate-50 p-3 rounded-lg">
                                   <p className="font-bold text-slate-800">P: Què passa si m'equivoco de jugada?</p>
                                   <p>R: Si el temps no s'ha acabat, pots tornar a enviar una nova jugada. L'aplicació es quedarà amb l'última enviada.</p>
                               </div>
                               <div className="bg-slate-50 p-3 rounded-lg">
                                   <p className="font-bold text-slate-800">P: Com funciona la puntuació?</p>
                                   <p>R: La teva puntuació és la suma dels punts de les teves jugades vàlides. Si la teva jugada és invàlida o fora de temps, sumes 0 punts en aquella ronda.</p>
                               </div>
                               <div className="bg-slate-50 p-3 rounded-lg">
                                   <p className="font-bold text-slate-800">P: Puc recuperar una partida tancada?</p>
                                   <p>R: Sí, l'aplicació guarda l'estat al servidor. Si tornes a entrar com a Màster, la partida continuarà on es va deixar.</p>
                               </div>
                           </div>
                      )}
                  </div>
                  
                  {/* Modal Footer */}
                  <div className="p-4 bg-slate-50 border-t border-slate-200 text-right shrink-0">
                      <button 
                          onClick={() => setShowHelp(false)}
                          className="bg-slate-800 hover:bg-slate-700 text-white px-6 py-2 rounded-lg font-bold transition-colors"
                      >
                          Entesos
                      </button>
                  </div>
              </div>
          </div>
      )}
    </div>
  );
};

export default LobbyView;
