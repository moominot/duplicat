import React, { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { createNewGame, getPublicGames, getGamesByMaster } from '../services/gameService';
import { getAuth, onAuthStateChanged, User } from 'firebase/auth';
import { getDatabase, ref, get } from 'firebase/database';
import { signOut } from 'firebase/auth';

const NewLobbyView: React.FC = () => {
  const navigate = useNavigate();
  const [games, setGames] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [hostName, setHostName] = useState('');
  const [isPublic, setIsPublic] = useState(true); // <-- NOU ESTAT
  const [isCreating, setIsCreating] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [helpTab, setHelpTab] = useState<'intro' | 'manual' | 'config' | 'faq'>('intro');
  const [user, setUser] = useState<User | null>(null);
  const [userRole, setUserRole] = useState<string | null>(null);

  useEffect(() => {
    const auth = getAuth();
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        setUser(user);
        const db = getDatabase();
        const userRoleRef = ref(db, `masters/${user.uid}/role`);
        const snapshot = await get(userRoleRef);
        if (snapshot.exists()) {
          const role = snapshot.val();
          setUserRole(role);
          loadGames(role, user.uid);
        } else {
          loadGames('user', null);
        }
      } else {
        navigate('/auth');
      }
    });
    return () => unsubscribe();
  }, [navigate]);

  const loadGames = async (role: string, uid: string | null) => {
    setLoading(true);
    try {
      let list;
      if ((role === 'master' ) && uid) {
        list = await getGamesByMaster(uid);
      } else {
        list = await getPublicGames();
      }
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
      if(user) {
        // Passem el nou estat 'isPublic' a la funció de creació
        const gameId = await createNewGame(hostName, user.uid, isPublic);
        navigate(`/master?gameId=${gameId}`);
      }
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
  
  const handleLogout = async () => {
    const auth = getAuth();
    try {
        await signOut(auth);
        navigate('/');
    } catch (error) {
        console.error("Error durant el tancament de sessió:", error);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans selection:bg-indigo-100 selection:text-indigo-700">
      
      <nav className="w-full p-4 flex justify-between items-center max-w-6xl mx-auto">
          {user && (
            <div className="flex items-center gap-3 bg-white px-4 py-2 rounded-full shadow-sm border border-slate-100">
                <span className="text-xl">{userRole === 'superuser' ? '👑' : (userRole === 'master' ? '🧑‍🏫' : '👤')}</span>
                <span className="font-bold text-slate-700 text-sm">{user.displayName || user.email}</span>
            </div>
          )}
          <div className="flex items-center">
            <button 
              onClick={() => setShowHelp(true)}
              className="flex items-center gap-2 text-slate-500 hover:text-indigo-600 font-medium transition-colors px-4 py-2 rounded-full hover:bg-white hover:shadow-sm"
            >
              <span className="text-xl">?</span> Ajuda
            </button>
            {user && (
              <button 
                onClick={handleLogout}
                className="flex items-center gap-2 text-slate-500 hover:text-indigo-600 font-medium transition-colors px-4 py-2 rounded-full hover:bg-white hover:shadow-sm"
              >
                Tancar Sessió
              </button>
            )}
          </div>
      </nav>

      <div className="max-w-5xl mx-auto px-4 pb-12 space-y-12">
        
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
            
            <div className="md:col-span-7 lg:col-span-8 space-y-6">
                <div className="flex justify-between items-center px-2">
                    <h2 className="text-2xl font-bold text-slate-700 flex items-center gap-2">
                        <span className="text-3xl">🌍</span>
                        {userRole === 'master' ? 'Les Teves Partides' : 'Partides Públiques en Curs'}
                    </h2>
                    <button 
                        onClick={() => user && loadGames(userRole || 'user', user.uid)} 
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
                        <p className="text-slate-400 text-sm mt-2">Crea una partida nova per començar.</p>
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
                                    <button 
                                        onClick={() => joinGame(g.id, 'player')}
                                        className="col-span-1 sm:col-span-2 bg-indigo-600 hover:bg-indigo-700 text-white py-4 px-6 rounded-xl font-bold text-lg shadow-md hover:shadow-lg transition-all flex items-center justify-center gap-3 active:scale-95"
                                    >
                                        <span>🎮</span> ENTRAR COM A JUGADOR
                                    </button>

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

            <div className="md:col-span-5 lg:col-span-4 sticky top-8">
                {(userRole === 'master' || userRole === 'superuser') ? (
                <div className="bg-white rounded-2xl p-6 border border-slate-100 shadow-xl">
                    <h2 className="text-xl font-bold mb-4 flex items-center gap-2 text-slate-800 border-b pb-4 border-slate-100">
                        <span>🚀</span> Crear Nova Partida
                    </h2>
                    <form onSubmit={handleCreate} className="space-y-6">
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

                        {/* ----- NOU INTERRUPTOR DE VISIBILITAT ----- */}
                        <div>
                            <label className="block text-xs font-bold text-slate-500 mb-2 uppercase tracking-wide">Visibilitat</label>
                            <div className="flex items-center justify-between bg-slate-50 p-2 rounded-xl border-2 border-slate-200">
                                <span className={`px-2 text-sm font-bold transition-colors ${!isPublic ? 'text-indigo-600' : 'text-slate-400'}`}>Privada</span>
                                <button
                                    type="button"
                                    onClick={() => setIsPublic(!isPublic)}
                                    className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 ${isPublic ? 'bg-indigo-600' : 'bg-slate-300'}`}
                                >
                                    <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${isPublic ? 'translate-x-5' : 'translate-x-0'}`}/>
                                </button>
                                <span className={`px-2 text-sm font-bold transition-colors ${isPublic ? 'text-indigo-600' : 'text-slate-400'}`}>Pública</span>
                            </div>
                            <p className="text-[11px] text-slate-400 text-center mt-2 px-2">
                                {isPublic
                                    ? "La partida serà visible per a tothom al lobby."
                                    : "Només accessible amb l'enllaç de la partida."}
                            </p>
                        </div>
                        {/* ----- FI DEL NOU INTERRUPTOR ----- */}


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
                        
                    </form>
                </div>
                ) : (
                    <div className="bg-white rounded-2xl p-6 border border-slate-100 shadow-xl text-center">
                         <p className="text-slate-600 text-lg font-medium">Benvingut, {user?.displayName || 'jugador'}!</p>
                         <p className="text-slate-400 text-sm mt-2">Només els usuaris amb rol de "Màster" poden crear partides noves.</p>
                     </div>
                )}

                <div className="mt-8 text-center">
                    <p className="text-xs text-slate-400">
                        Scrabble DupliCat v2.1
                        <br/>Desenvolupat per a la comunitat.
                    </p>
                    {userRole === 'superuser' && (
                       <p className="text-xs text-slate-400 mt-2">
                            <Link to="/master-registration" className="text-indigo-600 hover:underline">Registrar nou màster</Link>
                       </p> 
                    )}
                </div>
            </div>
        </div>
      </div>

      {/* ... El codi del Modal d'Ajuda es manté igual ... */}
      {showHelp && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
              {/* ... contingut del modal ... */}
          </div>
      )}
    </div>
  );
};

export default NewLobbyView;
