import React, { useState, useEffect } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, addDoc, onSnapshot, query } from 'firebase/firestore';

// Firebase-Konfiguration
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

// Vordefinierte Listen für Persönlichkeitsmerkmale und Interessen
const allPersonalityTraits = ['ordentlich', 'ruhig', 'gesellig', 'kreativ', 'sportlich', 'nachtaktiv', 'frühaufsteher'];
const allInterests = ['Kochen', 'Filme', 'Musik', 'Spiele', 'Natur', 'Sport', 'Lesen', 'Reisen', 'Feiern', 'Gaming'];

// Hauptkomponente der WG-Match-Anwendung
function App() {
    const [searcherProfiles, setSearcherProfiles] = useState([]);
    const [wgProfiles, setWgProfiles] = useState([]);
    const [matches, setMatches] = useState([]);
    const [db, setDb] = useState(null);
    const [userId, setUserId] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [showSeekerForm, setShowSeekerForm] = useState(true); // Steuert, welches Formular angezeigt wird
    const [saveMessage, setSaveMessage] = useState('');

    // Firebase-Initialisierung und Authentifizierung
    useEffect(() => {
        let appInstance, dbInstance, authInstance;

        try {
            appInstance = initializeApp(firebaseConfig);
            dbInstance = getFirestore(appInstance);
            authInstance = getAuth(appInstance);

            setDb(dbInstance);

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
    }, []);

    // Echtzeit-Datenabruf für Suchende-Profile von Firestore
    useEffect(() => {
        if (!db || !userId) return;

        setLoading(true);
        const searchersCollectionRef = collection(db, `searcherProfiles`);
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
        const wgsCollectionRef = collection(db, `wgProfiles`);
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

    // **Verbesserte Match-Logik**
    useEffect(() => {
        const calculateMatches = () => {
            const newMatches = [];
            searcherProfiles.forEach(searcher => {
                const matchingWGs = wgProfiles.map(wg => {
                    let score = 0;

                    // 1. Alter Match (Suchender-Alter vs. WG-Altersbereich)
                    // Hohe Priorität: Muss im Bereich liegen
                    if (searcher.age && wg.minAge && wg.maxAge) {
                        if (searcher.age >= wg.minAge && searcher.age <= wg.maxAge) {
                            score += 20;
                        } else {
                            score -= 15; // Deutlicher Abzug, wenn Alter nicht passt
                        }
                    }

                    // 2. Geschlechtspräferenz
                    // Hohe Priorität
                    if (searcher.gender && wg.genderPreference) {
                        if (wg.genderPreference === 'egal' || searcher.gender === wg.genderPreference) {
                            score += 10;
                        } else {
                            score -= 10; // Abzug, wenn Geschlecht nicht passt
                        }
                    }

                    // 3. Persönlichkeitsmerkmale (Übereinstimmung)
                    // Mittlere Priorität
                    const searcherTraits = searcher.personalityTraits || [];
                    const wgTraits = wg.personalityTraits || []; // Für WG-Profile jetzt auch 'personalityTraits'
                    searcherTraits.forEach(trait => {
                        if (wgTraits.includes(trait)) {
                            score += 5;
                        }
                    });

                    // 4. Interessen (Überlappung)
                    // Mittlere Priorität
                    const searcherInterests = searcher.interests || [];
                    const wgInterests = wg.interests || []; // Für WG-Profile jetzt auch 'interests'
                    searcherInterests.forEach(interest => {
                        if (wgInterests.includes(interest)) {
                            score += 3;
                        }
                    });

                    // 5. Mietpreis (Suchender Max. Miete >= WG Miete)
                    // Hohe Priorität
                    if (searcher.maxRent && wg.rent) {
                        if (searcher.maxRent >= wg.rent) {
                            score += 15;
                        } else {
                            score -= 15; // Deutlicher Abzug, wenn Miete zu hoch
                        }
                    }

                    // 6. Haustiere (Match)
                    // Mittlere Priorität
                    if (searcher.pets && wg.petsAllowed) {
                        if (searcher.pets === 'ja' && wg.petsAllowed === 'ja') {
                            score += 8;
                        } else if (searcher.pets === 'ja' && wg.petsAllowed === 'nein') {
                            score -= 8; // Abzug, wenn Haustiere nicht erlaubt sind
                        }
                    }

                    // 7. Freitext 'lookingFor' (Suchender) vs. 'description'/'lookingForInFlatmate' (WG)
                    // Niedrigere Priorität, für Textübereinstimmung
                    const seekerLookingFor = (searcher.lookingFor || '').toLowerCase();
                    const wgDescription = (wg.description || '').toLowerCase();
                    const wgLookingForInFlatmate = (wg.lookingForInFlatmate || '').toLowerCase();

                    const seekerKeywords = seekerLookingFor.split(' ').filter(word => word.length > 2);
                    seekerKeywords.forEach(keyword => {
                        if (wgDescription.includes(keyword) || wgLookingForInFlatmate.includes(keyword)) {
                            score += 1;
                        }
                    });

                    return { wg, score };
                }).filter(match => match.score > 0); // Nur Matches mit positivem Score anzeigen

                // Sortiere die passenden WGs nach Score für diesen Suchenden
                matchingWGs.sort((a, b) => b.score - a.score);

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

    // **Vereinheitlichte Profilformular-Komponente**
    const ProfileForm = ({ onSubmit, type }) => {
        const [formState, setFormState] = useState({
            name: '', // Für Suchender, Name der WG für Anbieter
            age: '', // Alter Suchender
            minAge: '', // Min-Alter Anbieter
            maxAge: '', // Max-Alter Anbieter
            gender: 'männlich', // Geschlecht Suchender
            genderPreference: 'egal', // Geschlechtspräferenz Anbieter
            personalityTraits: [],
            interests: [],
            maxRent: '', // Max. Miete Suchender
            pets: 'egal', // Haustiere Suchender
            lookingFor: '', // Was sucht Suchender
            description: '', // Beschreibung WG
            rent: '', // Miete WG
            roomType: 'Einzelzimmer', // Zimmertyp WG
            petsAllowed: 'egal', // Haustiere erlaubt Anbieter
            avgAge: '', // Durchschnittsalter Bewohner Anbieter
            lookingForInFlatmate: '', // Was sucht WG im Mitbewohner
            location: '', // Ort/Stadtteil
        });

        // Felder, die für beide Typen gleich sind
        const commonFields = ['location'];

        // Felder, die nur für Suchende relevant sind
        const seekerOnlyFields = ['age', 'maxRent', 'pets', 'lookingFor', 'gender'];

        // Felder, die nur für Anbieter relevant sind
        const providerOnlyFields = ['minAge', 'maxAge', 'description', 'rent', 'roomType', 'petsAllowed', 'avgAge', 'lookingForInFlatmate', 'genderPreference'];

        const handleChange = (e) => {
            const { name, value, type, checked } = e.target;
            if (type === 'checkbox') {
                const currentValues = formState[name] || [];
                if (checked) {
                    setFormState({ ...formState, [name]: [...currentValues, value] });
                } else {
                    setFormState({ ...formState, [name]: currentValues.filter((item) => item !== value) });
                }
            } else {
                setFormState({ ...formState, [name]: value });
            }
        };

        const handleSubmit = (e) => {
            e.preventDefault();
            // Umwandlung von Zahlfeldern und Hinzufügen von Werten
            const dataToSubmit = { ...formState };
            if (dataToSubmit.age) dataToSubmit.age = parseInt(dataToSubmit.age);
            if (dataToSubmit.minAge) dataToSubmit.minAge = parseInt(dataToSubmit.minAge);
            if (dataToSubmit.maxAge) dataToSubmit.maxAge = parseInt(dataToSubmit.maxAge);
            if (dataToSubmit.maxRent) dataToSubmit.maxRent = parseInt(dataToSubmit.maxRent);
            if (dataToSubmit.rent) dataToSubmit.rent = parseInt(dataToSubmit.rent);
            if (dataToSubmit.avgAge) dataToSubmit.avgAge = parseInt(dataToSubmit.avgAge);

            onSubmit(dataToSubmit);
            // Formular zurücksetzen nach dem Speichern
            setFormState({
                name: '', age: '', minAge: '', maxAge: '', gender: 'männlich',
                genderPreference: 'egal', personalityTraits: [], interests: [],
                maxRent: '', pets: 'egal', lookingFor: '', description: '', rent: '',
                roomType: 'Einzelzimmer', petsAllowed: 'egal', avgAge: '',
                lookingForInFlatmate: '', location: ''
            });
        };

        return (
            <form onSubmit={handleSubmit} className="p-6 bg-white rounded-xl shadow-lg space-y-4 w-full max-w-xl">
                <h2 className="text-2xl font-bold text-gray-800 mb-4 text-center">
                    {type === 'seeker' ? 'Suchenden-Profil erstellen' : 'WG-Angebot erstellen'}
                </h2>

                {/* Name / WG-Name */}
                <div>
                    <label className="block text-gray-700 text-sm font-bold mb-2">
                        {type === 'seeker' ? 'Dein Name:' : 'Name der WG:'}
                    </label>
                    <input
                        type="text"
                        name="name"
                        value={formState.name}
                        onChange={handleChange}
                        required
                        className="shadow appearance-none border rounded-xl w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
                    />
                </div>

                {/* Alter (Suchender) / Altersbereich (Anbieter) */}
                {type === 'seeker' && (
                    <div>
                        <label className="block text-gray-700 text-sm font-bold mb-2">Dein Alter:</label>
                        <input
                            type="number"
                            name="age"
                            value={formState.age}
                            onChange={handleChange}
                            required
                            className="shadow appearance-none border rounded-xl w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
                        />
                    </div>
                )}
                {type === 'provider' && (
                    <div className="flex space-x-4">
                        <div className="flex-1">
                            <label className="block text-gray-700 text-sm font-bold mb-2">Mindestalter Mitbewohner:</label>
                            <input
                                type="number"
                                name="minAge"
                                value={formState.minAge}
                                onChange={handleChange}
                                required
                                className="shadow appearance-none border rounded-xl w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
                            />
                        </div>
                        <div className="flex-1">
                            <label className="block text-gray-700 text-sm font-bold mb-2">Höchstalter Mitbewohner:</label>
                            <input
                                type="number"
                                name="maxAge"
                                value={formState.maxAge}
                                onChange={handleChange}
                                required
                                className="shadow appearance-none border rounded-xl w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
                            />
                        </div>
                    </div>
                )}

                {/* Geschlecht (Suchender) / Geschlechtspräferenz (Anbieter) */}
                {type === 'seeker' && (
                    <div>
                        <label className="block text-gray-700 text-sm font-bold mb-2">Dein Geschlecht:</label>
                        <select
                            name="gender"
                            value={formState.gender}
                            onChange={handleChange}
                            className="shadow appearance-none border rounded-xl w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
                        >
                            <option value="männlich">Männlich</option>
                            <option value="weiblich">Weiblich</option>
                            <option value="divers">Divers</option>
                        </select>
                    </div>
                )}
                {type === 'provider' && (
                    <div>
                        <label className="block text-gray-700 text-sm font-bold mb-2">Geschlechtspräferenz Mitbewohner:</label>
                        <select
                            name="genderPreference"
                            value={formState.genderPreference}
                            onChange={handleChange}
                            className="shadow appearance-none border rounded-xl w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
                        >
                            <option value="egal">Egal</option>
                            <option value="männlich">Männlich</option>
                            <option value="weiblich">Weiblich</option>
                            <option value="divers">Divers</option>
                        </select>
                    </div>
                )}

                {/* Persönlichkeitsmerkmale (für beide) */}
                <div>
                    <label className="block text-gray-700 text-sm font-bold mb-2">
                        {type === 'seeker' ? 'Deine Persönlichkeitsmerkmale:' : 'Persönlichkeitsmerkmale der aktuellen Bewohner:'}
                    </label>
                    <div className="grid grid-cols-2 gap-2 p-2 border rounded-xl bg-gray-50">
                        {allPersonalityTraits.map(trait => (
                            <label key={trait} className="inline-flex items-center text-gray-800">
                                <input
                                    type="checkbox"
                                    name="personalityTraits" // Name ist für beide gleich
                                    value={trait}
                                    checked={formState.personalityTraits.includes(trait)}
                                    onChange={handleChange}
                                    className="form-checkbox h-5 w-5 text-blue-600 rounded"
                                />
                                <span className="ml-2">{trait}</span>
                            </label>
                        ))}
                    </div>
                </div>

                {/* Interessen (für beide) */}
                <div>
                    <label className="block text-gray-700 text-sm font-bold mb-2">
                        {type === 'seeker' ? 'Deine Interessen:' : 'Interessen der aktuellen Bewohner:'}
                    </label>
                    <div className="grid grid-cols-2 gap-2 p-2 border rounded-xl bg-gray-50">
                        {allInterests.map(interest => (
                            <label key={interest} className="inline-flex items-center text-gray-800">
                                <input
                                    type="checkbox"
                                    name="interests" // Name ist für beide gleich
                                    value={interest}
                                    checked={formState.interests.includes(interest)}
                                    onChange={handleChange}
                                    className="form-checkbox h-5 w-5 text-blue-600 rounded"
                                />
                                <span className="ml-2">{interest}</span>
                            </label>
                        ))}
                    </div>
                </div>

                {/* Maximale Miete (Suchender) / Miete (Anbieter) */}
                {type === 'seeker' && (
                    <div>
                        <label className="block text-gray-700 text-sm font-bold mb-2">Maximale Miete (€):</label>
                        <input
                            type="number"
                            name="maxRent"
                            value={formState.maxRent}
                            onChange={handleChange}
                            className="shadow appearance-none border rounded-xl w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
                        />
                    </div>
                )}
                {type === 'provider' && (
                    <div>
                        <label className="block text-gray-700 text-sm font-bold mb-2">Miete (€):</label>
                        <input
                            type="number"
                            name="rent"
                            value={formState.rent}
                            onChange={handleChange}
                            className="shadow appearance-none border rounded-xl w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
                        />
                    </div>
                )}

                {/* Haustiere (Suchender) / Haustiere erlaubt (Anbieter) */}
                {type === 'seeker' && (
                    <div>
                        <label className="block text-gray-700 text-sm font-bold mb-2">Haustiere:</label>
                        <select
                            name="pets"
                            value={formState.pets}
                            onChange={handleChange}
                            className="shadow appearance-none border rounded-xl w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
                        >
                            <option value="egal">Egal</option>
                            <option value="ja">Ja</option>
                            <option value="nein">Nein</option>
                        </select>
                    </div>
                )}
                {type === 'provider' && (
                    <div>
                        <label className="block text-gray-700 text-sm font-bold mb-2">Haustiere erlaubt:</label>
                        <select
                            name="petsAllowed"
                            value={formState.petsAllowed}
                            onChange={handleChange}
                            className="shadow appearance-none border rounded-xl w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
                        >
                            <option value="egal">Egal</option>
                            <option value="ja">Ja</option>
                            <option value="nein">Nein</option>
                        </select>
                    </div>
                )}

                {/* Was gesucht wird (Suchender) / Beschreibung der WG (Anbieter) */}
                {type === 'seeker' && (
                    <div>
                        <label className="block text-gray-700 text-sm font-bold mb-2">Was suchst du in einer WG?:</label>
                        <textarea
                            name="lookingFor"
                            value={formState.lookingFor}
                            onChange={handleChange}
                            rows="3"
                            className="shadow appearance-none border rounded-xl w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
                        ></textarea>
                    </div>
                )}
                {type === 'provider' && (
                    <>
                        <div>
                            <label className="block text-gray-700 text-sm font-bold mb-2">Beschreibung der WG:</label>
                            <textarea
                                name="description"
                                value={formState.description}
                                onChange={handleChange}
                                rows="3"
                                className="shadow appearance-none border rounded-xl w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
                            ></textarea>
                        </div>
                        <div>
                            <label className="block text-gray-700 text-sm font-bold mb-2">Was sucht ihr im neuen Mitbewohner?:</label>
                            <textarea
                                name="lookingForInFlatmate"
                                value={formState.lookingForInFlatmate}
                                onChange={handleChange}
                                rows="3"
                                className="shadow appearance-none border rounded-xl w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
                            ></textarea>
                        </div>
                    </>
                )}
                {type === 'provider' && (
                    <div>
                        <label className="block text-gray-700 text-sm font-bold mb-2">Zimmertyp:</label>
                        <select
                            name="roomType"
                            value={formState.roomType}
                            onChange={handleChange}
                            className="shadow appearance-none border rounded-xl w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
                        >
                            <option value="Einzelzimmer">Einzelzimmer</option>
                            <option value="Doppelzimmer">Doppelzimmer</option>
                        </select>
                    </div>
                )}
                {type === 'provider' && (
                    <div>
                        <label className="block text-gray-700 text-sm font-bold mb-2">Durchschnittsalter der Bewohner:</label>
                        <input
                            type="number"
                            name="avgAge"
                            value={formState.avgAge}
                            onChange={handleChange}
                            className="shadow appearance-none border rounded-xl w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
                        />
                    </div>
                )}

                {/* Ort/Stadtteil (für beide) */}
                <div>
                    <label className="block text-gray-700 text-sm font-bold mb-2">Ort / Stadtteil:</label>
                    <input
                        type="text"
                        name="location"
                        value={formState.location}
                        onChange={handleChange}
                        className="shadow appearance-none border rounded-xl w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
                    />
                </div>


                <div className="flex justify-between mt-6">
                    <button
                        type="button"
                        onClick={() => setShowSeekerForm(true)} // Zurück zur Auswahl des Formulars
                        className="bg-gray-300 hover:bg-gray-400 text-gray-800 font-bold py-2 px-4 rounded-xl focus:outline-none focus:shadow-outline transition duration-150 ease-in-out"
                    >
                        Abbrechen
                    </button>
                    <button
                        type="submit"
                        className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-xl focus:outline-none focus:shadow-outline transition duration-150 ease-in-out"
                    >
                        Profil speichern
                    </button>
                </div>
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
                    onClick={() => setShowSeekerForm(true)}
                    className={`px-6 py-3 rounded-full text-lg font-semibold shadow-md transition-all duration-200 ${
                        showSeekerForm
                            ? 'bg-blue-600 text-white transform scale-105'
                            : 'bg-white text-blue-800 hover:bg-blue-50'
                    }`}
                >
                    Suchenden-Profil
                </button>
                <button
                    onClick={() => setShowSeekerForm(false)}
                    className={`px-6 py-3 rounded-full text-lg font-semibold shadow-md transition-all duration-200 ${
                        !showSeekerForm
                            ? 'bg-green-600 text-white transform scale-105'
                            : 'bg-white text-green-800 hover:bg-green-50'
                    }`}
                >
                    WG-Angebot
                </button>
            </div>

            <div className="w-full max-w-xl mb-12">
                {showSeekerForm ? (
                    <ProfileForm onSubmit={addSearcherProfile} type="seeker" />
                ) : (
                    <ProfileForm onSubmit={addWGProfile} type="provider" />
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
                                <p className="text-gray-700 mb-4">Interessen: {match.searcher.interests?.join(', ') || 'N/A'}</p>
                                <p className="text-gray-700 mb-4">Persönlichkeit: {match.searcher.personalityTraits?.join(', ') || 'N/A'}</p>


                                <h4 className="text-lg font-semibold text-blue-600 mb-2">Passende WG-Angebote:</h4>
                                <div className="space-y-4">
                                    {match.matchingWGs.map(wgMatch => (
                                        <div key={wgMatch.wg.id} className="bg-white p-4 rounded-lg shadow border border-blue-100">
                                            <p className="font-bold text-gray-800">WG-Name: {wgMatch.wg.name} (Score: {wgMatch.score}) (ID: {wgMatch.wg.id.substring(0, 8)}...)</p>
                                            <p className="text-sm text-gray-600">Gesuchtes Alter: {wgMatch.wg.minAge}-{wgMatch.wg.maxAge}, Geschlechtspräferenz: {wgMatch.wg.genderPreference}</p>
                                            <p className="text-sm text-gray-600">Interessen: {wgMatch.wg.interests?.join(', ') || 'N/A'}</p>
                                            <p className="text-sm text-gray-600">Persönlichkeit der Bewohner: {wgMatch.wg.personalityTraits?.join(', ') || 'N/A'}</p>
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
                                <p className="text-sm text-gray-600">Interessen: {profile.interests?.join(', ') || 'N/A'}</p>
                                <p className="text-sm text-gray-600">Persönlichkeit: {profile.personalityTraits?.join(', ') || 'N/A'}</p>
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
                                <p className="font-semibold text-green-700">WG-Name: {profile.name}</p> {/* Name der WG */}
                                <p className="text-sm text-gray-600">Gesuchtes Alter: {profile.minAge}-{profile.maxAge}</p>
                                <p className="text-sm text-gray-600">Geschlechtspräferenz: {profile.genderPreference}</p>
                                <p className="text-sm text-gray-600">Interessen: {profile.interests?.join(', ') || 'N/A'}</p>
                                <p className="text-sm text-gray-600">Persönlichkeit der Bewohner: {profile.personalityTraits?.join(', ') || 'N/A'}</p>
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