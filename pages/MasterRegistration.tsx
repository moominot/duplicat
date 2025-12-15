
import React, { useState, useEffect } from 'react';
import { getAuth, createUserWithEmailAndPassword, onAuthStateChanged, User } from "firebase/auth";
import { getDatabase, ref, set, get, onValue, off } from 'firebase/database';

interface Master {
    uid: string;
    email: string;
    role: string;
}

const MasterRegistration: React.FC = () => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);
    const [user, setUser] = useState<User | null>(null);
    const [userRole, setUserRole] = useState<string | null>(null);
    const [masters, setMasters] = useState<Master[]>([]);

    useEffect(() => {
        const auth = getAuth();
        const db = getDatabase();

        const unsubscribeAuth = onAuthStateChanged(auth, async (currentUser) => {
            if (currentUser) {
                setUser(currentUser);
                const userRoleRef = ref(db, `masters/${currentUser.uid}/role`);
                const snapshot = await get(userRoleRef);
                if (snapshot.exists()) {
                    setUserRole(snapshot.val());
                }
            } else {
                setUser(null);
                setUserRole(null);
            }
        });

        const mastersRef = ref(db, 'masters');
        onValue(mastersRef, (snapshot) => {
            const data = snapshot.val();
            if (data) {
                const masterList = Object.keys(data).map(uid => ({
                    uid,
                    email: data[uid].email, // Display email
                    role: data[uid].role,
                }));
                setMasters(masterList);
            }
        });

        return () => {
            unsubscribeAuth();
            off(mastersRef);
        };
    }, []);

    const handleRegister = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setSuccess(null);

        if (!email || !password) {
            setError("Email and password cannot be empty.");
            return;
        }

        const auth = getAuth();
        try {
            const userCredential = await createUserWithEmailAndPassword(auth, email, password);
            const newUser = userCredential.user;
            const uid = newUser.uid;

            const db = getDatabase();
            const masterRef = ref(db, `masters/${uid}`);
            // Save role and email
            await set(masterRef, { role: 'user', email: email });
            
            setSuccess(`User ${email} registered successfully as a player!` );
            
            setEmail('');
            setPassword('');

        } catch (err: any) {
            setError(`Error registering: ${err.message}`);
        }
    };

    const handleRoleChange = async (uid: string, newRole: string) => {
        if (userRole !== 'superuser') {
            setError('You do not have permission to change roles.');
            return;
        }

        try {
            const db = getDatabase();
            const userRoleRef = ref(db, `masters/${uid}/role`);
            await set(userRoleRef, newRole);
            
            const master = masters.find(m => m.uid === uid);
            const userIdentifier = master ? master.email : uid;

            setSuccess(`Role for user ${userIdentifier} updated to ${newRole}`);
        } catch (err: any) {
            setError(`Failed to update role: ${err.message}`);
        }
    };

    if (userRole === 'superuser') {
        return (
            <div className="min-h-screen bg-gray-100 p-8">
                <div className="max-w-4xl mx-auto bg-white p-8 rounded-lg shadow-md">
                    <h1 className="text-2xl font-bold mb-6">Master Management</h1>
                    {error && <p className="text-red-500 text-sm mb-4">{error}</p>}
                    {success && <p className="text-green-500 text-sm mb-4">{success}</p>}
                    <div className="space-y-4">
                        {masters.map(m => (
                            <div key={m.uid} className="flex items-center justify-between p-4 border rounded-lg">
                                <span className="font-medium text-gray-800">{m.email}</span>
                                <select 
                                    value={m.role} 
                                    onChange={(e) => handleRoleChange(m.uid, e.target.value)}
                                    className="px-3 py-2 border rounded-lg bg-gray-50"
                                >
                                    <option value="user">User</option>
                                    <option value="master">Master</option>
                                    <option value="superuser">Superuser</option>
                                </select>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-100 flex items-center justify-center">
            <div className="bg-white p-8 rounded-lg shadow-md w-full max-w-md">
                <h1 className="text-2xl font-bold mb-6">Register</h1>
                <form onSubmit={handleRegister}>
                    <div className="mb-4">
                        <label htmlFor="email" className="block text-gray-700 font-bold mb-2">Email</label>
                        <input
                            type="email"
                            id="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring focus:border-blue-300"
                            placeholder="Enter your email"
                            required
                        />
                    </div>
                    <div className="mb-4">
                        <label htmlFor="password" className="block text-gray-700 font-bold mb-2">Password</label>
                        <input
                            type="password"
                            id="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring focus:border-blue-300"
                            placeholder="Enter a password (min. 6 chars)"
                            required
                        />
                    </div>

                    {error && <p className="text-red-500 text-sm mb-4">{error}</p>}
                    {success && <p className="text-green-500 text-sm mb-4">{success}</p>}

                    <button
                        type="submit"
                        className="w-full bg-blue-500 text-white font-bold py-2 px-4 rounded-lg hover:bg-blue-600 focus:outline-none focus:ring-4 focus:ring-blue-300"
                    >
                        Register as Player
                    </button>
                </form>
            </div>
        </div>
    );
};

export default MasterRegistration;
