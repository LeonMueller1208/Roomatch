import React, { useState, useEffect } from 'react';
// Importiere Firebase-Module direkt aus dem installierten Paket
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, addDoc, onSnapshot, query } from 'firebase/firestore';

// **Firebase-Konfiguration außerhalb der Komponente definiert**
// Dies stellt sicher, dass firebaseConfig nur einmal initialisiert wird
// und keine Abhängigkeitsprobleme im useEffect verursacht.
// DEINE ECHTEN FIREBASE-KONFIGURATIONSDATEN SIND HIER EINGEFÜGT!
const firebaseConfig = {
    apiKey: "AIzaSyACGoSxD0_UZhWg06gzZjaifBn3sI06YGg",
    authDomain: "mvp-roomatch.firebaseapp.com",
    projectId: "mvp-roomatch",
    storageBucket: "mvp-roomatch.firebasestorage.app",
    messagingSenderId: "190918526277",
    appId: "1:190918526277:web:268e07e2f1f326b8e86a2c",
    measurementId: "G-5JPWLDD0ZC"
};

// Hauptkomponente der WG-Match-Anwendung
function App() {
    // Zustand für die Liste der suchenden Profile
    const [searcherProfiles, setSearcherProfiles] = useState([]);
    // Zustand für die Liste der WG-Angebote
    const [wgProfiles, setWgProfiles] = useState([]);
    // Zustand für die aktuell angezeigten Matches
    const [matches, setMatches] = useState([]);
    // Zustand für die Firebase Firestore-Datenbankinstanz
    const [db, setDb] = useState(null);
    // GEÄNDERT: appId-State-Variable entfernt, da nicht mehr benötigt und ESLint-Fehler verursacht hat.
    // Die projectId aus firebaseConfig wird direkt für die Firestore-Pfade verwendet.
    const [userId, setUserId] = useState(null);
    // Zustand für den Ladezustand der Firebase-Initialisierung und Daten
    const [loading, setLoading] = useState(true);
    // Zustand für Fehlermeldungen
    const [error, setError] = useState(null);
    // Zustand für die Umschaltung zwischen Suchenden- und WG-Formular
    const [showSearcherForm, setShowSearcherForm] = useState(true);
    // Zustand für die Meldung nach dem Speichern (z.B. "Profil gespeichert!")
    const [saveMessage, setSaveMessage] = useState('');

    // Initialisierung von Firebase (Firestore und Auth) und Setzen des Auth-State-Listeners
    useEffect(() => {
        let appInstance, dbInstance, authInstance;

        try {
            appInstance = initializeApp(firebaseConfig);
            dbInstance = getFirestore(appInstance);
            authInstance = getAuth(appInstance);

            setDb(dbInstance);
            // GEÄNDERT: 'currentAppId' wurde entfernt, da es nicht verwendet wurde.
            // Die projectId aus firebaseConfig wird bei Bedarf direkt genutzt.

            const unsubscribeAuth = onAuthStateChanged(authInstance, async (user) => {
                if (!user) {
                    try {
                        await signInAnonymously(authInstance);
                    } catch (signInError) {
                        console.error("Fehler bei der Firebase-Anonym-Authentifizierung:", signInError);
                        setError("Fehler bei der Anmeldung. Bitte versuchen Sie es später erneut.");
                        setLoading(false);
                        return;
                    }
                }
                setUserId(authInstance.currentUser?.uid || 'anonymous-' + Date.now() + '-' + Math.random().toString(36).substring(2));
                setLoading(false);
            });

            return () => {
                unsubscribeAuth();
            };
        } catch (initError) {
            console.error("Fehler bei der Firebase-Initialisierung:", initError);
            setError("Firebase konnte nicht initialisiert werden. Bitte überprüfen Sie Ihre Firebase-Konfiguration und Internetverbindung.");
            setLoading(false);
        }
    }, []); // Abhängigkeits-Array ist leer, da firebaseConfig außerhalb der Komponente stabil ist.


    // Echtzeit-Datenabruf für Suchende-Profile von Firestore
    useEffect(() => {
        if (!db || !userId) return;

        setLoading(true);
        const searchersCollectionRef = collection(db, `searcherProfiles`); // Vereinfachter Pfad
        const q = query(searchersCollectionRef);

        const unsubscribeSearchers = onSnapshot(q, (snapshot) => {
            const profiles = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            setSearcherProfiles(profiles);
            setLoading(false);
        }, (err) => {
            console.error("Fehler beim Abrufen der Suchenden-Profile:", err);
            setError("Fehler beim Laden der Suchenden-Profile.");
            setLoading(false);
        });

        return () => unsubscribeSearchers();
    }, [db, userId]);


    // Echtzeit-Datenabruf für WG-Profile von Firestore
    useEffect(() => {
        if (!db || !userId) return;

        setLoading(true);
        const wgsCollectionRef = collection(db, `wgProfiles`); // Vereinfachter Pfad
        const q = query(wgsCollectionRef);

        const unsubscribeWGs = onSnapshot(q, (snapshot) => {
            const profiles = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            setWgProfiles(profiles);
            setLoading(false);
        }, (err) => {
            console.error("Fehler beim Abrufen der WG-Profile:", err);
            setError("Fehler beim Laden der WG-Profile.");
            setLoading(false);
        });

        return () => unsubscribeWGs();
    }, [db, userId]);


    // Match-Logik, die ausgelöst wird, wenn sich searcherProfiles oder wgProfiles ändern
    useEffect(() => {
        const calculateMatches = () => {
            const newMatches = [];
            searcherProfiles.forEach(searcher => {
                const matchingWGs = wgProfiles.filter(wg => {
                    const ageMatch = !searcher.age || !wg.age || (searcher.age >= wg.minAge && searcher.age <= wg.maxAge);
                    const genderMatch = !searcher.gender || !wg.genderPreference || wg.genderPreference === 'egal' || searcher.gender === wg.genderPreference;
                    const searcherInterests = searcher.interests ? searcher.interests.split(',').map(i => i.trim().toLowerCase()) : [];
                    const wgInterests = wg.interests ? wg.interests.split(',').map(i => i.trim().toLowerCase()) : [];
                    const interestsMatch = searcherInterests.some(si => wgInterests.includes(si));

                    return ageMatch && genderMatch && interestsMatch;
                });

                if (matchingWGs.length > 0) {
                    newMatches.push({
                        searcher: searcher,
                        matchingWGs: matchingWGs
                    });
                }
            });
            setMatches(newMatches);
        };

        if (searcherProfiles.length > 0 || wgProfiles.length > 0) {
            calculateMatches();
        } else {
            setMatches([]);
        }
    }, [searcherProfiles, wgProfiles]);

    // Funktion zum Hinzufügen eines Suchenden-Profils zu Firestore
    const addSearcherProfile = async (profileData) => {
        if (!db || !userId) {
            setError("Datenbank nicht bereit. Bitte warten Sie oder melden Sie sich an.");
            return;
        }
        try {
            await addDoc(collection(db, `searcherProfiles`), {
                ...profileData,
                createdAt: new Date(),
                createdBy: userId,
            });
            setSaveMessage('Suchenden-Profil erfolgreich gespeichert!');
            setTimeout(() => setSaveMessage(''), 3000);
        } catch (e) {
            console.error("Fehler beim Hinzufügen des Suchenden-Profils: ", e);
            setError("Fehler beim Speichern des Suchenden-Profils.");
        }
    };

    // Funktion zum Hinzufügen eines WG-Profils zu Firestore
    const addWGProfile = async (profileData) => {
        if (!db || !userId) {
            setError("Datenbank nicht bereit. Bitte warten Sie oder melden Sie sich an.");
            return;
        }
        try {
            await addDoc(collection(db, `wgProfiles`), {
                ...profileData,
                createdAt: new Date(),
                createdBy: userId,
            });
            setSaveMessage('WG-Profil erfolgreich gespeichert!');
            setTimeout(() => setSaveMessage(''), 3000);
        } catch (e) {
            console.error("Fehler beim Hinzufügen des WG-Profils: ", e);
            setError("Fehler beim Speichern des WG-Profils.");
        }
    };

    // Komponenten für Formulare und Anzeige
    const SearcherForm = ({ onSubmit }) => {
        const [name, setName] = useState('');
        const [age, setAge] = useState('');
        const [gender, setGender] = useState('männlich');
        const [interests, setInterests] = useState('');

        const handleSubmit = (e) => {
            e.preventDefault();
            onSubmit({ name, age: parseInt(age), gender, interests });
            setName('');
            setAge('');
            setGender('männlich');
            setInterests('');
        };

        return (
            <form onSubmit={handleSubmit} className="p-6 bg-white rounded-xl shadow-lg space-y-4">
                <h2 className="text-2xl font-bold text-gray-800 mb-4">Suchenden-Profil erstellen</h2>
                <div>
                    <label className="block text-gray-700 text-sm font-bold mb-2">Name:</label>
                    <input
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        required
                        className="shadow appearance-none border rounded-xl w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
                    />
                </div>
                <div>
                    <label className="block text-gray-700 text-sm font-bold mb-2">Alter:</label>
                    <input
                        type="number"
                        value={age}
                        onChange={(e) => setAge(e.target.value)}
                        required
                        className="shadow appearance-none border rounded-xl w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
                    />
                </div>
                <div>
                    <label className="block text-gray-700 text-sm font-bold mb-2">Geschlecht:</label>
                    <select
                        value={gender}
                        onChange={(e) => setGender(e.target.value)}
                        className="shadow appearance-none border rounded-xl w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
                    >
                        <option value="männlich">Männlich</option>
                        <option value="weiblich">Weiblich</option>
                        <option value="divers">Divers</option>
                    </select>
                </div>
                <div>
                    <label className="block text-gray-700 text-sm font-bold mb-2">Interessen (kommagetrennt):</label>
                    <input
                        type="text"
                        value={interests}
                        onChange={(e) => setInterests(e.target.value)}
                        className="shadow appearance-none border rounded-xl w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
                    />
                </div>
                <button
                    type="submit"
                    className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-xl focus:outline-none focus:shadow-outline transition duration-150 ease-in-out"
                >
                    Profil erstellen
                </button>
            </form>
        );
    };

    const WGForm = ({ onSubmit }) => {
        const [wgName, setWgName] = useState('');
        const [minAge, setMinAge] = useState('');
        const [maxAge, setMaxAge] = useState('');
        const [genderPreference, setGenderPreference] = useState('egal');
        const [interests, setInterests] = useState('');

        const handleSubmit = (e) => {
            e.preventDefault();
            onSubmit({
                wgName,
                minAge: parseInt(minAge),
                maxAge: parseInt(maxAge),
                genderPreference,
                interests
            });
            setWgName('');
            setMinAge('');
            setMaxAge('');
            setGenderPreference('egal');
            setInterests('');
        };

        return (
            <form onSubmit={handleSubmit} className="p-6 bg-white rounded-xl shadow-lg space-y-4">
                <h2 className="text-2xl font-bold text-gray-800 mb-4">WG-Angebot erstellen</h2>
                <div>
                    <label className="block text-gray-700 text-sm font-bold mb-2">WG-Name:</label>
                    <input
                        type="text"
                        value={wgName}
                        onChange={(e) => setWgName(e.target.value)}
                        required
                        className="shadow appearance-none border rounded-xl w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
                    />
                </div>
                <div>
                    <label className="block text-gray-700 text-sm font-bold mb-2">Mindestalter:</label>
                    <input
                        type="number"
                        value={minAge}
                        onChange={(e) => setMinAge(e.target.value)}
                        required
                        className="shadow appearance-none border rounded-xl w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
                    />
                </div>
                <div>
                    <label className="block text-gray-700 text-sm font-bold mb-2">Höchstalter:</label>
                    <input
                        type="number"
                        value={maxAge}
                        onChange={(e) => setMaxAge(e.target.value)}
                        required
                        className="shadow appearance-none border rounded-xl w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
                    />
                </div>
                <div>
                    <label className="block text-gray-700 text-sm font-bold mb-2">Geschlechtspräferenz:</label>
                    <select
                        value={genderPreference}
                        onChange={(e) => setGenderPreference(e.target.value)}
                        className="shadow appearance-none border rounded-xl w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
                    >
                        <option value="egal">Egal</option>
                        <option value="männlich">Männlich</option>
                        <option value="weiblich">Weiblich</option>
                        <option value="divers">Divers</option>
                    </select>
                </div>
                <div>
                    <label className="block text-gray-700 text-sm font-bold mb-2">Interessen (kommagetrennt):</label>
                    <input
                        type="text"
                        value={interests}
                        onChange={(e) => setInterests(e.target.value)}
                        className="shadow appearance-none border rounded-xl w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
                    />
                </div>
                <button
                    type="submit"
                    className="bg-green-500 hover:bg-green-700 text-white font-bold py-2 px-4 rounded-xl focus:outline-none focus:shadow-outline transition duration-150 ease-in-out"
                >
                    Angebot erstellen
                </button>
            </form>
        );
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-screen bg-gray-100">
                <p className="text-gray-700 text-lg">Lade App und Daten...</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex items-center justify-center min-h-screen bg-red-100 text-red-700 p-4 rounded-lg">
                <p>Fehler: {error}</p>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gradient-to-br from-blue-100 to-purple-200 p-8 font-inter flex flex-col items-center">
            <h1 className="text-5xl font-extrabold text-gray-900 mb-6 text-center">WG-Match App</h1>
            {userId && (
                <div className="bg-blue-200 text-blue-800 text-sm px-4 py-2 rounded-full mb-6 shadow">
                    Ihre Benutzer-ID: <span className="font-mono font-semibold">{userId}</span>
                </div>
            )}
            {saveMessage && (
                <div className="bg-green-100 text-green-700 px-4 py-2 rounded-lg mb-4 shadow-md transition-all duration-300">
                    {saveMessage}
                </div>
            )}

            <div className="w-full max-w-4xl flex justify-center space-x-4 mb-8">
                <button
                    onClick={() => setShowSearcherForm(true)}
                    className={`px-6 py-3 rounded-full text-lg font-semibold shadow-md transition-all duration-200 ${
                        showSearcherForm
                            ? 'bg-blue-600 text-white transform scale-105'
                            : 'bg-white text-blue-800 hover:bg-blue-50'
                    }`}
                >
                    Suchenden-Profil
                </button>
                <button
                    onClick={() => setShowSearcherForm(false)}
                    className={`px-6 py-3 rounded-full text-lg font-semibold shadow-md transition-all duration-200 ${
                        !showSearcherForm
                            ? 'bg-green-600 text-white transform scale-105'
                            : 'bg-white text-green-800 hover:bg-green-50'
                    }`}
                >
                    WG-Angebot
                </button>
            </div>

            <div className="w-full max-w-xl mb-12">
                {showSearcherForm ? (
                    <SearcherForm onSubmit={addSearcherProfile} />
                ) : (
                    <WGForm onSubmit={addWGProfile} />
                )}
            </div>

            <div className="w-full max-w-6xl bg-white p-8 rounded-xl shadow-2xl">
                <h2 className="text-3xl font-bold text-gray-800 mb-6 text-center">Matches</h2>
                {matches.length === 0 ? (
                    <p className="text-center text-gray-600 text-lg">
                        Keine Matches gefunden. Erstellen Sie Profile, um Übereinstimmungen zu sehen!
                    </p>
                ) : (
                    <div className="space-y-8">
                        {matches.map((match, index) => (
                            <div key={index} className="bg-blue-50 p-6 rounded-lg shadow-inner border border-blue-200">
                                <h3 className="text-xl font-semibold text-blue-700 mb-3">
                                    Suchender: <span className="font-bold">{match.searcher.name}</span> (ID: {match.searcher.id.substring(0, 8)}...)
                                </h3>
                                <p className="text-gray-700 mb-2">Alter: {match.searcher.age}, Geschlecht: {match.searcher.gender}</p>
                                <p className="text-gray-700 mb-4">Interessen: {match.searcher.interests}</p>

                                <h4 className="text-lg font-semibold text-blue-600 mb-2">Passende WG-Angebote:</h4>
                                <div className="space-y-4">
                                    {match.matchingWGs.map(wg => (
                                        <div key={wg.id} className="bg-white p-4 rounded-lg shadow border border-blue-100">
                                            <p className="font-bold text-gray-800">{wg.wgName} (ID: {wg.id.substring(0, 8)}...)</p>
                                            <p className="text-sm text-gray-600">Alter: {wg.minAge}-{wg.maxAge}, Geschlechtspräferenz: {wg.genderPreference}</p>
                                            <p className="text-sm text-gray-600">Interessen: {wg.interests}</p>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <div className="w-full max-w-6xl mt-12 bg-white p-8 rounded-xl shadow-2xl">
                <h2 className="text-3xl font-bold text-gray-800 mb-6 text-center">Alle Suchenden-Profile</h2>
                {searcherProfiles.length === 0 ? (
                    <p className="text-center text-gray-600 text-lg">Noch keine Suchenden-Profile vorhanden.</p>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {searcherProfiles.map(profile => (
                            <div key={profile.id} className="bg-purple-50 p-5 rounded-lg shadow-inner border border-purple-200">
                                <p className="font-semibold text-purple-700">Name: {profile.name}</p>
                                <p className="text-sm text-gray-600">Alter: {profile.age}</p>
                                <p className="text-sm text-gray-600">Geschlecht: {profile.gender}</p>
                                <p className="text-sm text-gray-600">Interessen: {profile.interests}</p>
                                <p className="text-xs text-gray-500 mt-2">Erstellt von: {profile.createdBy.substring(0, 8)}...</p>
                                <p className="text-xs text-gray-500">Am: {new Date(profile.createdAt.toDate()).toLocaleDateString()}</p>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <div className="w-full max-w-6xl mt-8 bg-white p-8 rounded-xl shadow-2xl">
                <h2 className="text-3xl font-bold text-gray-800 mb-6 text-center">Alle WG-Angebote</h2>
                {wgProfiles.length === 0 ? (
                    <p className="text-center text-gray-600 text-lg">Noch keine WG-Angebote vorhanden.</p>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {wgProfiles.map(profile => (
                            <div key={profile.id} className="bg-green-50 p-5 rounded-lg shadow-inner border border-green-200">
                                <p className="font-semibold text-green-700">Name: {profile.wgName}</p>
                                <p className="text-sm text-gray-600">Alter: {profile.minAge}-{profile.maxAge}</p>
                                <p className="text-sm text-gray-600">Geschlecht: {profile.genderPreference}</p>
                                <p className="text-sm text-gray-600">Interessen: {profile.interests}</p>
                                <p className="text-xs text-gray-500 mt-2">Erstellt von: {profile.createdBy.substring(0, 8)}...</p>
                                <p className="text-xs text-gray-500">Am: {new Date(profile.createdAt.toDate()).toLocaleDateString()}</p>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

export default App;