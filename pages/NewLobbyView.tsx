import React, { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { createNewGame, getPublicGames, getGamesByMaster, getAllGames } from '../services/gameService';
import { getAuth, onAuthStateChanged, User } from 'firebase/auth';
import { getDatabase, ref, get } from 'firebase/database';
import { signOut } from 'firebase/auth';

const NewLobbyView: React.FC = () => {
  const navigate = useNavigate();
  const [games, setGames] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [hostName, setHostName] = useState('');
  const [isPublic, setIsPublic] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);
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
        const role = snapshot.exists() ? snapshot.val() : 'user';
        setUserRole(role);
        loadGames(role, user.uid);
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
      if (role === 'superuser') {
        list = await getAllGames();
      } else if (role === 'master' && uid) {
        list = await getGamesByMaster(uid);
      } else {
        list = await getPublicGames();
      }
      setGames(list);
    } catch (e) {
      console.error("Error loading games:", e);
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hostName || !user) return;
    
    setIsCreating(true);
    setErrorMsg(null);
    try {
      const gameId = await createNewGame(hostName, user.uid, isPublic);
      navigate(`/master?gameId=${gameId}`);
    } catch (error: any) {
        let msg = "Error creating game.";
        if (error.code === 'PERMISSION_DENIED') {
            msg = "PERMISSION DENIED: Check Firebase Console Rules.";
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
        console.error("Error signing out:", error);
    }
  };

  const getGameListTitle = () => {
    if (userRole === 'superuser') return 'All Games (Admin)';
    if (userRole === 'master') return 'Your Games';
    return 'Public Games';
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      <nav className="w-full p-4 flex justify-between items-center max-w-6xl mx-auto">
          {user && (
            <div className="flex items-center gap-3 bg-white px-4 py-2 rounded-full shadow-sm border">
                <span className="text-xl">{userRole === 'superuser' ? '👑' : (userRole === 'master' ? '🧑‍🏫' : '👤')}</span>
                <span className="font-bold text-sm">{user.displayName || user.email}</span>
            </div>
          )}
          <div className="flex items-center">
            <button onClick={() => setShowHelp(true)} className="px-4 py-2 rounded-full hover:bg-white">
              ? Help
            </button>
            {user && (
              <button onClick={handleLogout} className="px-4 py-2 rounded-full hover:bg-white">
                Sign Out
              </button>
            )}
          </div>
      </nav>

      <div className="max-w-5xl mx-auto px-4 pb-12">
        <div className="text-center space-y-6 py-8">
            <h1 className="text-6xl font-black tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-slate-800 to-indigo-800">
                Scrabble DupliCat
            </h1>
        </div>

        <div className="grid md:grid-cols-12 gap-8 items-start">
            <div className="md:col-span-7 lg:col-span-8 space-y-6">
                <div className="flex justify-between items-center px-2">
                    <h2 className="text-2xl font-bold">{getGameListTitle()}</h2>
                    <button onClick={() => user && loadGames(userRole || 'user', user.uid)} className="text-xs font-bold text-indigo-600 bg-indigo-50 px-3 py-1.5 rounded-full">
                        ↻ Refresh
                    </button>
                </div>

                {loading ? (
                    <div className="text-center p-12"><p>Loading games...</p></div>
                ) : games.length === 0 ? (
                    <div className="text-center p-12"><p>No active games found.</p></div>
                ) : (
                    <div className="space-y-4">
                        {games.map((g) => (
                            <div key={g.id} className="bg-white p-6 rounded-2xl border shadow-lg">
                                <div className="flex justify-between items-start mb-4">
                                    <div>
                                        <div className="font-black text-xl">{g.host}</div>
                                        <div className="text-xs text-slate-400 uppercase">
                                            {userRole === 'superuser' && (g.isPublic ? 'PUBLIC' : 'PRIVATE')} ID: {g.id.substring(0,8)}...
                                        </div>
                                    </div>
                                    <span className="bg-indigo-50 text-indigo-700 px-3 py-1 rounded-lg text-sm font-bold">Ronda {g.round}</span>
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <button onClick={() => joinGame(g.id, 'player')} className="col-span-2 bg-indigo-600 hover:bg-indigo-700 text-white py-3 rounded-xl font-bold">
                                        JOIN AS PLAYER
                                    </button>
                                    <button onClick={() => joinGame(g.id, 'projector')} className="bg-slate-100 hover:bg-slate-200 py-2 rounded-xl text-sm">
                                        Projector
                                    </button>
                                    <button onClick={() => joinGame(g.id, 'master')} className="bg-slate-100 hover:bg-slate-200 py-2 rounded-xl text-sm">
                                        Master Panel
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <div className="md:col-span-5 lg:col-span-4 sticky top-8">
                {(userRole === 'master' || userRole === 'superuser') && (
                <div className="bg-white rounded-2xl p-6 border shadow-xl">
                    <h2 className="text-xl font-bold mb-4">Create New Game</h2>
                    <form onSubmit={handleCreate} className="space-y-4">
                        <input type="text" value={hostName} onChange={(e) => setHostName(e.target.value)} placeholder="Organizer / Club Name" className="w-full p-3 border-2 rounded-xl" required />
                        <div>
                            <label className="flex items-center justify-center gap-4 bg-slate-50 p-2 rounded-xl border-2">
                                <span className={!isPublic ? 'font-bold text-indigo-600' : ''}>Private</span>
                                <button type="button" onClick={() => setIsPublic(!isPublic)} className={`h-6 w-11 rounded-full ${isPublic ? 'bg-indigo-600' : 'bg-slate-300'}`}>
                                    <span className={`inline-block h-5 w-5 m-0.5 rounded-full bg-white transform transition-transform ${isPublic ? 'translate-x-5' : 'translate-x-0'}`}/>
                                </button>
                                <span className={isPublic ? 'font-bold text-indigo-600' : ''}>Public</span>
                            </button>
                        </div>
                        {errorMsg && <p className="text-red-500 text-xs">{errorMsg}</p>}
                        <button type="submit" disabled={isCreating || !hostName} className="w-full py-3 bg-slate-900 text-white font-bold rounded-xl disabled:opacity-50">
                            {isCreating ? 'Creating...' : 'CREATE & JOIN'}
                        </button>
                    </form>
                </div>
                )}
                <div className="mt-8 text-center text-xs text-slate-400">
                    <p>Scrabble DupliCat v2.1</p>
                    {userRole === 'superuser' && <Link to="/master-registration" className="text-indigo-600">Register new master</Link>}
                </div>
            </div>
        </div>
      </div>
    </div>
  );
};

export default NewLobbyView;
